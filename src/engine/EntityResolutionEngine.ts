import type { QueryIR } from '../types/query-ir.js';
import type { EntityDisambiguationCandidate, EntityRecord, EntityStore } from '../store/EntityStore.js';
import {
  ENTITY_INSTANCE_SIGNAL_LEXICON,
  extractRelativeReferences,
  inferReferenceType,
  isStrongNewInstanceSignal,
  isStrongUpdateInstanceSignal,
  normalizeLexiconText
} from '../lexicon/coreMemoryLexicon.js';

export enum EntityInstanceDecisionSignal {
  STRONG_NEW_SIGNAL = 'strong_new_signal',
  STRONG_UPDATE_SIGNAL = 'strong_update_signal',
  AMBIGUOUS = 'ambiguous'
}

export enum PendingEntityFallbackStrategy {
  ASSUME_NEW = 'ASSUME_NEW',
  ASSUME_LATEST = 'ASSUME_LATEST',
  STAY_PENDING = 'STAY_PENDING'
}

export const STRONG_NEW_SIGNAL_PHRASES = ENTITY_INSTANCE_SIGNAL_LEXICON.strongNew;
export const STRONG_UPDATE_SIGNAL_PHRASES = ENTITY_INSTANCE_SIGNAL_LEXICON.strongUpdate;

export interface EntityInstanceResolutionDecision {
  normalizedText: string;
  signal: EntityInstanceDecisionSignal;
  matchedSignal?: string;
  fallback: PendingEntityFallbackStrategy;
  shouldCreatePending: boolean;
}

export interface EntityResolutionResult {
  resolved: EntityRecord[];
  relatedEntityIds: string[];
  candidateRefs: string[];
  confidence: number;
  disambiguation: Array<{
    reference: string;
    candidates: EntityDisambiguationCandidate[];
  }>;
}

export class EntityResolutionEngine {
  constructor(private entityStore: EntityStore) {}

  resolve(input: {
    query: string;
    ir: QueryIR;
    projectId?: string;
  }): EntityResolutionResult {
    const candidateRefs = Array.from(new Set([
      ...input.ir.entities,
      ...input.ir.mustMatch,
      ...input.ir.shouldMatch,
      ...input.ir.semantics.entityHints,
      ...this.extractImplicitRefs(input.query)
    ])).filter(Boolean);

    const disambiguation = candidateRefs.map((ref) => ({
      reference: ref,
      candidates: this.entityStore.listReferenceCandidatesWithRelativeSupport(
        ref,
        this.inferType(ref, input.query),
        {
          projectId: input.projectId,
          beforeTime: this.resolveBeforeTime(input.ir)
        }
      )
    }));

    const resolved = disambiguation
      .map((item) => item.candidates[0]?.entity)
      .filter((entity): entity is EntityRecord => Boolean(entity));

    const relatedEntityIds = Array.from(new Set(
      resolved.flatMap((entity) => this.entityStore.listRelations(entity.entityId, undefined, input.projectId).map((relation) =>
        relation.sourceEntityId === entity.entityId ? relation.targetEntityId : relation.sourceEntityId
      ))
    )).filter((entityId) => !resolved.some((entity) => entity.entityId === entityId));

    return {
      resolved,
      relatedEntityIds,
      candidateRefs,
      confidence: resolved.length > 0 ? Math.min(0.96, 0.58 + resolved.length * 0.12) : 0.22,
      disambiguation: disambiguation.filter((item) => item.candidates.length > 0)
    };
  }

  private resolveBeforeTime(ir: QueryIR): number | undefined {
    if (ir.temporal.end) return ir.temporal.end;
    if (ir.temporal.relative === 'around_half_year_ago') {
      return Date.now() - 150 * 24 * 60 * 60 * 1000;
    }
    if (ir.temporal.relative === 'past_six_months') {
      return Date.now();
    }
    return undefined;
  }

  private extractImplicitRefs(query: string): string[] {
    return extractRelativeReferences(normalizeLexiconText(query));
  }

  private inferType(reference: string, query: string): string | undefined {
    return inferReferenceType(reference, query);
  }
}

export function decideEntityInstanceResolution(text: string): EntityInstanceResolutionDecision {
  const normalizedText = normalizeEntityInstanceText(text);
  const strongNewMatch = STRONG_NEW_SIGNAL_PHRASES.find((phrase) => normalizedText.includes(phrase.toLowerCase()));
  if (strongNewMatch) {
    return {
      normalizedText,
      signal: EntityInstanceDecisionSignal.STRONG_NEW_SIGNAL,
      matchedSignal: strongNewMatch,
      fallback: PendingEntityFallbackStrategy.ASSUME_NEW,
      shouldCreatePending: false
    };
  }

  const strongUpdateMatch = STRONG_UPDATE_SIGNAL_PHRASES.find((phrase) => normalizedText.includes(phrase.toLowerCase()));
  if (strongUpdateMatch) {
    return {
      normalizedText,
      signal: EntityInstanceDecisionSignal.STRONG_UPDATE_SIGNAL,
      matchedSignal: strongUpdateMatch,
      fallback: PendingEntityFallbackStrategy.ASSUME_LATEST,
      shouldCreatePending: false
    };
  }

  return {
    normalizedText,
    signal: EntityInstanceDecisionSignal.AMBIGUOUS,
    fallback: PendingEntityFallbackStrategy.STAY_PENDING,
    shouldCreatePending: true
  };
}

function normalizeEntityInstanceText(text: string): string {
  const normalized = normalizeLexiconText(text)
    .toLowerCase()
    .replace(/不对，?\s*/g, '')
    .replace(/其实，?\s*/g, '')
    .replace(/\s+/g, ' ');
  if (isStrongNewInstanceSignal(normalized) || isStrongUpdateInstanceSignal(normalized)) {
    return normalized;
  }
  return normalized;
}
