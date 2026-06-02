import { BeliefStore } from './belief/BeliefStore.js';
import { IngestionCursorStore } from './batch/IngestionCursorStore.js';
import { MemoryGraph } from './core/MemoryGraph.js';
import { type BrainRecallOptions } from './recall/BrainRecall.js';
import { type RecallGovernanceSuppressionReason } from './recall/RecallGovernance.js';
import { TopicRegistry } from './recall/TopicRegistry.js';
import { type OfflineConsolidationOutput } from './engine/OfflineConsolidationPipeline.js';
import { PipelineMetrics } from './engine/PipelineMetrics.js';
import { type UniverseNavigationResult } from './retrieval/UniverseNavigator.js';
import type { EmbeddingProvider } from './embedding/EmbeddingProvider.js';
import { NeuronEmbeddingStore } from './embedding/NeuronEmbeddingStore.js';
import type { ReEmbeddingStatus } from './embedding/ReEmbeddingStatus.js';
import type { EncryptionProvider } from './encryption/index.js';
import { type RedactionPolicy } from './governance/index.js';
import { type EnvLike } from './config/CogmemConfig.js';
import { ModelRegistry } from './models/ModelRegistry.js';
import type { Embedder } from './store/Embedder.js';
import { CognitiveGraphStore } from './store/CognitiveGraphStore.js';
import { EntityStore } from './store/EntityStore.js';
import { EventStore } from './store/EventStore.js';
import { FactStore } from './store/FactStore.js';
import { TemporalAdjacencyStore } from './store/TemporalAdjacencyStore.js';
import { TopologyStore } from './store/TopologyStore.js';
import type { IVectorStore, VectorBackend } from './store/IVectorStore.js';
import type { IngestInput, Neuron } from './types/index.js';
import { type ImportOptions, type ImportResult, type SnapshotMeta } from './snapshot/index.js';
export interface MemoryKernelOptions {
    dbPath?: string;
    embedder?: Embedder;
    embeddingProvider?: EmbeddingProvider;
    modelRegistry?: ModelRegistry;
    maxOfflinePipelineBudgetMs?: number;
    vectorBackend?: VectorBackend;
    vectorDimension?: number;
    encryptionProvider?: EncryptionProvider;
    redactionPolicy?: RedactionPolicy | false;
}
export interface MemoryKernelFromConfigOptions extends MemoryKernelOptions {
    configPath?: string;
    cwd?: string;
    env?: EnvLike;
}
export interface MemoryKernelConsolidationOptions {
    projectId?: string;
    startTime?: number;
    endTime?: number;
}
export interface MemoryKernelNavigationOptions {
    projectId?: string;
    limit?: number;
    startTime?: number;
    endTime?: number;
}
export interface MemoryKernelNavigationResult {
    query: string;
    projectId?: string;
    recallMode: 'universe_navigation' | 'brain_recall_fallback';
    fallbackUsed: boolean;
    navigation?: UniverseNavigationResult;
    rawEvidence: Neuron[];
    filteredEvidence?: Array<{
        neuron: Neuron;
        reason: 'status_suppressed' | 'over_context_limit';
        governanceReason?: RecallGovernanceSuppressionReason;
    }>;
}
export interface ForgetUserResult {
    projectId: string;
    auditId: string;
    deleted: {
        neurons: number;
        synapses: number;
        events: number;
        facts: number;
        compiledEvents: number;
        embeddings: number;
        vectors: number;
    };
}
export interface GovernanceAuditRecord {
    auditId: string;
    action: string;
    projectId?: string;
    reason?: string;
    details?: Record<string, unknown>;
    createdAt: number;
}
export declare class MemoryKernel {
    private readonly options;
    readonly memoryGraph: MemoryGraph;
    readonly eventStore: EventStore;
    readonly factStore: FactStore;
    readonly entityStore: EntityStore;
    readonly beliefStore: BeliefStore;
    readonly cursorStore: IngestionCursorStore;
    readonly vectorStore: IVectorStore;
    readonly topicRegistry: TopicRegistry;
    readonly topologyStore: TopologyStore;
    readonly cognitiveGraphStore: CognitiveGraphStore;
    readonly temporalAdjacencyStore: TemporalAdjacencyStore;
    readonly neuronEmbeddingStore: NeuronEmbeddingStore;
    readonly pipelineMetrics: PipelineMetrics;
    private readonly dbPath;
    private readonly embedder;
    private readonly embeddingProvider?;
    private readonly modelRegistry;
    private readonly encryptionProvider?;
    private readonly piiRedactor?;
    private readonly interactionUnitStore;
    private readonly compilerConfidenceStore;
    private readonly summaryStore;
    private readonly deepWriteCandidateStore;
    private readonly topicSummaryBoard;
    private readonly topicDecayPolicy;
    private readonly localSemanticCompiler;
    private readonly topicClassifier;
    private readonly reflection;
    private readonly metabolism;
    private readonly ingestionEngine;
    private readonly universeNavigator;
    private readonly offlineConsolidationPipeline;
    private readonly consolidationPipeline;
    private readonly topologyCompiler;
    private readonly cognitiveGraphCompiler;
    private readonly brainRecall;
    private readonly ranker;
    private readonly reEmbeddingPipeline?;
    private readonly extensions;
    private lastEmbedSuccessAt?;
    private lastEmbedErrorAt?;
    private initialized;
    constructor(options?: MemoryKernelOptions);
    initialize(skipWarmup?: boolean): Promise<void>;
    start(): Promise<void>;
    stop(): void;
    close(): void;
    ingest(input: IngestInput | {
        content: string;
        projectId?: string;
        tags?: string[];
    }): Promise<Neuron>;
    recall(query: string, options?: BrainRecallOptions): import("./types/BrainRecallResult.js").BrainRecallResult;
    navigateMemory(query: string, options?: MemoryKernelNavigationOptions): MemoryKernelNavigationResult;
    consolidate(options?: MemoryKernelConsolidationOptions): Promise<OfflineConsolidationOutput>;
    exportSnapshot(outputPath: string): Promise<SnapshotMeta>;
    importSnapshot(snapshotPath: string, opts?: ImportOptions): Promise<ImportResult>;
    getHealthStatus(): {
        status: string;
        package: string;
        dbPath: string;
        stats: {
            neuronCount: number;
            synapseCount: number;
            anchorCount: number;
        };
        vectorRecall: "active" | "degraded" | "disabled";
        embeddingModelId: string | undefined;
        hasStaleVectors: boolean;
        pipelineLastRunAt: number | undefined;
        pipelineP99Ms: number | undefined;
        pipelineLastRunAborted: boolean;
        reEmbedding: ReEmbeddingStatus;
        extensionCount: number;
    };
    getReEmbeddingStatus(): ReEmbeddingStatus;
    getStats(): {
        neuronCount: number;
        synapseCount: number;
        anchorCount: number;
    };
    getMetrics(): {
        queryLatency: number;
        queryType: string;
        neuronCount: number;
        synapseCount: number;
        energyPropagation: number;
        memoryUsage: number;
        modelInferenceHealth: number;
        chainIntegrityScore: number;
        fallbackCount: number;
    };
    startMetabolism(): Promise<void>;
    stopMetabolism(): void;
    getHotMemories(): Neuron[];
    forgetUser(projectId: string, reason?: string): Promise<ForgetUserResult>;
    getGovernanceAudit(projectId?: string): GovernanceAuditRecord[];
    getProjectMemories(projectId: string): Neuron[];
    registerExtension(name: string, implementation: unknown): void;
    hasExtension(name: string): boolean;
    getExtension<T = unknown>(name: string): T | undefined;
    private normalizeIngestInput;
    private queueEmbedding;
    private getVectorRecallStatus;
    private getEmbeddingDimension;
    private ensureMetaTable;
    private ensureGovernanceAuditTable;
}
export declare function createMemoryKernel(options?: MemoryKernelOptions): MemoryKernel;
export declare function createMemoryKernelFromConfig(configPath?: string): MemoryKernel;
export declare function createMemoryKernelFromConfig(options?: MemoryKernelFromConfigOptions): MemoryKernel;
//# sourceMappingURL=factory.d.ts.map