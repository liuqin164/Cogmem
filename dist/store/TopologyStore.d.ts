import Database from 'bun:sqlite';
import type { EventClusterRecord, EventClusterType, ProjectBranchKind, ProjectBranchRecord, TaskBranchRecord, TimeBucketRecord, TimeBucketType, TopologyReference } from '../types/index.js';
export declare class TopologyStore {
    private db;
    private readonly ownsDb;
    constructor(dbOrPath?: Database | string);
    private initializeSchema;
    timeProjectionNeedsRebuild(projectId: string, timeZone: string): boolean;
    hasDirtyTimeProjection(projectId?: string): boolean;
    hasUsableTimeProjection(projectId: string, timeZone: string): boolean;
    hasUsableTimeProjections(timeZone: string): boolean;
    beginTimeProjectionSourceUpdate(projectId: string | undefined, timeZone: string, updatedAt: number): {
        sourceRevision: number;
        incremental: boolean;
    };
    getTimeProjectionSourceRevision(projectId: string | undefined): number;
    markTimeProjection(projectId: string, status: 'dirty' | 'building' | 'clean' | 'failed', timeZone: string, updatedAt: number, error?: string, sourceRevision?: number): void;
    resetProjectTimeBuckets(projectId: string): void;
    listProjectTimeBucketsByNeuron(projectId: string, neuronIds: string[]): Map<string, TimeBucketRecord[]>;
    upsertTimeBucket(bucket: TimeBucketRecord): TimeBucketRecord;
    attachToTimeBucket(bucketId: string, ref: TopologyReference & {
        projectId?: string;
    }): void;
    upsertProjectBranch(input: {
        branchId: string;
        projectId: string;
        branchKey: string;
        branchKind: ProjectBranchKind;
        title: string;
        createdAt: number;
    }): ProjectBranchRecord;
    linkBranches(parentBranchId: string, childBranchId: string, relationType: string, createdAt: number): void;
    attachToBranch(branchId: string, ref: TopologyReference): void;
    upsertTaskBranch(input: {
        taskId: string;
        projectId?: string;
        taskKey: string;
        title: string;
        status?: 'active' | 'derived';
        createdAt: number;
    }): TaskBranchRecord;
    attachToTask(taskId: string, ref: TopologyReference): void;
    upsertEventCluster(input: {
        clusterId: string;
        projectId?: string;
        clusterKey: string;
        clusterType: EventClusterType;
        title: string;
        createdAt: number;
    }): EventClusterRecord;
    attachToEventCluster(clusterId: string, ref: TopologyReference): void;
    listProjectBranches(projectId: string): ProjectBranchRecord[];
    listTaskBranches(projectId?: string): TaskBranchRecord[];
    listEventClusters(projectId?: string): EventClusterRecord[];
    listNeuronIdsByProject(projectId: string): string[];
    listNeuronIdsByTemporalRange(start: number, end: number): string[];
    listTimeBucketIdsByNeuronIds(neuronIds: string[], projectId?: string, limit?: number): string[];
    collectCandidateNeuronIds(input: {
        projectId?: string;
        startTime?: number;
        endTime?: number;
        terms?: string[];
        limit?: number;
        excludeTemporal?: boolean;
    }): string[];
    collectBranchNavigation(input: {
        projectId?: string;
        terms?: string[];
        limit?: number;
        siblingDepth?: number;
    }): {
        branchIds: string[];
        taskIds: string[];
        clusterIds: string[];
        neuronIds: string[];
    };
    collectNavigationFromNeuronIds(input: {
        neuronIds: string[];
        projectId?: string;
        limit?: number;
        siblingDepth?: number;
    }): {
        branchIds: string[];
        taskIds: string[];
        clusterIds: string[];
        neuronIds: string[];
    };
    collectTemporalContext(input: {
        startTime?: number;
        endTime?: number;
        preferredBucketType?: TimeBucketType;
        limit?: number;
    }): {
        bucketType: TimeBucketType;
        bucketIds: string[];
        bucketLabels: string[];
        neuronIds: string[];
    };
    getTimeBucketEntryCount(bucketType: TimeBucketType, start: number): number;
    getMaterializedMembershipCount(): number;
    private upsertMembership;
    close(): void;
}
//# sourceMappingURL=TopologyStore.d.ts.map