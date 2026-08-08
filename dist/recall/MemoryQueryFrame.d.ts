import type { MemoryDimension, MemoryQueryFacet, MemoryQueryFrameV1 } from '../semantic/MemoryFrameTypes.js';
export type { MemoryQueryFacet, MemoryQueryFrameV1, MemoryQueryIntent } from '../semantic/MemoryFrameTypes.js';
export declare function createMemoryQueryFrame(input: Omit<MemoryQueryFrameV1, 'schemaVersion'>): MemoryQueryFrameV1;
export declare function queryFacet(label: string, dimension?: MemoryDimension, canonicalNodeId?: string): MemoryQueryFacet;
//# sourceMappingURL=MemoryQueryFrame.d.ts.map