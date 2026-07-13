import type { MemoryDimension, MemoryQueryFacet, MemoryQueryFrameV1, MemoryQueryIntent } from '../semantic/MemoryFrameTypes.js';

export type { MemoryQueryFacet, MemoryQueryFrameV1, MemoryQueryIntent } from '../semantic/MemoryFrameTypes.js';

export function createMemoryQueryFrame(input: Omit<MemoryQueryFrameV1, 'schemaVersion'>): MemoryQueryFrameV1 {
  return { schemaVersion: 'memory_query_frame.v1', ...input };
}

export function queryFacet(label: string, dimension?: MemoryDimension, canonicalNodeId?: string): MemoryQueryFacet {
  return { label, dimension, canonicalNodeId };
}
