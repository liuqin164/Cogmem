import { randomUUID } from 'node:crypto';

import { BeliefStore } from './belief/BeliefStore.js';
import { IngestionCursorStore } from './batch/IngestionCursorStore.js';
import { MemoryGraph } from './core/MemoryGraph.js';
import { Metabolism } from './core/Metabolism.js';
import { Reflection } from './core/Reflection.js';
import { TwoStagePulseRanker } from './core/TwoStagePulseRanker.js';
import { BrainRecall, type BrainRecallOptions } from './recall/BrainRecall.js';
import { HierarchicalRecallRouter } from './recall/HierarchicalRecallRouter.js';
import {
  isRecallableMemoryEvidence,
  recallSuppressionReasonFor,
  type RecallGovernanceSuppressionReason,
} from './recall/RecallGovernance.js';
import { TopicClassifier } from './recall/TopicClassifier.js';
import { TopicDecayPolicy } from './recall/TopicDecayPolicy.js';
import { TopicRegistry } from './recall/TopicRegistry.js';
import { TopicSummaryBoard } from './recall/TopicSummaryBoard.js';
import { CognitiveGraphCompiler } from './engine/CognitiveGraphCompiler.js';
import { ConsolidationPipeline } from './engine/ConsolidationPipeline.js';
import { ConsolidationTrigger } from './engine/ConsolidationTrigger.js';
import { CrossTopicSynthesizer } from './engine/CrossTopicSynthesizer.js';
import { CrossTopicTrigger } from './engine/CrossTopicTrigger.js';
import { DeepWritePromotionPolicy } from './engine/DeepWritePromotionPolicy.js';
import { EpisodicSemanticDistiller } from './engine/EpisodicSemanticDistiller.js';
import { EntityResolutionEngine } from './engine/EntityResolutionEngine.js';
import { FactCompiler } from './engine/FactCompiler.js';
import { GraphCommunityEngine } from './engine/GraphCommunityEngine.js';
import { IngestionEngine } from './engine/IngestionEngine.js';
import { InteractionBinder } from './engine/InteractionBinder.js';
import { LocalSemanticCompiler } from './engine/LocalSemanticCompiler.js';
import { MemoryConsolidationEngine } from './engine/MemoryConsolidationEngine.js';
import { OfflineConsolidationPipeline, type OfflineConsolidationOutput } from './engine/OfflineConsolidationPipeline.js';
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
import { UniverseNavigator, type UniverseNavigationResult } from './retrieval/UniverseNavigator.js';
import { UniverseTraversalExecutor } from './retrieval/UniverseTraversalExecutor.js';
import type { EmbeddingProvider } from './embedding/EmbeddingProvider.js';
import { NeuronEmbeddingStore } from './embedding/NeuronEmbeddingStore.js';
import { ReEmbeddingPipeline } from './embedding/ReEmbeddingPipeline.js';
import type { ReEmbeddingStatus } from './embedding/ReEmbeddingStatus.js';
import type { EncryptionProvider } from './encryption/index.js';
import { PiiRedactor, type RedactionPolicy } from './governance/index.js';
import {
  loadCogmemConfig,
  resolveCogmemConfigPath,
  type EnvLike,
} from './config/CogmemConfig.js';
import { ModelRegistry } from './models/ModelRegistry.js';
import { IterativeLLMClarifier, type BrainToolDispatcherLike } from './routing/IterativeLLMClarifier.js';
import { ToolUsePolicy } from './routing/ToolUsePolicy.js';
import { createConfiguredEmbedder } from './store/EmbedderFactory.js';
import type { Embedder } from './store/Embedder.js';
import { CognitiveGraphStore } from './store/CognitiveGraphStore.js';
import { CompilerConfidenceStore } from './store/CompilerConfidenceStore.js';
import { DeepWriteCandidateStore } from './store/DeepWriteCandidateStore.js';
import { EntityStore } from './store/EntityStore.js';
import { EventStore } from './store/EventStore.js';
import { FactStore } from './store/FactStore.js';
import { InteractionUnitStore } from './store/InteractionUnitStore.js';
import { SummaryStore } from './store/SummaryStore.js';
import { TemporalAdjacencyStore } from './store/TemporalAdjacencyStore.js';
import { TopologyStore } from './store/TopologyStore.js';
import type { IVectorStore, VectorBackend } from './store/IVectorStore.js';
import { SqliteVecStore } from './store/SqliteVecStore.js';
import { VectorStore } from './store/VectorStore.js';
import type { IngestInput, Neuron } from './types/index.js';
import { config } from './utils/Config.js';
import {
  KernelRunningError,
  SnapshotExporter,
  SnapshotImporter,
  type ImportOptions,
  type ImportResult,
  type SnapshotMeta,
} from './snapshot/index.js';

