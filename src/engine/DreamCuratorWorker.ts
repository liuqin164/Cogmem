import { createHash } from 'crypto';

import { isOperationalNoiseText } from '../recall/RecallGovernance.js';
import type { DeepWriteCandidateInput, DeepWriteCandidateRecord } from '../store/DeepWriteCandidateStore.js';
import type { DeepWriteCandidateStore } from '../store/DeepWriteCandidateStore.js';
import type { DreamBacklogStatus, DreamLedgerStore } from '../store/DreamLedgerStore.js';
import type { EventStore } from '../store/EventStore.js';
import type { ModelRegistry } from '../models/ModelRegistry.js';
import type { TextGenerateFn } from '../models/ModelRole.js';
import type { PipelineMetrics } from './PipelineMetrics.js';
import type { MemoryEvent } from '../types/index.js';
import type { EpisodeSemanticSummary, EpisodeType } from '../episode/EpisodeTypes.js';
import { eventTextForMemory } from '../episode/CogmemBlockStripper.js';
import type { CorrectionResolver } from '../episode/CorrectionResolver.js';

export interface DreamCuratorRunOptions {
  projectId?: string;
  limit?: number;
  mode?: 'candidate' | 'shadow';
  now?: number;
  generateText?: TextGenerateFn;
  /** Internal episode path: process only these authoritative raw events. */
  eventIds?: string[];
  sourceEpisodeId?: string;
  sourceEpisodeEventIds?: string[];
  dreamMode?: 'micro' | 'normal' | 'deep';
  maxCandidates?: number;
  episodeType?: EpisodeType;
  closureReason?: string;
  semanticSummary?: EpisodeSemanticSummary;
  episodeRelations?: Array<{ eventId: string; relation: string }>;
}

export interface DreamCuratorRunResult {
  runId?: string;
  projectId?: string;
  skipped: boolean;
  reason?: string;
  processedEventCount: number;
  dreamableEventCount: number;
  candidateCount: number;
  maxGlobalSeq?: number;
  status: DreamBacklogStatus;
  candidates: DeepWriteCandidateRecord[];
}

export interface DreamCuratorWorkerDeps {
  eventStore: EventStore;
  dreamLedgerStore: DreamLedgerStore;
  candidateStore: DeepWriteCandidateStore;
  modelRegistry?: ModelRegistry;
  pipelineMetrics?: PipelineMetrics;
  correctionResolver?: CorrectionResolver;
}

interface DreamEvidence {
  eventId: string;
  role?: string;
  rawEventType?: string;
  threadId?: string;
  sessionId?: string;
  projectId?: string;
  globalSeq?: number;
  occurredAt: number;
  textExcerpt: string;
  sourceAnchor: {
    eventId: string;
    threadId?: string;
    sessionId?: string;
    turnId?: string;
    role?: string;
    threadSeq?: number;
    turnSeq?: number;
    eventOrdinal?: number;
    parentEventId?: string;
    prevEventId?: string;
    nextEventId?: string;
    causalityType?: string;
    orderingConfidence?: string;
  };
}

