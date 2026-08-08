import Database from 'bun:sqlite';
import type { CognitiveEdgeRecord, CognitiveEdgeType, CognitiveNodeRecord, CognitiveNodeType } from '../types/index.js';
export declare class CognitiveGraphStore {
    private db;
    private readonly ownsDb;
    constructor(dbOrPath?: Database | string);
    private initializeSchema;
    upsertNode(input: {
        nodeId: string;
        nodeType: CognitiveNodeType;
        nodeKey: string;
        title: string;
        projectId?: string;
        sourceNeuronId?: string;
        metadata?: Record<string, unknown>;
        createdAt: number;
    }): CognitiveNodeRecord;
    linkNodes(input: {
        sourceNodeId: string;
        targetNodeId: string;
        edgeType: CognitiveEdgeType;
        weight?: number;
        projectId?: string;
        metadata?: Record<string, unknown>;
        createdAt: number;
    }): CognitiveEdgeRecord;
    findNode(projectId: string | undefined, nodeType: CognitiveNodeType, nodeKey: string): CognitiveNodeRecord | null;
    resetProjectTimeProjection(projectId: string): void;
    collectContext(input: {
        projectId?: string;
        terms?: string[];
        seedNodeKeys?: string[];
        seedNodeIds?: string[];
        limit?: number;
        hopLimit?: number;
        excludeTemporal?: boolean;
    }): {
        seedNodeIds: string[];
        traversedNodeIds: string[];
        neuronIds: string[];
        edgeCount: number;
    };
    getNodeCount(): number;
    private hasReadableTimeProjection;
    getEdgeCount(): number;
    close(): void;
}
//# sourceMappingURL=CognitiveGraphStore.d.ts.map