const CORE_VERSION = '2.0.0-rc.1';
const LATEST_SCHEMA_VERSION = 12;

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

interface RecallableEvidenceSelection {
  rawEvidence: Neuron[];
  filteredEvidence: NonNullable<MemoryKernelNavigationResult['filteredEvidence']>;
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

export class MemoryKernel {
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

  private readonly dbPath: string;
  private readonly embedder: Embedder;
  private readonly embeddingProvider?: EmbeddingProvider;
  private readonly modelRegistry: ModelRegistry;
  private readonly encryptionProvider?: EncryptionProvider;
  private readonly piiRedactor?: PiiRedactor;
  private readonly interactionUnitStore: InteractionUnitStore;
  private readonly compilerConfidenceStore: CompilerConfidenceStore;
  private readonly summaryStore: SummaryStore;
  private readonly deepWriteCandidateStore: DeepWriteCandidateStore;
  private readonly topicSummaryBoard: TopicSummaryBoard;
  private readonly topicDecayPolicy: TopicDecayPolicy;
  private readonly localSemanticCompiler: LocalSemanticCompiler;
  private readonly topicClassifier: TopicClassifier;
  private readonly reflection: Reflection;
  private readonly metabolism: Metabolism;
  private readonly ingestionEngine: IngestionEngine;
  private readonly universeNavigator: UniverseNavigator;
  private readonly offlineConsolidationPipeline: OfflineConsolidationPipeline;
  private readonly consolidationPipeline: ConsolidationPipeline;
  private readonly topologyCompiler: TopologyCompiler;
  private readonly cognitiveGraphCompiler: CognitiveGraphCompiler;
  private readonly brainRecall: BrainRecall;
  private readonly ranker: TwoStagePulseRanker;
  private readonly reEmbeddingPipeline?: ReEmbeddingPipeline;
  private readonly extensions = new Map<string, unknown>();
  private lastEmbedSuccessAt?: number;
  private lastEmbedErrorAt?: number;
  private initialized = false;

