import type { MemoryAtlasNode } from '../atlas/MemoryAtlasTypes.js';
import type { MemoryQueryFrameV1 } from '../semantic/MemoryFrameTypes.js';
export declare const DEFAULT_DIMENSION_QUOTAS: Record<string, number>;
export declare class DimensionAwareRanker {
    rank(nodes: MemoryAtlasNode[], frame: MemoryQueryFrameV1, quotas?: Record<string, number>): MemoryAtlasNode[];
}
//# sourceMappingURL=DimensionAwareRanker.d.ts.map