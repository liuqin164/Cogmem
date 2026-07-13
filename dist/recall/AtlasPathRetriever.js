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
        const requestedTypes = new Set([
            ...(queryFrame.actors ?? []).map(() => 'actor'), ...(queryFrame.projects ?? []).map(() => 'project'),
            ...(queryFrame.topics ?? []).map(() => 'topic'), ...(queryFrame.issues ?? []).map(() => 'issue'),
            ...(queryFrame.events ?? []).map(() => 'event'), ...(queryFrame.tasks ?? []).map(() => 'task'),
            ...(queryFrame.entities ?? []).map(() => 'entity'), ...(queryFrame.locations ?? []).map(() => 'location'),
        ]);
        result.nodes = result.nodes.filter((node) => {
            if (requestedTypes.size && !requestedTypes.has(node.nodeType))
                return false;
            if (queryFrame.time?.from !== undefined && (node.occurredAt === undefined || node.occurredAt < queryFrame.time.from))
                return false;
            if (queryFrame.time?.to !== undefined && (node.occurredAt === undefined || node.occurredAt >= queryFrame.time.to))
                return false;
            if (queryFrame.states?.length && node.nodeType === 'state' && !queryFrame.states.some((state) => node.label.toLocaleLowerCase('und').includes(state.replace('_', ' '))))
                return false;
            return true;
        });
        result.nodes = this.ranker.rank(result.nodes, queryFrame).slice(0, Math.min(options.limit ?? 30, 100));
        const selected = new Set(result.nodes.map((node) => node.id));
        result.edges = result.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target));
        return { queryFrame, result };
    }
}
