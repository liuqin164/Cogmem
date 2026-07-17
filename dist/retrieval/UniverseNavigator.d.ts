import type { QueryCompiler } from './QueryCompiler.js';
import type { RetrievalPlanner } from './RetrievalPlanner.js';
import type { TemporalBranchSearch } from './TemporalBranchSearch.js';
import type { PulseRetrievalEngine } from './PulseRetrievalEngine.js';
import type { NarrativeRecallAssembler } from './NarrativeRecallAssembler.js';
import type { UniverseTraversalExecutor } from './UniverseTraversalExecutor.js';
export interface UniverseNavigationResult {
    compiledQuery: ReturnType<QueryCompiler['compile']>;
    branchSearch: ReturnType<TemporalBranchSearch['search']>;
    pulse: ReturnType<PulseRetrievalEngine['run']>;
    narrative: ReturnType<NarrativeRecallAssembler['assemble']>;
    runtime: {
        path: string[];
        segments: Array<{
            stage: string;
            label: string;
            count?: number;
        }>;
    };
}
export declare class UniverseNavigator {
    private queryCompiler;
    private retrievalPlanner;
    private temporalBranchSearch;
    private pulseRetrievalEngine;
    private narrativeRecallAssembler;
    private traversalExecutor;
    constructor(queryCompiler: QueryCompiler, retrievalPlanner: RetrievalPlanner, temporalBranchSearch: TemporalBranchSearch, pulseRetrievalEngine: PulseRetrievalEngine, narrativeRecallAssembler: NarrativeRecallAssembler, traversalExecutor: UniverseTraversalExecutor);
    navigate(input: {
        query: string;
        projectId?: string;
        startTime?: number;
        endTime?: number;
        temporalEnabled?: boolean;
        topologyIds: string[];
        branchIds: string[];
        temporalBucketIds: string[];
        temporalNeuronIds: string[];
        graphIds: string[];
        cognitiveGraphIds: string[];
        entityNeuronIds: string[];
    }): UniverseNavigationResult;
}
//# sourceMappingURL=UniverseNavigator.d.ts.map