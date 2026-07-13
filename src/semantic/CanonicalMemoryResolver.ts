import type { MemoryDimension } from './MemoryFrameTypes.js';

export function normalizeAlias(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('und').trim().replace(/\s+/gu, ' ');
}

export interface CanonicalMemoryCandidate { nodeId: string; label: string; dimension: MemoryDimension; confidence: number; }

export function resolveCanonicalAlias(label: string, dimension: MemoryDimension, candidates: CanonicalMemoryCandidate[]): CanonicalMemoryCandidate | undefined {
  const normalized = normalizeAlias(label);
  const matches = candidates.filter((candidate) => candidate.dimension === dimension && normalizeAlias(candidate.label) === normalized);
  return matches.length === 1 ? matches[0] : undefined;
}
