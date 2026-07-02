import { BeliefStore } from './belief/BeliefStore.js';
import { BeliefGovernanceService } from './belief/BeliefGovernanceService.js';
import { type MemoryBindingListOptions, type MemoryBindingRecord, type MemoryBindingStats, type MemoryClusterListOptions, type MemoryClusterRecord, type MemoryEdgeListOptions, type MemoryEdgeRecord, type MemoryGraphRecallAnchor } from './binding/index.js';
import { IngestionCursorStore } from './batch/IngestionCursorStore.js';
import { MemoryGraph } from './core/MemoryGraph.js';
import { type BrainRecallOptions } from './recall/BrainRecall.js';
import { type RecallGovernanceSuppressionReason } from './recall/RecallGovernance.js';
import { TopicRegistry } from './recall/TopicRegistry.js';
import { type DeepWritePromotionDecision } from './engine/DeepWritePromotionPolicy.js';
import { type DreamCuratorRunOptions, type DreamCuratorRunResult } from './engine/DreamCuratorWorker.js';
import { type OfflineConsolidationOutput } from './engine/OfflineConsolidationPipeline.js';
import { PipelineMetrics } from './engine/PipelineMetrics.js';
import { type UniverseNavigationResult } from './retrieval/UniverseNavigator.js';
import type { EmbeddingProvider } from './embedding/EmbeddingProvider.js';
import { NeuronEmbeddingStore } from './embedding/NeuronEmbeddingStore.js';
import type { ReEmbeddingStatus } from './embedding/ReEmbeddingStatus.js';
import type { EncryptionProvider } from './encryption/index.js';
import { TopicAliasRegistry, TopicGovernance, TopicPathRegistry as UserTopicPathRegistry, TopicRelationGraph } from './topic/index.js';
import { MemoryGovernanceExecutor, type MemoryGovernanceExecutionResult, type MemoryGovernancePlan, type RedactionPolicy, type CandidateReviewInput, type CandidateReviewResult } from './governance/index.js';
import { EntityGovernanceService } from './entity/index.js';
import { TemporalMemoryService } from './temporal/index.js';
import { ContextCortex } from './context/index.js';
import { ProspectiveMemoryService } from './prospective/index.js';
import { StrategyCortex } from './strategy/index.js';
import { ContextOutcomeStore, MemoryUseJudge } from './eval/strategy/index.js';
import { EpisodeAssembler, EpisodeStore, type EpisodeClosureMode, type EpisodeClosureReceipt, type EpisodeDreamStatus, type EpisodeListOptions, type MemoryEpisode, type TurnRelationAdvisoryReviewer } from './episode/index.js';
import { type DreamTickOptions, type DreamTickResult } from './dream/index.js';
import { type EnvLike } from './config/CogmemConfig.js';
import { ModelRegistry } from './models/ModelRegistry.js';
import type { Embedder } from './store/Embedder.js';
import { CognitiveGraphStore } from './store/CognitiveGraphStore.js';
import { type DeepWriteCandidateStatus } from './store/DeepWriteCandidateStore.js';
import { type CandidateReviewRecord } from './store/CandidateReviewStore.js';
import { DreamLedgerStore, type DreamBacklogStatus } from './store/DreamLedgerStore.js';
import { ActivationStore, type ActivationDecayResult, type ActivationHotspot } from './store/ActivationStore.js';
import { EntityStore } from './store/EntityStore.js';
import { EventStore } from './store/EventStore.js';
import { FactStore } from './store/FactStore.js';
import { MemoryBindingStore } from './store/MemoryBindingStore.js';
import { MemoryAtlasStore } from './store/MemoryAtlasStore.js';
import { MemoryAtlasService, type MemoryAtlasNodeDetail, type MemoryAtlasPathResult, type MemoryAtlasQueryOptions, type MemoryAtlasSlice, type MemoryAtlasTimelineResult } from './atlas/index.js';
import { MemoryGovernanceStore } from './store/MemoryGovernanceStore.js';
import { TemporalAdjacencyStore } from './store/TemporalAdjacencyStore.js';
import { TopologyStore } from './store/TopologyStore.js';
import type { IVectorStore, VectorBackend } from './store/IVectorStore.js';
import type { IngestInput, MemoryEvent, MemoryEventCausalityType, MemoryEventContext, MemoryRawEventType, MemoryEventRole, Neuron } from './types/index.js';
import { type ImportOptions, type ImportResult, type SnapshotMeta } from './snapshot/index.js';
export type { DreamCuratorRunOptions, DreamCuratorRunResult } from './engine/DreamCuratorWorker.js';
export type { DreamTickOptions, DreamTickResult } from './dream/index.js';
export type { EpisodeClosureReceipt, EpisodeDreamStatus, EpisodeListOptions, MemoryEpisode } from './episode/index.js';
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
    turnRelationReviewer?: TurnRelationAdvisoryReviewer;
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
export interface RawEventSearchOptions {
    projectId?: string;
    workspaceId?: string;
    threadId?: string;
    sessionId?: string;
    localDate?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
}
export type DreamCandidateStatus = DeepWriteCandidateStatus;
export interface DreamCandidateRecord {
    candidateId: string;
    runId: string;
    candidateType: string;
    status: DreamCandidateStatus;
    confidence: number;
    content: unknown;
    evidence: unknown;
    promotionTargetType?: string;
    promotionTargetId?: string;
    statusReason?: string;
    createdAt: number;
    updatedAt: number;
}
export interface DreamCandidateListOptions {
    statuses?: DreamCandidateStatus[];
    candidateTypes?: string[];
    projectId?: string;
    runId?: string;
    limit?: number;
}
export interface DreamGovernanceRunOptions {
    projectId?: string;
    limit?: number;
}
export interface DreamGovernanceRunResult {
    projectId?: string;
    decisions: DeepWritePromotionDecision[];
    queue: {
        candidate: number;
        needsConfirmation: number;
        promoted: number;
        rejected: number;
        superseded: number;
        shadow: number;
    };
}
export interface MemoryMapOptions {
    projectId?: string;
}
export interface MemoryBindingBackfillOptions {
    projectId?: string;
    workspaceId?: string;
    threadId?: string;
    sessionId?: string;
    sinceGlobalSeq?: number;
    limit?: number;
}
export interface MemoryBindingBackfillResult {
    projectId?: string;
    sinceGlobalSeq?: number;
    nextGlobalSeq?: number;
    hasMore: boolean;
    scannedEvents: number;
    bindableEvents: number;
    boundEvents: number;
    createdBindings: number;
    skippedAlreadyBound: number;
    failedEvents: number;
    errors: Array<{
        eventId: string;
        message: string;
    }>;
}
export interface MemoryMapSection {
    id: string;
    name: string;
    role: string;
    currentCount?: number;
}
export interface MemoryDataLane {
    id: string;
    name: string;
    route: string;
    useWhen: string;
}
export interface MemorySelfMap {
    version: 'memory_map.v1';
    generatedAt: number;
    projectId?: string;
    anatomy: MemoryMapSection[];
    dataLanes: MemoryDataLane[];
    bounds: string[];
    manual: {
        commands: string[];
        agentUsage: string[];
    };
    counters: {
        rawEvents: number;
        neurons: number;
        vectors: number;
        activationHotspots: number;
        memoryBindings: number;
        memoryBindingTopics: number;
        memoryBindingEntities: number;
        memoryBindingClusters: number;
        memoryBindingEdges: number;
        episodes: number;
        unassignedRawEvents: number;
        episodeDream: EpisodeDreamStatus;
        dreamBacklog: DreamBacklogStatus;
        dreamCandidateQueue: DreamGovernanceRunResult['queue'];
    };
}
export interface MaintenanceTickOptions {
    projectId?: string;
    activationDecayFactor?: number;
    activationFloor?: number;
    confirmationTtlMs?: number;
    now?: number;
    atlasAccessRetentionMs?: number;
}
export interface MaintenanceSuggestedAction {
    kind: 'dream_curator' | 'govern_candidates' | 'resolve_entities' | 're_embed' | 'inspect_hotspots' | 'bind_raw_events' | 'inspect_binding_failures' | 'repair_episodes';
    command: string;
    reason: string;
}
export interface MaintenanceTickResult {
    version: 'maintenance_tick.v1';
    projectId?: string;
    ranAt: number;
    hostOwned: true;
    chargeVector: {
        dreamBacklog: number;
        candidateQueue: number;
        entityConflicts: number;
        activationHotspots: number;
        staleVectors: number;
        unboundRawEvents: number;
        bindingFailures: number;
        expiredConfirmationCandidates: number;
        episodeDreamBacklog: number;
        unassignedEpisodeRawEvents: number;
    };
    executed: {
        activationDecay: ActivationDecayResult;
        memoryAtlasRefresh: {
            documents: number;
            actions: number;
            refreshed: boolean;
            errors?: Array<{
                projectId: string;
                error: string;
            }>;
        };
        memoryAtlasActivationDecay: number;
        memoryAtlasAccessPruned: number;
        reviewQueueAging: {
            expired: number;
            candidateIds: string[];
            cutoff: number;
            ttlMs: number;
        };
        hiddenDaemonStarted: false;
    };
    hotspots: ActivationHotspot[];
    suggestedActions: MaintenanceSuggestedAction[];
}
export interface RawMemoryEventInput {
    eventId?: string;
    projectId?: string;
    workspaceId?: string;
    threadId: string;
    sessionId?: string;
    turnId?: string;
    turnSeq?: number;
    role: MemoryEventRole;
    rawEventType?: MemoryRawEventType;
    content: string;
    eventOrdinal?: number;
    occurredAt?: number;
    parentEventId?: string;
    prevEventId?: string;
    causalityType?: MemoryEventCausalityType;
    sourceId?: string;
    sourceOffset?: number;
    lineStart?: number;
    lineEnd?: number;
    charStart?: number;
    charEnd?: number;
    localDate?: string;
    metadata?: Record<string, unknown>;
}
export interface EpisodeMessageInput {
    projectId: string;
    sessionId: string;
    sourceAgent: string;
    role: MemoryEventRole;
    text: string;
    externalMessageId?: string;
    timestamp?: number;
    threadId?: string;
    metadata?: Record<string, unknown>;
}
export interface EpisodeMessageResult {
    created: boolean;
    eventId: string;
    episodeId?: string;
    assigned: boolean;
    ignored: boolean;
    sealed: boolean;
    dreamRecommended: boolean;
    dreamRan: false;
}
export type EpisodeRepairInput = {
    operation: 'move-event';
    projectId: string;
    eventId: string;
    targetEpisodeId: string;
    now?: number;
} | {
    operation: 'split';
    projectId: string;
    episodeId: string;
    eventIds: string[];
    now?: number;
} | {
    operation: 'merge';
    projectId: string;
    sourceEpisodeId: string;
    targetEpisodeId: string;
    now?: number;
} | {
    operation: 'reclassify';
    projectId: string;
    episodeId: string;
    episodeType?: MemoryEpisode['episodeType'];
    topicPath?: string;
    importance?: number;
    now?: number;
} | {
    operation: 'requeue-dream' | 'invalidate-dream-run';
    projectId: string;
    episodeId: string;
    mode?: 'micro' | 'normal' | 'deep';
    now?: number;
};
export interface EpisodeRepairResult {
    repairId: string;
    operation: EpisodeRepairInput['operation'];
    affectedEpisodeIds: string[];
    staleCandidateIds: string[];
}
export interface ToolCallMemoryEventInput {
    projectId?: string;
    workspaceId?: string;
    threadId: string;
    sessionId?: string;
    turnId?: string;
    turnSeq?: number;
    assistantEventId?: string;
    toolCallId?: string;
    toolName: string;
    input?: unknown;
    content?: string;
    eventOrdinal?: number;
    occurredAt?: number;
    sourceId?: string;
    metadata?: Record<string, unknown>;
}
export interface ToolResultMemoryEventInput {
    projectId?: string;
    workspaceId?: string;
    threadId: string;
    sessionId?: string;
    turnId?: string;
    turnSeq?: number;
    toolCallEventId: string;
    toolCallId?: string;
    toolName: string;
    output: string;
    eventOrdinal?: number;
    occurredAt?: number;
    sourceId?: string;
    metadata?: Record<string, unknown>;
}
export interface TaskMemoryEventInput {
    projectId?: string;
    workspaceId?: string;
    threadId: string;
    sessionId?: string;
    turnId?: string;
    turnSeq?: number;
    parentEventId?: string;
    taskId?: string;
    title?: string;
    content: string;
    role?: MemoryEventRole;
    rawEventType?: Extract<MemoryRawEventType, 'task_event' | 'action_result'>;
    eventOrdinal?: number;
    occurredAt?: number;
    sourceId?: string;
    metadata?: Record<string, unknown>;
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
        activations: number;
        memoryBindings: number;
        episodes: number;
        brainProjections: number;
        entityRecords: number;
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
    readonly entityGovernanceService: EntityGovernanceService;
    readonly beliefStore: BeliefStore;
    readonly beliefGovernanceService: BeliefGovernanceService;
    readonly temporalMemoryService: TemporalMemoryService;
    readonly contextCortex: ContextCortex;
    readonly strategyCortex: StrategyCortex;
    readonly memoryUseJudge: MemoryUseJudge;
    readonly contextOutcomeStore: ContextOutcomeStore;
    readonly prospectiveMemoryService: ProspectiveMemoryService;
    readonly cursorStore: IngestionCursorStore;
    readonly vectorStore: IVectorStore;
    readonly topicRegistry: TopicRegistry;
    readonly topologyStore: TopologyStore;
    readonly cognitiveGraphStore: CognitiveGraphStore;
    readonly temporalAdjacencyStore: TemporalAdjacencyStore;
    readonly neuronEmbeddingStore: NeuronEmbeddingStore;
    readonly dreamLedgerStore: DreamLedgerStore;
    readonly activationStore: ActivationStore;
    readonly memoryBindingStore: MemoryBindingStore;
    readonly memoryAtlasStore: MemoryAtlasStore;
    readonly memoryAtlasService: MemoryAtlasService;
    readonly memoryGovernanceStore: MemoryGovernanceStore;
    readonly memoryGovernanceExecutor: MemoryGovernanceExecutor;
    readonly pipelineMetrics: PipelineMetrics;
    readonly episodeStore: EpisodeStore;
    readonly episodeAssembler: EpisodeAssembler;
    readonly userTopicPathRegistry: UserTopicPathRegistry;
    readonly topicAliasRegistry: TopicAliasRegistry;
    readonly topicRelationGraph: TopicRelationGraph;
    readonly topicGovernance: TopicGovernance;
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
    private readonly deepWritePromotionPolicy;
    private readonly candidateReviewStore;
    private readonly candidateReviewService;
    private readonly dreamCuratorWorker;
    private readonly dreamScheduler;
    private readonly memoryBindingService;
    private readonly memoryAtlasIndexer;
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
    private closed;
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
    recordRawEvent(input: RawMemoryEventInput): MemoryEvent<{
        text: string;
        metadata?: Record<string, unknown>;
    }>;
    recordToolCall(input: ToolCallMemoryEventInput): MemoryEvent<{
        text: string;
        toolCallId?: string;
        toolName: string;
        input?: unknown;
        metadata?: Record<string, unknown>;
    }>;
    recordToolResult(input: ToolResultMemoryEventInput): MemoryEvent<{
        text: string;
        toolCallId?: string;
        toolName: string;
        output: string;
        metadata?: Record<string, unknown>;
    }>;
    recordTaskEvent(input: TaskMemoryEventInput): MemoryEvent<{
        text: string;
        taskId?: string;
        title?: string;
        metadata?: Record<string, unknown>;
    }>;
    consolidate(options?: MemoryKernelConsolidationOptions): Promise<OfflineConsolidationOutput>;
    getThreadEvents(threadId: string, options?: {
        projectId?: string;
        sessionId?: string;
        localDate?: string;
        limit?: number;
    }): MemoryEvent[];
    getEventContext(eventId: string, options?: {
        before?: number;
        after?: number;
    }): MemoryEventContext | null;
    searchRawEvents(query: string, options?: RawEventSearchOptions): MemoryEvent[];
    getDreamBacklogStatus(projectId?: string): DreamBacklogStatus;
    markDreamed(projectId: string | undefined, globalSeq: number, dreamedAt?: number): DreamBacklogStatus;
    runDreamCurator(options?: DreamCuratorRunOptions): Promise<DreamCuratorRunResult>;
    runDreamTick(options?: DreamTickOptions): Promise<DreamTickResult>;
    assembleEpisodeTurn(events: MemoryEvent[], input: {
        projectId: string;
        sessionId: string;
        sourceAgent?: string;
        conversationThreadId?: string;
        now?: number;
        batchSeal?: boolean;
        forceBatchSeal?: boolean;
    }): import("./episode/EpisodeAssembler.js").EpisodeAssemblyResult;
    assembleEpisodeTurnAsync(events: MemoryEvent[], input: {
        projectId: string;
        sessionId: string;
        sourceAgent?: string;
        conversationThreadId?: string;
        now?: number;
        batchSeal?: boolean;
        forceBatchSeal?: boolean;
    }): Promise<import("./episode/EpisodeAssembler.js").EpisodeAssemblyResult>;
    appendRawEventToEpisode(event: MemoryEvent, input: {
        projectId: string;
        sessionId: string;
        sourceAgent?: string;
        now?: number;
    }): import("./episode/EpisodeAssembler.js").EpisodeAssemblyResult;
    appendEpisodeMessage(input: EpisodeMessageInput): EpisodeMessageResult;
    appendEpisodeMessageAsync(input: EpisodeMessageInput): Promise<EpisodeMessageResult>;
    private resumeEpisodeMessage;
    private resumeEpisodeMessageAsync;
    private assertEpisodeIngestIdentity;
    listEpisodes(options?: EpisodeListOptions): MemoryEpisode[];
    getEpisode(episodeId: string): MemoryEpisode | undefined;
    sealEpisode(episodeId: string, input: {
        mode: EpisodeClosureMode;
        reason: string;
        now?: number;
    }): EpisodeClosureReceipt;
    sealImportedEpisode(episodeId: string, input: {
        reason: string;
        force?: boolean;
        now?: number;
    }): EpisodeClosureReceipt;
    sealIdleEpisodes(input: {
        projectId?: string;
        idleBefore: number;
        now?: number;
    }): EpisodeClosureReceipt[];
    listEpisodeClosureReceipts(options?: {
        episodeId?: string;
        projectId?: string;
        limit?: number;
    }): EpisodeClosureReceipt[];
    listEpisodeEventLinks(episodeId: string): import("./episode/EpisodeTypes.js").EpisodeEventLink[];
    getEpisodeDreamStatus(projectId?: string): EpisodeDreamStatus;
    retryFailedEpisodeDreams(projectId?: string): number;
    repairEpisodes(options?: {
        projectId?: string;
        sinceGlobalSeq?: number;
        limit?: number;
    }): {
        scanned: number;
        assigned: number;
        unassigned: number;
        unassignedEventIds: string[];
    };
    repairEpisode(input: EpisodeRepairInput): EpisodeRepairResult;
    listDreamCandidates(options?: DreamCandidateListOptions): DreamCandidateRecord[];
    countDreamCandidates(options?: Omit<DreamCandidateListOptions, 'limit'>): number;
    reviewDreamCandidate(input: CandidateReviewInput): CandidateReviewResult;
    listDreamCandidateReviews(options?: {
        projectId?: string;
        candidateId?: string;
        limit?: number;
    }): CandidateReviewRecord[];
    bindMemoryEvent(event: MemoryEvent): MemoryBindingRecord[];
    executeMemoryGovernancePlan(plan: MemoryGovernancePlan): MemoryGovernanceExecutionResult;
    bindRawEvents(options?: MemoryBindingBackfillOptions): MemoryBindingBackfillResult;
    listMemoryBindings(options?: MemoryBindingListOptions): MemoryBindingRecord[];
    listMemoryClusters(options?: MemoryClusterListOptions): MemoryClusterRecord[];
    listMemoryEdges(options?: MemoryEdgeListOptions): MemoryEdgeRecord[];
    recallMemoryBindingGraph(query: string, options?: {
        projectId?: string;
        limit?: number;
    }): MemoryGraphRecallAnchor[];
    getMemoryBindingStats(projectId?: string): MemoryBindingStats;
    rebuildMemoryAtlas(options?: {
        projectId?: string;
    }): {
        documents: number;
        actions: number;
    };
    ensureMemoryAtlas(options: {
        projectId: string;
    }): {
        documents: number;
        actions: number;
        refreshed: boolean;
    };
    private prepareMemoryAtlasRead;
    private withAtlasFreshness;
    graphOverview(options: MemoryAtlasQueryOptions): MemoryAtlasSlice;
    graphSearch(query: string, options: MemoryAtlasQueryOptions): MemoryAtlasSlice;
    graphExplore(query: string, options: MemoryAtlasQueryOptions): MemoryAtlasSlice;
    graphNode(nodeId: string, options: MemoryAtlasQueryOptions): MemoryAtlasNodeDetail | null;
    graphNeighbors(nodeId: string, options: MemoryAtlasQueryOptions & {
        hops?: number;
    }): MemoryAtlasSlice;
    graphPath(from: string, to: string, options: MemoryAtlasQueryOptions & {
        maxHops?: number;
    }): MemoryAtlasPathResult;
    graphTimeline(query: string, options: MemoryAtlasQueryOptions): MemoryAtlasTimelineResult;
    touchMemoryAtlas(input: {
        projectId: string;
        nodeIds: string[];
        reason: string;
        query?: string;
        now?: number;
    }): {
        touched: number;
    };
    countUnboundBindableRawEvents(projectId?: string, limit?: number): number;
    promoteDreamCandidates(options?: DreamGovernanceRunOptions): DreamGovernanceRunResult;
    getDreamCandidateQueue(projectId?: string): DreamGovernanceRunResult['queue'];
    buildMemoryMap(options?: MemoryMapOptions): MemorySelfMap;
    runMaintenanceTick(options?: MaintenanceTickOptions): MaintenanceTickResult;
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