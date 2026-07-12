import type { BeliefCandidate, BeliefRecord, Neuron } from '../types/index.js';
import { aaakGenerator } from '../utils/AAAKGenerator.js';
import { BeliefStore } from '../belief/BeliefStore.js';
import { BeliefExtractor } from './BeliefExtractor.js';
import { MemoryGate, type MemoryGateResult } from './MemoryGate.js';
import { InteractionBinder, type BindingResult } from './InteractionBinder.js';
import type { InteractionUnitRecord } from '../store/InteractionUnitStore.js';
import { FactCompiler, type FactCompilationResult } from './FactCompiler.js';
import type { LocalSemanticCompiler, SemanticCompilation } from './LocalSemanticCompiler.js';
import type { CompilerConfidenceStore } from '../store/CompilerConfidenceStore.js';
import type { FactStore } from '../store/FactStore.js';
import type { EntityStore } from '../store/EntityStore.js';
import { OfflineConsolidationPipeline } from './OfflineConsolidationPipeline.js';
import {
  createAsyncEnrichmentRunId,
  NoopAsyncEnrichmentHook,
  type AsyncEnrichmentHook,
  type AsyncEnrichmentContextSnapshot,
  type AsyncEnrichmentEntityBinding,
  type AsyncEnrichmentTrigger,
  type AsyncEnrichmentWriteback
} from '../types/AsyncEnrichment.js';

export interface ConsolidationResult {
  gate: MemoryGateResult;
  binding: BindingResult;
  interactionUnit?: InteractionUnitRecord | null;
  aaakSummary?: string;
  semanticCompilation?: SemanticCompilation;
  candidates: BeliefCandidate[];
  beliefs: BeliefRecord[];
  compiledFacts: FactCompilationResult['facts'];
  compiledEvents: FactCompilationResult['events'];
  compiledEntityIds: string[];
  rejectedCount: number;
}

/**
 * Online lightweight compilation pipeline.
 * Responsibilities stay intentionally narrow:
 * - raw episodes are already durably written before this stage runs
 * - apply the minimal gate and binder needed for the current session
 * - emit provisional facts / events / entity hints for near-term recall
 * - leave deep semantic reconciliation to the offline consolidation layer
 */
export class ConsolidationPipeline {
  private beliefExtractor: BeliefExtractor;
  private memoryGate: MemoryGate;
  private asyncEnrichmentHook: AsyncEnrichmentHook;
  private asyncEnrichmentEnabled: boolean;
  private lowConfidenceThreshold: number;
  private offlineConsolidationPipeline: OfflineConsolidationPipeline;

  constructor(
    private beliefStore: BeliefStore,
    private interactionBinder: InteractionBinder,
    private factCompiler: FactCompiler,
    private semanticCompiler: LocalSemanticCompiler,
    private factStore: FactStore,
    private entityStore: EntityStore,
    private compilerConfidenceStore?: CompilerConfidenceStore,
    beliefExtractor?: BeliefExtractor,
    offlineConsolidationPipeline: OfflineConsolidationPipeline = new OfflineConsolidationPipeline(),
    asyncEnrichmentHook: AsyncEnrichmentHook = new NoopAsyncEnrichmentHook(),
    options: {
      enabled?: boolean;
      lowConfidenceThreshold?: number;
    } = {}
  ) {
    this.beliefExtractor = beliefExtractor || new BeliefExtractor();
    this.memoryGate = new MemoryGate();
    this.offlineConsolidationPipeline = offlineConsolidationPipeline;
    this.asyncEnrichmentHook = asyncEnrichmentHook;
    this.asyncEnrichmentEnabled = options.enabled === true;
    this.lowConfidenceThreshold = options.lowConfidenceThreshold ?? 0.72;
  }

