import type { BeliefStore } from '../belief/BeliefStore.js';
import type { FactStore, FactRecord } from '../store/FactStore.js';
import type { EntityStore } from '../store/EntityStore.js';
import type { SummaryStore } from '../store/SummaryStore.js';
import type { GraphEdgeStoreLike } from '../types/ExtensionPoints.js';
import {
  DeepWriteCandidateStore,
  type DeepWriteCandidateRecord,
  type DeepWriteCandidateStatus
} from '../store/DeepWriteCandidateStore.js';
import type { BeliefCandidate } from '../types/index.js';

export type DeepWritePromotionOutcome =
  | 'promote_provisional'
  | 'promote_verified'
  | 'needs_confirmation'
  | 'keep_candidate'
  | 'reject';

export interface DeepWritePromotionDecision {
  outcome: DeepWritePromotionOutcome;
  reason: string;
  targetType?: string;
  targetId?: string;
}

export interface DeepWritePromotionPolicyDeps {
  candidateStore: DeepWriteCandidateStore;
  factStore?: FactStore;
  beliefStore?: BeliefStore;
  entityStore?: EntityStore;
  summaryStore?: SummaryStore;
  relationStore?: GraphEdgeStoreLike;
  minPromoteConfidence: number;
  promoteCausalLinks?: boolean;
}

export interface DeepWritePromotionOptions {
  projectId?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return undefined;
}

