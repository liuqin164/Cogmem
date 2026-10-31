// @ts-nocheck
import { normalizeLexiconText } from '../lexicon/coreMemoryLexicon.js';
import {
  buildAlgorithmReviewMetadata,
  MODEL_BACKED_PHASE2_REVIEW_VERSION,
  Phase1RuleAlgorithmReviewBackend,
  PHASE1_RULE_REVIEW_VERSION,
  type AlgorithmFactAdjudication,
  type AlgorithmReviewBackend,
  type AlgorithmReviewBackendMode,
  type AlgorithmReviewSuggestedEntity,
  type AlgorithmReviewSuggestedFact,
  type ReviewMultiFactExtractionCandidatesInput,
  type ReviewMultiFactExtractionCandidatesResult,
  type ReviewProvisionalFactCandidatesInput,
  type ReviewProvisionalFactCandidatesResult,
  type ReviewSelfCorrectionCandidatesInput,
  type ReviewSelfCorrectionCandidatesResult
} from './AlgorithmReviewBackend.js';
import { SemanticBackendRuntime, type SemanticBackendTask } from '../backend/SemanticBackend.js';
import { ModelRegistry } from '../models/ModelRegistry.js';

export interface Phase2ModelReviewRuntime {
  reviewProvisionalFactCandidates(
    input: ReviewProvisionalFactCandidatesInput
  ): Promise<Partial<ReviewProvisionalFactCandidatesResult>>;
  reviewSelfCorrectionCandidates(
    input: ReviewSelfCorrectionCandidatesInput
  ): Promise<Partial<ReviewSelfCorrectionCandidatesResult>>;
  reviewMultiFactExtractionCandidates(
    input: ReviewMultiFactExtractionCandidatesInput
  ): Promise<Partial<ReviewMultiFactExtractionCandidatesResult>>;
}

interface GemmaTextGenerationPipeline {
  (prompt: string, options?: Record<string, unknown>): Promise<Array<{ generated_text?: string }>>;
}

interface Phase2ModelAlgorithmReviewBackendOptions {
  semanticBackend?: SemanticBackendRuntime;
  modelRuntime?: Phase2ModelReviewRuntime;
  fallbackBackend?: AlgorithmReviewBackend;
  modelRegistry?: ModelRegistry;
}

interface StructuredModelReply {
  adjudications?: Array<Partial<AlgorithmFactAdjudication>>;
  suggestedEntities?: Array<Partial<AlgorithmReviewSuggestedEntity>>;
  suggestedFacts?: Array<Partial<AlgorithmReviewSuggestedFact>>;
}

export function resolveAlgorithmReviewBackendMode(): AlgorithmReviewBackendMode {
  return 'noop';
}

export class Phase2ModelAlgorithmReviewBackend implements AlgorithmReviewBackend {
  private readonly semanticBackend: SemanticBackendRuntime;
  private readonly fallbackBackend: AlgorithmReviewBackend;
  private runtimePromise?: Promise<Phase2ModelReviewRuntime>;

  constructor(private readonly options: Phase2ModelAlgorithmReviewBackendOptions = {}) {
    this.semanticBackend = options.semanticBackend || new SemanticBackendRuntime();
    this.fallbackBackend = options.fallbackBackend || new Phase1RuleAlgorithmReviewBackend();
  }

  async reviewProvisionalFactCandidates(
    input: ReviewProvisionalFactCandidatesInput
  ): Promise<ReviewProvisionalFactCandidatesResult> {
    const baseline = await this.fallbackBackend.reviewProvisionalFactCandidates(input);
    const runtime = await this.prepareRuntime('offline_deep_consolidation');
    if (!runtime) return this.annotateFallbackProvisional(baseline);

    const reviewed = await runtime.reviewProvisionalFactCandidates(input);
    return {
      adjudications: this.mergeAdjudications(baseline.adjudications, reviewed.adjudications || []),
      aliasMergeSuggestions: this.mergeAliasSuggestions(
        baseline.aliasMergeSuggestions,
        reviewed.aliasMergeSuggestions || []
      )
    };
  }

