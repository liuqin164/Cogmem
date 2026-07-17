import Database from 'bun:sqlite';
import type { TimeBucketRecord } from '../types/index.js';
export interface TemporalSurfaceSegment {
    bucketId: string;
    label: string;
    bucketStart: number;
    bucketEnd: number;
    neuronIds: string[];
    source: 'seed' | 'window' | 'adjacent' | 'nearest' | 'band';
}
export declare class TemporalAdjacencyStore {
    private db;
    private readonly ownsDb;
    constructor(dbOrPath?: Database | string);
    private initializeSchema;
    syncBuckets(buckets: TimeBucketRecord[], createdAt: number): void;
    rebuildAll(createdAt: number): void;
    rebuildProject(projectId: string, timeZone: string, createdAt: number): void;
    collectAdjacentNeuronIds(bucketIds: string[], limit?: number, projectId?: string): string[];
    collectContinuousTraversal(input: {
        bucketIds: string[];
        projectId?: string;
        hopLimit?: number;
        limit?: number;
    }): {
        bucketIds: string[];
        labels: string[];
        neuronIds: string[];
    };
    collectContinuousSurface(input: {
        bucketIds?: string[];
        startTime?: number;
        endTime?: number;
        preferredBucketType?: TimeBucketRecord['bucketType'];
        projectId?: string;
        hopLimit?: number;
        limit?: number;
    }): {
        bucketType: TimeBucketRecord['bucketType'];
        segments: TemporalSurfaceSegment[];
        bucketIds: string[];
        labels: string[];
        neuronIds: string[];
    };
    close(): void;
    private getAdjacentBucketIds;
    private listWindowSegments;
    private listNearestSegments;
    private listBucketSegments;
    private listNeuronIdsForBucket;
    private expandContinuousBand;
    private listAdjacentBucketIds;
    private filterBucketIdsForProject;
    private listNeuronIdsForBuckets;
}
//# sourceMappingURL=TemporalAdjacencyStore.d.ts.map