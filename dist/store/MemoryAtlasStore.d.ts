import type Database from 'bun:sqlite';
import type { MemoryAtlasAction, MemoryAtlasEdge, MemoryAtlasNode } from '../atlas/MemoryAtlasTypes.js';
export declare class MemoryAtlasStore {
    readonly db: Database;
    constructor(db: Database);
    upsertDocument(input: Omit<MemoryAtlasNode, 'activation' | 'score' | 'evidenceCount'> & {
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
    }): MemoryAtlasNode[];
    evidenceIds(nodeId: string, projectId: string, limit: number): string[];
    listEdges(projectId: string): MemoryAtlasEdge[];
    listEdgesForNodes(projectId: string, nodeIds: string[], limit?: number): MemoryAtlasEdge[];
    findEdgesBetween(projectId: string, leftNodeId: string, rightNodeId: string): MemoryAtlasEdge[];
    findEdgesFromNodesToTarget(projectId: string, leftNodeIds: string[], rightNodeId: string): MemoryAtlasEdge[];
    listActions(projectId: string, options: {
        target?: string;
        from?: number;
        to?: number;
        limit: number;
    }): MemoryAtlasAction[];
    actionEvidenceIds(actionId: string, projectId: string): string[];
    recordAccess(projectId: string, nodeIds: string[], kind: string, query?: string): void;
    decay(projectId?: string, factor?: number, now?: number): number;
    projectionNeedsRefresh(projectId: string): boolean;
    markProjectionClean(projectId: string, metadata?: Record<string, unknown>, now?: number): void;
    countDocuments(projectId?: string): number;
    private refreshFtsNode;
    private topicRelationEdges;
}
//# sourceMappingURL=MemoryAtlasStore.d.ts.map