import type { Neuron, TimeBucketRecord } from '../types/index.js';
import type { ConsolidationResult } from './ConsolidationPipeline.js';
import { TopologyStore } from '../store/TopologyStore.js';
export declare class TopologyCompiler {
    private store;
    constructor(store: TopologyStore);
    compile(input: {
        neuron: Neuron;
        consolidation: ConsolidationResult;
        timeZone?: string;
    }): {
        timeBuckets: TimeBucketRecord[];
        branchIds: string[];
        taskIds: string[];
        clusterIds: string[];
    };
    rebuildTimeBuckets(neurons: Neuron[], timeZone: string): TimeBucketRecord[];
    private attachTimeBuckets;
    private attachProjectBranches;
    private attachTaskBranches;
    private attachEventClusters;
    private buildBucket;
    private looksLikeTaskCarrier;
    private toClusterType;
    private normalizeKey;
}
//# sourceMappingURL=TopologyCompiler.d.ts.map