  consolidate(neuron: Neuron, sourceEventId: string): ConsolidationResult {
    const aaakSummary = this.ensureAAAKSummary(neuron);
    const gate = this.memoryGate.classify(neuron.content);
    const binding = this.interactionBinder.process(neuron);
    const interactionUnit = binding.unit;
    const tags = neuron.metadata.tags || [];
    const isProfileOnlyImport = tags.includes('ingest:profile_only');

    if (isProfileOnlyImport) {
      return {
        gate,
        binding,
        interactionUnit,
        aaakSummary,
        semanticCompilation: undefined,
        candidates: [],
        beliefs: [],
        compiledFacts: [],
        compiledEvents: [],
        compiledEntityIds: [],
        rejectedCount: 0
      };
    }

    const semanticCompilation = this.semanticCompiler.compileMemory({
      text: interactionUnit?.semanticText || neuron.content,
      projectId: neuron.metadata.projectId,
      type: neuron.metadata.type,
      createdAt: neuron.metadata.createdAt
    });
    this.compilerConfidenceStore?.insert({
      runId: semanticCompilation.runId,
      targetType: 'memory',
      targetId: neuron.id,
      projectId: neuron.metadata.projectId,
      compilerName: 'LocalSemanticCompiler',
      confidence: semanticCompilation.confidence,
      metadata: {
        tags: semanticCompilation.tags,
        entities: semanticCompilation.entities.map((entity) => entity.text),
        topics: semanticCompilation.topics.map((topic) => topic.topic),
        issueHints: semanticCompilation.issueHints,
        ownershipSignals: semanticCompilation.ownershipSignals,
        relativeReferences: semanticCompilation.relativeReferences,
        projectLinks: semanticCompilation.projectLinks
      },
      createdAt: neuron.metadata.createdAt
    });

    if (gate.memoryClass === 'drop') {
      return {
        gate,
        binding,
        interactionUnit,
        aaakSummary,
        semanticCompilation,
        candidates: [],
        beliefs: [],
        compiledFacts: [],
        compiledEvents: [],
        compiledEntityIds: [],
        rejectedCount: 0
      };
    }

    const compiled = this.factCompiler.compile({
      neuron,
      unit: interactionUnit,
      semanticCompilation
    });

    if (gate.memoryClass === 'bind_first' && !binding.bound) {
      return {
        gate,
        binding,
        interactionUnit,
        aaakSummary,
        semanticCompilation,
        candidates: [],
        beliefs: [],
        compiledFacts: compiled.facts,
        compiledEvents: compiled.events,
        compiledEntityIds: compiled.entityIds,
        rejectedCount: 0
      };
    }

    const candidates = gate.memoryClass === 'short_term'
      ? []
      : this.extractBeliefCandidates(neuron, sourceEventId);

    const beliefs: BeliefRecord[] = [];
    let rejectedCount = 0;

    for (const candidate of candidates) {
      const result = this.beliefStore.upsert(candidate, neuron.metadata.createdAt);
      if (result.belief) beliefs.push(result.belief);
      else rejectedCount += 1;
    }

    const result = {
      gate,
      binding,
      interactionUnit,
      aaakSummary,
      semanticCompilation,
      candidates,
      beliefs,
      compiledFacts: compiled.facts,
      compiledEvents: compiled.events,
      compiledEntityIds: compiled.entityIds,
      rejectedCount
    };

    this.dispatchAsyncEnrichment(neuron, sourceEventId, result);
    this.scheduleOfflineConsolidation(neuron, result);
    return result;
  }

  private ensureAAAKSummary(neuron: Neuron): string | undefined {
    if (neuron.metadata.aaak_summary) return neuron.metadata.aaak_summary;

    const importance = this.calculateImportance(neuron.content);
    const summary = aaakGenerator.generateSummarySync(
      neuron.content,
      neuron.metadata.type,
      importance
    );

    neuron.metadata.aaak_summary = summary;
    return summary;
  }

  private extractBeliefCandidates(neuron: Neuron, sourceEventId: string): BeliefCandidate[] {
    return this.beliefExtractor.extract({ neuron, sourceEventId });
  }

  private calculateImportance(content: string): number {
    const len = content.length;
    if (len < 50) return 1;
    if (len < 100) return 2;
    if (len < 200) return 3;
    if (len < 500) return 4;
    return 5;
  }

  private dispatchAsyncEnrichment(
    neuron: Neuron,
    sourceEventId: string,
    consolidation: ConsolidationResult
  ): void {
    if (!this.asyncEnrichmentEnabled) return;

    const triggers = this.collectAsyncEnrichmentTriggers(consolidation);
    if (triggers.length === 0) return;

    const runId = createAsyncEnrichmentRunId();
    queueMicrotask(() => {
      Promise.resolve(
        this.asyncEnrichmentHook.enrich(
          {
            runId,
            neuron,
            sourceEventId,
            triggers,
            consolidation,
            compilerOutput: {
              facts: consolidation.compiledFacts,
              events: consolidation.compiledEvents,
              entityIds: consolidation.compiledEntityIds
            },
            entityBinding: this.buildAsyncEnrichmentEntityBinding(neuron, consolidation),
            recentContext: this.buildAsyncEnrichmentContext(neuron, consolidation)
          },
          {
            persist: (result) => this.persistAsyncEnrichmentResult(runId, neuron, sourceEventId, result)
          }
        )
      )
        .then((result) => {
          if (result) this.persistAsyncEnrichmentResult(runId, neuron, sourceEventId, result);
        })
        .catch(() => undefined);
    });
  }