  async reviewSelfCorrectionCandidates(
    input: ReviewSelfCorrectionCandidatesInput
  ): Promise<ReviewSelfCorrectionCandidatesResult> {
    const baseline = await this.fallbackBackend.reviewSelfCorrectionCandidates(input);
    const runtime = await this.prepareRuntime('optional_semantic_task');
    if (!runtime) return this.annotateFallbackSuggestedFacts(baseline);

    const reviewed = await runtime.reviewSelfCorrectionCandidates(input);
    return {
      suggestedFacts: this.mergeSuggestedFacts(baseline.suggestedFacts, reviewed.suggestedFacts || [], {
        defaultKind: 'model_backed_self_correction_repair'
      })
    };
  }

  async reviewMultiFactExtractionCandidates(
    input: ReviewMultiFactExtractionCandidatesInput
  ): Promise<ReviewMultiFactExtractionCandidatesResult> {
    const baseline = await this.fallbackBackend.reviewMultiFactExtractionCandidates(input);
    const runtime = await this.prepareRuntime(
      input.mode === 'offline' ? 'offline_deep_consolidation' : 'async_low_confidence_enrichment'
    );
    if (!runtime) return this.annotateFallbackMultiFact(baseline);

    const reviewed = await runtime.reviewMultiFactExtractionCandidates(input);
    return {
      suggestedEntities: this.mergeSuggestedEntities(baseline.suggestedEntities, reviewed.suggestedEntities || []),
      suggestedFacts: this.mergeSuggestedFacts(baseline.suggestedFacts, reviewed.suggestedFacts || [], {
        defaultKind: 'model_backed_multi_fact_repair'
      })
    };
  }

  private async prepareRuntime(task: SemanticBackendTask): Promise<Phase2ModelReviewRuntime | null> {
    const invocation = this.semanticBackend.prepare(task);
    if (invocation.selectedBackend === 'rule-only-fallback') {
      return null;
    }
    if (!this.runtimePromise) {
      this.runtimePromise = this.options.modelRuntime
        ? Promise.resolve(this.options.modelRuntime)
        : this.createDefaultRuntime();
    }
    return this.runtimePromise;
  }

  private async createDefaultRuntime(): Promise<Phase2ModelReviewRuntime> {
    const status = this.semanticBackend.getStatus();
    if (!status.modelPath) {
      throw new Error('Phase2ModelAlgorithmReviewBackend requires a warmed local model path.');
    }
    return new GemmaPhase2LocalReviewRuntime(status.modelPath);
  }

  private annotateFallbackProvisional(result: ReviewProvisionalFactCandidatesResult): ReviewProvisionalFactCandidatesResult {
    return {
      adjudications: result.adjudications.map((item) => ({
        ...item,
        metadata: buildAlgorithmReviewMetadata({
          reviewBackendMode: 'phase1_rule',
          reviewVersion: PHASE1_RULE_REVIEW_VERSION,
          reviewKind: `${item.metadata?.reviewKind || item.metadata?.algorithm_review_kind || 'provisional_fact_adjudication'}`,
          reviewFallbackFrom: 'model_backed_phase2',
          provenance: `${item.metadata?.provenance || 'algorithm_review_phase1'}`,
          metadata: item.metadata
        })
      })),
      aliasMergeSuggestions: result.aliasMergeSuggestions
    };
  }

  private annotateFallbackSuggestedFacts(result: ReviewSelfCorrectionCandidatesResult): ReviewSelfCorrectionCandidatesResult {
    return {
      suggestedFacts: result.suggestedFacts.map((fact) => ({
        ...fact,
        metadata: buildAlgorithmReviewMetadata({
          reviewBackendMode: 'phase1_rule',
          reviewVersion: PHASE1_RULE_REVIEW_VERSION,
          reviewKind: `${fact.metadata?.reviewKind || fact.metadata?.algorithm_review_kind || 'self_correction_repair'}`,
          reviewFallbackFrom: 'model_backed_phase2',
          provenance: `${fact.metadata?.provenance || 'algorithm_review_phase1'}`,
          metadata: fact.metadata
        })
      }))
    };
  }

