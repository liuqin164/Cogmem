import { DimensionAwareRanker } from './DimensionAwareRanker.js';
import { MultidimensionalQueryPlanner } from './MultidimensionalQueryPlanner.js';
export class AtlasPathRetriever {
    atlas;
    planner;
    ranker;
    constructor(atlas, planner = new MultidimensionalQueryPlanner(), ranker = new DimensionAwareRanker()) {
        this.atlas = atlas;
        this.planner = planner;
        this.ranker = ranker;
    }
    retrieve(query, options) {
        const queryFrame = this.planner.plan(query, options.now);
        const result = this.atlas.explore(query, { ...options, limit: Math.min(options.limit ?? 30, 100) });
        result.nodes = this.ranker.rank(result.nodes, queryFrame).slice(0, Math.min(options.limit ?? 30, 100));
        const selected = new Set(result.nodes.map((node) => node.id));
        result.edges = result.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target));
        return { queryFrame, result };
    }
}
