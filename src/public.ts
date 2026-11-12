/**
 * cogmem — public API surface for v2.0+
 *
 * Stability tiers (see SEMVER.md for full policy):
 *   @stable      — covered by SemVer; no breaking changes within a major
 *   @beta        — available for integration; may change before next stable minor
 *   @experimental — no stability promise; can change or be removed at any time
 *
 * Only explicitly listed symbols are part of the public entrypoint. Internal
 * implementation modules stay importable inside the source tree, but are not
 * exported for third-party packages.
 */

// ─── @stable ─────────────────────────────────────────────────────────────────

/**
 * Primary entry point and kernel lifecycle.
 * @stable @since 1.0.0
 */
export {
  MemoryKernel,
  createMemoryKernel,
  createMemoryKernelFromConfig,
} from './factory.js';
export type {
  ForgetUserResult,
  GovernanceAuditRecord,
  DreamCandidateListOptions,
  DreamCandidateRecord,
  DreamCandidateStatus,
  DreamCuratorRunOptions,
  DreamCuratorRunResult,
  DreamTickOptions,
  DreamTickResult,
  EpisodeClosureReceipt,
  EpisodeDreamStatus,
  EpisodeListOptions,
  EpisodeMessageInput,
  EpisodeMessageResult,
  EpisodeRepairInput,
  EpisodeRepairResult,
  MemoryEpisode,
  MaintenanceSuggestedAction,
  MaintenanceTickOptions,
  MaintenanceTickResult,
  MemoryDataLane,
  MemoryBindingBackfillOptions,
  MemoryBindingBackfillResult,
  MemoryKernelFromConfigOptions,
  MemoryKernelNavigationOptions,
  MemoryKernelNavigationResult,
  MemoryKernelOptions,
  MemoryMapOptions,
  MemoryMapSection,
  MemorySelfMap,
  RawEventSearchOptions,
  RawMemoryEventInput,
  TaskMemoryEventInput,
  ToolCallMemoryEventInput,
  ToolResultMemoryEventInput,
} from './factory.js';
export {
  EpisodeAssembler,
  EpisodeStore,
  classifyAssistantRelation,
  classifyTurnRelation,
  classifyTurnRelationHybrid,
  classifyTurnRelationHybridTrace,
  createStableImportIdentityFactory,
  summarizeEpisode,
  type EpisodeCandidateType,
  type EpisodeClosureMode,
  type EpisodeClosureReasonCode,
  type EpisodeDreamState,
  type EpisodeDreamStatusValue,
  type EpisodeEventLink,
  type EpisodeSemanticSummary,
  type EpisodeStatus,
  type EpisodeType,
  type EpisodeBoundaryAuditItem,
  type EpisodeBoundaryAuditResult,
  type EpisodeBoundaryConfig,
  type EpisodeBoundaryConfigDiagnostic,
  type EpisodeBoundaryDecisionRecord,
  type EpisodeBoundaryGuardCode,
  type EpisodeBoundaryGuardResult,
  type EpisodeBoundaryMetrics,
  type EpisodeBoundaryMode,
  type EpisodeBoundaryWarning,
  type EpisodeSplitImpactInventory,
  type EpisodeSplitPlan,
  type EpisodeSplitPlanSegment,
  type EpisodeSplitProposedBoundary,
  type StableImportIdentityInput,
  type TurnClassificationContext,
  type TurnRelation,
  type TurnRelationAdvisoryReviewer,
  type TurnRelationDecision,
  type TurnRelationHybridTrace,
  type TurnRelationReviewStatus,
} from './episode/index.js';
export { DreamScheduler, type DreamTickMode, type SelectedDreamMode } from './dream/index.js';
export { MEMORY_ONTOLOGY_CLASSES, isMemoryOntologyClass, type MemoryOntologyClass } from './ontology/MemoryOntology.js';
export {
  TopicAliasRegistry,
  TopicGovernance,
  TopicPathRegistry as UserTopicPathRegistry,
  TopicRelationGraph,
  type TopicAliasRecord,
  type TopicCreatedBy,
  type TopicNode,
  type TopicOperationInput,
  type TopicOperationRecord,
  type TopicOperationType,
  type TopicRelationRecord,
  type TopicStatus,
} from './topic/index.js';

/**
 * Cogmem runtime home and structured configuration helpers.
 * @stable @since 2.0.0
 */