  private annotateFallbackMultiFact(result: ReviewMultiFactExtractionCandidatesResult): ReviewMultiFactExtractionCandidatesResult {
    return {
      suggestedEntities: result.suggestedEntities.map((entity) => ({
        ...entity,
        metadata: buildAlgorithmReviewMetadata({
          reviewBackendMode: 'phase1_rule',
          reviewVersion: PHASE1_RULE_REVIEW_VERSION,
          reviewKind: `${entity.metadata?.reviewKind || entity.metadata?.algorithm_review_kind || 'explicit_entity_wording_repair'}`,
          reviewFallbackFrom: 'model_backed_phase2',
          provenance: `${entity.metadata?.provenance || 'algorithm_review_phase1'}`,
          metadata: entity.metadata
        })
      })),
      suggestedFacts: result.suggestedFacts.map((fact) => ({
        ...fact,
        metadata: buildAlgorithmReviewMetadata({
          reviewBackendMode: 'phase1_rule',
          reviewVersion: PHASE1_RULE_REVIEW_VERSION,
          reviewKind: `${fact.metadata?.reviewKind || fact.metadata?.algorithm_review_kind || 'multi_fact_repair'}`,
          reviewFallbackFrom: 'model_backed_phase2',
          provenance: `${fact.metadata?.provenance || 'algorithm_review_phase1'}`,
          metadata: fact.metadata
        })
      }))
    };
  }

  private mergeAdjudications(
    baseline: AlgorithmFactAdjudication[],
    reviewed: Array<Partial<AlgorithmFactAdjudication>>
  ): AlgorithmFactAdjudication[] {
    const merged = new Map<string, AlgorithmFactAdjudication>(baseline.map((item) => [item.factId, item]));
    for (const item of reviewed) {
      if (!item.factId || !item.action || !item.reason) continue;
      merged.set(item.factId, {
        factId: item.factId,
        action: item.action,
        reason: item.reason,
        confidence: item.confidence,
        supersededByFactId: item.supersededByFactId,
        metadata: buildAlgorithmReviewMetadata({
          reviewBackendMode: 'model_backed_phase2',
          reviewVersion: MODEL_BACKED_PHASE2_REVIEW_VERSION,
          reviewKind: `${item.metadata?.reviewKind || item.metadata?.algorithm_review_kind || 'model_backed_provisional_fact_adjudication'}`,
          provenance: 'algorithm_review_phase2',
          metadata: item.metadata
        })
      });
    }
    return [...merged.values()];
  }

  private mergeAliasSuggestions<
    T extends { primaryEntityId: string; duplicateEntityId: string; reason: string }
  >(baseline: T[], reviewed: Array<Partial<T>>): T[] {
    const merged = new Map<string, T>();
    for (const item of baseline) {
      merged.set(`${item.primaryEntityId}|${item.duplicateEntityId}`, item);
    }
    for (const item of reviewed) {
      if (!item.primaryEntityId || !item.duplicateEntityId || !item.reason) continue;
      merged.set(`${item.primaryEntityId}|${item.duplicateEntityId}`, item as T);
    }
    return [...merged.values()];
  }

  private mergeSuggestedEntities(
    baseline: AlgorithmReviewSuggestedEntity[],
    reviewed: Array<Partial<AlgorithmReviewSuggestedEntity>>
  ): AlgorithmReviewSuggestedEntity[] {
    const merged = new Map<string, AlgorithmReviewSuggestedEntity>();
    for (const entity of baseline) {
      merged.set(`${entity.type}|${normalizeLexiconText(entity.canonicalName).toLowerCase()}`, entity);
    }
    for (const entity of reviewed) {
      if (!entity.canonicalName || !entity.type) continue;
      const key = `${entity.type}|${normalizeLexiconText(entity.canonicalName).toLowerCase()}`;
      merged.set(key, {
        canonicalName: entity.canonicalName,
        type: entity.type,
        aliases: entity.aliases,
        instanceMode: entity.instanceMode,
        metadata: buildAlgorithmReviewMetadata({
          reviewBackendMode: 'model_backed_phase2',
          reviewVersion: MODEL_BACKED_PHASE2_REVIEW_VERSION,
          reviewKind: `${entity.metadata?.reviewKind || entity.metadata?.algorithm_review_kind || 'model_backed_entity_wording_repair'}`,
          provenance: 'algorithm_review_phase2',
          metadata: entity.metadata
        })
      });
    }
    return [...merged.values()];
  }

