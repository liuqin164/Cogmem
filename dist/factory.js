import { createHash, randomUUID } from 'node:crypto';
import { BeliefStore } from './belief/BeliefStore.js';
import { BeliefGovernanceService } from './belief/BeliefGovernanceService.js';
import { MemoryBindingService, } from './binding/index.js';
import { IngestionCursorStore } from './batch/IngestionCursorStore.js';
import { MemoryGraph } from './core/MemoryGraph.js';
import { Metabolism } from './core/Metabolism.js';
import { Reflection } from './core/Reflection.js';
import { TwoStagePulseRanker } from './core/TwoStagePulseRanker.js';
import { BrainRecall } from './recall/BrainRecall.js';
import { AtlasPathRetriever, MultidimensionalQueryPlanner } from './recall/index.js';
import { HierarchicalRecallRouter } from './recall/HierarchicalRecallRouter.js';
import { isRecallableMemoryEvidence, recallSuppressionReasonFor, } from './recall/RecallGovernance.js';
import { TopicClassifier } from './recall/TopicClassifier.js';
import { TopicDecayPolicy } from './recall/TopicDecayPolicy.js';
import { TopicRegistry } from './recall/TopicRegistry.js';
import { TopicSummaryBoard } from './recall/TopicSummaryBoard.js';
import { CognitiveGraphCompiler } from './engine/CognitiveGraphCompiler.js';
import { cognitiveEdgeId, cognitiveNodeId } from './engine/CognitiveGraphIdentity.js';
import { ConsolidationPipeline } from './engine/ConsolidationPipeline.js';
import { ConsolidationTrigger } from './engine/ConsolidationTrigger.js';
import { CrossTopicSynthesizer } from './engine/CrossTopicSynthesizer.js';
import { CrossTopicTrigger } from './engine/CrossTopicTrigger.js';
import { DeepWritePromotionPolicy } from './engine/DeepWritePromotionPolicy.js';
import { DreamCuratorWorker } from './engine/DreamCuratorWorker.js';
import { EpisodicSemanticDistiller } from './engine/EpisodicSemanticDistiller.js';
import { EntityResolutionEngine } from './engine/EntityResolutionEngine.js';
import { FactCompiler } from './engine/FactCompiler.js';
import { GraphCommunityEngine } from './engine/GraphCommunityEngine.js';
import { IngestionEngine } from './engine/IngestionEngine.js';
import { InteractionBinder } from './engine/InteractionBinder.js';
import { LocalSemanticCompiler } from './engine/LocalSemanticCompiler.js';
import { MemoryConsolidationEngine } from './engine/MemoryConsolidationEngine.js';
import { OfflineConsolidationPipeline } from './engine/OfflineConsolidationPipeline.js';
import { OrphanCleaner } from './engine/OrphanCleaner.js';
import { PipelineMetrics } from './engine/PipelineMetrics.js';
import { PrincipleDecayPolicy } from './engine/PrincipleDecayPolicy.js';
import { TopologyCompiler } from './engine/TopologyCompiler.js';
import { WorkingMemoryDelta } from './engine/WorkingMemoryDelta.js';
import { EntityActivationIndex } from './retrieval/EntityActivationIndex.js';
import { NarrativeRecallAssembler } from './retrieval/NarrativeRecallAssembler.js';
import { PulseRetrievalEngine } from './retrieval/PulseRetrievalEngine.js';
import { QueryCompiler } from './retrieval/QueryCompiler.js';
import { RetrievalPlanner } from './retrieval/RetrievalPlanner.js';
import { TemporalBranchSearch } from './retrieval/TemporalBranchSearch.js';
import { UniverseNavigator } from './retrieval/UniverseNavigator.js';
import { UniverseTraversalExecutor } from './retrieval/UniverseTraversalExecutor.js';
import { NeuronEmbeddingStore } from './embedding/NeuronEmbeddingStore.js';
import { ReEmbeddingPipeline } from './embedding/ReEmbeddingPipeline.js';
import { TopicAliasRegistry, TopicGovernance, TopicPathRegistry as UserTopicPathRegistry, TopicRelationGraph } from './topic/index.js';
import { CorrectionResolver } from './episode/CorrectionResolver.js';
import { CandidateReviewService, MemoryGovernanceExecutor, MemoryGovernanceValidator, PiiRedactor, } from './governance/index.js';
import { ALL_MIGRATIONS, KERNEL_MIGRATIONS, SchemaMigrationRunner } from './migrations/index.js';
import { EntityGovernanceService } from './entity/index.js';
import { TemporalMemoryService } from './temporal/index.js';
import { ContextCortex } from './context/index.js';
import { ProspectiveMemoryService } from './prospective/index.js';
import { StrategyCortex } from './strategy/index.js';
import { ContextOutcomeStore, MemoryUseJudge } from './eval/strategy/index.js';
import { EpisodeAssembler, EpisodeStore } from './episode/index.js';
import { EpisodeBoundaryAuditService } from './episode/EpisodeBoundaryAuditService.js';
import { localDateFor, resolveProjectClockContext } from './utils/LocalDateContext.js';
import { EpisodeBoundaryPolicy, normalizeEpisodeBoundaryConfig } from './episode/EpisodeBoundaryPolicy.js';
import { logicalTurnsFromPairs } from './episode/EpisodeBoundaryReplayEngine.js';
import { EpisodeSplitPlanner } from './episode/EpisodeSplitPlanner.js';
import { DreamScheduler } from './dream/index.js';
import { loadCogmemConfig, resolveCogmemConfigPath, } from './config/CogmemConfig.js';
import { ModelRegistry } from './models/ModelRegistry.js';
import { IterativeLLMClarifier } from './routing/IterativeLLMClarifier.js';
import { ToolUsePolicy } from './routing/ToolUsePolicy.js';
import { createConfiguredEmbedder } from './store/EmbedderFactory.js';
import { CognitiveGraphStore } from './store/CognitiveGraphStore.js';
import { CompilerConfidenceStore } from './store/CompilerConfidenceStore.js';
import { DeepWriteCandidateStore } from './store/DeepWriteCandidateStore.js';
import { CandidateReviewStore } from './store/CandidateReviewStore.js';
import { DreamLedgerStore } from './store/DreamLedgerStore.js';
import { ActivationStore } from './store/ActivationStore.js';
import { EntityStore } from './store/EntityStore.js';
import { EventStore } from './store/EventStore.js';
import { FactStore } from './store/FactStore.js';
import { InteractionUnitStore } from './store/InteractionUnitStore.js';
import { MemoryBindingStore } from './store/MemoryBindingStore.js';
import { MemoryAtlasStore } from './store/MemoryAtlasStore.js';
import { MemoryFrameStore, frameSourceFingerprint } from './store/MemoryFrameStore.js';
import { deterministicFrameFallback } from './semantic/DeterministicFrameFallback.js';
import { MemoryAtlasIndexer, MemoryAtlasService, } from './atlas/index.js';
import { MemoryGovernanceStore } from './store/MemoryGovernanceStore.js';
import { SummaryStore } from './store/SummaryStore.js';
import { TemporalAdjacencyStore } from './store/TemporalAdjacencyStore.js';
import { TopologyStore } from './store/TopologyStore.js';
import { matchesProjectScope, projectScope } from './topology/ProjectScope.js';
import { deleteRegisteredProjectContent } from './governance/PrivacyDeletionRegistry.js';
import { SqliteVecStore } from './store/SqliteVecStore.js';
import { VectorStore } from './store/VectorStore.js';
import { config } from './utils/Config.js';
import { KernelRunningError, SnapshotExporter, SnapshotImporter, } from './snapshot/index.js';
import { CORE_VERSION } from './version.js';
const LATEST_SCHEMA_VERSION = Math.max(...ALL_MIGRATIONS.map((migration) => Number.parseInt(migration.version, 10)));
const TIME_PROJECTION_PUBLISH_BATCH_SIZE = 500;
export class MemoryKernel {
    options;
    memoryGraph;
    eventStore;
    factStore;
    entityStore;
    entityGovernanceService;
    beliefStore;
    beliefGovernanceService;
    temporalMemoryService;
    contextCortex;
    strategyCortex;
    memoryUseJudge;
    contextOutcomeStore;
    prospectiveMemoryService;
    cursorStore;
    vectorStore;
    topicRegistry;
    topologyStore;
    cognitiveGraphStore;
    temporalAdjacencyStore;
    neuronEmbeddingStore;
    dreamLedgerStore;
    activationStore;
    memoryBindingStore;
    memoryAtlasStore;
    memoryFrameStore;
    memoryAtlasService;
    multidimensionalQueryPlanner;
    memoryGovernanceStore;
    memoryGovernanceExecutor;
    pipelineMetrics;
    episodeStore;
    episodeAssembler;
    episodeBoundaryPolicy;
    episodeBoundaryAuditService;
    episodeSplitPlanner;
    userTopicPathRegistry;
    topicAliasRegistry;
    topicRelationGraph;
    topicGovernance;
    configDiagnostics;
    dbPath;
    projectClock;
    embedder;
    embeddingProvider;
    modelRegistry;
    encryptionProvider;
    piiRedactor;
    interactionUnitStore;
    compilerConfidenceStore;
    summaryStore;
    deepWriteCandidateStore;
    deepWritePromotionPolicy;
    candidateReviewStore;
    candidateReviewService;
    dreamCuratorWorker;
    dreamScheduler;
    memoryBindingService;
    memoryAtlasIndexer;
    atlasPathRetriever;
    topicSummaryBoard;
    topicDecayPolicy;
    localSemanticCompiler;
    topicClassifier;
    reflection;
    metabolism;
    ingestionEngine;
    universeNavigator;
    offlineConsolidationPipeline;
    consolidationPipeline;
    topologyCompiler;
    cognitiveGraphCompiler;
    brainRecall;
    ranker;
    reEmbeddingPipeline;
    extensions = new Map();
    lastEmbedSuccessAt;
    lastEmbedErrorAt;
    initialized = false;
    closed = false;
    constructor(options = {}) {
        this.options = options;
        this.configDiagnostics = [...(options.configDiagnostics || [])];
        const normalizedBoundary = normalizeEpisodeBoundaryConfig(options.episodeBoundary);
        this.configDiagnostics.push(...normalizedBoundary.diagnostics);
        if (options.projectTimeZone && normalizedBoundary.config.timezone && options.projectTimeZone !== normalizedBoundary.config.timezone)
            throw new Error('project_timezone_conflict');
        this.projectClock = resolveProjectClockContext({ projectTimeZone: options.projectTimeZone ?? normalizedBoundary.config.timezone });
        this.dbPath = options.dbPath ?? ':memory:';
        this.encryptionProvider = options.encryptionProvider;
        this.piiRedactor = options.redactionPolicy === false ? undefined : new PiiRedactor(options.redactionPolicy);
        this.factStore = new FactStore(this.dbPath, this.encryptionProvider);
        const db = this.factStore.getDatabase();
        this.memoryGraph = new MemoryGraph(db);
        this.eventStore = new EventStore(db, this.encryptionProvider, this.projectClock.timeZone);
        db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
        if (db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) {
            throw new Error('memory_kernel_foreign_keys_disabled');
        }
        new SchemaMigrationRunner(db, KERNEL_MIGRATIONS).run();
        const rebuildJobColumns = db.prepare(`PRAGMA table_info(topology_time_rebuild_jobs)`).all();
        if (rebuildJobColumns.length > 0 && !rebuildJobColumns.some((column) => column.name === 'publish_token'))
            db.exec(`ALTER TABLE topology_time_rebuild_jobs ADD COLUMN publish_token TEXT`);
        db.exec(`CREATE TABLE IF NOT EXISTS vector_write_outbox (neuron_id TEXT PRIMARY KEY, vector_json TEXT NOT NULL, created_at INTEGER NOT NULL)`);
        this.ensureMetaTable(db);
        this.entityStore = new EntityStore(db);
        this.ensureGovernanceAuditTable(db);
        const vectorDimension = options.vectorDimension ?? config.vector.dimension;
        this.modelRegistry = options.modelRegistry ?? ModelRegistry.defaults();
        this.beliefStore = new BeliefStore(db, this.eventStore);
        this.beliefGovernanceService = new BeliefGovernanceService(db, (eventId) => {
            const event = this.eventStore.getEvent(eventId);
            return event ? { eventId, projectId: event.projectId, role: event.role } : undefined;
        });
        this.temporalMemoryService = new TemporalMemoryService(db);
        this.contextCortex = new ContextCortex(db);
        this.strategyCortex = new StrategyCortex();
        this.memoryUseJudge = new MemoryUseJudge();
        this.contextOutcomeStore = new ContextOutcomeStore(db);
        this.prospectiveMemoryService = new ProspectiveMemoryService(db, (eventId) => {
            const event = this.eventStore.getEvent(eventId);
            return event ? {
                eventId,
                projectId: event.projectId,
                role: event.role,
                globalSeq: event.globalSeq,
                content: eventPayloadText(event.payload),
            } : undefined;
        });
        this.cursorStore = new IngestionCursorStore(db);
        this.vectorStore = options.vectorBackend === 'hnswlib'
            ? new VectorStore(vectorDimension)
            : new SqliteVecStore(db, vectorDimension);
        if (!(this.vectorStore instanceof SqliteVecStore))
            this.drainVectorOutbox();
        this.topicRegistry = new TopicRegistry(this.memoryGraph);
        this.topologyStore = new TopologyStore(db);
        this.cognitiveGraphStore = new CognitiveGraphStore(db);
        this.temporalAdjacencyStore = new TemporalAdjacencyStore(db);
        this.interactionUnitStore = new InteractionUnitStore(db);
        this.compilerConfidenceStore = new CompilerConfidenceStore(db);
        this.neuronEmbeddingStore = new NeuronEmbeddingStore(db);
        this.dreamLedgerStore = new DreamLedgerStore(db);
        this.episodeStore = new EpisodeStore(db, (eventId) => this.eventStore.getEvent(eventId), { initializeSchemaForTests: false });
        this.episodeBoundaryPolicy = new EpisodeBoundaryPolicy({ ...normalizedBoundary.config, timezone: this.projectClock.timeZone });
        this.episodeBoundaryAuditService = new EpisodeBoundaryAuditService(this.episodeStore, (eventId) => this.eventStore.getEvent(eventId), this.episodeBoundaryPolicy.config, this.configDiagnostics);
        this.episodeSplitPlanner = new EpisodeSplitPlanner(this.episodeStore, (eventId) => this.eventStore.getEvent(eventId), this.episodeBoundaryPolicy.config, this.configDiagnostics);
        this.userTopicPathRegistry = new UserTopicPathRegistry(db);
        this.topicAliasRegistry = new TopicAliasRegistry(db);
        this.topicRelationGraph = new TopicRelationGraph(db);
        this.topicGovernance = new TopicGovernance(db, this.userTopicPathRegistry, this.topicAliasRegistry, this.topicRelationGraph);
        this.episodeAssembler = new EpisodeAssembler(this.episodeStore, (eventId) => this.eventStore.getEvent(eventId), 30 * 60_000, options.turnRelationReviewer, (primary, episode) => {
            const text = eventPayloadText(primary.payload);
            const matches = this.topicAliasRegistry.matchText(primary.projectId || '', text || '');
            if (!matches.length)
                return {};
            const matchedPaths = [...new Set(matches
                    .map((match) => this.userTopicPathRegistry.get(match.topicId)?.topicPath)
                    .filter((path) => Boolean(path)))];
            return {
                topicPathMatch: Boolean(episode?.topicPath && matchedPaths.includes(episode.topicPath)),
                currentTopicPath: matchedPaths.length === 1 ? matchedPaths[0] : undefined,
            };
        }, this.episodeBoundaryPolicy);
        this.activationStore = new ActivationStore(db);
        this.memoryBindingStore = new MemoryBindingStore(db);
        this.memoryBindingService = new MemoryBindingService(this.memoryBindingStore, this.entityStore);
        this.memoryAtlasStore = new MemoryAtlasStore(db);
        this.memoryFrameStore = new MemoryFrameStore(db);
        this.memoryAtlasIndexer = new MemoryAtlasIndexer(db, this.eventStore, this.memoryAtlasStore, this.memoryFrameStore);
        this.memoryAtlasService = new MemoryAtlasService(this.memoryAtlasStore, this.eventStore);
        this.multidimensionalQueryPlanner = new MultidimensionalQueryPlanner();
        this.atlasPathRetriever = new AtlasPathRetriever(this.memoryAtlasService, this.multidimensionalQueryPlanner);
        this.entityGovernanceService = new EntityGovernanceService(db, this.entityStore, (eventId) => {
            const event = this.eventStore.getEvent(eventId);
            return event ? { eventId, projectId: event.projectId, role: event.role } : undefined;
        });
        this.memoryGovernanceStore = new MemoryGovernanceStore(db);
        this.memoryGovernanceExecutor = new MemoryGovernanceExecutor(db, this.memoryGovernanceStore, new MemoryGovernanceValidator((eventId) => {
            const event = this.eventStore.getEvent(eventId);
            return event ? { eventId, projectId: event.projectId, role: event.role } : undefined;
        }), {
            BIND_EVENT: (operation) => {
                const eventId = typeof operation.payload.eventId === 'string' ? operation.payload.eventId : operation.evidenceEventIds[0];
                const event = eventId ? this.eventStore.getEvent(eventId) : null;
                if (!event)
                    throw new Error(`BIND_EVENT requires an existing event: ${eventId || 'missing'}`);
                this.memoryBindingService.bindRawEvent(event);
            },
            CREATE_PROSPECTIVE_MEMORY: (operation, context) => {
                const projectId = operation.projectId ?? context.plan.projectId;
                if (!projectId)
                    throw new Error('CREATE_PROSPECTIVE_MEMORY requires projectId');
                this.prospectiveMemoryService.propose({
                    projectId,
                    candidateType: operation.payload.candidateType,
                    canonicalKey: requiredGovernancePayloadString(operation.payload, 'canonicalKey'),
                    title: requiredGovernancePayloadString(operation.payload, 'title'),
                    details: optionalGovernancePayloadString(operation.payload, 'details'),
                    evidenceEventIds: operation.evidenceEventIds,
                    proposedBy: context.plan.proposedBy,
                    dueAt: optionalGovernancePayloadNumber(operation.payload, 'dueAt'),
                });
            },
            RESOLVE_PROSPECTIVE_MEMORY: (operation) => {
                const projectId = operation.projectId;
                if (!projectId)
                    throw new Error('RESOLVE_PROSPECTIVE_MEMORY requires projectId');
                const candidateId = requiredGovernancePayloadString(operation.payload, 'candidateId');
                const action = requiredGovernancePayloadString(operation.payload, 'action');
                if (action === 'confirm') {
                    const confirmationEvidenceEventId = requiredGovernancePayloadString(operation.payload, 'confirmationEvidenceEventId');
                    if (!operation.evidenceEventIds.includes(confirmationEvidenceEventId)) {
                        throw new Error('confirmation evidence must be included in governance operation evidence');
                    }
                    this.prospectiveMemoryService.resolve(candidateId, {
                        action,
                        confirmationEvidenceEventId,
                    }, projectId);
                }
                else if (action === 'defer') {
                    const deferredUntil = optionalGovernancePayloadNumber(operation.payload, 'deferredUntil');
                    if (deferredUntil === undefined)
                        throw new Error('RESOLVE_PROSPECTIVE_MEMORY defer requires deferredUntil');
                    this.prospectiveMemoryService.resolve(candidateId, { action, deferredUntil }, projectId);
                }
                else if (action === 'reject' || action === 'complete' || action === 'expire') {
                    this.prospectiveMemoryService.resolve(candidateId, { action }, projectId);
                }
                else {
                    throw new Error(`invalid_prospective_memory_action:${action}`);
                }
            },
        });
        this.pipelineMetrics = new PipelineMetrics(db);
        this.summaryStore = new SummaryStore(db);
        this.summaryStore.migrateLegacyFactSummaries();
        this.deepWriteCandidateStore = new DeepWriteCandidateStore(db);
        this.dreamCuratorWorker = new DreamCuratorWorker({
            eventStore: this.eventStore,
            dreamLedgerStore: this.dreamLedgerStore,
            candidateStore: this.deepWriteCandidateStore,
            modelRegistry: this.modelRegistry,
            pipelineMetrics: this.pipelineMetrics,
            correctionResolver: new CorrectionResolver(({ projectId, query, entities, limit }) => (this.beliefStore.getActiveBeliefsForQuery({ projectId, query, entities, limit }).map((belief) => ({
                beliefId: belief.id, canonicalKey: belief.canonicalKey,
                statement: `${belief.subject} ${belief.predicate} ${String(belief.objectValue)}`, projectId: belief.projectId,
            })))),
            memoryFrameStore: this.memoryFrameStore,
        });
        this.dreamScheduler = new DreamScheduler(this.episodeStore, this.dreamCuratorWorker, this.deepWriteCandidateStore, this.memoryFrameStore);
        this.topicSummaryBoard = new TopicSummaryBoard(this.memoryGraph, this.summaryStore);
        this.topicDecayPolicy = new TopicDecayPolicy(this.memoryGraph);
        this.localSemanticCompiler = new LocalSemanticCompiler();
        this.embedder = options.embedder ?? createConfiguredEmbedder(vectorDimension, this.modelRegistry);
        this.embeddingProvider = options.embeddingProvider;
        this.universeNavigator = new UniverseNavigator(new QueryCompiler(this.localSemanticCompiler, new EntityResolutionEngine(this.entityStore)), new RetrievalPlanner(), new TemporalBranchSearch(this.topologyStore, this.temporalAdjacencyStore), new PulseRetrievalEngine(this.temporalAdjacencyStore, new EntityActivationIndex(this.entityStore, this.factStore)), new NarrativeRecallAssembler(), new UniverseTraversalExecutor());
        this.topicClassifier = new TopicClassifier(this.memoryGraph, { confidenceThreshold: 0.25, enableEmbedding: true, embeddingThreshold: 0.75 }, this.topicRegistry, this.embedder);
        this.ranker = new TwoStagePulseRanker(this.vectorStore);
        this.reflection = new Reflection(this.memoryGraph);
        this.metabolism = new Metabolism(this.memoryGraph, this.vectorStore, this.eventStore);
        this.ingestionEngine = new IngestionEngine(this.embedder, undefined, vectorDimension);
        this.ingestionEngine.setDedupDeps((vector, k) => this.vectorStore.search(vector, k), (id) => this.memoryGraph.getNeuron(id), (id) => this.reflection.onNeuronActivated(id));
        const noOpDispatcher = {
            dispatch: async (call) => ({
                toolName: 'brain_recall',
                callId: `memory-kernel-${Date.now()}`,
                success: true,
                result: [],
                durationMs: 0,
            }),
        };
        const makeClarifier = (answer) => new IterativeLLMClarifier(async () => answer, noOpDispatcher, {
            maxIterations: 1,
            policy: new ToolUsePolicy(),
        });
        const memoryConsolidationEngine = new MemoryConsolidationEngine(new ConsolidationTrigger(this.memoryGraph), new EpisodicSemanticDistiller(this.memoryGraph, makeClarifier('Consolidated principle from repeated experience.')));
        const crossTopicSynthesizer = new CrossTopicSynthesizer(this.memoryGraph, new CrossTopicTrigger(this.memoryGraph), makeClarifier('Cross-domain principle from multiple semantic consolidations.'));
        const graphCommunityEngine = new GraphCommunityEngine(this.memoryGraph);
        const orphanCleaner = new OrphanCleaner(this.memoryGraph);
        const principleDecayPolicy = new PrincipleDecayPolicy(this.memoryGraph);
        this.deepWritePromotionPolicy = new DeepWritePromotionPolicy({
            candidateStore: this.deepWriteCandidateStore,
            factStore: this.factStore,
            entityStore: this.entityStore,
            beliefStore: this.beliefStore,
            summaryStore: this.summaryStore,
            minPromoteConfidence: 0.86,
        });
        this.candidateReviewStore = new CandidateReviewStore(db);
        this.candidateReviewService = new CandidateReviewService(db, this.deepWriteCandidateStore, this.candidateReviewStore, this.deepWritePromotionPolicy, (eventId) => this.eventStore.getEvent(eventId));
        const workingMemoryDelta = new WorkingMemoryDelta(db, this.memoryGraph);
        this.offlineConsolidationPipeline = new OfflineConsolidationPipeline({
            factStore: this.factStore,
            entityStore: this.entityStore,
            beliefStore: this.beliefStore,
            compilerConfidenceStore: this.compilerConfidenceStore,
            semanticCompiler: this.localSemanticCompiler,
            deepWritePromotionPolicy: this.deepWritePromotionPolicy,
            topicSummaryBoard: this.topicSummaryBoard,
            topicDecayPolicy: this.topicDecayPolicy,
            memoryConsolidationEngine,
            proceduralLearningBridge: {
                scan: (projectId) => this.getExtension('procedural_bridge')?.scan(projectId),
            },
            crossTopicSynthesizer,
            graphCommunityEngine,
            orphanCleaner,
            principleDecayPolicy,
            pipelineMetrics: this.pipelineMetrics,
            maxBudgetMs: options.maxOfflinePipelineBudgetMs,
            db,
            workingMemoryDelta,
        });
        this.consolidationPipeline = new ConsolidationPipeline(this.beliefStore, new InteractionBinder(this.interactionUnitStore), new FactCompiler(this.factStore, this.entityStore), this.localSemanticCompiler, this.factStore, this.entityStore, this.compilerConfidenceStore, undefined, this.offlineConsolidationPipeline);
        this.topologyCompiler = new TopologyCompiler(this.topologyStore);
        this.cognitiveGraphCompiler = new CognitiveGraphCompiler(this.cognitiveGraphStore, this.entityStore);
        this.brainRecall = new BrainRecall({
            memoryGraph: this.memoryGraph,
            factStore: this.factStore,
            entityStore: this.entityStore,
            beliefStore: this.beliefStore,
            cursorStore: this.cursorStore,
            summaryStore: this.summaryStore,
            hierarchicalRouter: new HierarchicalRecallRouter(this.memoryGraph, { minConfidence: 0.15, maxCandidates: 500 }),
            topicSummaryBoard: this.topicSummaryBoard,
            graphCommunityEngine,
            embeddingProvider: this.embeddingProvider,
            neuronEmbeddingStore: this.neuronEmbeddingStore,
        });
        this.reEmbeddingPipeline = this.embeddingProvider
            ? new ReEmbeddingPipeline(this.neuronEmbeddingStore, this.embeddingProvider, this.memoryGraph, db)
            : undefined;
    }
    async initialize(skipWarmup = true) {
        if (this.initialized)
            return;
        if (!skipWarmup)
            await this.embedder.warmup();
        this.initialized = true;
    }
    async start() {
        await this.initialize();
    }
    stop() {
        this.metabolism.stop();
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        this.stop();
        this.beliefStore.close();
        this.cursorStore.close();
        this.memoryGraph.close();
        this.eventStore.close();
        this.entityStore.close();
        this.topologyStore.close();
        this.cognitiveGraphStore.close();
        this.temporalAdjacencyStore.close();
        this.activationStore.close();
        this.interactionUnitStore.close();
        this.compilerConfidenceStore.close();
        this.factStore.close();
        // bun:sqlite close(false) waits for temporary prepared statements to be
        // finalized. An explicit Kernel close must release the file before a CLI
        // process can reopen it, even while the Kernel object remains reachable.
        Bun.gc(true);
    }
    async ingest(input) {
        await this.initialize();
        const normalizedInput = await this.normalizeIngestInput(input);
        const prevNeuronSelfHash = this.memoryGraph.getLatestNeuronSelfHash(projectScope(normalizedInput.projectId));
        const { neuron, isDuplicate } = await this.ingestionEngine.ingest(normalizedInput, { prevNeuronSelfHash });
        if (isDuplicate) {
            this.metabolism.recordActivity();
            return neuron;
        }
        let vectorCommitted = false;
        try {
            this.factStore.getDatabase().transaction(() => {
                const ingestedEvent = this.eventStore.append({
                    streamId: neuron.id,
                    streamType: 'neuron',
                    eventType: 'INGESTED',
                    projectId: neuron.metadata.projectId,
                    sourceNeuronId: neuron.id,
                    parentEventId: normalizedInput.sourceRefs?.find((ref) => ref.eventId)?.eventId,
                    causalityType: normalizedInput.sourceRefs?.some((ref) => ref.eventId) ? 'derived_from' : undefined,
                    sourceId: normalizedInput.sourceRefs?.[0]?.sourceId,
                    contentHash: normalizedInput.sourceRefs?.[0]?.contentHash,
                    payload: {
                        neuronId: neuron.id,
                        selfHash: neuron.self_hash,
                        prevHash: neuron.prev_hash,
                        type: neuron.metadata.type,
                        createdAt: neuron.metadata.createdAt,
                        source: normalizedInput.source,
                        sourceRefs: normalizedInput.sourceRefs || [],
                    },
                });
                neuron.metadata.sourceEventId = ingestedEvent.eventId;
                neuron.metadata.updatedAt = neuron.metadata.createdAt;
                const projectionUpdate = this.topologyStore.beginTimeProjectionSourceUpdate(neuron.metadata.projectId, this.projectClock.timeZone, neuron.metadata.createdAt);
                const temporalIncremental = projectionUpdate.incremental;
                const sourceRevision = projectionUpdate.sourceRevision;
                this.memoryGraph.addNeuronInTransaction(neuron, false);
                if (this.vectorStore instanceof SqliteVecStore) {
                    this.vectorStore.addVector(neuron.id, neuron.coordinates.V);
                    vectorCommitted = true;
                }
                else {
                    this.factStore.getDatabase().prepare(`INSERT OR REPLACE INTO vector_write_outbox(neuron_id,vector_json,created_at) VALUES(?,?,?)`)
                        .run(neuron.id, JSON.stringify(neuron.coordinates.V), neuron.metadata.createdAt);
                }
                this.reflection.onNeuronActivated(neuron.id);
                this.reflection.detectAndCreateOverrides(neuron, (vector, k) => this.vectorStore.search(vector, k));
                const consolidation = this.consolidationPipeline.consolidate(neuron, ingestedEvent.eventId);
                const topology = this.topologyCompiler.compile({
                    neuron,
                    consolidation,
                    timeZone: this.projectClock.timeZone,
                    temporalEnabled: temporalIncremental,
                });
                if (temporalIncremental)
                    this.temporalAdjacencyStore.syncBuckets(topology.timeBuckets, neuron.metadata.createdAt);
                const cognitiveGraph = this.cognitiveGraphCompiler.compile({ neuron, consolidation, topology });
                if (temporalIncremental) {
                    this.topologyStore.markTimeProjectionCleanIfCurrent(projectScope(neuron.metadata.projectId), this.projectClock.timeZone, neuron.metadata.createdAt, sourceRevision);
                }
                this.eventStore.append({
                    streamId: neuron.id,
                    streamType: 'neuron',
                    eventType: 'TOPOLOGY_COMPILED',
                    projectId: neuron.metadata.projectId,
                    sourceNeuronId: neuron.id,
                    occurredAt: neuron.metadata.createdAt,
                    payload: {
                        neuronId: neuron.id,
                        timeBuckets: topology.timeBuckets.map((bucket) => bucket.bucketId),
                        branchIds: topology.branchIds,
                        taskIds: topology.taskIds,
                        clusterIds: topology.clusterIds,
                    },
                });
                this.eventStore.append({
                    streamId: neuron.id,
                    streamType: 'neuron',
                    eventType: 'COGNITIVE_GRAPH_COMPILED',
                    projectId: neuron.metadata.projectId,
                    sourceNeuronId: neuron.id,
                    occurredAt: neuron.metadata.createdAt,
                    payload: {
                        neuronId: neuron.id,
                        seedNodeIds: cognitiveGraph.seedNodeIds,
                        edgeCount: cognitiveGraph.edgeCount,
                    },
                });
            })();
        }
        catch (error) {
            if (vectorCommitted)
                this.vectorStore.removePoint(neuron.id);
            throw error;
        }
        if (!(this.vectorStore instanceof SqliteVecStore)) {
            try {
                this.drainVectorOutbox(neuron.id);
            }
            catch (error) {
                this.pipelineMetrics.recordNonFatal('vector_outbox_pending', {
                    projectId: neuron.metadata.projectId,
                    message: error instanceof Error ? error.message : String(error),
                    details: { neuronId: neuron.id },
                });
            }
        }
        this.memoryGraph.indexCommittedNeuron(neuron);
        this.topicRegistry.invalidate(neuron.metadata.projectId);
        this.queueEmbedding(neuron);
        this.metabolism.recordActivity();
        return neuron;
    }
    drainVectorOutbox(onlyNeuronId) {
        if (this.vectorStore instanceof SqliteVecStore)
            return;
        const db = this.factStore.getDatabase();
        const rows = (onlyNeuronId
            ? db.prepare(`SELECT o.neuron_id,o.vector_json,n.id AS canonical_id FROM vector_write_outbox o LEFT JOIN neurons n ON n.id=o.neuron_id AND n.is_deleted=0 WHERE o.neuron_id=?`).all(onlyNeuronId)
            : db.prepare(`SELECT o.neuron_id,o.vector_json,n.id AS canonical_id FROM vector_write_outbox o LEFT JOIN neurons n ON n.id=o.neuron_id AND n.is_deleted=0 ORDER BY o.created_at,o.neuron_id`).all());
        for (const row of rows) {
            if (!row.canonical_id) {
                db.prepare(`DELETE FROM vector_write_outbox WHERE neuron_id=?`).run(row.neuron_id);
                continue;
            }
            const vector = JSON.parse(row.vector_json);
            this.vectorStore.addVector(row.neuron_id, vector);
            db.prepare(`DELETE FROM vector_write_outbox WHERE neuron_id=?`).run(row.neuron_id);
        }
    }
    recall(query, options = {}) {
        const recallNow = options.now ?? Date.now();
        const recallTimeZone = options.timeZone ?? this.projectClock.timeZone;
        const normalizedOptions = {
            ...options,
            now: recallNow,
            timeZone: recallTimeZone,
            localDateNow: options.localDateNow ?? localDateFor(recallNow, recallTimeZone),
        };
        const result = this.brainRecall.recall(query, normalizedOptions);
        if (normalizedOptions.projectId === undefined)
            return result;
        try {
            const now = recallNow;
            const timeZone = recallTimeZone;
            const planned = this.atlasPathRetriever.retrieve(query, { projectId: normalizedOptions.projectId, limit: normalizedOptions.limit, includeEvidence: true, evidenceLimit: 1000, staleOk: true, localDateNow: normalizedOptions.localDateNow, timeZone, now });
            return { ...result, queryFrame: planned.queryFrame, atlas: planned.result };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.pipelineMetrics.recordNonFatal('memory_atlas_recall_degraded', { projectId: options.projectId, message, details: { component: 'atlas_path_retriever' } });
            return { ...result, atlasStatus: 'unavailable', atlasErrorCode: 'atlas_recall_failed' };
        }
    }
    navigateMemory(query, options = {}) {
        const clock = resolveProjectClockContext({
            now: options.now,
            localDateNow: options.localDateNow,
            timeZone: options.timeZone,
            projectTimeZone: this.projectClock.timeZone,
        });
        const temporalEnabled = options.projectId !== undefined
            ? this.topologyStore.hasUsableTimeProjection(projectScope(options.projectId), clock.timeZone)
            : this.topologyStore.hasUsableTimeProjections(clock.timeZone);
        const limit = Math.max(1, options.limit ?? 8);
        const seedLimit = Math.min(Math.max(limit * 4, 24), 120);
        const seedNeuronIds = this.memoryGraph.fullTextSearch(query, options.projectId, seedLimit);
        const cognitiveContext = this.cognitiveGraphStore.collectContext({
            projectId: options.projectId,
            terms: extractNavigationTerms(query),
            limit: seedLimit,
            hopLimit: 2,
            excludeTemporal: !temporalEnabled,
        });
        const seedTemporalBucketIds = temporalEnabled ? this.topologyStore.listTimeBucketIdsByNeuronIds(seedNeuronIds, options.projectId, seedLimit) : [];
        const navigation = this.universeNavigator.navigate({
            query,
            projectId: options.projectId,
            startTime: options.startTime,
            endTime: options.endTime,
            temporalEnabled,
            clock,
            topologyIds: seedNeuronIds,
            branchIds: [],
            temporalBucketIds: seedTemporalBucketIds,
            temporalNeuronIds: temporalEnabled ? seedNeuronIds : [],
            graphIds: seedNeuronIds,
            cognitiveGraphIds: cognitiveContext.neuronIds,
            entityNeuronIds: [],
        });
        const candidateIds = uniqueStrings([
            ...navigation.pulse.fusedIds,
            ...navigation.branchSearch.neuronIds,
            ...navigation.branchSearch.temporalTraversal.neuronIds,
            ...seedNeuronIds,
            ...cognitiveContext.neuronIds,
        ]);
        const rawEvidence = candidateIds
            .map((id) => this.memoryGraph.getNeuron(id))
            .filter((item) => Boolean(item))
            .filter((neuron) => matchesProjectScope(options.projectId, neuron.metadata.projectId));
        const governedEvidence = selectRecallableEvidence(rawEvidence, limit);
        if (governedEvidence.rawEvidence.length > 0) {
            return {
                query,
                projectId: options.projectId,
                recallMode: 'universe_navigation',
                fallbackUsed: false,
                navigation,
                rawEvidence: governedEvidence.rawEvidence,
                filteredEvidence: governedEvidence.filteredEvidence,
            };
        }
        const fallbackEvidence = this.recall(query, {
            projectId: options.projectId,
            limit,
            includeRawEvidence: true,
            now: clock.now,
            localDateNow: clock.localDateNow,
            timeZone: clock.timeZone,
        }).rawEvidence.filter((neuron) => matchesProjectScope(options.projectId, neuron.metadata.projectId));
        const governedFallbackEvidence = selectRecallableEvidence(fallbackEvidence, limit);
        return {
            query,
            projectId: options.projectId,
            recallMode: 'brain_recall_fallback',
            fallbackUsed: true,
            navigation,
            rawEvidence: governedFallbackEvidence.rawEvidence,
            filteredEvidence: uniqueFilteredEvidence([
                ...governedEvidence.filteredEvidence,
                ...governedFallbackEvidence.filteredEvidence,
            ]),
        };
    }
    rebuildProjectTimeTopology(projectId) {
        const scope = projectScope(projectId);
        const timeZone = this.projectClock.timeZone;
        const now = Date.now();
        const db = this.factStore.getDatabase();
        const currentSourceRevision = () => this.topologyStore.getTimeProjectionSourceRevision(scope);
        let job = db.prepare(`SELECT generation,time_zone,status,cursor_created_at,cursor_neuron_id,neuron_count,source_revision FROM topology_time_rebuild_jobs WHERE project_id=?`).get(scope);
        if (!job || job.status === 'failed' || job.time_zone !== timeZone || job.source_revision !== currentSourceRevision()) {
            const generation = `topology-${randomUUID()}`;
            const sourceRevision = currentSourceRevision();
            db.transaction(() => {
                db.prepare(`DELETE FROM topology_time_rebuild_jobs WHERE project_id=?`).run(scope);
                db.prepare(`INSERT INTO topology_time_rebuild_jobs(project_id,generation,time_zone,status,cursor_created_at,cursor_neuron_id,neuron_count,updated_at,error,source_revision) VALUES(?,?,?,'building',NULL,NULL,0,?,NULL,?)`).run(scope, generation, timeZone, now, sourceRevision);
                this.topologyStore.markTimeProjection(scope, 'building', timeZone, now, undefined, sourceRevision);
            })();
            job = { generation, time_zone: timeZone, status: 'building', neuron_count: 0, source_revision: sourceRevision };
        }
        try {
            const generation = job.generation;
            const sourceRevision = job.source_revision;
            const assertCurrentSource = () => {
                if (currentSourceRevision() !== sourceRevision)
                    throw new Error('topology_source_revision_changed');
            };
            let neuronCount = Number(job.neuron_count ?? 0);
            if (job.status === 'building') {
                let cursor = job.cursor_created_at !== null && job.cursor_created_at !== undefined && job.cursor_neuron_id
                    ? { createdAt: Number(job.cursor_created_at), id: job.cursor_neuron_id }
                    : undefined;
                const insertBucket = db.prepare(`INSERT INTO topology_time_rebuild_buckets(generation,bucket_id,project_id,time_zone,bucket_type,bucket_start,bucket_end,label) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(generation,bucket_id) DO UPDATE SET label=excluded.label`);
                const insertEntry = db.prepare(`INSERT OR IGNORE INTO topology_time_rebuild_entries(generation,bucket_id,neuron_id,project_id,created_at) VALUES(?,?,?,?,?)`);
                for (;;) {
                    assertCurrentSource();
                    const neurons = this.memoryGraph.listTimeProjectionNeurons(projectId, { afterCreatedAt: cursor?.createdAt, afterId: cursor?.id, limit: 500 });
                    if (neurons.length === 0)
                        break;
                    const planned = this.topologyCompiler.planTimeBuckets(neurons, timeZone);
                    const last = neurons[neurons.length - 1];
                    db.transaction(() => {
                        for (const neuron of neurons) {
                            for (const bucket of planned.get(neuron.id) ?? []) {
                                insertBucket.run(generation, bucket.bucketId, scope, timeZone, bucket.bucketType, bucket.bucketStart, bucket.bucketEnd, bucket.label);
                                insertEntry.run(generation, bucket.bucketId, neuron.id, scope, neuron.createdAt);
                            }
                        }
                        db.prepare(`UPDATE topology_time_rebuild_jobs SET cursor_created_at=?,cursor_neuron_id=?,neuron_count=neuron_count+?,updated_at=?,error=NULL WHERE project_id=? AND generation=? AND status='building' AND source_revision=?`).run(last.createdAt, last.id, neurons.length, Date.now(), scope, generation, sourceRevision);
                    })();
                    neuronCount += neurons.length;
                    cursor = { createdAt: last.createdAt, id: last.id };
                }
                assertCurrentSource();
                db.prepare(`DELETE FROM topology_time_rebuild_active_neurons WHERE generation=?`).run(generation);
                const insertActive = db.prepare(`INSERT INTO topology_time_rebuild_active_neurons(generation,neuron_id,project_id,created_at,title) VALUES(?,?,?,?,?)`);
                let snapshotCursor;
                neuronCount = 0;
                for (;;) {
                    assertCurrentSource();
                    const neurons = this.memoryGraph.listTimeProjectionNeurons(projectId, { afterCreatedAt: snapshotCursor?.createdAt, afterId: snapshotCursor?.id, limit: 500 });
                    if (neurons.length === 0)
                        break;
                    db.transaction(() => {
                        for (const neuron of neurons)
                            insertActive.run(generation, neuron.id, scope, neuron.createdAt, neuron.title);
                    })();
                    neuronCount += neurons.length;
                    const last = neurons[neurons.length - 1];
                    snapshotCursor = { createdAt: last.createdAt, id: last.id };
                }
                assertCurrentSource();
                this.stageTimeProjectionGraph(generation, scope, timeZone, now);
                assertCurrentSource();
                db.prepare(`UPDATE topology_time_rebuild_jobs SET status='ready',neuron_count=?,updated_at=?,error=NULL WHERE project_id=? AND generation=? AND status='building' AND source_revision=?`).run(neuronCount, Date.now(), scope, generation, sourceRevision);
            }
            assertCurrentSource();
            const bucketCount = Number(db.prepare(`SELECT COUNT(*) AS count FROM topology_time_rebuild_buckets b WHERE b.generation=? AND EXISTS (SELECT 1 FROM topology_time_rebuild_entries e JOIN topology_time_rebuild_active_neurons n ON n.generation=e.generation AND n.neuron_id=e.neuron_id AND n.project_id=e.project_id WHERE e.generation=b.generation AND e.bucket_id=b.bucket_id)`).get(generation)?.count ?? 0);
            const publishToken = `publish-${randomUUID()}`;
            db.transaction(() => {
                const claim = db.prepare(`UPDATE topology_time_rebuild_jobs SET publish_token=?,updated_at=? WHERE project_id=? AND generation=? AND status='ready' AND source_revision=? AND publish_token IS NULL`).run(publishToken, Date.now(), scope, generation, sourceRevision);
                const owned = db.prepare(`SELECT 1 FROM topology_time_rebuild_jobs WHERE project_id=? AND generation=? AND status='ready' AND source_revision=? AND publish_token=?`).get(scope, generation, sourceRevision, publishToken);
                if (claim.changes !== 1 || !owned)
                    throw new Error('time_projection_rebuild_publish_conflict');
            })();
            assertCurrentSource();
            this.publishTimeProjectionInBatches({ generation, scope, publishToken, sourceRevision });
            db.transaction(() => {
                assertCurrentSource();
                const owned = db.prepare(`SELECT 1 FROM topology_time_rebuild_jobs WHERE project_id=? AND generation=? AND status='ready' AND source_revision=? AND publish_token=?`).get(scope, generation, sourceRevision, publishToken);
                if (!owned)
                    throw new Error('time_projection_rebuild_publish_conflict');
                this.topologyStore.markTimeProjection(scope, 'clean', timeZone, now, undefined, sourceRevision);
                db.prepare(`DELETE FROM topology_time_rebuild_jobs WHERE project_id=? AND generation=? AND publish_token=?`).run(scope, generation, publishToken);
            })();
            return { projectId: scope, timeZone, neurons: neuronCount, buckets: bucketCount, rebuiltAt: now };
        }
        catch (error) {
            const failed = db.prepare(`UPDATE topology_time_rebuild_jobs SET status='failed',updated_at=?,error=? WHERE project_id=? AND generation=?`).run(Date.now(), error instanceof Error ? error.message : String(error), scope, job.generation);
            if (failed.changes === 1) {
                this.topologyStore.markTimeProjection(scope, 'failed', timeZone, now, error instanceof Error ? error.message : String(error), currentSourceRevision());
            }
            throw error;
        }
    }
    publishTimeProjectionInBatches(input) {
        const db = this.factStore.getDatabase();
        const ownsPublish = () => Boolean(db.prepare(`SELECT 1 FROM topology_time_rebuild_jobs WHERE project_id=? AND generation=? AND status='ready' AND source_revision=? AND publish_token=?`).get(input.scope, input.generation, input.sourceRevision, input.publishToken));
        const deleteBatches = (sql, ...params) => {
            for (;;) {
                const changed = db.transaction(() => {
                    if (!ownsPublish())
                        throw new Error('time_projection_rebuild_publish_conflict');
                    return Number(db.prepare(sql).run(...params, TIME_PROJECTION_PUBLISH_BATCH_SIZE).changes ?? 0);
                })();
                if (changed < TIME_PROJECTION_PUBLISH_BATCH_SIZE)
                    return;
            }
        };
        const insertBatches = (countSql, insertSql) => {
            const count = Number(db.prepare(countSql).get(input.generation)?.count ?? 0);
            for (let offset = 0; offset < count; offset += TIME_PROJECTION_PUBLISH_BATCH_SIZE)
                db.transaction(() => {
                    if (!ownsPublish())
                        throw new Error('time_projection_rebuild_publish_conflict');
                    db.prepare(insertSql).run(input.generation, TIME_PROJECTION_PUBLISH_BATCH_SIZE, offset);
                })();
        };
        deleteBatches(`DELETE FROM time_bucket_entries WHERE rowid IN (SELECT rowid FROM time_bucket_entries WHERE COALESCE(project_id,'')=? LIMIT ?)`, input.scope);
        deleteBatches(`DELETE FROM topology_membership WHERE rowid IN (SELECT rowid FROM topology_membership WHERE COALESCE(project_id,'')=? AND dimension_type='time_bucket' LIMIT ?)`, input.scope);
        deleteBatches(`DELETE FROM cognitive_edges WHERE rowid IN (SELECT rowid FROM cognitive_edges WHERE project_id=? AND edge_type='occurred_in_time_bucket' LIMIT ?)`, input.scope);
        deleteBatches(`DELETE FROM cognitive_nodes WHERE rowid IN (SELECT rowid FROM cognitive_nodes WHERE project_id=? AND node_type='time_bucket' LIMIT ?)`, input.scope);
        deleteBatches(`DELETE FROM temporal_adjacency WHERE rowid IN (SELECT rowid FROM temporal_adjacency WHERE project_id=? LIMIT ?)`, input.scope);
        deleteBatches(`DELETE FROM time_buckets WHERE rowid IN (SELECT rowid FROM time_buckets WHERE project_id=? AND bucket_id NOT IN (SELECT bucket_id FROM time_bucket_entries) LIMIT ?)`, input.scope);
        insertBatches(`SELECT COUNT(*) AS count FROM topology_time_rebuild_buckets b WHERE b.generation=? AND EXISTS (SELECT 1 FROM topology_time_rebuild_entries e JOIN topology_time_rebuild_active_neurons n ON n.generation=e.generation AND n.neuron_id=e.neuron_id AND n.project_id=e.project_id WHERE e.generation=b.generation AND e.bucket_id=b.bucket_id)`, `INSERT OR IGNORE INTO time_buckets(bucket_id,project_id,time_zone,bucket_type,bucket_start,bucket_end,label) SELECT b.bucket_id,b.project_id,b.time_zone,b.bucket_type,b.bucket_start,b.bucket_end,b.label FROM topology_time_rebuild_buckets b WHERE b.generation=? AND EXISTS (SELECT 1 FROM topology_time_rebuild_entries e JOIN topology_time_rebuild_active_neurons n ON n.generation=e.generation AND n.neuron_id=e.neuron_id AND n.project_id=e.project_id WHERE e.generation=b.generation AND e.bucket_id=b.bucket_id) ORDER BY b.bucket_id LIMIT ? OFFSET ?`);
        insertBatches(`SELECT COUNT(*) AS count FROM topology_time_rebuild_entries e JOIN topology_time_rebuild_active_neurons n ON n.generation=e.generation AND n.neuron_id=e.neuron_id AND n.project_id=e.project_id WHERE e.generation=?`, `INSERT OR IGNORE INTO time_bucket_entries(bucket_id,neuron_id,unit_id,belief_id,fact_id,event_id,project_id,created_at) SELECT e.bucket_id,e.neuron_id,NULL,NULL,NULL,NULL,e.project_id,e.created_at FROM topology_time_rebuild_entries e JOIN topology_time_rebuild_active_neurons n ON n.generation=e.generation AND n.neuron_id=e.neuron_id AND n.project_id=e.project_id WHERE e.generation=? ORDER BY e.bucket_id,e.neuron_id LIMIT ? OFFSET ?`);
        insertBatches(`SELECT COUNT(*) AS count FROM topology_time_rebuild_entries e JOIN topology_time_rebuild_active_neurons n ON n.generation=e.generation AND n.neuron_id=e.neuron_id AND n.project_id=e.project_id WHERE e.generation=?`, `INSERT OR IGNORE INTO topology_membership(neuron_id,project_id,dimension_type,dimension_key,title,created_at) SELECT e.neuron_id,e.project_id,'time_bucket',e.bucket_id,b.label,e.created_at FROM topology_time_rebuild_entries e JOIN topology_time_rebuild_buckets b ON b.generation=e.generation AND b.bucket_id=e.bucket_id JOIN topology_time_rebuild_active_neurons n ON n.generation=e.generation AND n.neuron_id=e.neuron_id AND n.project_id=e.project_id WHERE e.generation=? ORDER BY e.bucket_id,e.neuron_id LIMIT ? OFFSET ?`);
        insertBatches(`SELECT COUNT(*) AS count FROM topology_time_rebuild_cognitive_nodes WHERE generation=?`, `INSERT OR IGNORE INTO cognitive_nodes(node_id,node_type,node_key,title,project_id,source_neuron_id,metadata_json,created_at,updated_at) SELECT node_id,node_type,node_key,title,project_id,source_neuron_id,metadata_json,created_at,updated_at FROM topology_time_rebuild_cognitive_nodes WHERE generation=? ORDER BY node_id LIMIT ? OFFSET ?`);
        insertBatches(`SELECT COUNT(*) AS count FROM topology_time_rebuild_cognitive_edges WHERE generation=?`, `INSERT OR REPLACE INTO cognitive_edges(edge_id,source_node_id,target_node_id,edge_type,weight,project_id,metadata_json,created_at) SELECT edge_id,source_node_id,target_node_id,edge_type,weight,project_id,metadata_json,created_at FROM topology_time_rebuild_cognitive_edges WHERE generation=? ORDER BY edge_id LIMIT ? OFFSET ?`);
        insertBatches(`SELECT COUNT(*) AS count FROM topology_time_rebuild_adjacency WHERE generation=?`, `INSERT OR IGNORE INTO temporal_adjacency(project_id,time_zone,source_bucket_id,adjacent_bucket_id,bucket_type,weight,created_at) SELECT project_id,time_zone,source_bucket_id,adjacent_bucket_id,bucket_type,weight,created_at FROM topology_time_rebuild_adjacency WHERE generation=? ORDER BY source_bucket_id,adjacent_bucket_id LIMIT ? OFFSET ?`);
    }
    stageTimeProjectionGraph(generation, projectId, timeZone, createdAt) {
        const db = this.factStore.getDatabase();
        const insertNode = db.prepare(`INSERT INTO topology_time_rebuild_cognitive_nodes(generation,node_id,node_type,node_key,title,project_id,source_neuron_id,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(generation,node_id) DO UPDATE SET title=excluded.title,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`);
        const insertEdge = db.prepare(`INSERT OR IGNORE INTO topology_time_rebuild_cognitive_edges(generation,edge_id,source_node_id,target_node_id,edge_type,weight,project_id,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`);
        const insertAdjacent = db.prepare(`INSERT OR IGNORE INTO topology_time_rebuild_adjacency(generation,project_id,time_zone,source_bucket_id,adjacent_bucket_id,bucket_type,weight,created_at) VALUES(?,?,?,?,?,?,?,?)`);
        db.transaction(() => {
            db.prepare(`DELETE FROM topology_time_rebuild_cognitive_edges WHERE generation=?`).run(generation);
            db.prepare(`DELETE FROM topology_time_rebuild_cognitive_nodes WHERE generation=?`).run(generation);
            db.prepare(`DELETE FROM topology_time_rebuild_adjacency WHERE generation=?`).run(generation);
        })();
        let neuronCursor = '';
        for (;;) {
            const neurons = db.prepare(`
        SELECT neuron_id,title,created_at
        FROM topology_time_rebuild_active_neurons
        WHERE generation=? AND neuron_id>?
        ORDER BY neuron_id
        LIMIT 500
      `).all(generation, neuronCursor);
            if (neurons.length === 0)
                break;
            db.transaction(() => {
                for (const neuron of neurons) {
                    const key = `neuron:${neuron.neuron_id}`;
                    const nodeId = cognitiveNodeId(projectId || undefined, 'neuron', key);
                    insertNode.run(generation, nodeId, 'neuron', key, neuron.title, projectId, neuron.neuron_id, JSON.stringify({ status: 'active' }), neuron.created_at, neuron.created_at);
                }
            })();
            neuronCursor = neurons[neurons.length - 1].neuron_id;
        }
        let bucketCursor;
        const previousByType = new Map();
        for (;;) {
            const buckets = bucketCursor
                ? db.prepare(`
            SELECT bucket_id,bucket_type,bucket_start,bucket_end,label
            FROM topology_time_rebuild_buckets
            WHERE generation=? AND (
              bucket_type>? OR (bucket_type=? AND bucket_start>?) OR (bucket_type=? AND bucket_start=? AND bucket_id>?)
            )
            ORDER BY bucket_type,bucket_start,bucket_id
            LIMIT 500
          `).all(generation, bucketCursor.type, bucketCursor.type, bucketCursor.start, bucketCursor.type, bucketCursor.start, bucketCursor.id)
                : db.prepare(`
            SELECT bucket_id,bucket_type,bucket_start,bucket_end,label
            FROM topology_time_rebuild_buckets
            WHERE generation=?
            ORDER BY bucket_type,bucket_start,bucket_id
            LIMIT 500
          `).all(generation);
            const page = buckets;
            if (page.length === 0)
                break;
            db.transaction(() => {
                for (const bucket of page) {
                    const key = `time_bucket:${bucket.bucket_id}`;
                    const nodeId = cognitiveNodeId(projectId || undefined, 'time_bucket', key);
                    insertNode.run(generation, nodeId, 'time_bucket', key, bucket.label, projectId, null, JSON.stringify({ bucketType: bucket.bucket_type, timeZone }), bucket.bucket_start, createdAt);
                    const previous = previousByType.get(bucket.bucket_type);
                    if (previous) {
                        insertAdjacent.run(generation, projectId, timeZone, previous.bucket_id, bucket.bucket_id, bucket.bucket_type, 0.72, createdAt);
                        insertAdjacent.run(generation, projectId, timeZone, bucket.bucket_id, previous.bucket_id, bucket.bucket_type, 0.72, createdAt);
                    }
                    previousByType.set(bucket.bucket_type, bucket);
                }
            })();
            const last = page[page.length - 1];
            bucketCursor = { type: last.bucket_type, start: last.bucket_start, id: last.bucket_id };
        }
        let entryCursor = 0;
        for (;;) {
            const entries = db.prepare(`
        SELECT rowid,bucket_id,neuron_id,created_at
        FROM topology_time_rebuild_entries
        WHERE generation=? AND rowid>?
        ORDER BY rowid
        LIMIT 500
      `).all(generation, entryCursor);
            if (entries.length === 0)
                break;
            db.transaction(() => {
                for (const entry of entries) {
                    const sourceNodeId = cognitiveNodeId(projectId || undefined, 'neuron', `neuron:${entry.neuron_id}`);
                    const targetNodeId = cognitiveNodeId(projectId || undefined, 'time_bucket', `time_bucket:${entry.bucket_id}`);
                    insertEdge.run(generation, cognitiveEdgeId({ projectId: projectId || undefined, sourceNodeId, targetNodeId, edgeType: 'occurred_in_time_bucket' }), sourceNodeId, targetNodeId, 'occurred_in_time_bucket', 1, projectId, null, entry.created_at);
                }
            })();
            entryCursor = entries[entries.length - 1].rowid;
        }
    }
    recordRawEvent(input) {
        const text = this.piiRedactor ? this.piiRedactor.redact(input.content).text : input.content;
        const occurredAt = input.occurredAt ?? Date.now();
        return this.eventStore.append({
            eventId: input.eventId,
            streamId: input.threadId,
            streamType: 'thread',
            eventType: 'RAW_EVENT_RECORDED',
            rawEventType: input.rawEventType ?? 'message',
            projectId: input.projectId,
            workspaceId: input.workspaceId,
            actorId: input.role,
            sourceId: input.sourceId,
            contentHash: createHash('sha256').update(text).digest('hex'),
            threadId: input.threadId,
            sessionId: input.sessionId,
            localDate: input.localDate,
            localDateSource: input.localDateSource,
            timeZone: input.timeZone ?? input.projectTimeZone,
            projectTimeZone: this.projectClock.timeZone,
            turnId: input.turnId,
            turnSeq: input.turnSeq,
            eventOrdinal: input.eventOrdinal,
            role: input.role,
            parentEventId: input.parentEventId,
            prevEventId: input.prevEventId,
            causalityType: input.causalityType,
            sourceOffset: input.sourceOffset,
            lineStart: input.lineStart,
            lineEnd: input.lineEnd,
            charStart: input.charStart,
            charEnd: input.charEnd,
            occurredAt,
            orderingConfidence: input.orderingConfidence
                ?? (input.turnSeq !== undefined || input.eventOrdinal !== undefined || input.sourceOffset !== undefined || input.lineStart !== undefined ? 'high' : 'low'),
            payload: {
                text,
                metadata: input.metadata,
            },
        });
    }
    recordToolCall(input) {
        const text = input.content ?? `Tool call ${input.toolName}: ${stringifyToolPayload(input.input)}`;
        const event = this.recordRawEvent({
            projectId: input.projectId,
            workspaceId: input.workspaceId,
            threadId: input.threadId,
            sessionId: input.sessionId,
            turnId: input.turnId,
            turnSeq: input.turnSeq,
            role: 'assistant',
            rawEventType: 'tool_call',
            content: text,
            eventOrdinal: input.eventOrdinal,
            occurredAt: input.occurredAt,
            parentEventId: input.assistantEventId,
            prevEventId: input.assistantEventId,
            causalityType: input.assistantEventId ? 'triggered_by' : undefined,
            sourceId: input.sourceId,
            metadata: {
                ...input.metadata,
                toolCallId: input.toolCallId,
                toolName: input.toolName,
                input: input.input,
            },
        });
        if (input.assistantEventId) {
            this.eventStore.updateNextEventId(input.assistantEventId, event.eventId);
        }
        return {
            ...event,
            payload: {
                text: event.payload.text,
                toolCallId: input.toolCallId,
                toolName: input.toolName,
                input: input.input,
                metadata: event.payload.metadata,
            },
        };
    }
    recordToolResult(input) {
        const event = this.recordRawEvent({
            projectId: input.projectId,
            workspaceId: input.workspaceId,
            threadId: input.threadId,
            sessionId: input.sessionId,
            turnId: input.turnId,
            turnSeq: input.turnSeq,
            role: 'tool',
            rawEventType: 'tool_result',
            content: input.output,
            eventOrdinal: input.eventOrdinal,
            occurredAt: input.occurredAt,
            parentEventId: input.toolCallEventId,
            prevEventId: input.toolCallEventId,
            causalityType: 'tool_result_for',
            sourceId: input.sourceId,
            metadata: {
                ...input.metadata,
                toolCallId: input.toolCallId,
                toolName: input.toolName,
            },
        });
        this.eventStore.updateNextEventId(input.toolCallEventId, event.eventId);
        return {
            ...event,
            payload: {
                text: event.payload.text,
                toolCallId: input.toolCallId,
                toolName: input.toolName,
                output: event.payload.text,
                metadata: event.payload.metadata,
            },
        };
    }
    recordTaskEvent(input) {
        const event = this.recordRawEvent({
            projectId: input.projectId,
            workspaceId: input.workspaceId,
            threadId: input.threadId,
            sessionId: input.sessionId,
            turnId: input.turnId,
            turnSeq: input.turnSeq,
            role: input.role ?? 'system',
            rawEventType: input.rawEventType ?? 'task_event',
            content: input.content,
            eventOrdinal: input.eventOrdinal,
            occurredAt: input.occurredAt,
            parentEventId: input.parentEventId,
            prevEventId: input.parentEventId,
            causalityType: input.parentEventId ? 'triggered_by' : undefined,
            sourceId: input.sourceId,
            metadata: {
                ...input.metadata,
                taskId: input.taskId,
                title: input.title,
            },
        });
        return {
            ...event,
            payload: {
                text: event.payload.text,
                taskId: input.taskId,
                title: input.title,
                metadata: event.payload.metadata,
            },
        };
    }
    async consolidate(options = {}) {
        const endTime = options.endTime ?? Date.now() + 1;
        const startTime = options.startTime ?? 0;
        const rawEpisodes = this.memoryGraph.listNeuronsByTimeRange(startTime, endTime, options.projectId);
        const provisionalFacts = this.factStore.listFactsByTimeRange(startTime, endTime, {
            statuses: ['provisional', 'provisional_enriched', 'enriched_candidate', 'verified'],
        });
        const provisionalEvents = this.factStore.listEventsByTimeRange(startTime, endTime, {
            statuses: ['provisional', 'verified'],
        });
        const interactionUnits = this.interactionUnitStore.listUnitsByNeuronIds(rawEpisodes.map((episode) => episode.id));
        const provisionalEntities = this.entityStore.listEntitiesUpdatedInRange(startTime, endTime);
        const unresolvedReferences = this.entityStore
            .listPendingResolutions()
            .filter((item) => item.updatedAt >= startTime && item.updatedAt < endTime);
        const lowConfidenceItems = [
            ...provisionalFacts
                .filter((fact) => fact.confidence < 0.75 || fact.status === 'enriched_candidate')
                .map((fact) => ({
                source: 'compiler',
                targetType: 'fact',
                targetId: fact.factId,
                confidence: fact.confidence,
                reason: fact.status === 'enriched_candidate'
                    ? 'enriched_candidate_pending_verification'
                    : 'low_confidence_provisional_fact',
            })),
            ...provisionalEvents
                .filter((event) => event.confidence < 0.75)
                .map((event) => ({
                source: 'compiler',
                targetType: 'event',
                targetId: event.eventId,
                confidence: event.confidence,
                reason: 'low_confidence_provisional_event',
            })),
            ...unresolvedReferences.map((reference) => ({
                source: 'entity_binding',
                targetType: 'reference',
                targetId: reference.pendingId,
                reason: 'pending_reference_unresolved',
            })),
        ];
        const recentBeliefs = this.beliefStore.listByTimeRange(startTime, endTime, {
            projectId: options.projectId,
        });
        return this.offlineConsolidationPipeline.run({
            rawEpisodes,
            interactionUnits,
            provisionalFacts,
            provisionalEvents,
            provisionalEntities,
            unresolvedReferences,
            lowConfidenceItems,
            recentBeliefs,
            window: {
                projectId: options.projectId,
                startTime,
                endTime,
            },
        });
    }
    getThreadEvents(threadId, options = {}) {
        return this.eventStore.getThreadEvents(threadId, options);
    }
    getEventContext(eventId, options = {}) {
        return this.eventStore.getEventContext(eventId, options);
    }
    searchRawEvents(query, options = {}) {
        return this.eventStore.searchRawEvents(query, options);
    }
    getDreamBacklogStatus(projectId) {
        return this.dreamLedgerStore.getStatus(projectId);
    }
    markDreamed(projectId, globalSeq, dreamedAt) {
        return this.dreamLedgerStore.markDreamed(projectId, globalSeq, dreamedAt);
    }
    async runDreamCurator(options = {}) {
        return this.dreamCuratorWorker.run(options);
    }
    async runDreamTick(options = {}) {
        return this.dreamScheduler.tick(options);
    }
    assembleEpisodeTurn(events, input) {
        return this.episodeAssembler.appendTurn(events, input);
    }
    assembleEpisodeTurnAsync(events, input) {
        return this.episodeAssembler.appendTurnAsync(events, input);
    }
    appendRawEventToEpisode(event, input) {
        return this.episodeAssembler.appendEvent(event, input);
    }
    appendEpisodeMessage(input) {
        let reservedEventId;
        if (input.externalMessageId) {
            const proposedEventId = `evt-episode-${createHash('sha256')
                .update(JSON.stringify([input.projectId, input.sourceAgent, input.sessionId, input.externalMessageId]))
                .digest('hex')}`;
            this.episodeStore.recordIngestKey({
                projectId: input.projectId,
                sourceAgent: input.sourceAgent,
                sourceSessionId: input.sessionId,
                externalMessageId: input.externalMessageId,
                eventId: proposedEventId,
                now: input.timestamp,
            });
            reservedEventId = this.episodeStore.getIngestedEvent(input.projectId, input.sourceAgent, input.sessionId, input.externalMessageId);
            const existingEvent = reservedEventId ? this.eventStore.getEvent(reservedEventId) : null;
            if (existingEvent) {
                this.assertEpisodeIngestIdentity(existingEvent, input);
                return this.finishIngestMessage(existingEvent, input, false, () => this.resumeEpisodeMessage(existingEvent, input, false));
            }
        }
        let event;
        try {
            event = this.recordRawEvent({
                eventId: reservedEventId,
                projectId: input.projectId,
                workspaceId: input.projectId,
                threadId: input.threadId || input.sessionId,
                sessionId: input.sessionId,
                turnId: input.turnId,
                turnSeq: input.turnSeq,
                localDate: input.localDate,
                eventOrdinal: input.eventOrdinal,
                role: input.role,
                content: input.text,
                occurredAt: input.timestamp,
                sourceId: `${input.sourceAgent}:${input.sessionId}`,
                metadata: { ...input.metadata, externalMessageId: input.externalMessageId, sourceAgent: input.sourceAgent },
            });
        }
        catch (error) {
            const concurrent = reservedEventId ? this.eventStore.getEvent(reservedEventId) : null;
            if (!concurrent) {
                if (input.externalMessageId)
                    this.episodeStore.markIngestState({
                        projectId: input.projectId, sourceAgent: input.sourceAgent, sourceSessionId: input.sessionId,
                        externalMessageId: input.externalMessageId, state: 'failed', error: error instanceof Error ? error.message : String(error),
                    });
                throw error;
            }
            this.assertEpisodeIngestIdentity(concurrent, input);
            return this.finishIngestMessage(concurrent, input, false, () => this.resumeEpisodeMessage(concurrent, input, false));
        }
        return this.finishIngestMessage(event, input, true, () => this.resumeEpisodeMessage(event, input, true));
    }
    async appendEpisodeMessageAsync(input) {
        let reservedEventId;
        if (input.externalMessageId) {
            const proposedEventId = `evt-episode-${createHash('sha256')
                .update(JSON.stringify([input.projectId, input.sourceAgent, input.sessionId, input.externalMessageId]))
                .digest('hex')}`;
            this.episodeStore.recordIngestKey({
                projectId: input.projectId, sourceAgent: input.sourceAgent, sourceSessionId: input.sessionId,
                externalMessageId: input.externalMessageId, eventId: proposedEventId, now: input.timestamp,
            });
            reservedEventId = this.episodeStore.getIngestedEvent(input.projectId, input.sourceAgent, input.sessionId, input.externalMessageId);
            const existingEvent = reservedEventId ? this.eventStore.getEvent(reservedEventId) : null;
            if (existingEvent) {
                this.assertEpisodeIngestIdentity(existingEvent, input);
                return this.finishIngestMessageAsync(existingEvent, input, false, () => this.resumeEpisodeMessageAsync(existingEvent, input, false));
            }
        }
        let event;
        try {
            event = this.recordRawEvent({
                eventId: reservedEventId, projectId: input.projectId, workspaceId: input.projectId,
                threadId: input.threadId || input.sessionId, sessionId: input.sessionId, role: input.role,
                turnId: input.turnId, turnSeq: input.turnSeq, localDate: input.localDate, eventOrdinal: input.eventOrdinal,
                content: input.text, occurredAt: input.timestamp, sourceId: `${input.sourceAgent}:${input.sessionId}`,
                metadata: { ...input.metadata, externalMessageId: input.externalMessageId, sourceAgent: input.sourceAgent },
            });
        }
        catch (error) {
            const concurrent = reservedEventId ? this.eventStore.getEvent(reservedEventId) : null;
            if (!concurrent) {
                if (input.externalMessageId)
                    this.episodeStore.markIngestState({
                        projectId: input.projectId, sourceAgent: input.sourceAgent, sourceSessionId: input.sessionId,
                        externalMessageId: input.externalMessageId, state: 'failed', error: error instanceof Error ? error.message : String(error),
                    });
                throw error;
            }
            this.assertEpisodeIngestIdentity(concurrent, input);
            return this.finishIngestMessageAsync(concurrent, input, false, () => this.resumeEpisodeMessageAsync(concurrent, input, false));
        }
        return this.finishIngestMessageAsync(event, input, true, () => this.resumeEpisodeMessageAsync(event, input, true));
    }
    finishIngestMessage(event, input, created, operation) {
        try {
            const result = operation();
            if (input.externalMessageId)
                this.episodeStore.markIngestState({
                    projectId: input.projectId, sourceAgent: input.sourceAgent, sourceSessionId: input.sessionId,
                    externalMessageId: input.externalMessageId, state: 'committed', now: event.occurredAt,
                });
            return result;
        }
        catch (error) {
            if (input.externalMessageId)
                this.episodeStore.markIngestState({
                    projectId: input.projectId, sourceAgent: input.sourceAgent, sourceSessionId: input.sessionId,
                    externalMessageId: input.externalMessageId, state: 'failed', error: error instanceof Error ? error.message : String(error), now: event.occurredAt,
                });
            throw error;
        }
    }
    async finishIngestMessageAsync(event, input, created, operation) {
        try {
            const result = await operation();
            if (input.externalMessageId)
                this.episodeStore.markIngestState({
                    projectId: input.projectId, sourceAgent: input.sourceAgent, sourceSessionId: input.sessionId,
                    externalMessageId: input.externalMessageId, state: 'committed', now: event.occurredAt,
                });
            return result;
        }
        catch (error) {
            if (input.externalMessageId)
                this.episodeStore.markIngestState({
                    projectId: input.projectId, sourceAgent: input.sourceAgent, sourceSessionId: input.sessionId,
                    externalMessageId: input.externalMessageId, state: 'failed', error: error instanceof Error ? error.message : String(error), now: event.occurredAt,
                });
            throw error;
        }
    }
    resumeEpisodeMessage(event, input, created) {
        let link = this.episodeStore.getEventLink(event.eventId);
        let ignored = this.episodeStore.hasEventDisposition(event.eventId);
        let assembly;
        if (!link && !ignored) {
            assembly = this.assembleEpisodeTurn([event], {
                projectId: input.projectId,
                sessionId: event.sessionId || input.sessionId,
                sourceAgent: input.sourceAgent,
                conversationThreadId: input.threadId || event.threadId || input.sessionId,
                now: event.occurredAt,
            });
            link = this.episodeStore.getEventLink(event.eventId);
            ignored = assembly.ignoredEventIds.includes(event.eventId);
        }
        const episode = link ? this.episodeStore.getEpisode(link.episodeId) : undefined;
        const receipt = episode?.status === 'sealed'
            ? this.episodeStore.listClosureReceipts({ episodeId: episode.episodeId, limit: 1 })[0]
            : undefined;
        return {
            created,
            eventId: event.eventId,
            episodeId: episode?.episodeId,
            assigned: Boolean(link),
            ignored,
            sealed: episode?.status === 'sealed',
            dreamRecommended: Boolean(receipt?.dreamRecommended && !receipt.requiresReview && episode?.dreamStatus !== 'processed'),
            dreamRan: false,
            boundaryTriggered: assembly?.boundaryTriggered,
            boundaryDetected: assembly?.boundaryDetected,
            boundaryApplied: assembly?.boundaryApplied,
            boundaryMode: assembly?.boundaryMode,
            boundaryDecisionId: assembly?.boundaryDecisionId,
            boundaryGuardCodes: assembly?.boundaryGuardCodes,
            boundaryAuditRecorded: assembly?.boundaryAuditRecorded,
            boundaryAuditStatus: assembly?.boundaryAuditStatus,
            previousEpisodeId: assembly?.previousEpisodeId,
            reviewerRawResultStatus: assembly?.reviewerRawResultStatus,
            warnings: assembly?.warnings,
        };
    }
    async resumeEpisodeMessageAsync(event, input, created) {
        let link = this.episodeStore.getEventLink(event.eventId);
        let ignored = this.episodeStore.hasEventDisposition(event.eventId);
        let assembly;
        if (!link && !ignored) {
            assembly = await this.assembleEpisodeTurnAsync([event], {
                projectId: input.projectId, sessionId: event.sessionId || input.sessionId, sourceAgent: input.sourceAgent,
                conversationThreadId: input.threadId || event.threadId || input.sessionId, now: event.occurredAt,
            });
            link = this.episodeStore.getEventLink(event.eventId);
            ignored = assembly.ignoredEventIds.includes(event.eventId);
        }
        const episode = link ? this.episodeStore.getEpisode(link.episodeId) : undefined;
        const receipt = episode?.status === 'sealed'
            ? this.episodeStore.listClosureReceipts({ episodeId: episode.episodeId, limit: 1 })[0]
            : undefined;
        return {
            created, eventId: event.eventId, episodeId: episode?.episodeId, assigned: Boolean(link), ignored,
            sealed: episode?.status === 'sealed',
            dreamRecommended: Boolean(receipt?.dreamRecommended && !receipt.requiresReview && episode?.dreamStatus !== 'processed'),
            dreamRan: false,
            boundaryTriggered: assembly?.boundaryTriggered,
            boundaryDetected: assembly?.boundaryDetected,
            boundaryApplied: assembly?.boundaryApplied,
            boundaryMode: assembly?.boundaryMode,
            boundaryDecisionId: assembly?.boundaryDecisionId,
            boundaryGuardCodes: assembly?.boundaryGuardCodes,
            boundaryAuditRecorded: assembly?.boundaryAuditRecorded,
            boundaryAuditStatus: assembly?.boundaryAuditStatus,
            previousEpisodeId: assembly?.previousEpisodeId,
            reviewerRawResultStatus: assembly?.reviewerRawResultStatus,
            warnings: assembly?.warnings,
        };
    }
    assertEpisodeIngestIdentity(event, input) {
        const payload = event.payload;
        const expectedText = this.piiRedactor ? this.piiRedactor.redact(input.text).text : input.text;
        if (event.projectId !== input.projectId
            || event.sessionId !== input.sessionId
            || event.threadId !== (input.threadId || input.sessionId)
            || event.role !== input.role
            || !sameProvided(event.turnId, input.turnId)
            || !sameProvided(event.turnSeq, input.turnSeq)
            || !sameProvided(event.localDate, input.localDate)
            || !sameProvided(event.eventOrdinal, input.eventOrdinal)
            || (input.timestamp !== undefined && event.occurredAt !== input.timestamp)
            || (input.metadata?.imported !== undefined && payload?.metadata?.imported !== input.metadata.imported)
            || (input.metadata?.sourceRef !== undefined && JSON.stringify(payload?.metadata?.sourceRef) !== JSON.stringify(input.metadata.sourceRef))
            || payload?.text !== expectedText
            || payload?.metadata?.sourceAgent !== input.sourceAgent) {
            throw new Error(`episode_ingest_identity_conflict:${input.externalMessageId || event.eventId}`);
        }
    }
    listEpisodes(options = {}) {
        return this.episodeStore.listEpisodes(options);
    }
    getEpisode(episodeId) {
        return this.episodeStore.getEpisode(episodeId);
    }
    sealEpisode(episodeId, input) {
        return this.episodeStore.sealEpisode(episodeId, input);
    }
    sealImportedEpisode(episodeId, input) {
        const links = this.episodeStore.listEventLinks(episodeId);
        if (!links.length)
            throw new Error(`episode_empty:${episodeId}`);
        const averageConfidence = links.length
            ? links.reduce((total, link) => total + link.confidence, 0) / links.length
            : 0;
        const requiresReview = input.force !== true && averageConfidence < 0.6;
        return this.episodeStore.sealEpisode(episodeId, {
            mode: requiresReview ? 'soft' : 'batch',
            reason: requiresReview ? 'batch_low_confidence_review' : input.reason,
            reasonCode: 'batch_boundary',
            requiresReview,
            now: input.now,
        });
    }
    sealIdleEpisodes(input) {
        return this.episodeStore.sealIdleEpisodes(input);
    }
    listEpisodeClosureReceipts(options = {}) {
        return this.episodeStore.listClosureReceipts(options);
    }
    listEpisodeEventLinks(episodeId) {
        return this.episodeStore.listEventLinks(episodeId);
    }
    auditEpisodeBoundaries(options) {
        return this.episodeBoundaryAuditService.audit(options);
    }
    listEpisodeBoundaryDecisions(options) {
        if (!options.projectId)
            throw new Error('projectId is required');
        return this.episodeStore.listBoundaryDecisions(options);
    }
    planEpisodeSplit(options) {
        return this.episodeSplitPlanner.plan(options);
    }
    getEpisodeDreamStatus(projectId) {
        return this.episodeStore.getDreamStatus(projectId);
    }
    retryFailedEpisodeDreams(projectId) {
        return this.episodeStore.retryFailed(projectId);
    }
    repairEpisodes(options = {}) {
        const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 500), 5000));
        let afterGlobalSeq = options.sinceGlobalSeq === undefined ? undefined : options.sinceGlobalSeq - 1;
        const events = [];
        while (events.length < limit) {
            const page = this.eventStore.listRawEventsAfterGlobalSeq({ projectId: options.projectId, afterGlobalSeq, limit: Math.min(500, limit - events.length) });
            if (!page.length)
                break;
            events.push(...page);
            afterGlobalSeq = page.at(-1)?.globalSeq ?? afterGlobalSeq;
            if (page.length < Math.min(500, limit - events.length + page.length))
                break;
        }
        const eligibleEvents = events
            .filter((event) => !this.episodeStore.getEventLink(event.eventId))
            .filter((event) => !this.episodeStore.hasEventDisposition(event.eventId));
        let assigned = 0;
        const unassignedEventIds = [];
        for (const event of eligibleEvents) {
            const projectId = event.projectId || options.projectId;
            const sessionId = event.sessionId || event.threadId;
            if (!projectId || !sessionId) {
                unassignedEventIds.push(event.eventId);
                continue;
            }
            try {
                const metadata = event.payload?.metadata;
                const sourceAgent = typeof metadata?.sourceAgent === 'string' ? metadata.sourceAgent : undefined;
                const result = this.assembleEpisodeTurn([event], {
                    projectId, sessionId, sourceAgent, now: event.occurredAt,
                });
                if (result.assignedEventIds.includes(event.eventId))
                    assigned += 1;
                else
                    unassignedEventIds.push(event.eventId);
            }
            catch (error) {
                unassignedEventIds.push(event.eventId);
                this.pipelineMetrics.recordNonFatal('episode_repair_failed', {
                    projectId, message: error instanceof Error ? error.message : String(error), details: { eventId: event.eventId },
                });
            }
        }
        return { scanned: eligibleEvents.length, assigned, unassigned: unassignedEventIds.length, unassignedEventIds, nextGlobalSeq: afterGlobalSeq, hasMore: events.length >= limit };
    }
    repairEpisode(input) {
        validateEpisodeRepairInput(input, this.episodeStore, (eventId) => this.eventStore.getEvent(eventId) ?? undefined);
        return this.episodeStore.transaction(() => this.repairEpisodeInTransaction(input));
    }
    repairEpisodeInTransaction(input) {
        const now = input.now ?? Date.now();
        const affected = new Set();
        const before = {};
        const previousStatuses = new Map();
        let requeuedDream = input.operation === 'requeue-dream' || input.operation === 'invalidate-dream-run';
        if (input.operation === 'move-event') {
            const link = this.episodeStore.getEventLink(input.eventId);
            const source = link ? this.episodeStore.getEpisode(link.episodeId) : undefined;
            const target = this.episodeStore.getEpisode(input.targetEpisodeId);
            if (!source || !target || source.projectId !== input.projectId || target.projectId !== input.projectId) {
                throw new Error('episode_project_mismatch');
            }
            before[source.episodeId] = source;
            before[target.episodeId] = target;
            previousStatuses.set(source.episodeId, source.status);
            previousStatuses.set(target.episodeId, target.status);
        }
        if ('episodeId' in input) {
            const episode = this.episodeStore.getEpisode(input.episodeId);
            if (!episode || episode.projectId !== input.projectId)
                throw new Error(`episode_project_mismatch:${input.episodeId}`);
            before[input.episodeId] = episode;
            previousStatuses.set(input.episodeId, episode.status);
        }
        if ('sourceEpisodeId' in input) {
            const source = this.episodeStore.getEpisode(input.sourceEpisodeId);
            const target = this.episodeStore.getEpisode(input.targetEpisodeId);
            if (!source || !target || source.projectId !== input.projectId || target.projectId !== input.projectId)
                throw new Error('episode_project_mismatch');
            before[input.sourceEpisodeId] = source;
            before[input.targetEpisodeId] = target;
            previousStatuses.set(input.sourceEpisodeId, source.status);
            previousStatuses.set(input.targetEpisodeId, target.status);
        }
        if (input.operation === 'move-event') {
            const moved = this.episodeStore.moveEventForRepair(input.eventId, input.targetEpisodeId, now);
            affected.add(moved.sourceEpisodeId);
            affected.add(moved.targetEpisodeId);
        }
        else if (input.operation === 'reclassify') {
            this.episodeStore.reclassifyForRepair(input.episodeId, input);
            affected.add(input.episodeId);
        }
        else if (input.operation === 'requeue-dream' || input.operation === 'invalidate-dream-run') {
            this.episodeStore.requeueDreamForRepair(input.episodeId, input.mode || 'normal', now);
            affected.add(input.episodeId);
        }
        else if (input.operation === 'split') {
            const source = this.episodeStore.getEpisode(input.episodeId);
            if (source.status !== 'sealed')
                throw new Error('episode_split_requires_sealed_source');
            const sourceLinks = this.episodeStore.listEventLinks(input.episodeId);
            const selected = sourceLinks.filter((link) => input.eventIds.includes(link.eventId));
            if (!selected.length || selected.length === sourceLinks.length)
                throw new Error('episode_split_requires_proper_subset');
            const firstEvent = this.eventStore.getEvent(selected[0].eventId);
            if (!firstEvent)
                throw new Error(`event_not_found:${selected[0].eventId}`);
            const created = this.episodeStore.createEpisode({
                projectId: source.projectId, sessionId: source.sessionId, sourceAgent: source.sourceAgent,
                conversationThreadId: source.conversationThreadId, topicPath: source.topicPath, episodeType: source.episodeType,
                importance: source.importance, eventId: firstEvent.eventId, globalSeq: firstEvent.globalSeq,
                occurredAt: firstEvent.occurredAt, episodeTags: source.episodeTags,
                candidateTypes: source.candidateTypes, importanceSignals: source.importanceSignals, importanceReason: 'repair_split',
                linkedEpisodeId: source.episodeId,
            });
            previousStatuses.set(created.episodeId, source.status);
            for (const link of selected)
                this.episodeStore.moveEventForRepair(link.eventId, created.episodeId, now);
            this.episodeStore.addCrossReference({ projectId: source.projectId, episodeId: created.episodeId,
                referencedEpisodeId: source.episodeId, relation: 'SPLIT_FROM', createdBy: 'repair', now });
            affected.add(source.episodeId);
            affected.add(created.episodeId);
        }
        else if (input.operation === 'merge') {
            for (const link of this.episodeStore.listEventLinks(input.sourceEpisodeId)) {
                this.episodeStore.moveEventForRepair(link.eventId, input.targetEpisodeId, now);
            }
            this.episodeStore.addCrossReference({ projectId: input.projectId, episodeId: input.targetEpisodeId,
                referencedEpisodeId: input.sourceEpisodeId, relation: 'MERGED_FROM', createdBy: 'repair', now });
            affected.add(input.sourceEpisodeId);
            affected.add(input.targetEpisodeId);
        }
        if (['move-event', 'split', 'merge', 'reclassify'].includes(input.operation)) {
            this.memoryFrameStore.supersedeEpisodes([...affected], now);
            for (const episodeId of affected) {
                const episode = this.episodeStore.getEpisode(episodeId);
                if (!episode)
                    continue;
                const previousStatus = previousStatuses.get(episodeId) || 'open';
                if (episode.eventCount === 0) {
                    this.episodeStore.sealEpisode(episodeId, {
                        mode: 'soft', reason: 'episode_repair_recomputed_empty', reasonCode: 'repair', requiresReview: true, now,
                    });
                }
                else if (previousStatus === 'sealed') {
                    this.episodeStore.sealEpisode(episodeId, {
                        mode: 'manual', reason: 'episode_repair_recomputed', reasonCode: 'repair', now,
                    });
                }
                else if (previousStatus === 'soft_sealed') {
                    this.episodeStore.sealEpisode(episodeId, {
                        mode: 'soft', reason: 'episode_repair_recomputed', reasonCode: 'repair', requiresReview: true, now,
                    });
                }
            }
        }
        const staleCandidateIds = [];
        let candidateCursor;
        while (true) {
            const page = this.deepWriteCandidateStore.listCandidates({ projectId: input.projectId, limit: 500, after: candidateCursor });
            if (!page.length)
                break;
            for (const candidate of page) {
                const content = candidate.content && typeof candidate.content === 'object' ? candidate.content : {};
                const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
                const evidenceIds = evidence.flatMap((item) => item && typeof item === 'object' && typeof item.eventId === 'string'
                    ? [String(item.eventId)] : typeof item === 'string' ? [item] : []);
                const runSourceEpisode = typeof content.sourceEpisodeId === 'string' ? content.sourceEpisodeId : undefined;
                if (candidate.status !== 'superseded' && ((runSourceEpisode && affected.has(runSourceEpisode))
                    || evidenceIds.some((eventId) => affected.has(this.episodeStore.getEventLink(eventId)?.episodeId || '')))) {
                    this.deepWriteCandidateStore.updateCandidateStatus(candidate.candidateId, 'superseded', {
                        reason: 'episode_repair_invalidated_source',
                    });
                    this.invalidatePromotedCandidate(candidate, now);
                    staleCandidateIds.push(candidate.candidateId);
                }
            }
            const last = page.at(-1);
            candidateCursor = { createdAt: last.createdAt, candidateId: last.candidateId };
            if (page.length < 500)
                break;
        }
        for (const episodeId of affected) {
            const episode = this.episodeStore.getEpisode(episodeId);
            if (episode?.eventCount && episode.status === 'sealed'
                && input.operation !== 'requeue-dream'
                && input.operation !== 'invalidate-dream-run') {
                this.episodeStore.requeueDreamForRepair(episodeId, 'normal', now);
                requeuedDream = true;
            }
        }
        const after = Object.fromEntries([...affected].map((episodeId) => [episodeId, this.episodeStore.getEpisode(episodeId)]));
        const repairId = this.episodeStore.recordRepairAudit({ projectId: input.projectId, operation: input.operation, payload: input, before, after, now });
        const affectedEpisodeIds = [...affected];
        const nextCommands = affectedEpisodeIds.length
            ? affectedEpisodeIds.map((episodeId) => `cogmem memory graph-reindex --project ${shellQuote(input.projectId)} --episode ${shellQuote(episodeId)} --json`)
            : [];
        return {
            repairId,
            applied: true,
            operation: input.operation,
            affectedEpisodeIds,
            changedFields: changedFieldsForRepair(input),
            staleCandidateIds,
            requeuedDream,
            graphRefreshNeeded: affectedEpisodeIds.length > 0,
            nextCommands: [
                ...nextCommands,
                `cogmem memory graph-explore --project ${shellQuote(input.projectId)} --query '<query>' --json`,
            ],
            note: 'repairId is an audit id, not a dream candidate id; do not run memory dream --promote just because repairId exists.',
        };
    }
    invalidatePromotedCandidate(candidate, now) {
        if (candidate.status !== 'promoted' || !candidate.promotionTargetId)
            return;
        const db = this.factStore.getDatabase();
        const targetId = candidate.promotionTargetId;
        if (candidate.promotionTargetType === 'fact') {
            this.factStore.updateFactStatus(targetId, 'superseded', undefined, { repairInvalidatedAt: now, sourceCandidateId: candidate.candidateId });
        }
        else if (candidate.promotionTargetType === 'belief') {
            db.prepare(`UPDATE beliefs SET status = 'suspect', updated_at = ? WHERE id = ?`).run(now, targetId);
        }
        else if (candidate.promotionTargetType === 'summary') {
            this.summaryStore.markSuperseded(targetId);
        }
        else if (candidate.promotionTargetType === 'entity') {
            const support = db.prepare(`
        SELECT (
          (SELECT COUNT(*) FROM facts WHERE entity_id = ? AND status IN ('provisional', 'provisional_enriched', 'verified', 'active'))
          + (SELECT COUNT(*) FROM beliefs WHERE subject = ? AND status IN ('active', 'verified'))
          + (SELECT COUNT(*) FROM entity_mentions WHERE entity_id = ?)
          + (SELECT COUNT(*) FROM entity_attributes WHERE entity_id = ?)
          + (SELECT COUNT(*) FROM entity_relations WHERE source_entity_id = ? OR target_entity_id = ?)
          + ?
        ) AS count
      `).get(targetId, targetId, targetId, targetId, targetId, targetId, this.deepWriteCandidateStore.countActivePromotions('entity', targetId, candidate.candidateId));
            if (Number(support?.count || 0) === 0) {
                this.entityStore.archiveEntity(targetId, now);
            }
        }
        else if (candidate.promotionTargetType === 'graph_edge') {
            const relationStore = this.extensions.get('relationStore');
            if (!relationStore || relationStore.getDatabase() !== this.episodeStore.getDatabase()) {
                throw new Error(`graph_edge_invalidation_failed:${targetId}`);
            }
            const invalidated = relationStore.invalidateEdge(targetId, {
                repairInvalidatedAt: now,
                sourceCandidateId: candidate.candidateId,
            });
            if (invalidated !== true)
                throw new Error(`graph_edge_invalidation_failed:${targetId}`);
        }
    }
    listDreamCandidates(options = {}) {
        return this.deepWriteCandidateStore.listCandidates(options);
    }
    countDreamCandidates(options = {}) {
        return this.deepWriteCandidateStore.countCandidates(options);
    }
    reviewDreamCandidate(input) {
        return this.candidateReviewService.review(input);
    }
    listDreamCandidateReviews(options = {}) {
        return this.candidateReviewStore.list(options);
    }
    bindMemoryEvent(event) {
        return this.memoryBindingService.bindRawEvent(event);
    }
    executeMemoryGovernancePlan(plan) {
        return this.memoryGovernanceExecutor.execute(plan);
    }
    bindRawEvents(options = {}) {
        const limit = Math.max(1, Math.min(options.limit ?? 500, 5000));
        const afterGlobalSeq = options.sinceGlobalSeq === undefined
            ? undefined
            : Math.max(-1, options.sinceGlobalSeq - 1);
        const records = this.eventStore.listRawEventsAfterGlobalSeq({
            projectId: options.projectId,
            workspaceId: options.workspaceId,
            threadId: options.threadId,
            sessionId: options.sessionId,
            afterGlobalSeq,
            limit,
        });
        const result = {
            projectId: options.projectId,
            sinceGlobalSeq: options.sinceGlobalSeq,
            nextGlobalSeq: records.at(-1)?.globalSeq,
            hasMore: records.length >= limit,
            scannedEvents: records.length,
            bindableEvents: 0,
            boundEvents: 0,
            createdBindings: 0,
            skippedAlreadyBound: 0,
            failedEvents: 0,
            errors: [],
        };
        for (const event of records) {
            if (!this.memoryBindingService.isBindableRawEvent(event))
                continue;
            result.bindableEvents += 1;
            if (this.memoryBindingStore.listBindings({ eventId: event.eventId, limit: 1 }).length > 0) {
                result.skippedAlreadyBound += 1;
                continue;
            }
            try {
                const bindings = this.bindMemoryEvent(event);
                if (bindings.length > 0) {
                    result.boundEvents += 1;
                    result.createdBindings += bindings.length;
                }
            }
            catch (error) {
                result.failedEvents += 1;
                const message = error instanceof Error ? error.message : String(error);
                result.errors.push({ eventId: event.eventId, message });
                this.pipelineMetrics.recordNonFatal('memory_binding_failed', {
                    projectId: event.projectId,
                    message,
                    details: { eventId: event.eventId, source: 'bindRawEvents' },
                });
            }
        }
        return result;
    }
    listMemoryBindings(options = {}) {
        return this.memoryBindingStore.listBindings(options);
    }
    listMemoryClusters(options = {}) {
        return this.memoryBindingStore.listClusters(options);
    }
    listMemoryEdges(options = {}) {
        return this.memoryBindingStore.listEdges(options);
    }
    recallMemoryBindingGraph(query, options = {}) {
        return this.memoryBindingService.recallGraphAnchors(query, options);
    }
    getMemoryBindingStats(projectId) {
        return this.memoryBindingStore.getStats(projectId);
    }
    rebuildMemoryAtlas(options = {}) {
        return this.memoryAtlasIndexer.rebuild(options);
    }
    reindexMemoryAtlas(options) {
        return this.memoryAtlasIndexer.reindex(options);
    }
    ensureMemoryAtlas(options) {
        return this.memoryAtlasIndexer.ensureFresh(options);
    }
    getMemoryFrame(episodeId, projectId, options = {}) {
        const episode = this.episodeStore.getEpisode(episodeId);
        if (!episode || (projectId !== undefined && episode.projectId !== projectId))
            return null;
        return this.memoryFrameStore.getByEpisode(episode.projectId, episodeId, options.includeStaged ? ['active', 'needs_confirmation', 'staged'] : undefined);
    }
    reviewMemoryFrame(input) {
        return this.memoryFrameStore.review(input.frameId, input.projectId, input.action, input.actor, input.reason);
    }
    listMemoryDimensions(projectId, nodeType, limit = 100) {
        const allowed = new Set(['actor', 'entity', 'project', 'topic', 'issue', 'event', 'task', 'object', 'location', 'state', 'episode', 'time']);
        if (nodeType && !allowed.has(nodeType))
            throw new Error(`invalid_memory_dimension:${nodeType}`);
        const rows = this.factStore.getDatabase().prepare(`
      SELECT node_id,node_type,label,confidence,evidence_event_ids_json
      FROM memory_atlas_documents
      WHERE project_id=? AND status NOT IN ('archived','rejected','needs_confirmation') ${nodeType ? 'AND node_type=?' : ''}
      ORDER BY confidence DESC, updated_at DESC, node_id ASC LIMIT ?
    `).all(projectId, ...(nodeType ? [nodeType] : []), Math.max(1, Math.min(limit, 500)));
        return rows.map((row) => ({ id: row.node_id, nodeType: row.node_type, label: row.label, confidence: Number(row.confidence), evidenceEventIds: JSON.parse(row.evidence_event_ids_json || '[]') }));
    }
    backfillMemoryFrames(options) {
        const page = this.episodeStore.listEpisodesForFrameBackfill({ projectId: options.projectId, cursor: options.cursor, limit: options.limit });
        const selected = page.episodes;
        let created = 0;
        let needsReview = 0;
        for (const episode of selected) {
            const events = this.episodeStore.listEventLinks(episode.episodeId).map((link) => this.eventStore.getEvent(link.eventId)).filter((event) => Boolean(event));
            if (!events.length)
                continue;
            const frame = deterministicFrameFallback({ projectId: options.projectId, episodeId: episode.episodeId, episodeType: episode.episodeType, events });
            const saved = this.memoryFrameStore.save({
                frame,
                sourceFingerprint: frameSourceFingerprint(events.map((event) => event.eventId), episode.episodeId),
                status: 'staged',
                publishStatus: 'needs_confirmation',
            });
            // Backfill active is an explicit publication request, but deterministic
            // fallback frames remain review-only and can never become active here.
            if (options.mode === 'active') {
                const published = this.memoryFrameStore.publish(saved.frameId, 'staged', frame.needsReview ? 'needs_confirmation' : 'active');
                if (!published)
                    throw new Error(`memory_frame_backfill_publish_conflict:${saved.frameId}`);
            }
            created += 1;
            needsReview += frame.needsReview ? 1 : 0;
        }
        return { projectId: options.projectId, processed: selected.length, created, needsReview, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}), hasMore: page.hasMore };
    }
    prepareMemoryAtlasRead(options) {
        if (options.refresh !== true) {
            const state = this.memoryAtlasStore.getProjectionState(options.projectId);
            return { atlasFresh: state?.status === 'clean' };
        }
        try {
            this.ensureMemoryAtlas({ projectId: options.projectId });
            return { atlasFresh: true };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (options.staleOk !== false && /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message)) {
                return { atlasFresh: false, refreshError: message };
            }
            throw error;
        }
    }
    withProjectClock(options) {
        const now = options.now ?? Date.now();
        const timeZone = options.timeZone ?? this.projectClock.timeZone;
        return { ...options, now, timeZone, localDateNow: options.localDateNow ?? localDateFor(now, timeZone) };
    }
    withAtlasFreshness(result, freshness) {
        return Object.assign(result, {
            atlasFresh: freshness.atlasFresh,
            ...(freshness.refreshError ? { refreshError: freshness.refreshError } : {}),
        });
    }
    graphOverview(options) {
        const freshness = this.prepareMemoryAtlasRead(options);
        return this.withAtlasFreshness(this.memoryAtlasService.overview(options), freshness);
    }
    graphSearch(query, options) {
        options = this.withProjectClock(options);
        const freshness = this.prepareMemoryAtlasRead(options);
        return this.withAtlasFreshness(this.memoryAtlasService.search(query, options), freshness);
    }
    graphExplore(query, options) {
        options = this.withProjectClock(options);
        const freshness = this.prepareMemoryAtlasRead(options);
        return this.withAtlasFreshness(this.memoryAtlasService.explore(query, options), freshness);
    }
    planMemoryQuery(query, options) {
        options = this.withProjectClock(options);
        const freshness = this.prepareMemoryAtlasRead(options);
        const planned = this.atlasPathRetriever.retrieve(query, options);
        return { queryFrame: planned.queryFrame, result: this.withAtlasFreshness(planned.result, freshness) };
    }
    graphNode(nodeId, options) {
        const freshness = this.prepareMemoryAtlasRead(options);
        const result = this.memoryAtlasService.node(nodeId, options);
        return result ? this.withAtlasFreshness(result, freshness) : result;
    }
    graphNeighbors(nodeId, options) {
        const freshness = this.prepareMemoryAtlasRead(options);
        return this.withAtlasFreshness(this.memoryAtlasService.neighbors(nodeId, options), freshness);
    }
    graphPath(from, to, options) {
        const freshness = this.prepareMemoryAtlasRead(options);
        return this.withAtlasFreshness(this.memoryAtlasService.path(from, to, options), freshness);
    }
    graphTimeline(query, options) {
        options = this.withProjectClock(options);
        const freshness = this.prepareMemoryAtlasRead(options);
        return this.withAtlasFreshness(this.memoryAtlasService.timeline(query, options), freshness);
    }
    touchMemoryAtlas(input) {
        if (!input.projectId?.trim())
            throw new Error('projectId is required');
        if (!input.reason?.trim())
            throw new Error('reason is required');
        const valid = Array.from(new Set(input.nodeIds)).filter((id) => this.memoryAtlasStore.getNode(id, input.projectId)).slice(0, 30);
        return { touched: this.memoryAtlasStore.recordAccess(input.projectId, valid, input.reason, input.query, input.now) };
    }
    countUnboundBindableRawEvents(projectId, limit = 1000) {
        const max = Math.max(1, limit);
        let afterGlobalSeq;
        let count = 0;
        while (count < max) {
            const batchLimit = Math.min(500, max);
            const events = this.eventStore.listRawEventsAfterGlobalSeq({
                projectId,
                afterGlobalSeq,
                limit: batchLimit,
            });
            if (events.length === 0)
                break;
            afterGlobalSeq = events.at(-1)?.globalSeq ?? afterGlobalSeq;
            for (const event of events) {
                if (!this.memoryBindingService.isBindableRawEvent(event))
                    continue;
                if (this.memoryBindingStore.listBindings({ eventId: event.eventId, limit: 1 }).length > 0)
                    continue;
                count += 1;
                if (count >= max)
                    break;
            }
            if (events.length < batchLimit)
                break;
        }
        return count;
    }
    promoteDreamCandidates(options = {}) {
        this.deepWriteCandidateStore.recoverStalePromoting(Date.now() - 5 * 60_000, Date.now());
        const decisions = this.deepWritePromotionPolicy.promotePending(options.limit ?? 100, {
            projectId: options.projectId,
        });
        return {
            projectId: options.projectId,
            decisions,
            queue: this.getDreamCandidateQueue(options.projectId),
        };
    }
    getDreamCandidateQueue(projectId) {
        return {
            candidate: this.countDreamCandidates({ projectId, statuses: ['candidate'] }),
            needsConfirmation: this.countDreamCandidates({ projectId, statuses: ['needs_confirmation'] }),
            promoted: this.countDreamCandidates({ projectId, statuses: ['promoted'] }),
            rejected: this.countDreamCandidates({ projectId, statuses: ['rejected'] }),
            superseded: this.countDreamCandidates({ projectId, statuses: ['superseded'] }),
            shadow: this.countDreamCandidates({ projectId, statuses: ['shadow'] }),
        };
    }
    buildMemoryMap(options = {}) {
        const projectId = options.projectId;
        const rawPage = this.eventStore.queryEvents(1, 1, {
            projectId: projectId !== undefined ? [projectId] : undefined,
        });
        const projectNeurons = projectId !== undefined
            ? this.memoryGraph.getNeuronIdsByProject(projectId).length
            : this.memoryGraph.getStats().neuronCount;
        const dreamBacklog = this.getDreamBacklogStatus(projectId);
        const dreamCandidateQueue = this.getDreamCandidateQueue(projectId);
        const activationHotspots = this.activationStore.getTop({ projectId, limit: 20 });
        const memoryBindingStats = this.getMemoryBindingStats(projectId);
        const episodes = this.listEpisodes({ projectId, limit: 1000 });
        const episodeDream = this.getEpisodeDreamStatus(projectId);
        const unassignedRawEvents = this.episodeStore.countUnassignedRawEvents(projectId);
        return {
            version: 'memory_map.v1',
            generatedAt: Date.now(),
            projectId,
            anatomy: [
                {
                    id: 'raw_ledger',
                    name: 'Raw chronological ledger',
                    role: 'append-only event source for exact source drill-down and vectors=0 recall fallback',
                    currentCount: rawPage.total,
                },
                {
                    id: 'compiled_graph',
                    name: 'Compiled semantic graph',
                    role: 'governed neurons, synapses, topology, and cognitive graph for associative recall',
                    currentCount: projectNeurons,
                },
                {
                    id: 'belief_cases',
                    name: 'Belief cases',
                    role: 'active beliefs plus support, supersession, and contradiction history',
                },
                {
                    id: 'entity_cards',
                    name: 'Entity cards',
                    role: 'resolved people, projects, devices, aliases, attributes, and mention timelines',
                },
                {
                    id: 'activation',
                    name: 'Activation layer',
                    role: 'host-visible hot memory traces used by recall packs and maintenance tick',
                    currentCount: activationHotspots.length,
                },
                {
                    id: 'memory_binding',
                    name: 'Memory binding layer',
                    role: 'deterministic raw-event bindings, clusters, and graph edges before governed fact promotion',
                    currentCount: memoryBindingStats.bindings,
                },
                {
                    id: 'memory_atlas',
                    name: 'Memory Atlas',
                    role: 'bounded, source-anchored content navigation over topics, entities, clusters, episodes, beliefs, actions, and time',
                },
                {
                    id: 'episode_assembler',
                    name: 'Episode assembler',
                    role: 'groups raw session events into auditable open, soft-sealed, and sealed consolidation units',
                    currentCount: episodes.length,
                },
                {
                    id: 'dream_queue',
                    name: 'Dream curator queue',
                    role: 'sealed-episode candidate-only consolidation backlog controlled by explicit host ticks',
                    currentCount: episodeDream.pending + episodeDream.failed,
                },
            ],
            dataLanes: [
                {
                    id: 'episode_dream',
                    name: 'Episode Dream',
                    route: 'cogmem episode status|repair and cogmem dream tick|status',
                    useWhen: 'Inspect conversation boundaries, repair unassigned raw events, or conditionally consolidate sealed episodes.',
                },
                {
                    id: 'agent_recall_pack',
                    name: 'Agent recall pack',
                    route: 'KernelAgentMemoryBackend.recallPack()',
                    useWhen: 'Before an agent answer that needs direct memory, beliefs, entities, and associative neighbors.',
                },
                {
                    id: 'collection_routing',
                    name: 'Collection routing',
                    route: 'collection:<name> tags on raw events and neurons',
                    useWhen: 'Store creative Theseus artifacts without polluting default operational recall.',
                },
                {
                    id: 'source_drilldown',
                    name: 'Source drill-down',
                    route: 'sourceContext.locator.command',
                    useWhen: 'Audit exact raw events behind any recalled item.',
                },
                {
                    id: 'maintenance_tick',
                    name: 'Maintenance tick',
                    route: 'MemoryKernel.runMaintenanceTick() / cogmem memory tick',
                    useWhen: 'Let the host decide when to decay activation, run dream, govern candidates, or re-embed.',
                },
                {
                    id: 'memory_binding',
                    name: 'Memory binding',
                    route: 'MemoryKernel.listMemoryBindings(), listMemoryClusters(), listMemoryEdges(), bindRawEvents(), recallMemoryBindingGraph() / cogmem memory map|bind',
                    useWhen: 'Inspect or backfill raw-event topic/entity bindings, claim-key clusters, correction edges, and graph-recall anchors.',
                },
                {
                    id: 'memory_atlas',
                    name: 'Memory Atlas navigation',
                    route: 'MemoryKernel.graphOverview(), graphExplore(), graphNode(), graphNeighbors(), graphPath(), graphTimeline() / cogmem memory graph-*',
                    useWhen: 'Inventory broad memory areas, combine query facets, navigate relationships, or revive cold source evidence before exact drill-down.',
                },
            ],
            bounds: [
                'kernel-only memory layer; no notes app, wiki, or UI ownership',
                'no hidden daemon; cron/systemd/agent adapters explicitly call dream tick or memory tick',
                'candidate-only self-improvement unless governance promotes the candidate',
                'sourceContext remains available for drill-down instead of replacing evidence with summaries',
                'default recall includes untagged and collection:anchor only; collection:theseus requires an explicit collection query',
            ],
            manual: {
                commands: [
                    'cogmem memory recall --project <id> --query <q> --json',
                    'cogmem memory recall --project <id> --collection theseus --query <q> --json',
                    'cogmem memory show --event <event-id> --before 2 --after 2',
                    'cogmem memory map --project <id> --json',
                    'cogmem memory graph-explore --project <id> --query <q> --json',
                    'cogmem memory graph-node --project <id> --id <node-id> --json',
                    'cogmem memory graph-path --project <id> --from <node-id> --to <node-id> --json',
                    'cogmem memory tick --project <id> --json',
                    'cogmem memory bind --project <id> --json',
                    'cogmem episode status --project <id> --json',
                    'cogmem episode repair --project <id> --json',
                    'cogmem dream tick --project <id> --mode auto --json',
                ],
                agentUsage: [
                    'Call recallPack() before answering when the host wants direct recall plus associative, belief, and entity context.',
                    'Use collection "theseus" for creative artifacts and collection "anchor" or no collection for operational memory.',
                    'Use memory map for self-inspection; use maintenance tick for explicit host-owned upkeep signals.',
                    'Run memory bind when maintenance tick reports bind_raw_events for imported or adapter-written raw user events.',
                    'Use episode append/import for hookless agents; call dream tick only from an explicit host schedule or operator action.',
                    'Use memory bindings, claim-key clusters, correction edges, and graph recall anchors as source-anchored organization hints, not as promoted long-term facts.',
                    'Use graph explore for broad inventory or historical questions, then graph node/path/timeline to narrow the source-anchored slice before memory show.',
                    'Treat Atlas activation as visibility ranking only; exact project-scoped facet matches can revive cold nodes without changing their truth status.',
                ],
            },
            counters: {
                rawEvents: rawPage.total,
                neurons: projectNeurons,
                vectors: this.vectorStore.getCurrentCount(),
                activationHotspots: activationHotspots.length,
                memoryBindings: memoryBindingStats.bindings,
                memoryBindingTopics: memoryBindingStats.topics,
                memoryBindingEntities: memoryBindingStats.entities,
                memoryBindingClusters: memoryBindingStats.clusters,
                memoryBindingEdges: memoryBindingStats.edges,
                episodes: episodes.length,
                unassignedRawEvents,
                episodeDream,
                dreamBacklog,
                dreamCandidateQueue,
            },
        };
    }
    runMaintenanceTick(options = {}) {
        const projectId = options.projectId;
        const ranAt = options.now ?? Date.now();
        const activationDecay = this.activationStore.decay({
            projectId,
            factor: options.activationDecayFactor,
            floor: options.activationFloor,
            now: ranAt,
        });
        let memoryAtlasRefresh;
        try {
            memoryAtlasRefresh = projectId !== undefined
                ? { ...this.ensureMemoryAtlas({ projectId }), errors: [] }
                : this.memoryAtlasIndexer.ensureAllFresh();
        }
        catch (error) {
            memoryAtlasRefresh = { documents: this.memoryAtlasStore.countDocuments(projectId), actions: 0, refreshed: false,
                errors: [{ projectId: projectId ?? '__all__', error: error instanceof Error ? error.message : String(error) }] };
        }
        const memoryAtlasActivationDecay = this.memoryAtlasStore.decay(projectId, options.activationDecayFactor ?? 0.85, ranAt);
        const memoryAtlasAccessPruned = this.memoryAtlasStore.cleanupAccess({
            projectId, before: ranAt - (options.atlasAccessRetentionMs ?? 90 * 24 * 60 * 60 * 1000),
        });
        const confirmationTtlMs = options.confirmationTtlMs ?? 30 * 24 * 60 * 60 * 1000;
        const reviewQueueAging = this.deepWriteCandidateStore.expireNeedsConfirmation({
            projectId,
            before: ranAt - confirmationTtlMs,
            now: ranAt,
        });
        const dreamBacklog = this.getDreamBacklogStatus(projectId);
        const episodeDream = this.getEpisodeDreamStatus(projectId);
        const unassignedEpisodeRawEvents = this.episodeStore.countUnassignedRawEvents(projectId);
        const queue = this.getDreamCandidateQueue(projectId);
        const entityConflicts = this.entityStore.listAliasConflicts().filter((conflict) => {
            if (projectId === undefined)
                return true;
            return conflict.entityIds.some((entityId) => {
                const entity = this.entityStore.getByEntityId(entityId);
                return entity?.metadata?.projectId === projectId
                    || this.entityStore.listTimeline({ entityId, projectId, limit: 1 }).length > 0;
            });
        }).length;
        const hotspots = this.activationStore.getTop({ projectId, limit: 10 });
        const reEmbedding = this.getReEmbeddingStatus();
        const staleVectors = this.getHealthStatus().hasStaleVectors ? reEmbedding.total - reEmbedding.completed : 0;
        const candidateQueue = queue.candidate + queue.needsConfirmation + queue.shadow;
        const unboundRawEvents = this.countUnboundBindableRawEvents(projectId);
        const bindingFailures = this.pipelineMetrics.getNonFatalCount('memory_binding_failed', { projectId });
        const suggestedActions = [];
        const suggestedAction = (kind, executable, args, reason) => ({
            kind,
            executable,
            args,
            command: [executable, ...args.map(cliArg)].join(' '),
            reason,
        });
        if (projectId !== undefined && !this.topologyStore.hasUsableTimeProjection(projectScope(projectId), this.projectClock.timeZone)) {
            suggestedActions.push(suggestedAction('rebuild_topology', 'cogmem', ['memory', 'rebuild-topology', '--project', projectId, '--json'], 'The project time projection is dirty or uses a different timezone; recall remains on non-temporal lanes until explicit rebuild.'));
        }
        if (episodeDream.pending + episodeDream.failed > 0) {
            suggestedActions.push(suggestedAction('dream_curator', 'cogmem', [
                'dream', 'tick', ...(projectId !== undefined ? ['--project', projectId] : []), '--mode', 'auto'
            ], `${episodeDream.pending + episodeDream.failed} sealed episodes are waiting for candidate-only Dream processing.`));
        }
        if (unassignedEpisodeRawEvents > 0) {
            suggestedActions.push(suggestedAction('repair_episodes', 'cogmem', [
                'episode', 'repair', ...(projectId !== undefined ? ['--project', projectId] : []), '--json'
            ], `${unassignedEpisodeRawEvents} raw events are not assigned to an episode; the raw evidence remains intact.`));
        }
        if (candidateQueue > 0) {
            suggestedActions.push(suggestedAction('govern_candidates', 'cogmem', [
                'memory', 'govern', ...(projectId !== undefined ? ['--project', projectId] : [])
            ], `${candidateQueue} dream/deep-write candidates need CPU governance.`));
        }
        if (entityConflicts > 0) {
            suggestedActions.push(suggestedAction('resolve_entities', 'cogmem', ['memory', 'map', '--json'], `${entityConflicts} active entity alias conflicts need host or agent review.`));
        }
        if (staleVectors > 0) {
            suggestedActions.push(suggestedAction('re_embed', 'cogmem-re-embed', [
                'run', ...(projectId !== undefined ? ['--project', projectId] : [])
            ], `${staleVectors} embeddings are stale for the configured embedding model.`));
        }
        if (unboundRawEvents > 0) {
            suggestedActions.push(suggestedAction('bind_raw_events', 'cogmem', [
                'memory', 'bind', ...(projectId !== undefined ? ['--project', projectId] : []), '--json'
            ], `${unboundRawEvents} high-value raw user events are not attached to memory binding clusters yet.`));
        }
        if (bindingFailures > 0) {
            suggestedActions.push(suggestedAction('inspect_binding_failures', 'cogmem', [
                'memory', 'tick', ...(projectId !== undefined ? ['--project', projectId] : []), '--json'
            ], `${bindingFailures} non-fatal memory binding failures were recorded; raw ledger writes were preserved.`));
        }
        if (hotspots.length > 0) {
            suggestedActions.push(suggestedAction('inspect_hotspots', 'cogmem', [
                'memory', 'map', ...(projectId !== undefined ? ['--project', projectId] : []), '--json'
            ], `${hotspots.length} activation hotspots remain after decay.`));
        }
        return {
            version: 'maintenance_tick.v1',
            projectId,
            ranAt,
            hostOwned: true,
            chargeVector: {
                dreamBacklog: dreamBacklog.undreamedRawCount,
                candidateQueue,
                entityConflicts,
                activationHotspots: hotspots.length,
                staleVectors,
                unboundRawEvents,
                bindingFailures,
                expiredConfirmationCandidates: reviewQueueAging.expired,
                episodeDreamBacklog: episodeDream.pending + episodeDream.failed,
                unassignedEpisodeRawEvents,
            },
            executed: {
                activationDecay,
                memoryAtlasRefresh,
                memoryAtlasActivationDecay,
                memoryAtlasAccessPruned,
                reviewQueueAging: {
                    ...reviewQueueAging,
                    ttlMs: confirmationTtlMs,
                },
                hiddenDaemonStarted: false,
            },
            hotspots,
            suggestedActions,
        };
    }
    async exportSnapshot(outputPath) {
        const exporter = new SnapshotExporter({
            embeddingDimension: this.getEmbeddingDimension(),
            coreVersion: CORE_VERSION,
        });
        return exporter.export(this.dbPath, outputPath);
    }
    async importSnapshot(snapshotPath, opts = {}) {
        if (this.initialized)
            throw new KernelRunningError();
        if (this.dbPath === ':memory:') {
            throw new Error('Cannot import a snapshot into an in-memory MemoryKernel (dbPath is ":memory:"). ' +
                'Provide a file-backed dbPath when creating the kernel.');
        }
        this.close();
        const importer = new SnapshotImporter({ expectedEmbeddingDimension: this.getEmbeddingDimension() });
        return importer.import(snapshotPath, this.dbPath, opts);
    }
    getHealthStatus() {
        const lastRun = this.pipelineMetrics.getLastRun();
        const pipelineP99Ms = this.pipelineMetrics.getPipelineP99();
        return {
            status: 'ok',
            package: 'cogmem',
            dbPath: this.dbPath,
            stats: this.memoryGraph.getStats(),
            vectorRecall: this.getVectorRecallStatus(),
            embeddingModelId: this.embeddingProvider?.modelId,
            hasStaleVectors: this.embeddingProvider
                ? this.neuronEmbeddingStore.hasStaleVectors(this.embeddingProvider.modelId)
                : false,
            pipelineLastRunAt: lastRun?.completedAt,
            pipelineP99Ms: pipelineP99Ms > 0 ? pipelineP99Ms : undefined,
            pipelineLastRunAborted: lastRun?.aborted ?? false,
            reEmbedding: this.getReEmbeddingStatus(),
            extensionCount: this.extensions.size,
        };
    }
    getReEmbeddingStatus() {
        const progress = this.neuronEmbeddingStore.getProgress();
        const completedOrFailed = progress.completed + progress.failed;
        const remaining = Math.max(0, progress.total - completedOrFailed);
        const throughput = this.reEmbeddingPipeline?.getRecentThroughput() ?? null;
        return {
            isRunning: this.reEmbeddingPipeline?.isRunning() ?? false,
            total: progress.total,
            completed: progress.completed,
            failed: progress.failed,
            percentComplete: progress.total === 0 ? 100 : Math.min(100, (completedOrFailed / progress.total) * 100),
            estimatedRemainingMs: progress.completed === 0 || throughput === null ? null : Math.ceil(remaining / throughput),
            lastUpdatedAt: progress.lastUpdatedAt,
        };
    }
    getStats() {
        return this.memoryGraph.getStats();
    }
    getMetrics() {
        const stats = this.memoryGraph.getStats();
        return {
            queryLatency: 0,
            queryType: 'STANDARD',
            neuronCount: stats.neuronCount,
            synapseCount: stats.synapseCount,
            energyPropagation: 0,
            memoryUsage: 0,
            modelInferenceHealth: this.embedder.isReady() ? 1 : 0,
            chainIntegrityScore: 1,
            fallbackCount: 0,
        };
    }
    async startMetabolism() {
        await this.metabolism.start();
    }
    stopMetabolism() {
        this.metabolism.stop();
    }
    getHotMemories() {
        return this.metabolism.getHotMemories();
    }
    async forgetUser(projectId, reason = 'unspecified') {
        const db = this.factStore.getDatabase();
        const scope = projectScope(projectId);
        const neuronIds = this.memoryGraph.getNeuronIdsByProject(scope);
        const auditId = `audit-${randomUUID()}`;
        const deleted = {
            neurons: neuronIds.length,
            synapses: 0,
            events: 0,
            facts: 0,
            compiledEvents: 0,
            embeddings: 0,
            vectors: 0,
            activations: 0,
            memoryBindings: 0,
            episodes: 0,
            brainProjections: 0,
            entityRecords: 0,
        };
        const projectMentionRows = (neuronIds.length > 0
            ? db.prepare(`
          SELECT DISTINCT entity_id FROM entity_mentions
          WHERE COALESCE(project_id, '') = ? OR neuron_id IN (${neuronIds.map(() => '?').join(', ')})
        `).all(scope, ...neuronIds)
            : db.prepare(`SELECT DISTINCT entity_id FROM entity_mentions WHERE COALESCE(project_id, '') = ?`).all(scope));
        const projectMentionEntityIds = new Set(projectMentionRows.map((row) => row.entity_id));
        const projectEntityInstances = db.prepare(`
      SELECT instance_id, canonical_entity_id, aliases_json, metadata_json
      FROM entity_instances
    `).all()
            .filter((row) => {
            const ownerProjectId = parseJsonObject(row.metadata_json).projectId;
            return projectScope(typeof ownerProjectId === 'string' ? ownerProjectId : undefined) === scope
                || (!ownerProjectId && projectMentionEntityIds.has(row.instance_id));
        });
        const projectEntityIds = projectEntityInstances.map((row) => row.instance_id);
        const affectedCanonicalEntityIds = uniqueStrings(projectEntityInstances.map((row) => row.canonical_entity_id));
        const placeholders = neuronIds.map(() => '?').join(', ');
        const runDelete = (sql, params = []) => {
            try {
                return Number(db.prepare(sql).run(...params).changes ?? 0);
            }
            catch (error) {
                if (error instanceof Error && /no such table/i.test(error.message))
                    return 0;
                throw error;
            }
        };
        const deleteScoped = (table) => runDelete(`DELETE FROM ${table} WHERE COALESCE(project_id, '') = ?`, [scope]);
        db.exec(`PRAGMA secure_delete = ON`);
        db.transaction(() => {
            Object.assign(deleted, { privacyTables: deleteRegisteredProjectContent({ scope, neuronIds, runDelete }) });
            if (neuronIds.length > 0) {
                deleted.synapses += runDelete(`DELETE FROM synapses WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`, [...neuronIds, ...neuronIds]);
                deleted.facts += runDelete(`DELETE FROM facts WHERE neuron_id IN (${placeholders})`, neuronIds);
                deleted.compiledEvents += runDelete(`DELETE FROM compiled_events WHERE neuron_id IN (${placeholders})`, neuronIds);
                deleted.embeddings += runDelete(`DELETE FROM neuron_embeddings WHERE neuron_id IN (${placeholders})`, neuronIds);
                deleted.vectors += runDelete(`DELETE FROM vector_index WHERE neuron_id IN (${placeholders})`, neuronIds);
                runDelete(`DELETE FROM neurons_fts WHERE id IN (${placeholders})`, neuronIds);
            }
            deleted.episodes += this.episodeStore.deleteByProject(scope);
            for (const table of [
                'memory_atlas_supports', 'memory_atlas_aliases', 'memory_edges', 'memory_atlas_fts',
                'memory_atlas_documents', 'memory_action_frame_evidence', 'memory_action_frames',
                'memory_atlas_access', 'memory_atlas_activation', 'memory_atlas_projection_state',
                'memory_frames'
            ])
                deleteScoped(table);
            runDelete(`DELETE FROM memory_events_fts WHERE event_id IN (SELECT event_id FROM memory_events WHERE COALESCE(project_id, '') = ?)`, [scope]);
            deleted.events += deleteScoped('memory_events');
            deleteScoped('compiler_confidence_runs');
            if (neuronIds.length > 0) {
                runDelete(`DELETE FROM pending_bindings WHERE unit_id IN (
          SELECT unit_id FROM interaction_units
          WHERE EXISTS (
            SELECT 1 FROM json_each(interaction_units.message_neuron_ids_json)
            WHERE json_each.value IN (${placeholders})
          )
        )`, neuronIds);
                runDelete(`DELETE FROM interaction_units WHERE EXISTS (
          SELECT 1 FROM json_each(interaction_units.message_neuron_ids_json)
          WHERE json_each.value IN (${placeholders})
        )`, neuronIds);
            }
            deleted.activations += this.activationStore.deleteByProject(scope);
            deleted.memoryBindings += this.memoryBindingStore.deleteByProject(scope);
            for (const table of [
                'time_bucket_entries', 'temporal_adjacency', 'time_buckets', 'topology_time_rebuild_jobs',
                'topology_projection_state', 'topology_source_revisions'
            ])
                deleteScoped(table);
            runDelete(`DELETE FROM branch_links WHERE parent_branch_id IN (SELECT branch_id FROM project_branches WHERE COALESCE(project_id, '') = ?) OR child_branch_id IN (SELECT branch_id FROM project_branches WHERE COALESCE(project_id, '') = ?)`, [scope, scope]);
            runDelete(`DELETE FROM branch_entries WHERE branch_id IN (SELECT branch_id FROM project_branches WHERE COALESCE(project_id, '') = ?)`, [scope]);
            deleteScoped('project_branches');
            runDelete(`DELETE FROM task_branch_entries WHERE task_id IN (SELECT task_id FROM task_branches WHERE COALESCE(project_id, '') = ?)`, [scope]);
            deleteScoped('task_branches');
            runDelete(`DELETE FROM event_cluster_entries WHERE cluster_id IN (SELECT cluster_id FROM event_clusters WHERE COALESCE(project_id, '') = ?)`, [scope]);
            deleteScoped('event_clusters');
            deleteScoped('topology_membership');
            deleteScoped('cognitive_edges');
            deleteScoped('cognitive_nodes');
            deleted.brainProjections += runDelete(`DELETE FROM prospective_memory_transitions WHERE candidate_id IN (SELECT candidate_id FROM prospective_memories WHERE COALESCE(project_id, '') = ?)`, [scope]);
            for (const table of ['prospective_memories', 'context_strategy_outcomes', 'context_activation_receipts', 'memory_timeline_entries']) {
                deleted.brainProjections += deleteScoped(table);
            }
            deleted.brainProjections += runDelete(`DELETE FROM belief_graph_evidence WHERE belief_id IN (SELECT belief_id FROM belief_graph_nodes WHERE COALESCE(project_id, '') = ?)`, [scope]);
            deleted.brainProjections += runDelete(`DELETE FROM belief_graph_versions WHERE belief_id IN (SELECT belief_id FROM belief_graph_nodes WHERE COALESCE(project_id, '') = ?)`, [scope]);
            for (const table of ['belief_graph_conflicts', 'belief_graph_nodes'])
                deleted.brainProjections += deleteScoped(table);
            deleted.brainProjections += runDelete(`DELETE FROM entity_resolution_log WHERE candidate_id IN (SELECT candidate_id FROM entity_merge_candidates WHERE COALESCE(project_id, '') = ?)`, [scope]);
            for (const table of ['entity_merge_candidates', 'memory_governance_audit'])
                deleted.brainProjections += deleteScoped(table);
            deleted.brainProjections += runDelete(`DELETE FROM memory_governance_plans WHERE COALESCE(project_id, '') = ? OR plan_id IN (SELECT plan_id FROM memory_governance_operations WHERE COALESCE(project_id, '') = ?)`, [scope, scope]);
            deleted.brainProjections += deleteScoped('memory_governance_operations');
            deleted.entityRecords += deleteScoped('entity_mentions');
            if (projectEntityIds.length > 0) {
                const entityPlaceholders = projectEntityIds.map(() => '?').join(', ');
                deleted.entityRecords += runDelete(`DELETE FROM entity_resolution_log WHERE source_entity_id IN (${entityPlaceholders}) OR target_entity_id IN (${entityPlaceholders})`, [...projectEntityIds, ...projectEntityIds]);
                deleted.entityRecords += runDelete(`DELETE FROM entity_merge_candidates WHERE source_entity_id IN (${entityPlaceholders}) OR target_entity_id IN (${entityPlaceholders})`, [...projectEntityIds, ...projectEntityIds]);
                deleted.entityRecords += runDelete(`DELETE FROM entity_aliases WHERE entity_id IN (${entityPlaceholders})`, projectEntityIds);
                deleted.entityRecords += runDelete(`DELETE FROM entity_attributes WHERE entity_id IN (${entityPlaceholders})`, projectEntityIds);
                deleted.entityRecords += runDelete(`DELETE FROM entity_relations WHERE source_entity_id IN (${entityPlaceholders}) OR target_entity_id IN (${entityPlaceholders})`, [...projectEntityIds, ...projectEntityIds]);
                deleted.entityRecords += runDelete(`DELETE FROM pending_entity_resolution WHERE resolved_entity_id IN (${entityPlaceholders})`, projectEntityIds);
                deleted.entityRecords += runDelete(`DELETE FROM entity_instances WHERE instance_id IN (${entityPlaceholders})`, projectEntityIds);
                scrubEntityAliasConflicts(db, projectEntityIds);
            }
            if (neuronIds.length > 0) {
                deleted.entityRecords += runDelete(`DELETE FROM entity_attributes WHERE source_neuron_id IN (${placeholders})`, neuronIds);
                deleted.entityRecords += runDelete(`DELETE FROM entity_relations WHERE source_neuron_id IN (${placeholders})`, neuronIds);
                deleted.entityRecords += runDelete(`DELETE FROM pending_entity_resolution WHERE context_neuron_id IN (${placeholders})`, neuronIds);
            }
            for (const canonicalEntityId of affectedCanonicalEntityIds) {
                rebuildCanonicalEntityAfterForget(db, canonicalEntityId, runDelete);
            }
            if (neuronIds.length > 0) {
                runDelete(`DELETE FROM neurons WHERE id IN (${placeholders})`, neuronIds);
            }
            db.prepare(`
        INSERT INTO governance_audit_log (
          audit_id, action, project_id, reason, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(auditId, 'forgetUser', scope, reason, JSON.stringify({ deleted }), Date.now());
        })();
        db.exec(`PRAGMA wal_checkpoint(TRUNCATE)`);
        db.exec(`VACUUM`);
        for (const neuronId of neuronIds) {
            this.vectorStore.removePoint(neuronId);
        }
        this.memoryGraph.rebuildIndexes();
        this.topicRegistry.invalidate(scope);
        return { projectId: scope, auditId, deleted };
    }
    getGovernanceAudit(projectId) {
        const db = this.factStore.getDatabase();
        this.ensureGovernanceAuditTable(db);
        const rows = projectId !== undefined
            ? db.prepare(`
          SELECT *
          FROM governance_audit_log
          WHERE COALESCE(project_id, '') = ?
          ORDER BY created_at DESC, audit_id DESC
        `).all(projectId)
            : db.prepare(`
          SELECT *
          FROM governance_audit_log
          ORDER BY created_at DESC, audit_id DESC
        `).all();
        return rows.map((row) => ({
            auditId: row.audit_id,
            action: row.action,
            projectId: row.project_id || undefined,
            reason: row.reason || undefined,
            details: row.details_json ? JSON.parse(row.details_json) : undefined,
            createdAt: Number(row.created_at),
        }));
    }
    getProjectMemories(projectId) {
        return this.memoryGraph.getAllNeurons().filter((neuron) => matchesProjectScope(projectId, neuron.metadata.projectId));
    }
    registerExtension(name, implementation) {
        this.extensions.set(name, implementation);
        if (name === 'relationStore') {
            const store = implementation;
            if (store.getDatabase() !== this.episodeStore.getDatabase())
                throw new Error('relation_store_database_mismatch');
            this.deepWritePromotionPolicy.setRelationStore(store);
        }
    }
    hasExtension(name) {
        return this.extensions.has(name);
    }
    getExtension(name) {
        return this.extensions.get(name);
    }
    async normalizeIngestInput(input) {
        const base = input;
        const content = this.piiRedactor ? this.piiRedactor.redact(base.content ?? '').text : base.content ?? '';
        const resolvedTopicPath = base.topicPath ?? (await this.topicClassifier.classifyAsync(content, base.projectId)).topicPath;
        return {
            ...base,
            content,
            topicPath: resolvedTopicPath,
            type: base.type ?? 'chat',
        };
    }
    queueEmbedding(neuron) {
        if (!this.embeddingProvider)
            return;
        this.embeddingProvider.embed(neuron.content)
            .then((vector) => {
            if (vector.length !== this.embeddingProvider.dimensions) {
                throw new Error(`Embedding dimension mismatch for ${this.embeddingProvider.modelId}: expected ${this.embeddingProvider.dimensions}, got ${vector.length}`);
            }
            this.neuronEmbeddingStore.upsert(neuron.id, this.embeddingProvider.modelId, new Float32Array(vector), neuron.metadata.projectId);
            this.lastEmbedSuccessAt = Date.now();
        })
            .catch(() => {
            this.lastEmbedErrorAt = Date.now();
        });
    }
    getVectorRecallStatus() {
        if (!this.embeddingProvider)
            return 'disabled';
        if (typeof this.lastEmbedErrorAt === 'number'
            && (typeof this.lastEmbedSuccessAt !== 'number' || this.lastEmbedErrorAt > this.lastEmbedSuccessAt)) {
            return 'degraded';
        }
        return 'active';
    }
    getEmbeddingDimension() {
        return this.embeddingProvider?.dimensions ?? this.vectorStore.getStats().dimension;
    }
    ensureMetaTable(db) {
        db.exec(`
      CREATE TABLE IF NOT EXISTS _meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
        const write = db.prepare(`INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)`);
        write.run('schema_version', String(LATEST_SCHEMA_VERSION));
        write.run('core_version', CORE_VERSION);
    }
    ensureGovernanceAuditTable(db) {
        db.exec(`
      CREATE TABLE IF NOT EXISTS governance_audit_log (
        audit_id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        project_id TEXT,
        reason TEXT,
        details_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_governance_audit_project
        ON governance_audit_log(project_id, created_at DESC);
    `);
    }
}
export function createMemoryKernel(options = {}) {
    return new MemoryKernel(options);
}
export function createMemoryKernelFromConfig(input = {}) {
    const options = typeof input === 'string' ? { configPath: input } : input;
    const resolution = resolveCogmemConfigPath({
        configPath: options.configPath,
        cwd: options.cwd,
        env: options.env,
    });
    if (resolution.kind === 'missing') {
        throw new Error(`missing_cogmem_config: Missing cogmem config at ${resolution.path}. Run cogmem-init first.`);
    }
    const loaded = loadCogmemConfig({
        configPath: resolution.path,
        cwd: options.cwd,
        env: options.env,
    });
    const error = loaded.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    if (error)
        throw new Error(`${error.code}: ${error.message}`);
    const { configPath: _configPath, cwd: _cwd, env: _env, ...explicitOptions } = options;
    return createMemoryKernel({
        ...loaded.options,
        ...explicitOptions,
        episodeBoundary: { ...loaded.options.episodeBoundary, ...explicitOptions.episodeBoundary },
        configDiagnostics: [...loaded.diagnostics, ...(explicitOptions.configDiagnostics || [])],
    });
}
function changedFieldsForRepair(input) {
    if (input.operation === 'reclassify') {
        return [
            input.episodeType ? 'episodeType' : '',
            input.topicPath ? 'topicPath' : '',
            input.importance !== undefined ? 'importance' : '',
        ].filter(Boolean);
    }
    if (input.operation === 'move-event')
        return ['episodeEvents'];
    if (input.operation === 'split' || input.operation === 'merge')
        return ['episodeEvents', 'crossRefs'];
    if (input.operation === 'requeue-dream' || input.operation === 'invalidate-dream-run')
        return ['dreamQueue'];
    return [];
}
function validateEpisodeRepairInput(input, store, resolveEvent) {
    if (!input.projectId?.trim())
        throw new Error('episode_project_required');
    if (input.operation === 'reclassify' && input.importance !== undefined
        && (!Number.isFinite(input.importance) || input.importance < 0 || input.importance > 1)) {
        throw new Error('episode_importance_out_of_range');
    }
    if (input.operation === 'split') {
        if (!input.eventIds.length)
            throw new Error('episode_split_requires_event_ids');
        if (new Set(input.eventIds).size !== input.eventIds.length)
            throw new Error('episode_split_duplicate_event_ids');
        const source = store.getEpisode(input.episodeId);
        if (!source || source.projectId !== input.projectId)
            throw new Error(`episode_project_mismatch:${input.episodeId}`);
        if (source.status !== 'sealed')
            throw new Error('episode_split_requires_sealed_source');
        const sourceIds = new Set(store.listEventLinks(input.episodeId).map((link) => link.eventId));
        if (input.eventIds.some((eventId) => !sourceIds.has(eventId)))
            throw new Error('episode_split_event_not_in_source');
        if (input.eventIds.length >= sourceIds.size)
            throw new Error('episode_split_requires_proper_subset');
        const links = store.listEventLinks(input.episodeId);
        const selected = new Set(input.eventIds);
        const indices = links.map((link, index) => selected.has(link.eventId) ? index : -1).filter((index) => index >= 0);
        const first = indices[0];
        const last = indices.at(-1);
        if (first === undefined || last === undefined || last - first + 1 !== indices.length) {
            throw new Error('episode_split_requires_contiguous_range');
        }
        const pairs = links.map((link) => ({ link, event: resolveEvent(link.eventId) }));
        const turns = logicalTurnsFromPairs(pairs);
        if (turns.some((turn) => {
            const included = turn.filter((pair) => selected.has(pair.link.eventId)).length;
            return included > 0 && included !== turn.length;
        }))
            throw new Error('episode_split_requires_complete_logical_turns');
        for (const eventId of selected) {
            const event = resolveEvent(eventId);
            if (event?.parentEventId && sourceIds.has(event.parentEventId) && !selected.has(event.parentEventId)) {
                throw new Error('episode_split_requires_complete_tool_chain');
            }
            const childInSource = links.some((link) => resolveEvent(link.eventId)?.parentEventId === eventId);
            if (childInSource && !links.filter((link) => resolveEvent(link.eventId)?.parentEventId === eventId).every((link) => selected.has(link.eventId))) {
                throw new Error('episode_split_requires_complete_tool_chain');
            }
        }
        if (!turns.some((turn) => turn.every((pair) => selected.has(pair.link.eventId)) && turn.some((pair) => pair.event?.role === 'user'))) {
            throw new Error('episode_split_requires_primary_user_turn');
        }
    }
    if (input.operation === 'move-event') {
        const link = store.getEventLink(input.eventId);
        if (link?.episodeId === input.targetEpisodeId)
            throw new Error('episode_move_source_equals_target');
        const source = link ? store.getEpisode(link.episodeId) : undefined;
        const target = store.getEpisode(input.targetEpisodeId);
        if (!source || !target || source.projectId !== input.projectId || target.projectId !== input.projectId)
            throw new Error('episode_project_mismatch');
        if (source.sessionId !== target.sessionId || source.sourceAgent !== target.sourceAgent || source.conversationThreadId !== target.conversationThreadId) {
            throw new Error('episode_move_scope_mismatch');
        }
    }
    if (input.operation === 'merge') {
        if (input.sourceEpisodeId === input.targetEpisodeId)
            throw new Error('episode_merge_source_equals_target');
        const source = store.getEpisode(input.sourceEpisodeId);
        const target = store.getEpisode(input.targetEpisodeId);
        if (!source || !target || source.projectId !== input.projectId || target.projectId !== input.projectId)
            throw new Error('episode_project_mismatch');
        if (source.sessionId !== target.sessionId || source.sourceAgent !== target.sourceAgent || source.conversationThreadId !== target.conversationThreadId) {
            throw new Error('episode_merge_scope_mismatch');
        }
    }
}
function shellQuote(value) {
    return `'${String(value).replace(/'/gu, `'\\''`)}'`;
}
function requiredGovernancePayloadString(payload, field) {
    const value = payload[field];
    if (typeof value !== 'string' || value.trim() === '')
        throw new Error(`governance payload requires ${field}`);
    return value;
}
function eventPayloadText(payload) {
    if (!payload || typeof payload !== 'object')
        return undefined;
    const text = payload.text;
    return typeof text === 'string' ? text : undefined;
}
function parseJsonObject(value) {
    if (!value)
        return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
function parseJsonStringArray(value) {
    if (!value)
        return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    }
    catch {
        return [];
    }
}
function scrubEntityAliasConflicts(db, deletedEntityIds) {
    const deleted = new Set(deletedEntityIds);
    const rows = db.prepare(`SELECT conflict_id, entity_ids_json FROM entity_alias_conflicts`).all();
    for (const row of rows) {
        const remaining = parseJsonStringArray(row.entity_ids_json).filter((entityId) => !deleted.has(entityId));
        if (remaining.length < 2) {
            db.prepare(`DELETE FROM entity_alias_conflicts WHERE conflict_id = ?`).run(row.conflict_id);
        }
        else {
            db.prepare(`UPDATE entity_alias_conflicts SET entity_ids_json = ?, updated_at = ? WHERE conflict_id = ?`)
                .run(JSON.stringify(remaining), Date.now(), row.conflict_id);
        }
    }
}
function rebuildCanonicalEntityAfterForget(db, canonicalEntityId, runDelete) {
    const remaining = db.prepare(`
    SELECT aliases_json FROM entity_instances WHERE canonical_entity_id = ?
  `).all(canonicalEntityId);
    if (remaining.length === 0) {
        runDelete(`DELETE FROM entities WHERE entity_id = ?`, [canonicalEntityId]);
        return;
    }
    const aliases = uniqueStrings(remaining.flatMap((row) => parseJsonStringArray(row.aliases_json)));
    const canonical = db.prepare(`SELECT metadata_json FROM entities WHERE entity_id = ?`).get(canonicalEntityId);
    const metadata = parseJsonObject(canonical?.metadata_json);
    for (const key of ['projectId', 'rawMention', 'answerDisplayName', 'ens1RawMention', 'ens1RawMentions', 'ens1AnswerDisplayName']) {
        delete metadata[key];
    }
    db.prepare(`UPDATE entities SET aliases_json = ?, metadata_json = ?, updated_at = ? WHERE entity_id = ?`)
        .run(JSON.stringify(aliases), JSON.stringify(metadata), Date.now(), canonicalEntityId);
}
function optionalGovernancePayloadString(payload, field) {
    const value = payload[field];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'string')
        throw new Error(`governance payload ${field} must be a string`);
    return value;
}
function optionalGovernancePayloadNumber(payload, field) {
    const value = payload[field];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error(`governance payload ${field} must be a finite number`);
    return value;
}
function uniqueStrings(values) {
    return Array.from(new Set(values.filter(Boolean)));
}
function sameProvided(left, right) {
    return right === undefined || (left ?? undefined) === right;
}
function extractNavigationTerms(query) {
    return uniqueStrings(query
        .toLowerCase()
        .split(/[\s,，。！？、:：/]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2));
}
function selectRecallableEvidence(neurons, limit) {
    const recallable = neurons.filter((neuron) => isRecallableMemoryEvidence(neuron));
    const filteredEvidence = uniqueFilteredEvidence([
        ...neurons
            .filter((neuron) => !isRecallableMemoryEvidence(neuron))
            .map((neuron) => ({
            neuron,
            reason: 'status_suppressed',
            governanceReason: recallSuppressionReasonFor(neuron),
        })),
        ...recallable
            .slice(limit)
            .map((neuron) => ({ neuron, reason: 'over_context_limit' })),
    ]);
    return {
        rawEvidence: recallable.slice(0, limit),
        filteredEvidence,
    };
}
function uniqueFilteredEvidence(items) {
    const seen = new Set();
    const uniqueItems = [];
    for (const item of items) {
        const key = `${item.neuron.id}:${item.reason}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        uniqueItems.push(item);
    }
    return uniqueItems;
}
function stringifyToolPayload(value) {
    if (value === undefined)
        return '';
    if (typeof value === 'string')
        return value;
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function cliArg(value) {
    return /^[A-Za-z0-9._:/=@+-]+$/u.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