export {
  defaultCogmemConfigPath,
  defaultCogmemHome,
  loadCogmemConfig,
  resolveCogmemConfigPath,
} from './config/CogmemConfig.js';
export type {
  CogmemConfigResolution,
  CogmemConfigResolutionOptions,
  LoadedCogmemConfig,
  LoadCogmemConfigOptions,
} from './config/CogmemConfig.js';
export type {
  MemoryBindingListOptions,
  MemoryBindingRecord,
  MemoryBindingSource,
  MemoryBindingStats,
  MemoryBindingType,
  MemoryBindingAction,
  MemoryClusterListOptions,
  MemoryClusterRecord,
  MemoryClusterStatus,
  MemoryEdgeListOptions,
  MemoryEdgeRecord,
  MemoryEdgeRelation,
  MemoryGraphEdgeStatus,
  MemoryGraphEndpointType,
  MemoryGraphRelation,
  MemoryEntityRecord,
  MemoryEntityType,
  MemoryGraphRecallAnchor,
  MemoryTopicRecord,
} from './binding/index.js';
export {
  BeliefGovernanceService,
  type ApplyBeliefInput,
  type BeliefEvidenceLookup,
  type BeliefEvidenceRecord,
  type BeliefOwnership,
  type BeliefRelation,
  type GovernedBeliefRecord,
  type GovernedBeliefStatus,
  type GovernedBeliefType,
} from './belief/BeliefGovernanceService.js';
export {
  TemporalMemoryService,
  type RecordTimelineEntryInput,
  type TemporalBeliefRecord,
  type TimelineEntryRecord,
  type TimelineEntryType,
  type TimelineListOptions,
} from './temporal/index.js';
export {
  ContextCortex,
  type ContextActivationPlan,
  type ContextActivationReceipt,
  type ContextCandidate,
  type ContextIntent,
  type ContextLayer,
  type ContextPlanInput,
  type ContextSuppressionReason,
} from './context/index.js';
export {
  ProspectiveMemoryService,
  type ProposeProspectiveMemoryInput,
  type ProspectiveEvidenceLookup,
  type ProspectiveEvidenceRecord,
  type ProspectiveMemoryListOptions,
  type ProspectiveMemoryProposer,
  type ProspectiveMemoryRecord,
  type ProspectiveMemoryStatus,
  type ProspectiveMemoryType,
  type ResolveProspectiveMemoryInput,
} from './prospective/index.js';
export {
  BrainEvalRunner,
  type BrainEvalMetrics,
  type BrainEvalReport,
  type BrainEvalSample,
} from './benchmark/BrainEval.js';
export {
  StrategyConditionedCandidateBuilder,
  StrategyCortex,
  StrategyTemplateRegistry,
  formatStrategyContext,
  type RetrievalLane,
  type StrategyCapsule,
  type StrategyPlanInput,
  type StrategyReplanDecision,
  type StrategyReplanObservation,
  type StrategyReplanReason,
  type StrategyRetrievalPolicy,
  type StrategySourcePolicy,
  type StrategyTemplate,
  type StrategyTemplateId,
} from './strategy/index.js';
export {
  ContextOutcomeStore,
  ContextPolicyScorer,
  MemoryUseJudge,
  StrategyDiversitySelector,
  StrategyRolloutEvaluator,
  type ContextPolicyScore,
  type JudgedMemorySelection,
  type MemoryUseJudgeInput,
  type MemoryUseViolation,
  type StrategyRolloutOutcome,
  type StrategyRolloutReport,
  type StrategyVectorCandidate,
} from './eval/strategy/index.js';

/**
 * Agent framework integration facade.
 * @stable @since 2.0.0
 */
export {
  compileAgentRecallQuery,
  COGMEM_RECALL_BLOCK_RE,
  createMemoryUsageReceipt,
  formatMemoryUsageBridge,
  formatSessionWorkingState,
  inferAgentRecallIntent,
  KernelAgentMemoryBackend,
  shouldInjectMemoryUsageBridge,
  stripCogmemRecallBlocks,
  updateSessionWorkingState,
  type AgentRecallBeliefTouch,
  type AgentRecallEntityCard,
  type AgentRecallIntent,
  type AgentRecallItem,
  type AgentRecallPackResult,
  type AgentRecallPackSlots,
  type AgentRecallQuery,
  type AgentRecallQueryPlan,
  type AgentRecallResult,
  type AgentRecallSourceAnchor,
  type AgentRecallSourceContext,
  type AgentRecallSourceContextEvent,
  type AgentTaskEventMemory,
  type AgentToolCallMemory,
  type AgentToolObservationMemory,
  type AgentTurnCompileReason,
  type AgentTurnIngestMode,
  type AgentTurnMemory,
  type AgentTurnMemoryResult,
  type CreateMemoryUsageReceiptInput,
  type MemoryUsageReceipt,
  type MemoryUsageReceiptSourceAnchor,
  type SessionWorkingState,
  type StripCogmemRecallBlocksResult,
  type UpdateSessionWorkingStateInput,
} from './agent/index.js';