  private mergeSuggestedFacts(
    baseline: AlgorithmReviewSuggestedFact[],
    reviewed: Array<Partial<AlgorithmReviewSuggestedFact>>,
    options: { defaultKind: string }
  ): AlgorithmReviewSuggestedFact[] {
    const merged = new Map<string, AlgorithmReviewSuggestedFact>();
    for (const fact of baseline) {
      merged.set(this.factKey(fact), fact);
    }
    for (const fact of reviewed) {
      if (!fact.neuronId || !fact.subject || !fact.predicateFamily || !fact.validFrom || !fact.sourceText) continue;
      const record: AlgorithmReviewSuggestedFact = {
        neuronId: fact.neuronId,
        subject: fact.subject,
        predicateFamily: fact.predicateFamily,
        predicateValue: fact.predicateValue,
        object: fact.object,
        entityId: fact.entityId,
        validFrom: fact.validFrom,
        certaintyLevel: fact.certaintyLevel || 'probable',
        confidence: fact.confidence || 0.82,
        status: fact.status || 'provisional_enriched',
        sourceText: fact.sourceText,
        metadata: buildAlgorithmReviewMetadata({
          reviewBackendMode: 'model_backed_phase2',
          reviewVersion: MODEL_BACKED_PHASE2_REVIEW_VERSION,
          reviewKind: `${fact.metadata?.reviewKind || fact.metadata?.algorithm_review_kind || options.defaultKind}`,
          provenance: 'algorithm_review_phase2',
          metadata: fact.metadata
        })
      };
      merged.set(this.factKey(record), record);
    }
    return [...merged.values()];
  }

  private factKey(fact: Pick<AlgorithmReviewSuggestedFact, 'neuronId' | 'predicateFamily' | 'predicateValue' | 'object' | 'entityId'>): string {
    return [
      fact.neuronId,
      fact.predicateFamily,
      normalizeLexiconText(fact.predicateValue || '').toLowerCase(),
      normalizeLexiconText(fact.object || '').toLowerCase(),
      fact.entityId || ''
    ].join('|');
  }
}

class GemmaPhase2LocalReviewRuntime implements Phase2ModelReviewRuntime {
  private pipelinePromise?: Promise<GemmaTextGenerationPipeline>;

  constructor(private readonly modelPath: string) {}

  async reviewProvisionalFactCandidates(
    input: ReviewProvisionalFactCandidatesInput
  ): Promise<Partial<ReviewProvisionalFactCandidatesResult>> {
    const prompt = [
      'Return JSON only.',
      'Task: adjudicate provisional facts for offline consolidation.',
      'Schema: {"adjudications":[{"factId":"...","action":"verify|archive|reject|supersede|keep_provisional","reason":"...","confidence":0.0,"supersededByFactId":"...","metadata":{"algorithm_review_kind":"..."}}],"aliasMergeSuggestions":[]}',
      JSON.stringify({
        rawEpisodes: input.rawEpisodes.map((episode) => ({ id: episode.id, content: episode.content })),
        facts: input.facts.map((fact) => ({
          factId: fact.factId,
          predicateFamily: fact.predicateFamily,
          predicateValue: fact.predicateValue,
          object: fact.object,
          confidence: fact.confidence,
          status: fact.status,
          metadata: fact.metadata
        })),
        entities: input.entities.map((entity) => ({
          entityId: entity.entityId,
          canonicalName: entity.canonicalName,
          type: entity.type,
          aliases: entity.aliases
        }))
      })
    ].join('\n');
    const parsed = await this.generateStructuredReply(prompt);
    return {
      adjudications: parsed.adjudications || [],
      aliasMergeSuggestions: []
    };
  }