function numberField(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function sourceOf(record: Record<string, unknown>): string {
  return String(record.source || record.sourceType || record.attribution || '').toLowerCase();
}

function durabilityOf(record: Record<string, unknown>): string {
  return String(record.durability || record.memoryDurability || '').toLowerCase();
}

function riskOf(record: Record<string, unknown>): string {
  return String(record.risk || record.claimRisk || '').toLowerCase();
}

function evidenceArray(candidate: DeepWriteCandidateRecord): unknown[] {
  return Array.isArray(candidate.evidence) ? candidate.evidence : [];
}

function firstEvidenceNeuronId(candidate: DeepWriteCandidateRecord): string | undefined {
  for (const item of evidenceArray(candidate)) {
    if (typeof item === 'string' && item.trim()) return item.trim();
    const record = asRecord(item);
    const id = stringField(record, ['neuronId', 'neuron_id', 'id', 'sourceNeuronId', 'eventId']);
    if (id) return id;
    const sourceAnchor = asRecord(record.sourceAnchor);
    const anchorId = stringField(sourceAnchor, ['eventId', 'id']);
    if (anchorId) return anchorId;
  }
  return undefined;
}

function hasExplicitUserSource(record: Record<string, unknown>): boolean {
  const source = sourceOf(record);
  return source.includes('explicit_user')
    || source.includes('user_statement')
    || source === 'user'
    || source === 'user_input';
}

function hasMixedSource(record: Record<string, unknown>): boolean {
  return sourceOf(record).includes('mixed');
}

function isInferenceOnly(record: Record<string, unknown>): boolean {
  const source = sourceOf(record);
  const risk = riskOf(record);
  return source.includes('assistant')
    || source.includes('inference')
    || source.includes('inferred')
    || source.includes('model')
    || risk.includes('inferred')
    || risk.includes('metaphor')
    || risk.includes('emotion');
}

function hasUserTurnEvidence(candidate: DeepWriteCandidateRecord): boolean {
  return evidenceArray(candidate).some((item) => {
    const record = asRecord(item);
    return String(record.role || record.turnRole || '').toLowerCase() === 'user';
  });
}

function isOrganizationCandidate(type: string): boolean {
  return type === 'correction'
    || type === 'semantic_tags'
    || type === 'indexing_decision'
    || type === 'semantic_relation'
    || type === 'edge_adjustment';
}

function isSummaryLikeCandidate(type: string): boolean {
  return type === 'summary'
    || type === 'session_summary'
    || type === 'topic_summary'
    || type === 'project_memory'
    || type === 'failure_lesson'
    || type === 'diagnostic_conclusion';
}

function isPreferenceLikeCandidate(type: string): boolean {
  return type === 'preferences'
    || type === 'user_preference'
    || type === 'boundary'
    || type === 'long_term_goal';
}

function promotedSummaryContent(type: string, content: Record<string, unknown>): Record<string, unknown> {
  const text = stringField(content, ['summary', 'statement', 'text', 'content', 'recommendation', 'rootCause', 'newStatement']);
  const topic = stringField(content, ['topic', 'category', 'candidateBucket']);
  return {
    ...content,
    summary: text || JSON.stringify(content),
    scope: type === 'session_summary' ? 'session' : type === 'project_memory' ? 'project' : 'turn_window',
    source: stringField(content, ['source']) || 'deep_write_summary_candidate',
    topic,
  };
}

function promotedPreferenceContent(type: string, content: Record<string, unknown>): Record<string, unknown> {
  const value = stringField(content, ['object', 'objectValue', 'value', 'preferenceValue', 'statement', 'summary', 'text']);
  return {
    ...content,
    predicate: stringField(content, ['predicate', 'preference', 'kind']) || type,
    object: value,
    statement: value,
    source: stringField(content, ['source']) || 'deep_write_preference_candidate',
  };
}

function sourceNeuronIds(candidate: DeepWriteCandidateRecord): string[] {
  return evidenceArray(candidate)
    .map((item) => {
      if (typeof item === 'string') return item;
      const record = asRecord(item);
      return stringField(record, ['neuronId', 'neuron_id', 'id', 'sourceNeuronId', 'sourceId', 'eventId'])
        || stringField(asRecord(record.sourceAnchor), ['eventId', 'id']);
    })
    .filter((item): item is string => Boolean(item));
}

export class DeepWritePromotionPolicy {
  constructor(private readonly deps: DeepWritePromotionPolicyDeps) {}

  promoteRun(runId: string): DeepWritePromotionDecision[] {
    const candidates = this.deps.candidateStore.listCandidatesByRun(runId);
    return candidates.map((candidate) => this.evaluateAndApply(candidate));
  }

  promotePending(limit: number = 100, options: DeepWritePromotionOptions = {}): DeepWritePromotionDecision[] {
    const candidates = options.projectId
      ? this.deps.candidateStore.listCandidates({ statuses: ['candidate'], projectId: options.projectId, limit })
      : this.deps.candidateStore.listCandidatesByStatus(['candidate'], { limit });
    return candidates.map((candidate) => this.evaluateAndApply(candidate));
  }

  evaluateAndApply(candidate: DeepWriteCandidateRecord): DeepWritePromotionDecision {
    if (candidate.status !== 'candidate') {
      return this.keep(candidate, `status_${candidate.status}_not_promotable`);
    }

    const content = asRecord(candidate.content);
    if (evidenceArray(candidate).length === 0) {
      return this.mark(candidate, 'rejected', { outcome: 'reject', reason: 'missing_evidence' });
    }

    if (isOrganizationCandidate(candidate.candidateType)) {
      return this.promoteOrganizationCandidate(candidate, content);
    }

    if (isSummaryLikeCandidate(candidate.candidateType)) {
      if (candidate.confidence < 0.72) {
        return this.mark(candidate, 'needs_confirmation', {
          outcome: 'needs_confirmation',
          reason: 'summary_like_below_min_promote_confidence'
        });
      }
      return this.promoteSummary(candidate, promotedSummaryContent(candidate.candidateType, content));
    }

    if (isPreferenceLikeCandidate(candidate.candidateType)) {
      if (candidate.confidence < 0.74) {
        return this.mark(candidate, 'needs_confirmation', {
          outcome: 'needs_confirmation',
          reason: 'preference_like_below_min_promote_confidence'
        });
      }
      if (!hasExplicitUserSource(content) && !hasUserTurnEvidence(candidate)) {
        return this.mark(candidate, 'needs_confirmation', {
          outcome: 'needs_confirmation',
          reason: 'preference_like_requires_user_evidence'
        });
      }
      return this.promotePreference(candidate, promotedPreferenceContent(candidate.candidateType, content));
    }

    if (candidate.confidence < this.deps.minPromoteConfidence) {
      return this.mark(candidate, 'needs_confirmation', {
        outcome: 'needs_confirmation',
        reason: 'below_min_promote_confidence'
      });
    }

    if (isInferenceOnly(content)) {
      return this.mark(candidate, 'needs_confirmation', {
        outcome: 'needs_confirmation',
        reason: 'inference_or_assistant_claim_not_auto_promoted'
      });
    }

    if (candidate.candidateType === 'summary') return this.promoteSummary(candidate, content);
    if (candidate.candidateType === 'relations') return this.promoteRelation(candidate, content);
    if (candidate.candidateType === 'causalLinks') return this.promoteCausalLink(candidate, content);

    if (!hasExplicitUserSource(content)) {
      return this.mark(candidate, 'needs_confirmation', {
        outcome: 'needs_confirmation',
        reason: 'not_explicit_user_source'
      });
    }

    if (candidate.candidateType === 'facts') return this.promoteFact(candidate, content);
    if (candidate.candidateType === 'preferences') return this.promotePreference(candidate, content);
    if (candidate.candidateType === 'entities') return this.promoteEntity(candidate, content);

    return this.mark(candidate, 'needs_confirmation', {
      outcome: 'needs_confirmation',
      reason: `${candidate.candidateType}_requires_review`
    });
  }

  private promoteOrganizationCandidate(candidate: DeepWriteCandidateRecord, content: Record<string, unknown>): DeepWritePromotionDecision {
    if (candidate.confidence < 0.6) {
      return this.mark(candidate, 'needs_confirmation', {
        outcome: 'needs_confirmation',
        reason: 'organization_candidate_below_min_confidence'
      });
    }
    if (evidenceArray(candidate).length === 0) {
      return this.mark(candidate, 'rejected', { outcome: 'reject', reason: 'missing_evidence' });
    }
    if (candidate.candidateType === 'correction') {
      const targetIds = Array.isArray(content.correctedBeliefCandidateIds)
        ? content.correctedBeliefCandidateIds.filter((value) => typeof value === 'string' && value)
        : [];
      const claimKey = stringField(content, ['correctedClaimKey', 'targetClaimKey', 'targetBeliefId']);
      if (!claimKey && targetIds.length === 0) {
        return this.mark(candidate, 'needs_confirmation', {
          outcome: 'needs_confirmation',
          reason: 'orphan_correction_requires_target_review',
        });
      }
    }
    return this.mark(candidate, 'promoted', {
      outcome: 'promote_provisional',
      reason: 'semantic_organization_candidate_accepted',
      targetType: candidate.promotionTargetType || candidate.candidateType,
      targetId: stringField(content, ['sourceEventId', 'targetEventId', 'topicPath']) || candidate.candidateId
    });
  }

  private promoteFact(candidate: DeepWriteCandidateRecord, content: Record<string, unknown>): DeepWritePromotionDecision {
    if (!this.deps.factStore) return this.keep(candidate, 'fact_store_unavailable');
    const neuronId = firstEvidenceNeuronId(candidate);
    const subject = stringField(content, ['subject', 'entity', 'topic']);
    const predicateFamily = stringField(content, ['predicateFamily', 'predicate', 'relation', 'kind']) || 'deep_write_fact';
    const object = stringField(content, ['object', 'objectValue', 'value', 'predicateValue', 'statement']);
    const sourceText = stringField(content, ['sourceText', 'statement', 'text', 'summary']) || object;

    if (!neuronId || !subject || !object || !sourceText) {
      return this.mark(candidate, 'needs_confirmation', {
        outcome: 'needs_confirmation',
        reason: 'fact_missing_required_fields'
      });
    }

    const status: FactRecord['status'] = candidate.confidence >= 0.95 && evidenceArray(candidate).length > 1
      ? 'verified'
      : 'provisional';
    const [fact] = this.deps.factStore.insertFacts([{
      neuronId,
      subject,
      predicateFamily,
      predicateValue: stringField(content, ['predicateValue', 'value']),
      object,
      entityId: stringField(content, ['entityId']),
      timeText: stringField(content, ['timeText', 'time', 'when']),
      validFrom: candidate.createdAt,
      certaintyLevel: status === 'verified' ? 'certain' : 'probable',
      confidence: candidate.confidence,
      status,
      sourceText,
      metadata: {
        source: 'deep_write',
        deep_write_run_id: candidate.runId,
        deep_write_candidate_id: candidate.candidateId,
        deep_write_candidate_type: candidate.candidateType,
        deep_write_status: status
      }
    }]);

    return this.mark(candidate, 'promoted', {
      outcome: status === 'verified' ? 'promote_verified' : 'promote_provisional',
      reason: 'explicit_user_fact_promoted',
      targetType: 'fact',
      targetId: fact.factId
    });
  }

  private promoteSummary(candidate: DeepWriteCandidateRecord, content: Record<string, unknown>): DeepWritePromotionDecision {
    if (!this.deps.summaryStore) return this.keep(candidate, 'summary_store_unavailable');
    if (!hasUserTurnEvidence(candidate)) {
      return this.mark(candidate, 'needs_confirmation', {
        outcome: 'needs_confirmation',
        reason: 'summary_requires_user_turn_evidence'
      });
    }
    const neuronId = firstEvidenceNeuronId(candidate);
    const summary = stringField(content, ['summary', 'text', 'statement', 'content']);
    if (!neuronId || !summary) {
      return this.mark(candidate, 'needs_confirmation', {
        outcome: 'needs_confirmation',
        reason: 'summary_missing_required_fields'
      });
    }

    const scope = stringField(content, ['scope']) as 'turn_window' | 'session' | 'day' | 'project' | undefined;
    const record = this.deps.summaryStore.insertSummary({
      projectId: stringField(content, ['projectId']),
      sessionId: stringField(content, ['sessionId']),
      scope: scope && ['turn_window', 'session', 'day', 'project'].includes(scope) ? scope : 'turn_window',
      windowStart: numberField(content, ['windowStart', 'startTime', 'validFrom']),
      windowEnd: numberField(content, ['windowEnd', 'endTime', 'validTo']) || candidate.createdAt,
      text: summary,
      confidence: Math.min(candidate.confidence, 0.9),
      status: 'provisional',
      sourceNeuronIds: sourceNeuronIds(candidate),
      deepWriteRunId: candidate.runId,
      deepWriteCandidateId: candidate.candidateId,
      createdAt: candidate.createdAt,
      updatedAt: candidate.createdAt
    });

    return this.mark(candidate, 'promoted', {
      outcome: 'promote_provisional',
      reason: 'evidence_backed_summary_promoted',
      targetType: 'summary',
      targetId: record.summaryId
    });
  }

  private promoteRelation(candidate: DeepWriteCandidateRecord, content: Record<string, unknown>): DeepWritePromotionDecision {
    return this.promoteGraphEdge(candidate, content, 'deep_write_relation', false);
  }

  private promoteCausalLink(candidate: DeepWriteCandidateRecord, content: Record<string, unknown>): DeepWritePromotionDecision {
    if (!this.deps.promoteCausalLinks) {
      return this.mark(candidate, 'needs_confirmation', {
        outcome: 'needs_confirmation',
        reason: 'causal_link_promotion_not_enabled'
      });
    }
    if (candidate.confidence < Math.max(this.deps.minPromoteConfidence, 0.9)) {
      return this.mark(candidate, 'needs_confirmation', {
        outcome: 'needs_confirmation',
        reason: 'causal_link_below_strict_confidence'
      });
    }
    return this.promoteGraphEdge(candidate, content, 'deep_write_causal', true);
  }

  private promoteGraphEdge(
    candidate: DeepWriteCandidateRecord,
    content: Record<string, unknown>,
    edgeType: 'deep_write_relation' | 'deep_write_causal',
    causal: boolean
  ): DeepWritePromotionDecision {
    if (!this.deps.relationStore) return this.keep(candidate, 'relation_store_unavailable');
    if (!this.deps.entityStore) return this.keep(candidate, 'entity_store_unavailable');
    if (!hasExplicitUserSource(content) && !(hasMixedSource(content) && hasUserTurnEvidence(candidate))) {
      return this.mark(candidate, 'needs_confirmation', {
        outcome: 'needs_confirmation',
        reason: 'relation_requires_explicit_user_or_mixed_user_evidence'
      });
    }

    const fromName = stringField(content, ['from', 'source', 'subject', 'cause', 'entityA', 'left']);
    const toName = stringField(content, ['to', 'target', 'object', 'effect', 'entityB', 'right']);
    const fromEntity = this.resolveEntity(fromName, stringField(content, ['fromType', 'sourceType', 'subjectType', 'causeType']));
    const toEntity = this.resolveEntity(toName, stringField(content, ['toType', 'targetType', 'objectType', 'effectType']));
    if (!fromEntity || !toEntity) {
      return this.mark(candidate, 'needs_confirmation', {
        outcome: 'needs_confirmation',
        reason: 'endpoints_not_promoted'
      });
    }

    if (!this.deps.relationStore.appendEdge) return this.keep(candidate, 'relation_store_append_unavailable');
    const edge = this.deps.relationStore.appendEdge({
      fromNodeId: fromEntity.entityId,
      toNodeId: toEntity.entityId,
      edgeType,
      weight: candidate.confidence,
      confidence: candidate.confidence,
      supportCount: Math.max(1, evidenceArray(candidate).length),
      coactivationCount: 0,
      status: 'active',
      sourceProposalId: `deep-write-${candidate.candidateId}`,
      proposalBackendMode: 'rule_only_plasticity_v1',
      proposalVersion: 'rule_only_plasticity_v1',
      appliedAt: Date.now(),
      metadata: {
        source: causal ? 'deep_write_causal' : 'deep_write_relation',
        relation: stringField(content, ['relation', 'predicate', 'kind', 'label']),
        deep_write_run_id: candidate.runId,
        deep_write_candidate_id: candidate.candidateId,
        deep_write_candidate_type: candidate.candidateType
      }
    });

    return this.mark(candidate, 'promoted', {
      outcome: 'promote_provisional',
      reason: `${edgeType}_promoted`,
      targetType: 'graph_edge',
      targetId: edge.edgeRecordId
    });
  }

  private resolveEntity(name: string | undefined, type?: string): { entityId: string } | undefined {
    if (!name || !this.deps.entityStore) return undefined;
    return this.deps.entityStore.findByCanonicalName(name, type)
      || this.deps.entityStore.findByAlias(name, type)
      || this.deps.entityStore.findByCanonicalName(name)
      || this.deps.entityStore.findByAlias(name)
      || undefined;
  }

  private promotePreference(candidate: DeepWriteCandidateRecord, content: Record<string, unknown>): DeepWritePromotionDecision {
    if (!this.deps.beliefStore) return this.keep(candidate, 'belief_store_unavailable');
    const neuronId = firstEvidenceNeuronId(candidate);
    const subject = stringField(content, ['subject', 'owner', 'user']) || 'user';
    const predicate = stringField(content, ['predicate', 'preference', 'kind']) || 'preference';
    const value = stringField(content, ['object', 'objectValue', 'value', 'preferenceValue', 'statement', 'summary', 'text']);
    if (!neuronId || !value) {
      return this.mark(candidate, 'needs_confirmation', {
        outcome: 'needs_confirmation',
        reason: 'preference_missing_required_fields'
      });
    }

    const beliefCandidate: BeliefCandidate = {
      projectId: stringField(content, ['projectId']),
      scope: 'project',
      subject,
      predicate,
      objectValue: {
        raw: value,
        normalized: value,
        type: 'string'
      },
      confidence: candidate.confidence,
      trustScore: Math.max(0.55, candidate.confidence),
      sourceNeuronId: neuronId,
      sourceType: 'user_input',
      validityKind: durabilityOf(content).includes('temporary') ? 'time_range' : 'open',
      validFrom: candidate.createdAt,
      explanation: stringField(content, ['explanation', 'reason', 'sourceText']),
      extractionReason: 'preference_signal',
      metadata: {
        source: 'deep_write',
        deep_write_run_id: candidate.runId,
        deep_write_candidate_id: candidate.candidateId,
        deep_write_candidate_type: candidate.candidateType
      }
    };
    const result = this.deps.beliefStore.upsert(beliefCandidate, candidate.createdAt);
    if (!result.belief) {
      return this.mark(candidate, 'needs_confirmation', {
        outcome: 'needs_confirmation',
        reason: result.decision.rejectReason || 'belief_rejected_by_conflict_policy'
      });
    }

    return this.mark(candidate, 'promoted', {
      outcome: 'promote_provisional',
      reason: 'explicit_user_preference_promoted',
      targetType: 'belief',
      targetId: result.belief.id
    });
  }

  private promoteEntity(candidate: DeepWriteCandidateRecord, content: Record<string, unknown>): DeepWritePromotionDecision {
    if (!this.deps.entityStore) return this.keep(candidate, 'entity_store_unavailable');
    const name = stringField(content, ['canonicalName', 'name', 'entity', 'displayName']);
    const type = stringField(content, ['type', 'entityType', 'kind']) || 'unknown';
    if (!name) {
      return this.mark(candidate, 'needs_confirmation', {
        outcome: 'needs_confirmation',
        reason: 'entity_missing_name'
      });
    }

    const aliases = Array.isArray(content.aliases)
      ? content.aliases.filter((value): value is string => typeof value === 'string')
      : [];
    const entity = this.deps.entityStore.upsertEntity({
      canonicalName: name,
      type,
      aliases,
      status: 'active',
      createdFrom: firstEvidenceNeuronId(candidate),
      createdAt: candidate.createdAt,
      metadata: {
        source: 'deep_write',
        rawMention: stringField(content, ['rawMention', 'mention']) || name,
        answerDisplayName: stringField(content, ['displayName']) || name,
        deep_write_run_id: candidate.runId,
        deep_write_candidate_id: candidate.candidateId,
        deep_write_candidate_type: candidate.candidateType
      }
    });

    return this.mark(candidate, 'promoted', {
      outcome: 'promote_provisional',
      reason: 'explicit_user_entity_promoted',
      targetType: 'entity',
      targetId: entity.entityId
    });
  }

  private keep(candidate: DeepWriteCandidateRecord, reason: string): DeepWritePromotionDecision {
    return {
      outcome: 'keep_candidate',
      reason,
      targetType: candidate.promotionTargetType,
      targetId: candidate.promotionTargetId
    };
  }

  private mark(
    candidate: DeepWriteCandidateRecord,
    status: DeepWriteCandidateStatus,
    decision: DeepWritePromotionDecision
  ): DeepWritePromotionDecision {
    this.deps.candidateStore.updateCandidateStatus(candidate.candidateId, status, {
      type: decision.targetType,
      id: decision.targetId,
      reason: decision.reason,
    });
    return decision;
  }
}