const PREFERENCE_PATTERN = /(请以后|以后请|始终|总是|偏好|喜欢|希望|不要|别|必须|一定要|长期目标|目标是|约束|边界|本地优先|local-first|prefer|preference|always|never|must|do not|don't|goal|constraint|boundary)/iu;
const CORRECTION_PATTERN = /((?:^|[。！？.!?\s])不[，,]|(?<!对)不对|(?<!是)不是|纠正|更正|应该是|推翻|修正|actually|correction|instead)/iu;
const LEADING_CORRECTION_PATTERN = /^\s*不[，,]/u;

export class DreamCuratorWorker {
  constructor(private readonly deps: DreamCuratorWorkerDeps) {}

  async run(options: DreamCuratorRunOptions = {}): Promise<DreamCuratorRunResult> {
    const before = this.deps.dreamLedgerStore.getStatus(options.projectId);
    const explicitEpisodeRun = Array.isArray(options.eventIds);
    const events = explicitEpisodeRun
      ? options.eventIds!
        .slice(0, Math.max(1, Math.min(options.limit ?? 100, 500)))
        .map((eventId) => this.deps.eventStore.getEvent(eventId))
        .filter((event): event is MemoryEvent => Boolean(event))
        .filter((event) => !options.projectId || event.projectId === options.projectId)
      : this.deps.eventStore.listRawEventsAfterGlobalSeq({
        projectId: options.projectId,
        afterGlobalSeq: before.lastDreamedGlobalSeq,
        limit: options.limit ?? 100,
      });
    if (events.length === 0) {
      return {
        projectId: options.projectId,
        skipped: true,
        reason: explicitEpisodeRun ? 'episode_has_no_raw_events' : 'no_undreamed_raw_events',
        processedEventCount: 0,
        dreamableEventCount: 0,
        candidateCount: 0,
        status: before,
        candidates: [],
      };
    }

    const now = options.now ?? Date.now();
    const maxGlobalSeq = Math.max(...events.map((event) => event.globalSeq || 0));
    const dreamableEvents = events.filter((event) => this.isDreamableEvent(event));
    const allowedEvidence = new Set(options.sourceEpisodeEventIds || events.map((event) => event.eventId));
    const candidateInputs = (await this.buildCandidates(dreamableEvents, options, now))
      .filter((candidate) => {
        const evidence = Array.isArray(candidate.evidence) ? candidate.evidence as Array<{ eventId?: unknown }> : [];
        const content = objectRecord(candidate.content);
        if (candidate.status === 'rejected' && content.source === 'dream_curator_provider_warning') {
          return evidence.length === 1
            && typeof evidence[0].eventId === 'string'
            && evidence[0].eventId.startsWith('system-diagnostic:');
        }
        return evidence.length > 0
          && evidence.every((item) => typeof item.eventId === 'string' && allowedEvidence.has(item.eventId));
      })
      .slice(0, Math.max(1, Math.min(options.maxCandidates ?? 500, 500)))
      .map((candidate) => ({
        ...candidate,
        content: options.sourceEpisodeId && objectRecord(candidate.content).source !== 'dream_curator_provider_warning'
          ? {
            ...objectRecord(candidate.content),
            sourceEpisodeId: options.sourceEpisodeId,
            evidenceAuthority: 'raw_event_ids_only',
            evidenceEventIds: (candidate.evidence as Array<{ eventId?: string }>).map((item) => item.eventId).filter(Boolean),
            dreamMode: options.dreamMode || 'normal',
            episodeType: options.episodeType,
            closureReason: options.closureReason,
          }
          : candidate.content,
      }));
    const providerConfig = this.resolveProviderConfig(options);
    const run = this.deps.candidateStore.insertRun({
      projectId: options.projectId,
      sessionId: this.singleSessionId(dreamableEvents),
      sourceNeuronIds: [],
      modelProvider: providerConfig.provider,
      modelName: providerConfig.modelName,
      mode: `dream_curator_${providerConfig.provider}_${options.mode ?? 'candidate'}_${options.dreamMode ?? 'normal'}_v1`,
      promptHash: hash(JSON.stringify(events.map((event) => ({
        eventId: event.eventId,
        globalSeq: event.globalSeq,
        contentHash: event.contentHash,
      })))),
      outputHash: hash(JSON.stringify(candidateInputs.map((candidate) => ({
        candidateType: candidate.candidateType,
        content: candidate.content,
        evidence: candidate.evidence,
      })))),
      status: 'succeeded',
      createdAt: now,
    });
    const inserted = this.deps.candidateStore.insertCandidates(
      candidateInputs.map((candidate) => ({ ...candidate, runId: run.runId, createdAt: now }))
    );
    const status = explicitEpisodeRun
      ? before
      : this.deps.dreamLedgerStore.markDreamed(options.projectId, maxGlobalSeq, now);

    return {
      runId: run.runId,
      projectId: options.projectId,
      skipped: false,
      processedEventCount: events.length,
      dreamableEventCount: dreamableEvents.length,
      candidateCount: inserted.length,
      maxGlobalSeq,
      status,
      candidates: inserted,
    };
  }

  private async buildCandidates(
    events: MemoryEvent[],
    options: DreamCuratorRunOptions,
    now: number,
  ): Promise<Array<Omit<DeepWriteCandidateInput, 'runId'>>> {
    if (events.length === 0) return [];
    const status = options.mode === 'shadow' ? 'shadow' : 'candidate';
    const candidates: Array<Omit<DeepWriteCandidateInput, 'runId'>> = [];
    const userEvents = events.filter((event) => event.role === 'user');

    if (userEvents.length > 0) {
      candidates.push({
        candidateType: 'summary',
        status,
        confidence: 0.74,
        content: {
          projectId: options.projectId,
          sessionId: this.singleSessionId(events),
          scope: this.singleSessionId(events) ? 'session' : 'turn_window',
          summary: summarizeEvents(events),
          topics: extractTopics(events.map(eventText).join('\n')),
          source: 'mixed_user_assistant_raw_ledger',
          durability: 'session',
          session_hint_only: true,
          not_user_owned: true,
          not_durable_belief: true,
          risk: 'curator_summary_candidate_requires_governance',
          windowStart: Math.min(...events.map((event) => event.occurredAt)),
          windowEnd: Math.max(...events.map((event) => event.occurredAt)),
        },
        evidence: events.map((event) => this.toEvidence(event)),
        createdAt: now,
      });
    }

    for (const event of userEvents) {
      const text = eventText(event);
      if (PREFERENCE_PATTERN.test(text)) {
        candidates.push({
          candidateType: 'preferences',
          status,
          confidence: 0.8,
          content: {
            projectId: event.projectId || options.projectId,
            subject: 'user',
            predicate: preferencePredicate(text),
            object: text,
            statement: text,
            category: preferenceCategory(text),
            tags: preferenceTags(text),
            source: 'explicit_user_statement',
            durability: 'durable',
            risk: 'curator_preference_candidate_requires_governance',
          },
          evidence: [this.toEvidence(event)],
          createdAt: now,
        });
      }
      if (isExplicitCorrectionCandidate(text)) {
        const resolution = this.deps.correctionResolver?.resolve({
          projectId: event.projectId || options.projectId || '', query: text,
          topicPath: typeof event.payload === 'object' && event.payload && typeof (event.payload as Record<string, unknown>).topicPath === 'string'
            ? String((event.payload as Record<string, unknown>).topicPath)
            : undefined,
        }) ?? { status: 'needs_review' as const, candidates: [], reason: 'correction_resolver_unavailable' };
        candidates.push({
          candidateType: 'correction',
          status: resolution.status === 'resolved' ? status : 'needs_confirmation',
          statusReason: resolution.status === 'resolved'
            ? undefined
            : 'orphan_correction_requires_target_review',
          confidence: 0.78,
          content: {
            projectId: event.projectId || options.projectId,
            statement: text,
            sourceEventId: event.eventId,
            source: 'explicit_user_statement',
            durability: 'event',
            correctionKind: 'user_clarification_or_revision',
            correctedClaimKey: resolution.target?.canonicalKey || null,
            correctedBeliefCandidateIds: resolution.target ? [resolution.target.beliefId] : [],
            correctionResolution: resolution.status,
            correctionResolutionReason: resolution.reason,
            correctionTargetSearchQuery: truncate(text, 240),
            governance: 'organizational_trace_only',
            risk: 'correction_requires_prior_claim_binding_before_belief_change',
          },
          evidence: [this.toEvidence(event)],
          createdAt: now,
        });
      }
    }

    if (options.episodeType === 'decision' || options.semanticSummary?.candidateTypes.includes('decision')) {
      const decisionEvidence = userEvents.length ? userEvents : events;
      candidates.push({
        candidateType: 'temporal_fact_update',
        status: userEvents.length ? status : 'needs_confirmation',
        confidence: userEvents.length ? 0.82 : 0.58,
        content: {
          projectId: options.projectId,
          timelineType: 'decision',
          statement: options.semanticSummary?.decision || summarizeEvents(decisionEvidence),
          occurredAt: Math.min(...decisionEvidence.map((event) => event.occurredAt)),
          startSeq: minDefined(decisionEvidence.map((event) => event.globalSeq)),
          endSeq: maxDefined(decisionEvidence.map((event) => event.globalSeq)),
          source: userEvents.length ? 'explicit_user_decision_episode' : 'mixed_decision_episode_requires_review',
          governance: 'candidate_only_cpu_governance_required',
          notDurableWithoutUserEvidence: userEvents.length === 0,
        },
        evidence: decisionEvidence.map((event) => this.toEvidence(event)),
        promotionTargetType: 'temporal_decision',
        createdAt: now,
      });
    }

    const relationByEvent = new Map((options.episodeRelations || []).map((item) => [item.eventId, item.relation]));
    for (let index = 0; index < events.length; index += 1) {
      const confirmation = events[index];
      if (relationByEvent.get(confirmation.eventId) !== 'accepts_assistant_proposal' || confirmation.role !== 'user') continue;
      let proposal: MemoryEvent | undefined;
      for (let priorIndex = index - 1; priorIndex >= Math.max(0, index - 8); priorIndex -= 1) {
        const prior = events[priorIndex];
        const relation = relationByEvent.get(prior.eventId);
        if (prior.role === 'user' && (relation === 'rejects_assistant_proposal' || relation === 'corrects_previous')) break;
        if (relation === 'assistant_proposal'
          && prior.sessionId === confirmation.sessionId
          && (!prior.threadId || !confirmation.threadId || prior.threadId === confirmation.threadId)) {
          proposal = prior;
          break;
        }
      }
      if (proposal) {
        candidates.push({
          candidateType: 'semantic_relation',
          status,
          confidence: 0.88,
          content: {
            projectId: options.projectId,
            relation: 'assistant_proposal_confirmed_by_user',
            proposalEvidenceEventId: proposal.eventId,
            confirmationEvidenceEventId: confirmation.eventId,
            evidenceKind: 'assistant_proposal_confirmed_by_user',
            governance: 'candidate_only_cpu_governance_required',
          },
          evidence: [this.toEvidence(proposal), this.toEvidence(confirmation)],
          promotionTargetType: 'confirmed_proposal_relation',
          createdAt: now,
        });
      }
    }

    for (const event of events) {
      if (event.rawEventType === 'tool_result' && event.parentEventId) {
        candidates.push({
          candidateType: 'causalLinks',
          status,
          confidence: 0.68,
          content: {
            projectId: event.projectId || options.projectId,
            relation: 'tool_result_for',
            causeEventId: event.parentEventId,
            effectEventId: event.eventId,
            statement: eventText(event),
            source: 'tool_observation_candidate',
            risk: 'tool_observation_requires_governance',
          },
          evidence: [this.toEvidence(event)],
          createdAt: now,
        });
      }
    }

    candidates.push(...this.buildSemanticOrganizationCandidates(events, now, status, options));

    const providerCandidates = await this.buildProviderCandidates(events, options, now, status);
    candidates.push(...providerCandidates);

    return candidates;
  }

  private async buildProviderCandidates(
    events: MemoryEvent[],
    options: DreamCuratorRunOptions,
    now: number,
    status: 'candidate' | 'shadow',
  ): Promise<Array<Omit<DeepWriteCandidateInput, 'runId'>>> {
    const generate = this.resolveGenerateText(options);
    if (!generate) return [];

    const systemPrompt = [
      'You are the Cogmem Memory Curator / Dream Worker.',
      'You inspect raw chronological ledger events and propose memory governance candidates only.',
      '',
      'Authority boundaries:',
      '- You do not promote anything to active memory.',
      '- You do not rewrite verified facts.',
      '- You do not decide final memory status.',
      '- CPU governance will validate, promote, reject, suppress, or supersede candidates later.',
      '',
      'Evidence rules:',
      '- Every candidate must be traceable to exact evidenceEventIds from the supplied raw ledger events.',
      '- User-owned durable candidates such as preferences, goals, boundaries, corrections, and long-term constraints must be supported by raw ledger events whose role is "user".',
      '- Assistant messages may provide conversational context, but they must not be treated as user preferences, user goals, user corrections, or user boundaries unless a user event explicitly confirms them.',
      '- Tool results and task events are observations only. They may support diagnostic or causal-link candidates, but they must not create user-owned memory by themselves.',
      '- If an event contains <COGMEM_RECALL_CONTEXT>, <COGMEM_TURN_BRIDGE>, <COGMEM_SESSION_STATE>, or <COGMEM_STRATEGY_CONTEXT>, treat that content as host-side memory context metadata, not as user-authored evidence.',
      '',
      'Output rules:',
      '- Return concise strict JSON only.',
      '- Do not include markdown.',
      '- Do not expose hidden chain-of-thought.',
      '- Include uncertainty and source limitations inside candidate fields, not as reasoning prose.',
      '',
      'Dream mode rules:',
      '- micro: extract only direct high-value candidates from this episode; do not infer cross-episode conclusions.',
      '- normal: perform bounded deduplication and conflict hints inside the supplied episode.',
      '- deep: inspect consistency across all supplied raw events, but never invent or scan evidence outside them.',
    ].join('\n');

    const userPrompt = JSON.stringify({
      task: 'Generate candidate-only memory curation output.',
      dreamMode: options.dreamMode || 'normal',
      episodeType: options.episodeType,
      closureReason: options.closureReason,
      semanticSummaryHint: options.semanticSummary
        ? { ...options.semanticSummary, evidencePolicy: 'hint_only_not_evidence' }
        : undefined,
      allowedCandidateBuckets: [
        'userPreferenceCandidates',
        'projectMemoryCandidates',
        'longTermGoalCandidates',
        'boundaryCandidates',
        'failureLessonCandidates',
        'diagnosticConclusionCandidates',
        'sessionSummaryCandidates',
        'topicSummaryCandidates',
        'temporalFactUpdateCandidates',
        'conflictCandidates',
        'semanticTagCandidates',
        'indexingDecisionCandidates',
        'semanticRelationCandidates',
        'edgeAdjustmentCandidates',
      ],
      rawLedgerEvents: events.map((event) => ({
        eventId: event.eventId,
        role: event.role,
        rawEventType: event.rawEventType,
        threadId: event.threadId,
        sessionId: event.sessionId,
        projectId: event.projectId,
        globalSeq: event.globalSeq,
        occurredAt: event.occurredAt,
        text: truncate(eventText(event), 1200),
      })),
      outputContract: {
        format: 'strict JSON object',
        rule: 'LLM suggests candidates only; CPU governance decides status later.',
        requiredPerCandidate: [
          'claim',
          'confidence',
          'evidenceEventIds',
          'evidenceRoles',
          'sourceLimitations',
        ],
        evidenceEventIds: options.sourceEpisodeId
          ? 'non-empty array of exact raw event ids from this episode. Never use ["all"].'
          : 'array of exact raw event ids. Use ["all"] only for legacy window-level session/topic summaries, never for user preferences, goals, corrections, or boundaries.',
        sourcePolicy: {
          userOwnedDurableMemory: 'requires at least one explicit user-role evidence event',
          assistantEvidence: 'context only unless confirmed by user',
          toolEvidence: 'observation only',
          taskEventEvidence: 'trace only',
          cogmemContextBlocks: 'not user-authored evidence',
        },
        forbidden: [
          'hidden chain-of-thought',
          'promotion decisions',
          'durable user memory from assistant/tool/task-only evidence',
          'durable user memory from COGMEM_* context blocks',
        ],
      },
    });

    let raw = '';
    try {
      raw = await generate(systemPrompt, userPrompt);
    } catch (error) {
      const diagnostic = this.providerDiagnosticCandidate(events, now, options.projectId, 'dream_curator_provider_exception', error);
      return diagnostic ? [diagnostic] : [];
    }
    const parsed = parseJsonObjectFromModel(raw);
    if (!parsed) {
      const diagnostic = this.providerDiagnosticCandidate(events, now, options.projectId, 'dream_curator_provider_invalid_output', raw);
      return diagnostic ? [diagnostic] : [];
    }
    this.supersedeProviderWarnings(options.projectId);
    return this.flattenProviderCandidates(parsed, events, now, status, Boolean(options.sourceEpisodeId), options.projectId);
  }

  private flattenProviderCandidates(
    parsed: Record<string, unknown>,
    events: MemoryEvent[],
    now: number,
    status: 'candidate' | 'shadow',
    requireExactEvidence = false,
    authoritativeProjectId?: string,
  ): Array<Omit<DeepWriteCandidateInput, 'runId'>> {
    const buckets: Array<[string, string, string]> = [
      ['userPreferenceCandidates', 'user_preference', 'user_preference'],
      ['projectMemoryCandidates', 'project_memory', 'project_memory'],
      ['longTermGoalCandidates', 'long_term_goal', 'long_term_goal'],
      ['boundaryCandidates', 'boundary', 'boundary'],
      ['failureLessonCandidates', 'failure_lesson', 'failure_lesson'],
      ['diagnosticConclusionCandidates', 'diagnostic_conclusion', 'diagnostic_conclusion'],
      ['sessionSummaryCandidates', 'session_summary', 'session_summary'],
      ['topicSummaryCandidates', 'topic_summary', 'topic_summary'],
      ['temporalFactUpdateCandidates', 'temporal_fact_update', 'temporal_fact_update'],
      ['conflictCandidates', 'conflict_candidate', 'conflict_candidate'],
      ['semanticTagCandidates', 'semantic_tags', 'semantic_tags'],
      ['indexingDecisionCandidates', 'indexing_decision', 'indexing_decision'],
      ['semanticRelationCandidates', 'semantic_relation', 'semantic_relation'],
      ['edgeAdjustmentCandidates', 'edge_adjustment', 'edge_adjustment'],
    ];
    const candidates: Array<Omit<DeepWriteCandidateInput, 'runId'>> = [];
    const validEventIds = new Set(events.map((event) => event.eventId));

    for (const [bucket, candidateType, promotionTargetType] of buckets) {
      const values = Array.isArray(parsed[bucket]) ? parsed[bucket] as unknown[] : [];
      for (const value of values) {
        if (!value || typeof value !== 'object') continue;

        const record = value as Record<string, unknown>;
        const rawEvidenceIds = Array.isArray(record.evidenceEventIds)
          ? record.evidenceEventIds.map((id) => String(id)).filter(Boolean)
          : [];

        if (requireExactEvidence && (
          rawEvidenceIds.length === 0
          || rawEvidenceIds.includes('all')
          || rawEvidenceIds.some((id) => !validEventIds.has(id))
        )) continue;

        if (isUserOwnedDurableProviderBucket(bucket)) {
          if (rawEvidenceIds.length === 0) continue;
          if (rawEvidenceIds.includes('all')) continue;
          if (rawEvidenceIds.some((id) => !validEventIds.has(id))) continue;
        }

        if (bucket === 'conflictCandidates') {
          if (!hasPairedConflictClaims(record)) continue;
          const distinctEvidenceIds = new Set(rawEvidenceIds);
          if (
            rawEvidenceIds.includes('all')
            || distinctEvidenceIds.size < 2
            || rawEvidenceIds.some((id) => !validEventIds.has(id))
          ) {
            continue;
          }
        }

        const evidence = this.providerEvidenceFor(record, events);
        if (evidence.length === 0) continue;

        if (isUserOwnedDurableProviderBucket(bucket) && !evidence.some((item) => item.role === 'user')) {
          continue;
        }

        candidates.push({
          candidateType,
          status,
          confidence: clampConfidence(record.confidence, 0.68),
          content: {
            ...record,
            source: 'llm_dream_curator_candidate',
            governance: 'candidate_only_cpu_governance_required',
            projectId: authoritativeProjectId || events[0]?.projectId,
            ...(typeof record.projectId === 'string' && record.projectId !== (authoritativeProjectId || events[0]?.projectId)
              ? { providerProjectIdWarning: record.projectId }
              : {}),
            candidateBucket: bucket,
          },
          evidence,
          promotionTargetType,
          createdAt: now,
        });
      }
    }
    return candidates;
  }

  private buildSemanticOrganizationCandidates(
    events: MemoryEvent[],
    now: number,
    status: 'candidate' | 'shadow',
    options: DreamCuratorRunOptions,
  ): Array<Omit<DeepWriteCandidateInput, 'runId'>> {
    const candidates: Array<Omit<DeepWriteCandidateInput, 'runId'>> = [];
    const readable = events.filter((event) => eventText(event).trim());
    if (readable.length === 0) return candidates;

    const combined = readable.map(eventText).join('\n');
    const topics = extractTopics(combined);
    const topicPath = inferTopicPath(combined, topics);
    const semanticTags = inferSemanticTags(combined, topics);

    if (semanticTags.length > 0) {
      candidates.push({
        candidateType: 'semantic_tags',
        status,
        confidence: 0.7,
        content: {
          projectId: readable[0]?.projectId,
          topicPath,
          tags: semanticTags,
          topics,
          source: 'deterministic_dream_curator_semantic_tagging',
          governance: 'candidate_only_cpu_governance_required',
          purpose: 'help future recall route by stable semantic cues instead of full-sentence matching',
        },
        evidence: readable.slice(0, 8).map((event) => this.toEvidence(event)),
        promotionTargetType: 'semantic_tags',
        createdAt: now,
      });
    }

    for (const event of readable) {
      const text = eventText(event);
      const eventTopics = extractTopics(text);
      const importance = memoryIndexImportance(text, event);
      candidates.push({
        candidateType: 'indexing_decision',
        status,
        confidence: importance.shouldEmbed ? 0.72 : 0.62,
        content: {
          projectId: event.projectId,
          sourceEventId: event.eventId,
          shouldEmbed: importance.shouldEmbed,
          storeAs: importance.storeAs,
          topicPath: inferTopicPath(text, eventTopics),
          tags: inferSemanticTags(text, eventTopics),
          reason: importance.reason,
          rawPreservation: 'raw_ledger_must_remain',
          source: 'deterministic_dream_curator_indexing_decision',
          governance: 'candidate_only_cpu_governance_required',
        },
        evidence: [this.toEvidence(event)],
        promotionTargetType: 'indexing_decision',
        createdAt: now,
      });
    }

    for (let index = 0; index < readable.length - 1; index += 1) {
      const current = readable[index];
      const next = readable[index + 1];

      if (!current.sessionId || !next.sessionId || current.sessionId !== next.sessionId) continue;
      if (current.threadId && next.threadId && current.threadId !== next.threadId) continue;
      if (current.orderingConfidence === 'low' || next.orderingConfidence === 'low') continue;
      const nextRelation = options.episodeRelations?.find((item) => item.eventId === next.eventId)?.relation;
      if (nextRelation && ['hard_topic_switch', 'ambiguous_shift', 'starts_new_topic', 'switches_topic'].includes(nextRelation)) continue;

      const relation = current.role === 'user' && next.role === 'assistant'
        ? 'answered_by'
        : next.parentEventId === current.eventId
          ? next.causalityType || 'caused'
          : 'chronologically_followed_by';

      const relationSummary = [
        `${current.role || current.rawEventType || 'event'}: ${truncate(eventText(current), 140)}`,
        `${next.role || next.rawEventType || 'event'}: ${truncate(eventText(next), 140)}`,
      ].join('\n');

      candidates.push({
        candidateType: 'semantic_relation',
        status,
        confidence: relation === 'answered_by' ? 0.74 : 0.62,
        content: {
          projectId: current.projectId || next.projectId,
          relation,
          summary: relationSummary,
          sourceEventId: current.eventId,
          targetEventId: next.eventId,
          topicPath: inferTopicPath(`${eventText(current)}\n${eventText(next)}`, extractTopics(`${eventText(current)}\n${eventText(next)}`)),
          source: 'deterministic_dream_curator_event_relation',
          governance: 'candidate_only_cpu_governance_required',
        },
        evidence: [this.toEvidence(current), this.toEvidence(next)],
        promotionTargetType: 'semantic_relation',
        createdAt: now,
      });
    }

    if (readable.length >= 2 && semanticTags.length > 0) {
      candidates.push({
        candidateType: 'edge_adjustment',
        status,
        confidence: 0.64,
        content: {
          projectId: readable[0]?.projectId,
          topicPath,
          strengthenWhenTagsOverlap: semanticTags,
          weakenReasons: ['operational_noise', 'imported_summary_without_raw_transcript', 'superseded_or_conflicted_fact'],
          evidenceEventIds: readable.slice(0, 8).map((event) => event.eventId),
          source: 'deterministic_dream_curator_edge_adjustment',
          governance: 'candidate_only_cpu_governance_required',
        },
        evidence: readable.slice(0, 8).map((event) => this.toEvidence(event)),
        promotionTargetType: 'edge_adjustment',
        createdAt: now,
      });
    }

    return candidates;
  }

  private providerEvidenceFor(record: Record<string, unknown>, events: MemoryEvent[]): DreamEvidence[] {
    const rawIds = Array.isArray(record.evidenceEventIds) ? record.evidenceEventIds : [];
    const ids = rawIds.map((id) => String(id)).filter(Boolean);
    const selected = ids.includes('all')
      ? events
      : events.filter((event) => ids.includes(event.eventId));
    return selected.map((event) => this.toEvidence(event));
  }

  private providerDiagnosticCandidate(
    events: MemoryEvent[],
    now: number,
    projectId: string | undefined,
    reason: string,
    detail: unknown,
  ): Omit<DeepWriteCandidateInput, 'runId'> | undefined {
    const detailText = truncate(detail instanceof Error ? detail.message : String(detail || ''), 500);
    this.deps.pipelineMetrics?.recordNonFatal(reason, {
      projectId,
      message: detailText,
      details: { component: 'dream_curator', disposition: 'rejected_diagnostic' },
      occurredAt: now,
    });
    const existing = this.deps.candidateStore.listCandidates({
      projectId,
      statuses: ['needs_confirmation', 'rejected'],
      candidateTypes: ['diagnostic_conclusion'],
      limit: 500,
    }).some((candidate) => {
      const content = candidate.content && typeof candidate.content === 'object'
        ? candidate.content as Record<string, unknown>
        : {};
      return content.source === 'dream_curator_provider_warning'
        && content.reason === reason
        && content.detail === detailText;
    });
    if (existing) return undefined;

    return {
      candidateType: 'diagnostic_conclusion',
      status: 'rejected',
      confidence: 0.4,
      content: {
        projectId,
        source: 'dream_curator_provider_warning',
        reason,
        detail: detailText,
        governance: 'candidate_only_cpu_governance_required',
        recommendation: 'Check [memory_model] provider configuration and rerun cogmem dream retry followed by cogmem dream tick.',
        evidenceAuthority: 'system_diagnostic_only',
      },
      evidence: [{
        eventId: `system-diagnostic:${hash(`${projectId || 'global'}:${reason}:${detailText}`)}`,
        role: 'system',
        rawEventType: 'system_diagnostic',
        projectId,
        occurredAt: now,
        textExcerpt: detailText,
        sourceAnchor: {
          eventId: `system-diagnostic:${hash(`${projectId || 'global'}:${reason}:${detailText}`)}`,
          role: 'system',
          orderingConfidence: 'high',
        },
      }],
      promotionTargetType: 'diagnostic_conclusion',
      createdAt: now,
    };
  }

  private supersedeProviderWarnings(projectId: string | undefined): void {
    const warnings = this.deps.candidateStore.listCandidates({
      projectId,
      statuses: ['needs_confirmation', 'rejected'],
      candidateTypes: ['diagnostic_conclusion'],
      limit: 500,
    });
    for (const candidate of warnings) {
      const content = candidate.content && typeof candidate.content === 'object'
        ? candidate.content as Record<string, unknown>
        : {};
      if (content.source !== 'dream_curator_provider_warning') continue;
      this.deps.candidateStore.updateCandidateStatus(candidate.candidateId, 'superseded', {
        type: 'diagnostic_conclusion',
        id: candidate.candidateId,
        reason: 'provider_recovered',
      });
    }
  }

  private resolveGenerateText(options: DreamCuratorRunOptions): TextGenerateFn | undefined {
    if (options.generateText) return options.generateText;
    if (!this.deps.modelRegistry || this.deps.modelRegistry.isRuleOnly('memory')) return undefined;
    return this.deps.modelRegistry.getTextGenerator('memory');
  }

  private resolveProviderConfig(options: DreamCuratorRunOptions): { provider: string; modelName?: string } {
    if (options.generateText) return { provider: 'explicit_generateText', modelName: 'custom' };
    if (!this.deps.modelRegistry) return { provider: 'rule_only' };
    const role = this.deps.modelRegistry.getRoleConfig('memory');
    return { provider: role.provider, modelName: role.modelName };
  }

  private isDreamableEvent(event: MemoryEvent): boolean {
    const text = eventText(event);
    if (!text.trim()) return false;
    if (isOperationalNoiseText(text)) return false;
    const metadata = event.payload && typeof event.payload === 'object'
      ? (event.payload as { metadata?: Record<string, unknown> }).metadata
      : undefined;
    if (metadata && Object.values(metadata).some((value) => isOperationalNoiseText(String(value || '')))) {
      return false;
    }
    return true;
  }

  private toEvidence(event: MemoryEvent): DreamEvidence {
    return {
      eventId: event.eventId,
      role: event.role,
      rawEventType: event.rawEventType,
      threadId: event.threadId,
      sessionId: event.sessionId,
      projectId: event.projectId,
      globalSeq: event.globalSeq,
      occurredAt: event.occurredAt,
      textExcerpt: truncate(eventText(event), 280),
      sourceAnchor: {
        eventId: event.eventId,
        threadId: event.threadId,
        sessionId: event.sessionId,
        turnId: event.turnId,
        role: event.role,
        threadSeq: event.threadSeq,
        turnSeq: event.turnSeq,
        eventOrdinal: event.eventOrdinal,
        parentEventId: event.parentEventId,
        prevEventId: event.prevEventId,
        nextEventId: event.nextEventId,
        causalityType: event.causalityType,
        orderingConfidence: event.orderingConfidence,
      },
    };
  }

  private singleSessionId(events: MemoryEvent[]): string | undefined {
    const sessionIds = new Set(events.map((event) => event.sessionId).filter((id): id is string => Boolean(id)));
    return sessionIds.size === 1 ? [...sessionIds][0] : undefined;
  }
}

function hasPairedConflictClaims(record: Record<string, unknown>): boolean {
  const incoming = String(record.newStatement || record.claim || '').trim();
  const prior = String(record.possiblySupersededStatement || record.priorStatement || '').trim();
  return incoming.length > 0 && prior.length > 0 && incoming !== prior;
}

function isExplicitCorrectionCandidate(text: string): boolean {
  if (!CORRECTION_PATTERN.test(text)) return false;
  if (LEADING_CORRECTION_PATTERN.test(text)) return true;
  return !/[?？]\s*$/u.test(text);
}

function eventText(event: MemoryEvent): string {
  return eventTextForMemory(event);
}

function summarizeEvents(events: MemoryEvent[]): string {
  return events
    .slice(0, 12)
    .map((event) => `${event.role || event.rawEventType || 'event'}: ${truncate(eventText(event), 180)}`)
    .join('\n');
}

function preferencePredicate(text: string): string {
  if (/不要|别|never|do not|don't|边界|boundary/iu.test(text)) return 'constraint';
  if (/长期目标|目标是|goal/iu.test(text)) return 'goal';
  if (/必须|一定要|本地优先|must|local-first/iu.test(text)) return 'operating_constraint';
  return 'preference';
}

function preferenceCategory(text: string): string {
  if (/不要|别|never|do not|don't|边界|boundary/iu.test(text)) return 'project_constraint';
  if (/长期目标|目标是|goal/iu.test(text)) return 'long_term_goal';
  if (/必须|一定要|本地优先|must|local-first/iu.test(text)) return 'operating_preference';
  return 'user_preference';
}

function preferenceTags(text: string): string[] {
  const tags = ['source:explicit_user_statement'];
  if (/记忆内核|CogMem|cogmem|OpenClaw|Hermes|Obsidian|wiki/iu.test(text)) tags.push('scope:project');
  if (/本地优先|local-first/iu.test(text)) tags.push('policy:local_first');
  if (/不要|别|never|do not|don't/iu.test(text)) tags.push('kind:negative_constraint');
  if (/长期目标|目标是|goal/iu.test(text)) tags.push('kind:goal');
  return tags;
}

function extractTopics(text: string): string[] {
  const topics: string[] = [];
  for (const topic of ['CogMem', 'cogmem', 'OpenClaw', 'Hermes', 'Obsidian', 'wiki', '记忆内核', '记忆黑盒', '上下文噪声', 'source locator', 'raw ledger', 'local-first']) {
    if (text.toLowerCase().includes(topic.toLowerCase())) topics.push(topic);
  }
  return [...new Set(topics)];
}

function inferTopicPath(text: string, topics: string[]): string {
  if (/记忆黑盒|黑盒|上下文噪声|source locator|raw ledger|原话|sourceContext/iu.test(text)) {
    return 'memory/auditability';
  }
  if (/OpenClaw|插件|plugin|hook|before_prompt_build|agent_end/iu.test(text)) {
    return 'integration/openclaw';
  }
  if (/Dream|Curator|整理|策展|候选|治理/iu.test(text)) {
    return 'memory/curation';
  }
  if (/Obsidian|wiki|知识库/iu.test(text)) {
    return 'architecture/boundary';
  }
  if (topics.includes('CogMem') || topics.includes('记忆内核')) return 'memory/kernel';
  return 'memory/session';
}

function inferSemanticTags(text: string, topics: string[]): string[] {
  const tags = new Set<string>();
  for (const topic of topics) tags.add(`topic:${topic}`);
  if (/记忆黑盒|黑盒/iu.test(text)) tags.add('concept:memory_black_box');
  if (/上下文噪声|噪声/iu.test(text)) tags.add('concept:context_noise');
  if (/原话|怎么说|exact quote|verbatim/iu.test(text)) tags.add('need:exact_quote');
  if (/sourceContext|source locator|sourceLocator|raw ledger|下钻/iu.test(text)) tags.add('need:source_drilldown');
  if (/上一个会话|上个会话|previous session|last session/iu.test(text)) tags.add('need:previous_session');
  if (/不要|禁止|边界|不能|do not|never|must not/iu.test(text)) tags.add('kind:boundary');
  if (/失败|问题|原因|root cause|diagnostic|诊断/iu.test(text)) tags.add('kind:diagnostic');
  return [...tags];
}

function memoryIndexImportance(text: string, event: MemoryEvent): { shouldEmbed: boolean; storeAs: string; reason: string } {
  if (/请以后|长期目标|必须|不要|禁止|边界|偏好|重要|always|never|must|preference|goal/iu.test(text)) {
    return {
      shouldEmbed: true,
      storeAs: 'compiled_memory_candidate',
      reason: 'durable_user_preference_goal_or_boundary',
    };
  }
  if (/记忆黑盒|上下文噪声|source locator|raw ledger|原话|诊断|root cause|失败教训/iu.test(text)) {
    return {
      shouldEmbed: true,
      storeAs: 'topic_summary_or_diagnostic_candidate',
      reason: 'reusable_project_memory_or_diagnostic_context',
    };
  }
  if (event.rawEventType === 'tool_result' || event.rawEventType === 'task_event') {
    return {
      shouldEmbed: false,
      storeAs: 'raw_ledger_only_until_governed',
      reason: 'tool_or_task_observation_requires_governance_before_embedding',
    };
  }
  return {
    shouldEmbed: false,
    storeAs: 'raw_ledger_only',
    reason: 'low_signal_event_preserve_raw_without_hot_vector',
  };
}

function isUserOwnedDurableProviderBucket(bucket: string): boolean {
  return [
    'userPreferenceCandidates',
    'longTermGoalCandidates',
    'boundaryCandidates',
    'failureLessonCandidates',
  ].includes(bucket);
}

function minDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => Number.isFinite(value));
  return defined.length ? Math.min(...defined) : undefined;
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => Number.isFinite(value));
  return defined.length ? Math.max(...defined) : undefined;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parseJsonObjectFromModel(raw: string): Record<string, unknown> | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || text;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function clampConfidence(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0.05, Math.min(0.99, numeric));
}
