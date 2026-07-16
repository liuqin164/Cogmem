import type { RetrievalExecutionPlan } from './RetrievalPlanner.js';
import type { QueryIR } from '../types/query-ir.js';
import type { TemporalAdjacencyStore } from '../store/TemporalAdjacencyStore.js';
import type { EntityActivationIndex } from './EntityActivationIndex.js';
import { EvidenceFusionRanker } from './EvidenceFusionRanker.js';
export interface PulseRetrievalResult {
    pulse0Ids: string[];
    pulse1Ids: string[];
    pulse2Ids: string[];
    fusedIds: string[];
    reasonsByNeuronId: Map<string, string[]>;
    trace: Array<{
        pulse: 0 | 1 | 2 | 3;
        stage: string;
        candidateCount: number;
        reason: string;
    }>;
}
export declare class PulseRetrievalEngine {
    private temporalAdjacencyStore;
    private entityActivationIndex;
    private fusionRanker;
    constructor(temporalAdjacencyStore: TemporalAdjacencyStore, entityActivationIndex: EntityActivationIndex, fusionRanker?: EvidenceFusionRanker);
    run(input: {
        projectId?: string;
        plan: RetrievalExecutionPlan;
        ir: QueryIR;
        entityIds: string[];
        topologyIds: string[];
        branchIds: string[];
        temporalBucketIds: string[];
        temporalNeuronIds: string[];
        graphIds: string[];
        cognitiveGraphIds: string[];
        entityNeuronIds: string[];
    }): PulseRetrievalResult;
}
//# sourceMappingURL=PulseRetrievalEngine.d.ts.map