  async reviewSelfCorrectionCandidates(
    input: ReviewSelfCorrectionCandidatesInput
  ): Promise<Partial<ReviewSelfCorrectionCandidatesResult>> {
    const prompt = [
      'Return JSON only.',
      'Task: propose corrected derived facts for self-correction utterances.',
      'Schema: {"suggestedFacts":[{"neuronId":"...","subject":"device|user|person|project","predicateFamily":"...","predicateValue":"...","object":"...","entityId":"...","validFrom":0,"certaintyLevel":"possible|probable|high","confidence":0.0,"status":"provisional_enriched","sourceText":"...","metadata":{"algorithm_review_kind":"model_backed_self_correction_repair"}}]}',
      JSON.stringify({
        rawEpisodes: input.rawEpisodes.map((episode) => ({ id: episode.id, content: episode.content, createdAt: episode.metadata.createdAt })),
        facts: input.facts.map((fact) => ({
          factId: fact.factId,
          neuronId: fact.neuronId,
          predicateFamily: fact.predicateFamily,
          predicateValue: fact.predicateValue,
          object: fact.object,
          entityId: fact.entityId,
          validFrom: fact.validFrom,
          sourceText: fact.sourceText,
          metadata: fact.metadata
        }))
      })
    ].join('\n');
    const parsed = await this.generateStructuredReply(prompt);
    return {
      suggestedFacts: parsed.suggestedFacts || []
    };
  }

  async reviewMultiFactExtractionCandidates(
    input: ReviewMultiFactExtractionCandidatesInput
  ): Promise<Partial<ReviewMultiFactExtractionCandidatesResult>> {
    const prompt = [
      'Return JSON only.',
      'Task: propose missing derived facts and entities for multi-fact extraction repair.',
      'Schema: {"suggestedEntities":[{"canonicalName":"...","type":"device|project|person|brand|issue","aliases":["..."],"instanceMode":"auto|canonical|new_instance","metadata":{"algorithm_review_kind":"model_backed_entity_wording_repair"}}],"suggestedFacts":[{"neuronId":"...","subject":"device|user|person|project","predicateFamily":"...","predicateValue":"...","object":"...","entityId":"...","validFrom":0,"certaintyLevel":"possible|probable|high","confidence":0.0,"status":"provisional_enriched","sourceText":"...","metadata":{"algorithm_review_kind":"model_backed_multi_fact_repair"}}]}',
      JSON.stringify({
        mode: input.mode,
        rawEpisodes: input.rawEpisodes.map((episode) => ({ id: episode.id, content: episode.content, createdAt: episode.metadata.createdAt })),
        facts: input.facts.map((fact) => ({
          factId: fact.factId,
          neuronId: fact.neuronId,
          predicateFamily: fact.predicateFamily,
          predicateValue: fact.predicateValue,
          object: fact.object,
          entityId: fact.entityId
        })),
        entities: input.entities.map((entity) => ({
          entityId: entity.entityId,
          canonicalName: entity.canonicalName,
          type: entity.type
        }))
      })
    ].join('\n');
    const parsed = await this.generateStructuredReply(prompt);
    return {
      suggestedEntities: parsed.suggestedEntities || [],
      suggestedFacts: parsed.suggestedFacts || []
    };
  }

  private async generateStructuredReply(prompt: string): Promise<StructuredModelReply> {
    const pipeline = await this.getPipeline();
    const response = await pipeline(prompt, {
      max_new_tokens: 512,
      temperature: 0.1,
      do_sample: false,
      return_full_text: false
    });
    const raw = response[0]?.generated_text || '';
    return parseStructuredReply(raw);
  }

  private async getPipeline(): Promise<GemmaTextGenerationPipeline> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        const transformers = await import('@xenova/transformers');
        return await transformers.pipeline('text-generation', this.modelPath) as GemmaTextGenerationPipeline;
      })();
    }
    return this.pipelinePromise;
  }
}

function parseStructuredReply(raw: string): StructuredModelReply {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return {};
  try {
    return JSON.parse(raw.slice(start, end + 1)) as StructuredModelReply;
  } catch {
    return {};
  }
}