  constructor(private readonly options: MemoryKernelOptions = {}) {
    this.dbPath = options.dbPath ?? ':memory:';
    this.encryptionProvider = options.encryptionProvider;
    this.piiRedactor = options.redactionPolicy === false ? undefined : new PiiRedactor(options.redactionPolicy);
    this.memoryGraph = new MemoryGraph(this.dbPath);
    this.eventStore = new EventStore(this.dbPath, this.encryptionProvider);
    this.factStore = new FactStore(this.dbPath, this.encryptionProvider);
    this.entityStore = new EntityStore(this.dbPath);
    const db = this.factStore.getDatabase();
    db.exec('PRAGMA busy_timeout = 5000;');
    this.ensureMetaTable(db);
    this.ensureGovernanceAuditTable(db);
    const vectorDimension = options.vectorDimension ?? config.vector.dimension;
    this.modelRegistry = options.modelRegistry ?? ModelRegistry.defaults();
    this.beliefStore = new BeliefStore(this.dbPath, this.eventStore);
    this.cursorStore = new IngestionCursorStore(this.dbPath);
    this.vectorStore = options.vectorBackend === 'hnswlib'
      ? new VectorStore(vectorDimension)
      : new SqliteVecStore(db, vectorDimension);
    this.topicRegistry = new TopicRegistry(this.memoryGraph);
    this.topologyStore = new TopologyStore(this.dbPath);
    this.cognitiveGraphStore = new CognitiveGraphStore(this.dbPath);
    this.temporalAdjacencyStore = new TemporalAdjacencyStore(this.dbPath);
    this.interactionUnitStore = new InteractionUnitStore(this.dbPath);
    this.compilerConfidenceStore = new CompilerConfidenceStore(this.dbPath);
    this.neuronEmbeddingStore = new NeuronEmbeddingStore(db);
    this.pipelineMetrics = new PipelineMetrics(db);
    this.summaryStore = new SummaryStore(db);
    this.summaryStore.migrateLegacyFactSummaries();
    this.deepWriteCandidateStore = new DeepWriteCandidateStore(db);
    this.topicSummaryBoard = new TopicSummaryBoard(this.memoryGraph, this.summaryStore);
    this.topicDecayPolicy = new TopicDecayPolicy(this.memoryGraph);
    this.localSemanticCompiler = new LocalSemanticCompiler();
    this.embedder = options.embedder ?? createConfiguredEmbedder(vectorDimension, this.modelRegistry);
    this.embeddingProvider = options.embeddingProvider;
    this.universeNavigator = new UniverseNavigator(
      new QueryCompiler(this.localSemanticCompiler, new EntityResolutionEngine(this.entityStore)),
      new RetrievalPlanner(),
      new TemporalBranchSearch(this.topologyStore, this.temporalAdjacencyStore),
      new PulseRetrievalEngine(
        this.temporalAdjacencyStore,
        new EntityActivationIndex(this.entityStore, this.factStore)
      ),
      new NarrativeRecallAssembler(),
      new UniverseTraversalExecutor()
    );
    this.topicClassifier = new TopicClassifier(
      this.memoryGraph,
      { confidenceThreshold: 0.25, enableEmbedding: true, embeddingThreshold: 0.75 },
      this.topicRegistry,
      this.embedder
    );
    this.ranker = new TwoStagePulseRanker(this.vectorStore);
    this.reflection = new Reflection(this.memoryGraph);
    this.metabolism = new Metabolism(this.memoryGraph, this.vectorStore, this.eventStore);
    this.ingestionEngine = new IngestionEngine(this.embedder, undefined, vectorDimension);
    this.ingestionEngine.setDedupDeps(
      (vector, k) => this.vectorStore.search(vector, k),
      (id) => this.memoryGraph.getNeuron(id),
      (id) => this.reflection.onNeuronActivated(id)
    );

    const noOpDispatcher = {
      dispatch: async (call: { action?: string }) => ({
        toolName: 'brain_recall',
        callId: `memory-kernel-${Date.now()}`,
        success: true,
        result: [],
        durationMs: 0,
      }),
    } as BrainToolDispatcherLike;
    const makeClarifier = (answer: string) =>
      new IterativeLLMClarifier(async () => answer, noOpDispatcher, {
        maxIterations: 1,
        policy: new ToolUsePolicy(),
      });
    const memoryConsolidationEngine = new MemoryConsolidationEngine(
      new ConsolidationTrigger(this.memoryGraph),
      new EpisodicSemanticDistiller(
        this.memoryGraph,
        makeClarifier('Consolidated principle from repeated experience.')
      )
    );
    const crossTopicSynthesizer = new CrossTopicSynthesizer(
      this.memoryGraph,
      new CrossTopicTrigger(this.memoryGraph),
      makeClarifier('Cross-domain principle from multiple semantic consolidations.')
    );
    const graphCommunityEngine = new GraphCommunityEngine(this.memoryGraph);
    const orphanCleaner = new OrphanCleaner(this.memoryGraph);
    const principleDecayPolicy = new PrincipleDecayPolicy(this.memoryGraph);
    const deepWritePromotionPolicy = new DeepWritePromotionPolicy({
      candidateStore: this.deepWriteCandidateStore,
      factStore: this.factStore,
      entityStore: this.entityStore,
      beliefStore: this.beliefStore,
      summaryStore: this.summaryStore,
      minPromoteConfidence: 0.86,
    });
    const workingMemoryDelta = new WorkingMemoryDelta(db, this.memoryGraph);

    this.offlineConsolidationPipeline = new OfflineConsolidationPipeline({
      factStore: this.factStore,
      entityStore: this.entityStore,
      beliefStore: this.beliefStore,
      compilerConfidenceStore: this.compilerConfidenceStore,
      semanticCompiler: this.localSemanticCompiler,
      deepWritePromotionPolicy,
      topicSummaryBoard: this.topicSummaryBoard,
      topicDecayPolicy: this.topicDecayPolicy,
      memoryConsolidationEngine,
      proceduralLearningBridge: {
        scan: (projectId: string) => this.getExtension<{ scan(projectId: string): unknown }>('procedural_bridge')?.scan(projectId),
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
    this.consolidationPipeline = new ConsolidationPipeline(
      this.beliefStore,
      new InteractionBinder(this.interactionUnitStore),
      new FactCompiler(this.factStore, this.entityStore),
      this.localSemanticCompiler,
      this.factStore,
      this.entityStore,
      this.compilerConfidenceStore,
      undefined,
      this.offlineConsolidationPipeline
    );
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

  async initialize(skipWarmup = true): Promise<void> {
    if (this.initialized) return;
    if (!skipWarmup) await this.embedder.warmup();
    this.initialized = true;
  }

  async start(): Promise<void> {
    await this.initialize();
  }

  stop(): void {
    this.metabolism.stop();
  }

  close(): void {
    this.stop();
    this.memoryGraph.close();
    this.eventStore.close();
    this.factStore.close();
    this.entityStore.close();
    this.topologyStore.close();
    this.cognitiveGraphStore.close();
    this.temporalAdjacencyStore.close();
    this.interactionUnitStore.close();
    this.compilerConfidenceStore.close();
  }

  async ingest(input: IngestInput | { content: string; projectId?: string; tags?: string[] }): Promise<Neuron> {
    await this.initialize();
    const normalizedInput = await this.normalizeIngestInput(input);
    const prevNeuronSelfHash = this.memoryGraph.getLatestNeuronSelfHash(normalizedInput.projectId);
    const { neuron, isDuplicate } = await this.ingestionEngine.ingest(normalizedInput, { prevNeuronSelfHash });
    if (isDuplicate) {
      this.metabolism.recordActivity();
      return neuron;
    }

    const ingestedEvent = this.eventStore.append({
      streamId: neuron.id,
      streamType: 'neuron',
      eventType: 'INGESTED',
      projectId: neuron.metadata.projectId,
      sourceNeuronId: neuron.id,
      payload: {
        neuronId: neuron.id,
        selfHash: neuron.self_hash,
        prevHash: neuron.prev_hash,
        type: neuron.metadata.type,
        createdAt: neuron.metadata.createdAt,
      },
    });

    neuron.metadata.sourceEventId = ingestedEvent.eventId;
    neuron.metadata.updatedAt = neuron.metadata.createdAt;

    this.memoryGraph.addNeuron(neuron);
    this.topicRegistry.invalidate(neuron.metadata.projectId);
    this.vectorStore.addVector(neuron.id, neuron.coordinates.V);
    this.queueEmbedding(neuron);
    this.reflection.onNeuronActivated(neuron.id);
    this.reflection.detectAndCreateOverrides(neuron, (vector, k) => this.vectorStore.search(vector, k));
    const consolidation = this.consolidationPipeline.consolidate(neuron, ingestedEvent.eventId);
    const topology = this.topologyCompiler.compile({ neuron, consolidation });
    this.temporalAdjacencyStore.syncBuckets(topology.timeBuckets, neuron.metadata.createdAt);
    const cognitiveGraph = this.cognitiveGraphCompiler.compile({ neuron, consolidation, topology });
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

    this.metabolism.recordActivity();
    return neuron;
  }

  recall(query: string, options: BrainRecallOptions = {}) {
    return this.brainRecall.recall(query, options);
  }

  navigateMemory(query: string, options: MemoryKernelNavigationOptions = {}): MemoryKernelNavigationResult {
    const limit = Math.max(1, options.limit ?? 8);
    const seedLimit = Math.min(Math.max(limit * 4, 24), 120);
    const seedNeuronIds = this.memoryGraph.fullTextSearch(query, options.projectId, seedLimit);
    const cognitiveContext = this.cognitiveGraphStore.collectContext({
      projectId: options.projectId,
      terms: extractNavigationTerms(query),
      limit: seedLimit,
      hopLimit: 2,
    });
    const seedTemporalBucketIds = this.topologyStore.listTimeBucketIdsByNeuronIds(
      seedNeuronIds,
      options.projectId,
      seedLimit
    );
    const navigation = this.universeNavigator.navigate({
      query,
      projectId: options.projectId,
      startTime: options.startTime,
      endTime: options.endTime,
      topologyIds: seedNeuronIds,
      branchIds: [],
      temporalBucketIds: seedTemporalBucketIds,
      temporalNeuronIds: seedNeuronIds,
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
      .filter((item): item is Neuron => Boolean(item))
      .filter((neuron) => !options.projectId || neuron.metadata.projectId === options.projectId);
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
    }).rawEvidence.filter((neuron) => !options.projectId || neuron.metadata.projectId === options.projectId);
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

  async consolidate(options: MemoryKernelConsolidationOptions = {}): Promise<OfflineConsolidationOutput> {
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
          source: 'compiler' as const,
          targetType: 'fact' as const,
          targetId: fact.factId,
          confidence: fact.confidence,
          reason: fact.status === 'enriched_candidate'
            ? 'enriched_candidate_pending_verification'
            : 'low_confidence_provisional_fact',
        })),
      ...provisionalEvents
        .filter((event) => event.confidence < 0.75)
        .map((event) => ({
          source: 'compiler' as const,
          targetType: 'event' as const,
          targetId: event.eventId,
          confidence: event.confidence,
          reason: 'low_confidence_provisional_event',
        })),
      ...unresolvedReferences.map((reference) => ({
        source: 'entity_binding' as const,
        targetType: 'reference' as const,
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

  async exportSnapshot(outputPath: string): Promise<SnapshotMeta> {
    const exporter = new SnapshotExporter({
      embeddingDimension: this.getEmbeddingDimension(),
      coreVersion: CORE_VERSION,
    });
    return exporter.export(this.dbPath, outputPath);
  }

  async importSnapshot(snapshotPath: string, opts: ImportOptions = {}): Promise<ImportResult> {
    if (this.initialized) throw new KernelRunningError();
    if (this.dbPath === ':memory:') {
      throw new Error(
        'Cannot import a snapshot into an in-memory MemoryKernel (dbPath is ":memory:"). ' +
        'Provide a file-backed dbPath when creating the kernel.',
      );
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
      package: '@CognitiveOS/core',
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

  getReEmbeddingStatus(): ReEmbeddingStatus {
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

  async startMetabolism(): Promise<void> {
    await this.metabolism.start();
  }

  stopMetabolism(): void {
    this.metabolism.stop();
  }

  getHotMemories(): Neuron[] {
    return this.metabolism.getHotMemories();
  }

  async forgetUser(projectId: string, reason = 'unspecified'): Promise<ForgetUserResult> {
    const db = this.factStore.getDatabase();
    const neuronIds = this.memoryGraph.getNeuronIdsByProject(projectId);
    const auditId = `audit-${randomUUID()}`;
    const deleted = {
      neurons: neuronIds.length,
      synapses: 0,
      events: 0,
      facts: 0,
      compiledEvents: 0,
      embeddings: 0,
      vectors: 0,
    };

    const placeholders = neuronIds.map(() => '?').join(', ');
    const runDelete = (sql: string, params: Array<string | number> = []): number => {
      try {
        return Number(db.prepare(sql).run(...params).changes ?? 0);
      } catch {
        return 0;
      }
    };

    db.transaction(() => {
      if (neuronIds.length > 0) {
        deleted.synapses += runDelete(`DELETE FROM synapses WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`, [...neuronIds, ...neuronIds]);
        deleted.facts += runDelete(`DELETE FROM facts WHERE neuron_id IN (${placeholders})`, neuronIds);
        deleted.compiledEvents += runDelete(`DELETE FROM compiled_events WHERE neuron_id IN (${placeholders})`, neuronIds);
        deleted.embeddings += runDelete(`DELETE FROM neuron_embeddings WHERE neuron_id IN (${placeholders})`, neuronIds);
        deleted.vectors += runDelete(`DELETE FROM vector_index WHERE neuron_id IN (${placeholders})`, neuronIds);
        runDelete(`DELETE FROM neurons_fts WHERE id IN (${placeholders})`, neuronIds);
        runDelete(`UPDATE neurons SET is_deleted = 1, status = 'archived', updated_at = ? WHERE id IN (${placeholders})`, [Date.now(), ...neuronIds]);
      }
      deleted.events += runDelete(`DELETE FROM memory_events WHERE project_id = ?`, [projectId]);
      runDelete(`DELETE FROM temporal_adjacency WHERE project_id = ?`, [projectId]);
      runDelete(`DELETE FROM cognitive_nodes WHERE project_id = ?`, [projectId]);
      runDelete(`DELETE FROM cognitive_edges WHERE project_id = ?`, [projectId]);
      db.prepare(`
        INSERT INTO governance_audit_log (
          audit_id, action, project_id, reason, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(auditId, 'forgetUser', projectId, reason, JSON.stringify({ deleted }), Date.now());
    })();

    for (const neuronId of neuronIds) {
      this.vectorStore.removePoint(neuronId);
    }
    this.memoryGraph.rebuildIndexes();
    this.topicRegistry.invalidate(projectId);
    return { projectId, auditId, deleted };
  }

  getGovernanceAudit(projectId?: string): GovernanceAuditRecord[] {
    const db = this.factStore.getDatabase();
    this.ensureGovernanceAuditTable(db);
    const rows = projectId
      ? db.prepare(`
          SELECT *
          FROM governance_audit_log
          WHERE project_id = ?
          ORDER BY created_at DESC, audit_id DESC
        `).all(projectId)
      : db.prepare(`
          SELECT *
          FROM governance_audit_log
          ORDER BY created_at DESC, audit_id DESC
        `).all();
    return (rows as Array<{
      audit_id: string;
      action: string;
      project_id?: string | null;
      reason?: string | null;
      details_json?: string | null;
      created_at: number;
    }>).map((row) => ({
      auditId: row.audit_id,
      action: row.action,
      projectId: row.project_id || undefined,
      reason: row.reason || undefined,
      details: row.details_json ? JSON.parse(row.details_json) : undefined,
      createdAt: Number(row.created_at),
    }));
  }

  getProjectMemories(projectId: string): Neuron[] {
    return this.memoryGraph.getAllNeurons().filter((neuron) => neuron.metadata.projectId === projectId);
  }

  registerExtension(name: string, implementation: unknown): void {
    this.extensions.set(name, implementation);
  }

  hasExtension(name: string): boolean {
    return this.extensions.has(name);
  }

  getExtension<T = unknown>(name: string): T | undefined {
    return this.extensions.get(name) as T | undefined;
  }

  private async normalizeIngestInput(
    input: IngestInput | { content: string; projectId?: string; tags?: string[] }
  ): Promise<IngestInput> {
    const base = input as IngestInput;
    const content = this.piiRedactor ? this.piiRedactor.redact(base.content ?? '').text : base.content ?? '';
    const resolvedTopicPath = base.topicPath ?? (await this.topicClassifier.classifyAsync(content, base.projectId)).topicPath;
    return {
      ...base,
      content,
      topicPath: resolvedTopicPath,
      type: base.type ?? 'chat',
    };
  }

  private queueEmbedding(neuron: Neuron): void {
    if (!this.embeddingProvider) return;
    this.embeddingProvider.embed(neuron.content)
      .then((vector) => {
        if (vector.length !== this.embeddingProvider!.dimensions) {
          throw new Error(`Embedding dimension mismatch for ${this.embeddingProvider!.modelId}: expected ${this.embeddingProvider!.dimensions}, got ${vector.length}`);
        }
        this.neuronEmbeddingStore.upsert(
          neuron.id,
          this.embeddingProvider!.modelId,
          new Float32Array(vector),
          neuron.metadata.projectId
        );
        this.lastEmbedSuccessAt = Date.now();
      })
      .catch(() => {
        this.lastEmbedErrorAt = Date.now();
      });
  }

  private getVectorRecallStatus(): 'disabled' | 'degraded' | 'active' {
    if (!this.embeddingProvider) return 'disabled';
    if (
      typeof this.lastEmbedErrorAt === 'number'
      && (typeof this.lastEmbedSuccessAt !== 'number' || this.lastEmbedErrorAt > this.lastEmbedSuccessAt)
    ) {
      return 'degraded';
    }
    return 'active';
  }

  private getEmbeddingDimension(): number {
    return this.embeddingProvider?.dimensions ?? this.vectorStore.getStats().dimension;
  }

  private ensureMetaTable(db: ReturnType<FactStore['getDatabase']>): void {
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

  private ensureGovernanceAuditTable(db: ReturnType<FactStore['getDatabase']>): void {
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

export function createMemoryKernel(options: MemoryKernelOptions = {}): MemoryKernel {
  return new MemoryKernel(options);
}

export function createMemoryKernelFromConfig(configPath?: string): MemoryKernel;
export function createMemoryKernelFromConfig(options?: MemoryKernelFromConfigOptions): MemoryKernel;
export function createMemoryKernelFromConfig(input: string | MemoryKernelFromConfigOptions = {}): MemoryKernel {
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
  if (error) throw new Error(`${error.code}: ${error.message}`);

  const {
    configPath: _configPath,
    cwd: _cwd,
    env: _env,
    ...explicitOptions
  } = options;
  return createMemoryKernel({ ...loaded.options, ...explicitOptions });
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractNavigationTerms(query: string): string[] {
  return uniqueStrings(
    query
      .toLowerCase()
      .split(/[\s,，。！？、:：/]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function selectRecallableEvidence(
  neurons: Neuron[],
  limit: number,
): RecallableEvidenceSelection {
  const recallable = neurons.filter((neuron) => isRecallableMemoryEvidence(neuron));
  const filteredEvidence = uniqueFilteredEvidence([
    ...neurons
      .filter((neuron) => !isRecallableMemoryEvidence(neuron))
      .map((neuron) => ({
        neuron,
        reason: 'status_suppressed' as const,
        governanceReason: recallSuppressionReasonFor(neuron),
      })),
    ...recallable
      .slice(limit)
      .map((neuron) => ({ neuron, reason: 'over_context_limit' as const })),
  ]);

  return {
    rawEvidence: recallable.slice(0, limit),
    filteredEvidence,
  };
}

function uniqueFilteredEvidence(
  items: NonNullable<MemoryKernelNavigationResult['filteredEvidence']>,
): NonNullable<MemoryKernelNavigationResult['filteredEvidence']> {
  const seen = new Set<string>();
  const uniqueItems: NonNullable<MemoryKernelNavigationResult['filteredEvidence']> = [];
  for (const item of items) {
    const key = `${item.neuron.id}:${item.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueItems.push(item);
  }
  return uniqueItems;
}