  private scheduleOfflineConsolidation(
    neuron: Neuron,
    consolidation: ConsolidationResult
  ): void {
    const pendingReferenceIds = consolidation.compiledFacts
      .filter((fact) => fact.status === 'provisional' && !fact.entityId)
      .map((fact) => fact.factId);
    const reasons = [
      ...(pendingReferenceIds.length > 0 ? ['pending_reference_or_entity_binding'] : []),
      ...(this.collectAsyncEnrichmentTriggers(consolidation).map((trigger) => trigger.kind)),
      ...((consolidation.semanticCompilation?.issueHints.length || 0) > 1 ? ['multi_issue_candidate_sentence'] : []),
      ...((consolidation.binding.bound || consolidation.binding.pendingRegistered) ? ['interaction_binding_present'] : [])
    ];

    queueMicrotask(() => {
      this.offlineConsolidationPipeline.schedule({
        neuron,
        interactionUnit: consolidation.interactionUnit,
        provisionalFacts: consolidation.compiledFacts,
        provisionalEvents: consolidation.compiledEvents,
        provisionalEntityIds: consolidation.compiledEntityIds,
        beliefIds: consolidation.beliefs.map((belief) => belief.id),
        pendingReferenceIds,
        reasons: Array.from(new Set(reasons))
      });
    });
  }

  private collectAsyncEnrichmentTriggers(consolidation: ConsolidationResult): AsyncEnrichmentTrigger[] {
    const triggers: AsyncEnrichmentTrigger[] = [];
    if (consolidation.compiledFacts.length === 0) {
      triggers.push({
        kind: 'ingest_compiled_fact_count_zero',
        detail: 'ingest_compiled_fact_count=0'
      });
    }
    if (this.hasSelfCorrectionPattern(consolidation)) {
      triggers.push({
        kind: 'self_correction_pattern',
        detail: consolidation.interactionUnit?.semanticText || consolidation.aaakSummary || 'self_correction_pattern'
      });
    }
    if ((consolidation.semanticCompilation?.issueHints.length || 0) > 1 && consolidation.compiledFacts.length <= 1) {
      triggers.push({
        kind: 'multi_candidate_single_fact',
        detail: `${consolidation.semanticCompilation?.issueHints.length || 0}_issue_candidates_vs_${consolidation.compiledFacts.length}_compiled_facts`
      });
    }
    if (this.hasSuspiciousUnseenEntityBinding(consolidation)) {
      triggers.push({
        kind: 'unseen_entity_binding_suspect',
        detail: 'explicit_unseen_name_bound_to_existing_entity'
      });
    }
    if ((consolidation.semanticCompilation?.confidence || 1) < this.lowConfidenceThreshold) {
      triggers.push({
        kind: 'low_compiler_confidence',
        detail: `compiler_confidence=${(consolidation.semanticCompilation?.confidence || 0).toFixed(3)}`
      });
    }
    return triggers;
  }

  private buildAsyncEnrichmentEntityBinding(neuron: Neuron, consolidation: ConsolidationResult): AsyncEnrichmentEntityBinding {
    const compiledEntities = consolidation.compiledEntityIds
      .map((entityId) => this.entityStore.getByEntityId(entityId))
      .filter((entity): entity is NonNullable<typeof entity> => Boolean(entity));
    const suspiciousReasons: string[] = [];
    if (compiledEntities.length > 0) {
      const explicitEntityHints = consolidation.semanticCompilation?.entities.map((entity) => entity.text) || [];
      if (explicitEntityHints.some((hint) => !compiledEntities.some((entity) => entity.canonicalName.includes(hint) || hint.includes(entity.canonicalName)))) {
        suspiciousReasons.push('semantic_entity_hint_mismatch');
      }
    }
    const explicitNamedDevice = neuron.content.match(/([A-Za-z][A-Za-z0-9._-]*(?:\s+[A-Za-z0-9._-]+){1,3})/);
    const candidate = explicitNamedDevice?.[1];
    if (candidate && compiledEntities.length > 0 && compiledEntities.every((entity) => !entity.canonicalName.toLowerCase().includes(candidate.toLowerCase()))) {
      suspiciousReasons.push('explicit_unseen_name_mismatch');
    }

    return {
      compiledEntityIds: consolidation.compiledEntityIds,
      compiledEntities,
      suspicious: suspiciousReasons.length > 0,
      reasons: suspiciousReasons
    };
  }

