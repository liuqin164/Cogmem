import type { MemoryAtlasQueryOptions, MemoryAtlasService } from '../atlas/index.js';
import type { MemoryAtlasSlice } from '../atlas/MemoryAtlasTypes.js';
import { DimensionAwareRanker } from './DimensionAwareRanker.js';
import { MultidimensionalQueryPlanner } from './MultidimensionalQueryPlanner.js';
export declare class AtlasPathRetriever {
    private readonly atlas;
    private readonly planner;
    private readonly ranker;
    constructor(atlas: MemoryAtlasService, planner?: MultidimensionalQueryPlanner, ranker?: DimensionAwareRanker);
    retrieve(query: string, options: MemoryAtlasQueryOptions): {
        queryFrame: ReturnType<MultidimensionalQueryPlanner['plan']>;
        result: MemoryAtlasSlice;
    };
}
//# sourceMappingURL=AtlasPathRetriever.d.ts.map