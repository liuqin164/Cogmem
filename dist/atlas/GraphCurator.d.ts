import type Database from 'bun:sqlite';
import type { EventStore } from '../store/EventStore.js';
import { MemoryAtlasStore } from '../store/MemoryAtlasStore.js';
export interface GraphCuratorResult {
    episodeCount: number;
    facetNodeCount: number;
    facetEdgeCount: number;
    reviewNeeded: number;
}
export declare class GraphCurator {
    private readonly db;
    private readonly eventStore;
    private readonly atlasStore;
    private readonly titleGenerator;
    constructor(db: Database, eventStore: EventStore, atlasStore: MemoryAtlasStore);
    rebuild(projectId: string, now?: number): GraphCuratorResult;
    rebuildEpisodes(projectId: string, episodeIds: string[], now?: number): GraphCuratorResult;
    private projectEpisode;
    private episodeEventIds;
    private facetTargetsFor;
    private upsertFacetNode;
    private upsertRawEventNode;
    private projectEpisodeRelations;
    private upsertEpisodeRelation;
    private entityHintsFor;
    private deleteFacetEdges;
    private deleteFacetEdgesForEpisodes;
    private upsertEdge;
}
//# sourceMappingURL=GraphCurator.d.ts.map