/**
 * The prompt-block renderers a host adapter injects: `<COGMEM_RECALL_CONTEXT>`
 * and `<COGMEM_MEMORY_ATLAS>`. Host-neutral, so every adapter shares one
 * implementation instead of carrying a copy that no test executes.
 *
 * @stable @since 4.0.0
 */
export {
  clampRecallContext,
  classifyMemoryNavigationIntent,
  compactRecallItems,
  contextCandidateFromRecallItem,
  contextEventLabel,
  formatAtlasCard,
  formatAtlasContext,
  formatContextEvent,
  formatRecallContext,
  formatRecallDecision,
  formatSourceRange,
  formatSourceWindow,
  truncateLineWithMeta,
  uniqueWindowEvents,
  type FormattedContextEvent,
  type TruncationMeta,
} from './host/RecallBlock.js';

/**
 * The host-neutral half of a host adapter: recall into one injectable block, and
 * record a finished turn. An adapter supplies its own identity; nothing here
 * invents a host name. See ADR-0004.
 *
 * @stable @since 4.0.0
 */
export {
  recallForHost,
  rememberForHost,
  type HostBridgeRuntime,
  type HostIdentity,
  type RecallForHostResult,
  type RememberForHostResult,
} from './host/bridge/HostBridge.js';

/**
 * Core recall pipeline.
 * @stable @since 1.0.0
 */
export { BrainRecall } from './recall/BrainRecall.js';
export type { BrainRecallOptions } from './recall/BrainRecall.js';
export type { BrainRecallResult } from './types/BrainRecallResult.js';

/**
 * Neuron types — the fundamental memory unit.
 * @stable @since 1.0.0
 */
export type {
  MemoryEvent,
  MemoryEventContext,
  MemoryEventCausalityType,
  MemoryRawEventType,
  MemoryEventRole,
  MemorySourceRef,
  Neuron,
  NeuronType,
  OrderingConfidence,
} from './types/index.js';
export type { ImportanceLevel } from './core/ImportanceLevels.js';

/**
 * Extension point interfaces for host runtimes and third-party adapters.
 * @stable @since 1.9.6
 */
export type {
  AutonomyContext,
  IAuditLedger,
  ILLMClarifier,
  IProceduralBridge,
  ISkillDiscovery,
  ISkillMemoryStore,
  SkillCandidateLike,
} from './types/ExtensionPoints.js';

/**
 * Cross-device snapshot: export / import / error types.
 * @stable @since 1.9.7
 */
export {
  ChecksumError,
  DimensionMismatchError,
  KernelRunningError,
  SnapshotExporter,
  SnapshotImporter,
  SnapshotTargetExistsError,
  SnapshotVersionError,
} from './snapshot/index.js';
export type { ImportOptions, ImportResult, SnapshotHeader, SnapshotMeta } from './snapshot/index.js';

/**
 * Security: AES-256-GCM encryption provider and PII redaction.
 * @stable @since 1.14.0
 */
export { AesGcmEncryptionProvider, isEncryptedPayload } from './encryption/index.js';
export type { EncryptionProvider } from './encryption/index.js';
export {
  MemoryGovernanceExecutor,
  MemoryGovernanceStore,
  MemoryGovernanceValidator,
  PiiRedactor,
} from './governance/index.js';
export type {
  MemoryEvidenceRole,
  MemoryGovernanceAuditEntry,
  MemoryGovernanceExecutionResult,
  MemoryGovernanceIssue,
  MemoryGovernanceOperation,
  MemoryGovernanceOperationType,
  MemoryGovernancePlan,
  MemoryGovernanceValidationResult,
  MemoryOwnership,
  PiiFinding,
  RedactionPolicy,
  RedactionResult,
} from './governance/index.js';

// ─── @beta ───────────────────────────────────────────────────────────────────

/**
 * The kernel's memory event stream: subscribe instead of polling for new ledger rows, a finished
 * Dream pass, and — once F2/F6 wire them — due prospective memories and pending candidates.
 *
 * The written contract is `docs/events.md`: frozen type list, cursor semantics, filter semantics,
 * error codes and version discipline. `MemoryKernel.events` is the stream; a shell binds
 * `KernelAgentMemoryBackend.subscribe` so it depends on the host API and not the kernel field.
 * @beta @since 5.0.0
 */
