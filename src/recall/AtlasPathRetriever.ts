import type { MemoryAtlasQueryOptions, MemoryAtlasService } from '../atlas/index.js';
import type { MemoryAtlasSlice } from '../atlas/MemoryAtlasTypes.js';
import { DimensionAwareRanker } from './DimensionAwareRanker.js';
import { MultidimensionalQueryPlanner } from './MultidimensionalQueryPlanner.js';

export class AtlasPathRetriever {
  constructor(private readonly atlas: MemoryAtlasService, private readonly planner = new MultidimensionalQueryPlanner(), private readonly ranker = new DimensionAwareRanker()) {}

  retrieve(query: string, options: MemoryAtlasQueryOptions): { queryFrame: ReturnType<MultidimensionalQueryPlanner['plan']>; result: MemoryAtlasSlice } {
    const queryFrame = this.planner.plan(query, options.now);
    const result = this.atlas.explore(query, { ...options, limit: Math.min(options.limit ?? 30, 100) });
    result.nodes = this.ranker.rank(result.nodes, queryFrame).slice(0, Math.min(options.limit ?? 30, 100));
    const selected = new Set(result.nodes.map((node) => node.id));
    result.edges = result.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target));
    return { queryFrame, result };
  }
}
