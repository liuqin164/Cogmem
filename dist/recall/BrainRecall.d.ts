import type { FactStore } from '../store/FactStore.js';
import type { EntityStore } from '../store/EntityStore.js';
import type { BeliefStore } from '../belief/BeliefStore.js';
import type { MemoryGraph } from '../core/MemoryGraph.js';
import type { IngestionCursorStore } from '../batch/IngestionCursorStore.js';
import type { SummaryStore } from '../store/SummaryStore.js';
import type { FileChunkStore } from '../assets/index.js';
import type { BrainRecallResult } from '../types/BrainRecallResult.js';
import type { GraphEdgeStoreLike, ISkillDiscovery } from '../types/ExtensionPoints.js';
import type { VectorCandidateFilter } from './VectorCandidateFilter.js';
import type { HierarchicalRecallRouter } from './HierarchicalRecallRouter.js';
import type { TopicSummaryBoard } from './TopicSummaryBoard.js';
import type { GraphCommunityEngine } from '../engine/GraphCommunityEngine.js';
import type { EmbeddingProvider } from '../embedding/EmbeddingProvider.js';
import type { NeuronEmbeddingStore } from '../embedding/NeuronEmbeddingStore.js';
export type { BrainRecallResult } from '../types/BrainRecallResult.js';
export interface BrainRecallOptions {
    projectId?: string;
    limit?: number;
    includeRawEvidence?: boolean;
    includeUnprocessedFallback?: boolean;
    /** Enable 1-hop persistent_gain graph edge expansion. Defaults to true. */
    enablePersistentGainEdges?: boolean;
    /** Enable opt-in deep-write relation/causal graph edges. Defaults to false. */
    enableDeepWriteEdges?: boolean;
    /** CPU-controlled topic namespace hint for hierarchical recall. */
    topicPath?: string;
}
export interface BrainRecallDependencies {
    memoryGraph: MemoryGraph;
    factStore: FactStore;
    entityStore: EntityStore;
    beliefStore: BeliefStore;
    cursorStore: IngestionCursorStore;
    graphEdgeStore?: GraphEdgeStoreLike;
    summaryStore?: SummaryStore;
    fileChunkStore?: FileChunkStore;
    skillDiscoveryEngine?: ISkillDiscovery;
    /**
     * v1.1: Optional vector semantic search function.
     * Called with the query string; returns an ordered list of neuron IDs.
     */
    vectorSearchFn?: (query: string, projectId: string | undefined, limit: number) => string[];
    vectorCandidateFilter?: VectorCandidateFilter;
    hierarchicalRouter?: HierarchicalRecallRouter;
    topicSummaryBoard?: TopicSummaryBoard;
    graphCommunityEngine?: GraphCommunityEngine;
    embeddingProvider?: EmbeddingProvider;
    neuronEmbeddingStore?: NeuronEmbeddingStore;
}
export declare class BrainRecall {
    private readonly deps;
    private readonly semanticCompiler;
    private readonly loader;
    private readonly adapters;
    constructor(deps: BrainRecallDependencies);
    recall(query: string, options?: BrainRecallOptions): BrainRecallResult;
    recallAsync(query: string, options?: BrainRecallOptions): Promise<BrainRecallResult>;
    private prepareRecallCandidates;
    private finishRecall;
    private _prependSemanticConsolidations;
    private _prependCrossDomainPrinciples;
    private findDurableNeuronsByType;
    private _expandByCommunity;
    private routeByTopic;
    private withSkillCandidates;
    private withFileEvidence;
    private expandEntityIdsViaPersistentGainEdges;
    private withSummaries;
    private detectPersistentGainAmbiguity;
    private collectProfileSignals;
    private collectFallbackSnippets;
    private collectProfileSurface;
    private rankFacts;
    private rankEvents;
    private scoreRecord;
    private scoreText;
    private extractProfileFacets;
    private normalizeProfileLabel;
    private extractTokens;
    /**
     * v1.1: Appends vector semantic search results to candidateNeuronIds when the
     * existing FTS5 results are sparse (below vectorFallbackThreshold).
     *
     * @returns true if vector search was triggered and produced results.
     */
    private appendVectorResults;
    private appendVectorResultsAsync;
    private appendVectorResultIds;
    private toRecallableNeurons;
    private retainRecallableNeuronIds;
    private filterRecallableNeuronIds;
    private isRecallableNeuronId;
    private isRecallableNeuron;
}
//# sourceMappingURL=BrainRecall.d.ts.map