export {
  DEFAULT_EVENT_BUFFER_CAPACITY,
  EVENT_CONTRACT_VERSION,
  KERNEL_EVENT_TYPES,
  KernelEventStreamError,
  KernelEventStream,
} from './events/index.js';
export type {
  KernelEvent,
  KernelEventFilter,
  KernelEventStreamErrorCode,
  KernelEventSubscription,
  KernelEventType,
} from './events/index.js';

/**
 * The time-awareness face (F2 of #156): the context block a shell hands the agent at wake or turn
 * start, the ledger-backed self-set wake intentions, and the schedule evaluation a base timer reads
 * instead of polling.
 *
 * The written contract is `docs/time-awareness.md`: the frozen context field list, the intention
 * record shape and API, the dream-window evaluation and the `prospective-due` producer. Everything
 * takes an injected `now`, so no caller sleeps and a test drives a month in milliseconds.
 * @beta @since 5.0.0
 */
export {
  ANCHOR_KINDS,
  DAY_PHASES,
  DEFAULT_DENSITY_WINDOW_MS,
  DEFAULT_RHYTHM_ACTIVE_HOUR_THRESHOLD,
  DEFAULT_RHYTHM_SAMPLE_DAYS,
  DENSITY_LABELS,
  RHYTHM_PHASES,
  TEMPORAL_CONTEXT_FIELDS,
  TIME_AWARENESS_CONTRACT_VERSION,
  WAKE_INTENTION_EVENT_TYPES,
  WAKE_INTENTION_STATUSES,
  WakeIntentionService,
  WakeScheduler,
  computeTemporalContext,
  evaluateDreamWindow,
} from './temporal/index.js';
export type {
  AnchorKind,
  ClaimDueWakeIntentionsInput,
  DayPhase,
  DensityLabel,
  DreamWindow,
  DreamWindowEvaluation,
  NearestAnchor,
  RegisterWakeIntentionInput,
  RhythmPhase,
  TemporalAnchor,
  TemporalContext,
  TemporalContextInput,
  TemporalDensity,
  TemporalLedgerOccurrence,
  TemporalRhythm,
  WakeIntention,
  WakeIntentionAuditEntry,
  WakeIntentionEventType,
  WakeIntentionListInput,
  WakeIntentionStatus,
  WakeTickInput,
  WakeTickResult,
} from './temporal/index.js';

/**
 * Embedding provider interface and utilities.
 * @beta @since 1.9.5
 */
export type { EmbeddingProvider } from './embedding/EmbeddingProvider.js';
export { EmbeddingUnavailableError, embedOne } from './embedding/EmbeddingProvider.js';

/**
 * Re-embedding status for observability.
 * @beta @since 1.9.8
 */
export type { ReEmbeddingStatus } from './embedding/ReEmbeddingStatus.js';

/**
 * Dream curator scheduling helpers. They describe host-owned schedules; core
 * never starts a hidden daemon.
 * @beta @since 2.0.0
 */
export {
  describeDreamCuratorWorkflow,
  nextDreamCuratorRunAt,
} from './engine/DreamCuratorSchedule.js';
export type {
  DreamCuratorScheduleConfig,
  DreamCuratorScheduleMode,
  DreamCuratorWorkflowDescription,
} from './engine/DreamCuratorSchedule.js';
export { ReEmbeddingPipeline } from './embedding/ReEmbeddingPipeline.js';
export { EntityGovernanceService } from './entity/index.js';
export type { EntityMergeCandidate, EntityMergeCandidateStatus, ProposeEntityMergeInput } from './entity/index.js';

/**
 * Vector store backends — choose between durable sqlite-vec (recommended)
 * and the legacy in-process hnswlib backend.
 * @beta @since 1.12.0
 */
export { SqliteVecStore } from './store/SqliteVecStore.js';
export { HnswlibVectorStore } from './store/HnswlibVectorStore.js';
export { ActivationStore } from './store/ActivationStore.js';
export { MemoryBindingStore } from './store/MemoryBindingStore.js';
/** @deprecated Use HnswlibVectorStore. Will be removed in v3.0. */
export { VectorStore } from './store/VectorStore.js';
export type { ActivationDecayOptions, ActivationDecayResult, ActivationHotspot, ActivationTouchInput } from './store/ActivationStore.js';
export type { UpsertMemoryEntityInput, UpsertMemoryTopicInput } from './store/MemoryBindingStore.js';
export type { IVectorStore, VectorBackend, VectorSearchResult, VectorStoreStats } from './store/IVectorStore.js';

/**
 * Offline consolidation — advanced use only.
 * @beta @since 1.9.0
 */
export { OfflineConsolidationPipeline } from './engine/OfflineConsolidationPipeline.js';