  private buildAsyncEnrichmentContext(neuron: Neuron, consolidation: ConsolidationResult): AsyncEnrichmentContextSnapshot {
    const recentEntities = Array.from(new Map(
      [
        ...consolidation.compiledEntityIds.map((entityId) => this.entityStore.getByEntityId(entityId)),
        ...this.entityStore.getEntityTimeline({
          projectId: neuron.metadata.projectId,
          limit: 8
        }).map((item) => this.entityStore.getByEntityId(item.entityId))
      ]
        .filter((entity): entity is NonNullable<typeof entity> => Boolean(entity))
        .map((entity) => [entity.entityId, entity])
    ).values()).slice(0, 6);

    const recentFacts = this.factStore.listFactsByEntityIds(recentEntities.map((entity) => entity.entityId), { limit: 12 });
    const recentPreferenceFacts = recentFacts.filter((fact) => fact.predicateFamily === 'likes' || fact.predicateFamily === 'dislikes');

    return {
      recentEntities,
      recentFacts,
      recentPreferenceFacts
    };
  }

  private hasSelfCorrectionPattern(consolidation: ConsolidationResult): boolean {
    const text = consolidation.interactionUnit?.semanticText || '';
    return /(不对|不是|更正|改口)/.test(text) && /(左耳|右耳)/.test(text);
  }

  private hasSuspiciousUnseenEntityBinding(consolidation: ConsolidationResult): boolean {
    const semanticEntityHints = consolidation.semanticCompilation?.entities.map((entity) => entity.text) || [];
    const compiledEntityNames = consolidation.compiledEntityIds
      .map((entityId) => this.entityStore.getByEntityId(entityId)?.canonicalName || '')
      .filter(Boolean);
    const sourceText = consolidation.interactionUnit?.semanticText || '';
    const explicitNamedDevice = sourceText.match(/([A-Za-z][A-Za-z0-9._-]*(?:\s+[A-Za-z0-9._-]+){1,3})/);
    const candidate = explicitNamedDevice?.[1];
    if (!candidate) return false;
    return semanticEntityHints.some((hint) => hint === candidate)
      || (compiledEntityNames.length > 0 && compiledEntityNames.every((name) => !name.toLowerCase().includes(candidate.toLowerCase())));
  }

  private persistAsyncEnrichmentResult(
    runId: string,
    neuron: Neuron,
    sourceEventId: string,
    result: AsyncEnrichmentWriteback
  ): {
    entities: ReturnType<EntityStore['upsertEntity']>[];
    facts: ReturnType<FactStore['insertFacts']>;
    beliefIds: string[];
  } {
    const entities = (result.entities || []).map((entity) => {
      const record = this.entityStore.upsertEntity({
        canonicalName: entity.canonicalName,
        type: entity.type,
        aliases: entity.aliases,
        createdFrom: neuron.id,
        metadata: {
          ...(entity.metadata || {}),
          source: 'enrichment',
          enrichment_run_id: runId,
          parent_neuron_id: neuron.id
        },
        instanceMode: entity.instanceMode,
        createdAt: Date.now()
      });
      this.entityStore.recordMention({
        entityId: record.entityId,
        neuronId: neuron.id,
        projectId: neuron.metadata.projectId,
        mentionType: 'related',
        createdAt: Date.now()
      });
      return record;
    });

    const facts = this.factStore.insertFacts((result.facts || []).map((fact) => ({
      ...fact,
      metadata: {
        ...(fact.metadata || {}),
        source: 'enrichment',
        fact_origin: 'enriched_fact',
        enrichment_run_id: runId,
        parent_neuron_id: neuron.id
      }
    })));

    const beliefIds: string[] = [];
    for (const belief of result.beliefs || []) {
      const upserted = this.beliefStore.upsert({
        ...belief,
        sourceNeuronId: belief.sourceNeuronId || neuron.id,
        sourceEventId: belief.sourceEventId || sourceEventId,
        sourceType: belief.sourceType || 'llm_inference',
        metadata: {
          ...(belief.metadata || {}),
          source: 'enrichment',
          enrichment_run_id: runId,
          parent_neuron_id: neuron.id
        }
      }, Date.now());
      if (upserted.belief) beliefIds.push(upserted.belief.id);
    }

    return { entities, facts, beliefIds };
  }
}
