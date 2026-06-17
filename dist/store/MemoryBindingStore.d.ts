import Database from 'bun:sqlite';
import type { MemoryBindingInput, MemoryBindingListOptions, MemoryBindingRecord, MemoryBindingStats, MemoryClusterListOptions, MemoryClusterRecord, MemoryEdgeListOptions, MemoryEdgeRecord, MemoryEdgeRelation, MemoryEntityRecord, MemoryEntityType, MemoryTopicRecord } from '../binding/MemoryBindingTypes.js';
export interface UpsertMemoryEntityInput {
    projectId?: string;
    canonicalName: string;
    entityType: MemoryEntityType;
    aliases?: string[];
    stablePath?: string;
    now?: number;
}
export interface UpsertMemoryTopicInput {
    projectId?: string;
    topicPath: string;
    parentPath?: string;
    topicType: MemoryTopicRecord['topicType'];
    summary?: string;
    now?: number;
}
export interface UpsertMemoryClusterInput {
    projectId?: string;
    topicPath: string;
    clusterType: MemoryClusterRecord['clusterType'];
    title: string;
    summary: string;
    claimKey: string;
    status: MemoryClusterRecord['status'];
    reviewFlags?: string[];
    confidence: number;
    eventId: string;
    now?: number;
}
export interface UpsertMemoryEdgeInput {
    projectId?: string;
    sourceType: MemoryEdgeRecord['sourceType'];
    sourceId: string;
    relationType: MemoryEdgeRelation;
    targetType: MemoryEdgeRecord['targetType'];
    targetId: string;
    confidence: number;
    evidenceEventIds: string[];
    status?: MemoryEdgeRecord['status'];
    createdAt?: number;
}
export declare class MemoryBindingStore {
    private readonly db;
    private readonly ownsDb;
    constructor(dbOrPath?: Database | string);
    upsertEntity(input: UpsertMemoryEntityInput): MemoryEntityRecord;
    upsertTopic(input: UpsertMemoryTopicInput): MemoryTopicRecord;
    insertBinding(input: MemoryBindingInput): MemoryBindingRecord;
    upsertCluster(input: UpsertMemoryClusterInput): MemoryClusterRecord;
    getCluster(clusterId: string): MemoryClusterRecord | null;
    listClusters(options?: MemoryClusterListOptions): MemoryClusterRecord[];
    upsertEdge(input: UpsertMemoryEdgeInput): MemoryEdgeRecord;
    listEdges(options?: MemoryEdgeListOptions): MemoryEdgeRecord[];
    listBindings(options?: MemoryBindingListOptions): MemoryBindingRecord[];
    getStats(projectId?: string): MemoryBindingStats;
    deleteByProject(projectId: string): number;
    close(): void;
    private initializeSchema;
    private ensureCompatibilityColumns;
}
//# sourceMappingURL=MemoryBindingStore.d.ts.map