import type Database from 'bun:sqlite';
import type { FacetQueryPlan } from '../atlas/FacetQueryPlanner.js';
import type { MemoryAtlasAction, MemoryAtlasCard, MemoryAtlasEdge, MemoryAtlasNode, MemoryAtlasRelatedCard } from '../atlas/MemoryAtlasTypes.js';
export declare const MEMORY_ATLAS_PROJECTION_NAME = "memory_atlas.v2";
export declare const MEMORY_ATLAS_PROJECTION_SCHEMA_VERSION = "3.7.2";
export declare class MemoryAtlasStore {
    readonly db: Database;
    constructor(db: Database);
    upsertDocument(input: Omit<MemoryAtlasNode, 'activation' | 'score' | 'evidenceCount' | 'evidenceTotal' | 'evidenceReturned'> & {
        evidenceEventIds?: string[];
        metadata?: Record<string, unknown>;
        updatedAt?: number;
    }): void;
    getNode(nodeId: string, projectId: string): MemoryAtlasNode | null;
    listNodes(projectId: string, limit: number): MemoryAtlasNode[];
    search(query: string, projectId: string, limit: number): MemoryAtlasNode[];
    searchFaceted(query: string, projectId: string, limit: number, facets: {
        from?: number;
        to?: number;
        memoryKinds?: string[];
        keywords?: string[];
        targetNodeIds?: string[];
    }): MemoryAtlasNode[];
    searchCanonicalEpisodeCards(projectId: string, plan: FacetQueryPlan, limit: number): MemoryAtlasCard[];
    relatedEpisodeCards(projectId: string, canonicalId: string, selectedIds: Set<string>, limit: number): MemoryAtlasRelatedCard[];
    private topicRelatedCardsForPlan;
    resolveTargetNodeIds(projectId: string, query: string): {
        nodeIds: string[];
        entitySourceIds: string[];
        labels: string[];
    };
    evidenceIds(nodeId: string, projectId: string, limit: number): string[];
    evidenceTotal(nodeId: string, projectId: string): number;
    listEdges(projectId: string): MemoryAtlasEdge[];
    listEdgesForNodes(projectId: string, nodeIds: string[], limit?: number): MemoryAtlasEdge[];
    findEdgesBetween(projectId: string, leftNodeId: string, rightNodeId: string): MemoryAtlasEdge[];
    findEdgesFromNodesToTarget(projectId: string, leftNodeIds: string[], rightNodeId: string): MemoryAtlasEdge[];
    listActions(projectId: string, options: {
        target?: string;
        targetEntityIds?: string[];
        from?: number;
        to?: number;
        limit: number;
    }): MemoryAtlasAction[];
    actionEvidenceIds(actionId: string, projectId: string): string[];
    recordAccess(projectId: string, nodeIds: string[], kind: string, query?: string, now?: number): number;
    cleanupAccess(options: {
        projectId?: string;
        before: number;
        retainLatest?: number;
    }): number;
    decay(projectId?: string, factor?: number, now?: number): number;
    projectionNeedsRefresh(projectId: string): boolean;
    markProjectionClean(projectId: string, metadata?: Record<string, unknown>, now?: number): void;
    markProjectionDirty(projectId: string, metadata?: Record<string, unknown>, now?: number): void;
    aggregateFacetNodeSupport(projectId: string, now?: number): void;
    markProjectionFailed(projectId: string, error: string, now?: number): void;
    getProjectionState(projectId: string): {
        status: string;
        lastRebuildAt?: number;
        lastError?: string;
    } | null;
    listKnownProjectIds(): string[];
    countDocuments(projectId?: string): number;
    private refreshFtsNode;
    private topicRelationEdges;
    private episodeEdgesForFacet;
    private episodeRows;
    private cardFromEpisodeRow;
}
//# sourceMappingURL=MemoryAtlasStore.d.ts.map