/**
 * MemoryGraph — low-level neuron graph. Prefer MemoryKernel for most use cases.
 * @beta @since 1.0.0
 */
export { MemoryGraph } from './core/MemoryGraph.js';

/**
 * Source adapters and the workspace profiles the import bridge reads.
 * @beta @since 2.0.0
 */
export {
  ConversationMarkdownAdapter,
  HermesWorkspaceProfile,
  MarkdownSourceLoader,
  OpenClawDailyMemoryAdapter,
  OpenClawMemoryIndexAdapter,
  OpenClawPersonaAdapter,
  OpenClawSessionAdapter,
  OpenClawUserProfileAdapter,
  OpenClawWorkspaceProfile,
  SoulMarkdownAdapter,
} from './adapters/index.js';
export type {
  AdaptedSource,
  HermesWorkspaceSourceOptions,
  OpenClawClassifiedPath,
  OpenClawWorkspaceSelection,
  OpenClawWorkspaceSelectionDiagnostic,
  OpenClawWorkspaceSourceOptions,
  SourceAdapter,
  SourceAdapterDiagnostic,
  SourceAdapterKind,
  SourceAdapterRecord,
  SourceDefinition,
} from './adapters/index.js';

/**
 * Pulse/universe recall orchestration. Agent backends use this by default;
 * advanced integrations can inspect or compose these pieces directly.
 * @beta @since 2.0.0
 */
export { QueryCompiler } from './retrieval/QueryCompiler.js';
export type { CompiledQuery } from './retrieval/QueryCompiler.js';
export { RetrievalPlanner } from './retrieval/RetrievalPlanner.js';
export type { RetrievalExecutionPlan, RetrievalIntent } from './retrieval/RetrievalPlanner.js';
export { TemporalBranchSearch } from './retrieval/TemporalBranchSearch.js';
export type { TemporalBranchSearchResult, TemporalTraversalSegment } from './retrieval/TemporalBranchSearch.js';
export { PulseRetrievalEngine } from './retrieval/PulseRetrievalEngine.js';
export type { PulseRetrievalResult } from './retrieval/PulseRetrievalEngine.js';
export { NarrativeRecallAssembler } from './retrieval/NarrativeRecallAssembler.js';
export type { NarrativeRecallSummary } from './retrieval/NarrativeRecallAssembler.js';
export { UniverseNavigator } from './retrieval/UniverseNavigator.js';
export type { UniverseNavigationResult } from './retrieval/UniverseNavigator.js';
export { UniverseTraversalExecutor } from './retrieval/UniverseTraversalExecutor.js';
export type { UniverseTraversalExecution, UniverseTraversalSegment } from './retrieval/UniverseTraversalExecutor.js';

/**
 * Recall explainability helpers.
 * @beta @since 2.0.0
 */
export { explainRecallWithKernel } from './recall/RecallExplanation.js';
export type {
  RecallExplanation,
  RecallExplanationEvidence,
  RecallExplanationOptions,
  RecallExplanationSourceAnchor,
} from './recall/RecallExplanation.js';
export type { DreamBacklogStatus } from './store/DreamLedgerStore.js';
export { MemoryFrameStore, frameSourceFingerprint } from './store/MemoryFrameStore.js';
export type { MemoryFrameSaveInput } from './store/MemoryFrameStore.js';
export * from './atlas/index.js';
export * from './semantic/index.js';
export { createMemoryQueryFrame, queryFacet } from './recall/MemoryQueryFrame.js';
export type { MemoryQueryFacet, MemoryQueryFrameV1, MemoryQueryIntent } from './recall/MemoryQueryFrame.js';
export { AtlasPathRetriever, DimensionAwareRanker, MultidimensionalQueryPlanner } from './recall/index.js';
export { assertLocalDate, localDateFor, localDateRange, resolveProjectClockContext, resolveTimeZone } from './utils/LocalDateContext.js';
export type { ProjectClockContext, ProjectClockSource } from './utils/LocalDateContext.js';

// ─── @experimental ───────────────────────────────────────────────────────────

/**
 * Chinese-language lexicons for entity hints, stopwords, and topic classification.
 * @experimental @since 1.13.0
 */
export { ZH_ENTITY_HINTS, ZH_STOPWORDS, ZH_TOPIC_LEXICON } from './lexicon/zh/index.js';
export type { ChineseTopicLexiconEntry } from './lexicon/zh/index.js';
// The shared-memory types a host integrates against; the SQLite adapter stays internal (ADR-0004).
export type { SharedCollection, SharedItem, SharedMemoryPort, SharedRetraction } from './ports/index.js';
