import {
  Phase1RuleAlgorithmReviewBackend,
  type AlgorithmReviewBackend,
  type ReviewMultiFactExtractionCandidatesInput,
  type ReviewMultiFactExtractionCandidatesResult,
  type ReviewProvisionalFactCandidatesInput,
  type ReviewProvisionalFactCandidatesResult,
  type ReviewSelfCorrectionCandidatesInput,
  type ReviewSelfCorrectionCandidatesResult
} from '../../algorithm/AlgorithmReviewBackend.js';
import { ModelRegistry } from '../ModelRegistry.js';
import type { TextGenerateFn } from '../ModelRole.js';
import { truncate } from '../../utils/Values.js';

function safeParse<T>(raw: string): Partial<T> {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Partial<T>;
  } catch {
    return {};
  }
}

export class MemoryReviewAdapter implements AlgorithmReviewBackend {
  constructor(private generateFn: TextGenerateFn) {}

  async reviewProvisionalFactCandidates(
    input: ReviewProvisionalFactCandidatesInput
  ): Promise<ReviewProvisionalFactCandidatesResult> {
    const system = 'Return JSON only with {"adjudications":[],"aliasMergeSuggestions":[]}.';
    const user = truncate(JSON.stringify({
      rawEpisodes: input.rawEpisodes.map((episode) => ({
        id: episode.id,
        content: episode.content,
        createdAt: episode.metadata.createdAt
      })),
      facts: input.facts,
      entities: input.entities
    }), 1500);
    const parsed = safeParse<ReviewProvisionalFactCandidatesResult>(await this.generateFn(system, user));
    return {
      adjudications: Array.isArray(parsed.adjudications) ? parsed.adjudications : [],
      aliasMergeSuggestions: Array.isArray(parsed.aliasMergeSuggestions) ? parsed.aliasMergeSuggestions : []
    };
  }

  async reviewSelfCorrectionCandidates(
    input: ReviewSelfCorrectionCandidatesInput
  ): Promise<ReviewSelfCorrectionCandidatesResult> {
    const system = 'Return JSON only with {"suggestedFacts":[]}.';
    const user = truncate(JSON.stringify({
      rawEpisodes: input.rawEpisodes.map((episode) => ({
        id: episode.id,
        content: episode.content,
        createdAt: episode.metadata.createdAt
      })),
      facts: input.facts,
      entities: input.entities
    }), 1500);
    const parsed = safeParse<ReviewSelfCorrectionCandidatesResult>(await this.generateFn(system, user));
    return {
      suggestedFacts: Array.isArray(parsed.suggestedFacts) ? parsed.suggestedFacts : []
    };
  }

  async reviewMultiFactExtractionCandidates(
    input: ReviewMultiFactExtractionCandidatesInput
  ): Promise<ReviewMultiFactExtractionCandidatesResult> {
    const system = 'Return JSON only with {"suggestedEntities":[],"suggestedFacts":[]}.';
    const user = truncate(JSON.stringify({
      mode: input.mode,
      rawEpisodes: input.rawEpisodes.map((episode) => ({
        id: episode.id,
        content: episode.content,
        createdAt: episode.metadata.createdAt
      })),
      facts: input.facts,
      entities: input.entities
    }), 1500);
    const parsed = safeParse<ReviewMultiFactExtractionCandidatesResult>(await this.generateFn(system, user));
    return {
      suggestedEntities: Array.isArray(parsed.suggestedEntities) ? parsed.suggestedEntities : [],
      suggestedFacts: Array.isArray(parsed.suggestedFacts) ? parsed.suggestedFacts : []
    };
  }
}

export function createMemoryReviewAdapter(
  registry: ModelRegistry
): AlgorithmReviewBackend {
  if (registry.isRuleOnly('memory')) {
    return new Phase1RuleAlgorithmReviewBackend();
  }
  return new MemoryReviewAdapter(registry.getTextGenerator('memory'));
}
