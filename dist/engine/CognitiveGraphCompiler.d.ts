import type { Neuron, TimeBucketRecord } from '../types/index.js';
import type { ConsolidationResult } from './ConsolidationPipeline.js';
import type { CognitiveGraphStore } from '../store/CognitiveGraphStore.js';
import type { EntityStore } from '../store/EntityStore.js';
export declare class CognitiveGraphCompiler {
    private store;
    private entityStore;
    constructor(store: CognitiveGraphStore, entityStore: EntityStore);
    compile(input: {
        neuron: Neuron;
        consolidation: ConsolidationResult;
        topology: {
            timeBuckets: TimeBucketRecord[];
            branchIds: string[];
            taskIds: string[];
            clusterIds: string[];
        };
    }): {
        seedNodeIds: string[];
        edgeCount: number;
    };
    rebuildTimeBuckets(input: {
        projectId: string;
        neurons: Array<{
            id: string;
            title: string;
            createdAt: number;
        }>;
        bucketsByNeuronId: Map<string, TimeBucketRecord[]>;
    }): void;
    private attachBeliefNode;
}
//# sourceMappingURL=CognitiveGraphCompiler.d.ts.map