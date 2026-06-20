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
export { MemoryKernel, createMemoryKernel, createMemoryKernelFromConfig, } from './factory.js';
/**
 * Cogmem runtime home and structured configuration helpers.
 * @stable @since 2.0.0
 */
export { defaultCogmemConfigPath, defaultCogmemHome, loadCogmemConfig, resolveCogmemConfigPath, } from './config/CogmemConfig.js';
export { BeliefGovernanceService, } from './belief/BeliefGovernanceService.js';
export { TemporalMemoryService, } from './temporal/index.js';
export { ContextCortex, } from './context/index.js';
export { ProspectiveMemoryService, } from './prospective/index.js';
export { BrainEvalRunner, } from './benchmark/BrainEval.js';
/**
 * Agent framework integration facade.
 * @stable @since 2.0.0
 */
export { compileAgentRecallQuery, COGMEM_RECALL_BLOCK_RE, createMemoryUsageReceipt, formatMemoryUsageBridge, formatSessionWorkingState, inferAgentRecallIntent, KernelAgentMemoryBackend, shouldInjectMemoryUsageBridge, stripCogmemRecallBlocks, updateSessionWorkingState, } from './agent/index.js';
/**
 * Core recall pipeline.
 * @stable @since 1.0.0
 */
export { BrainRecall } from './recall/BrainRecall.js';
/**
 * Cross-device snapshot: export / import / error types.
 * @stable @since 1.9.7
 */
export { ChecksumError, DimensionMismatchError, KernelRunningError, SnapshotExporter, SnapshotImporter, SnapshotTargetExistsError, SnapshotVersionError, } from './snapshot/index.js';
/**
 * Security: AES-256-GCM encryption provider and PII redaction.
 * @stable @since 1.14.0
 */
export { AesGcmEncryptionProvider, isEncryptedPayload } from './encryption/index.js';
export { MemoryGovernanceExecutor, MemoryGovernanceStore, MemoryGovernanceValidator, PiiRedactor, } from './governance/index.js';
export { EmbeddingUnavailableError, embedOne } from './embedding/EmbeddingProvider.js';
/**
 * Dream curator scheduling helpers. They describe host-owned schedules; core
 * never starts a hidden daemon.
 * @beta @since 2.0.0
 */
export { describeDreamCuratorWorkflow, nextDreamCuratorRunAt, } from './engine/DreamCuratorSchedule.js';
export { ReEmbeddingPipeline } from './embedding/ReEmbeddingPipeline.js';
export { EntityGovernanceService } from './entity/index.js';
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
 * Source adapters and first-party external-agent profiles.
 * @beta @since 2.0.0
 */
export { ConversationMarkdownAdapter, HermesWorkspaceProfile, MarkdownSourceLoader, OpenClawDailyMemoryAdapter, OpenClawMemoryIndexAdapter, OpenClawPersonaAdapter, OpenClawSessionAdapter, OpenClawUserProfileAdapter, OpenClawWorkspaceProfile, SoulMarkdownAdapter, } from './adapters/index.js';
/**
 * Pulse/universe recall orchestration. Agent backends use this by default;
 * advanced integrations can inspect or compose these pieces directly.
 * @beta @since 2.0.0
 */
export { QueryCompiler } from './retrieval/QueryCompiler.js';
export { RetrievalPlanner } from './retrieval/RetrievalPlanner.js';
export { TemporalBranchSearch } from './retrieval/TemporalBranchSearch.js';
export { PulseRetrievalEngine } from './retrieval/PulseRetrievalEngine.js';
export { NarrativeRecallAssembler } from './retrieval/NarrativeRecallAssembler.js';
export { UniverseNavigator } from './retrieval/UniverseNavigator.js';
export { UniverseTraversalExecutor } from './retrieval/UniverseTraversalExecutor.js';
/**
 * Recall explainability and MCP bridge helpers.
 * @beta @since 2.0.0
 */
export { explainRecallWithKernel } from './recall/RecallExplanation.js';
export { callCogmemMcpTool, listCogmemMcpTools } from './mcp/CoreMcpTools.js';
// ─── @experimental ───────────────────────────────────────────────────────────
/**
 * Chinese-language lexicons for entity hints, stopwords, and topic classification.
 * @experimental @since 1.13.0
 */
export { ZH_ENTITY_HINTS, ZH_STOPWORDS, ZH_TOPIC_LEXICON } from './lexicon/zh/index.js';
