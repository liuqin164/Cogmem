import type { TopologyStore } from '../store/TopologyStore.js';
import type { TemporalAdjacencyStore, TemporalSurfaceSegment } from '../store/TemporalAdjacencyStore.js';
export interface TemporalTraversalSegment extends TemporalSurfaceSegment {
    branchIds: string[];
    taskIds: string[];
    clusterIds: string[];
}
export interface TemporalBranchSearchResult {
    neuronIds: string[];
    branchIds: string[];
    taskIds: string[];
    clusterIds: string[];
    temporalTraversal: {
        bucketType: 'day' | 'week' | 'month';
        bucketIds: string[];
        labels: string[];
        neuronIds: string[];
        segments: TemporalTraversalSegment[];
        traversalMode: 'surface' | 'adjacent_fallback' | 'nearest_fallback' | 'disabled';
    };
    denseJointNeuronIds: string[];
    reasons: string[];
}
export declare class TemporalBranchSearch {
    private topologyStore;
    private temporalAdjacencyStore;
    constructor(topologyStore: TopologyStore, temporalAdjacencyStore: TemporalAdjacencyStore);
    search(input: {
        projectId?: string;
        startTime?: number;
        endTime?: number;
        temporalEnabled?: boolean;
        timeZone: string;
        terms: string[];
        temporalBucketIds?: string[];
        entityNeuronIds?: string[];
    }): TemporalBranchSearchResult;
    private formatTemporalWindow;
}
//# sourceMappingURL=TemporalBranchSearch.d.ts.map