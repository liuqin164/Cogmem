import type { BeliefRecord, Neuron } from '../types/index.js';
import type { EventRecord, FactRecord, FactStore } from '../store/FactStore.js';
import type { EntityRecord, EntityStore, PendingEntityResolutionRecord } from '../store/EntityStore.js';
import type { InteractionUnitRecord } from '../store/InteractionUnitStore.js';
import type { BeliefStore } from '../belief/BeliefStore.js';
import type { CompilerConfidenceStore } from '../store/CompilerConfidenceStore.js';
import { LocalSemanticCompiler } from './LocalSemanticCompiler.js';
import { type AlgorithmReviewBackend } from '../algorithm/AlgorithmReviewBackend.js';
import type { TopicDecayPolicy } from '../recall/TopicDecayPolicy.js';
import type { TopicSummaryBoard } from '../recall/TopicSummaryBoard.js';
import type { DeepWritePromotionPolicy } from './DeepWritePromotionPolicy.js';
import type { MemoryConsolidationEngine } from './MemoryConsolidationEngine.js';
import type { UserModelManager } from '../models/UserModelManager.js';
import type { IProceduralBridge } from '../types/ExtensionPoints.js';
import type { CrossTopicSynthesizer } from './CrossTopicSynthesizer.js';
import type { GraphCommunityEngine } from './GraphCommunityEngine.js';
import type { OrphanCleaner } from './OrphanCleaner.js';
import type { PrincipleDecayPolicy } from './PrincipleDecayPolicy.js';
import type { PipelineMetrics } from './PipelineMetrics.js';
import type Database from 'bun:sqlite';
import type { WorkingMemoryDelta } from './WorkingMemoryDelta.js';
import type { GraphEdgeStoreLike, ProposalLedgerLike } from '../types/ExtensionPoints.js';
export type CoreProposal = Record<string, unknown>;
export interface CoreProposalEmitter {
    emit(input: unknown): CoreProposal[];
}
export declare class NoopCoreProposalEmitter implements CoreProposalEmitter {
    emit(): CoreProposal[];
}
export interface AutoEdgeSeedingResult {
    seededEdgeCount?: number;
    [key: string]: unknown;
}
export interface OfflineConsolidationWindow {
    projectId?: string;
    startTime?: number;
    endTime?: number;
}
export interface OfflineConsolidationInput {
    rawEpisodes: Neuron[];
    interactionUnits: InteractionUnitRecord[];
    provisionalFacts: FactRecord[];
    provisionalEvents: EventRecord[];
    provisionalEntities: EntityRecord[];
    unresolvedReferences: PendingEntityResolutionRecord[];
    lowConfidenceItems: Array<{
        source: 'compiler' | 'entity_binding' | 'enrichment';
        targetType: 'fact' | 'event' | 'entity' | 'belief' | 'reference';
        targetId: string;
        confidence?: number;
        reason: string;
    }>;
    recentBeliefs: BeliefRecord[];
    window: OfflineConsolidationWindow;
}
export interface OfflineConsolidationOutput {
    verifiedFacts: FactRecord[];
    verifiedEvents: EventRecord[];
    correctedEntityBindings: Array<{
        targetId: string;
        targetType: 'fact' | 'event' | 'entity' | 'reference';
        fromEntityId?: string;
        toEntityId?: string;
        reason: string;
    }>;
    consolidatedBeliefs: BeliefRecord[];
    archivedFactIds: string[];
    rejectedFactIds: string[];
    archivedEntityIds: string[];
    unresolvedReferenceIds: string[];
    plasticityProposals: CoreProposal[];
    autoEdgeSeeding?: AutoEdgeSeedingResult;
}
export interface OfflineConsolidationScheduleRequest {
    neuron: Neuron;
    interactionUnit?: InteractionUnitRecord | null;
    provisionalFacts: FactRecord[];
    provisionalEvents: EventRecord[];
    provisionalEntityIds: string[];
    beliefIds: string[];
    pendingReferenceIds: string[];
    reasons: string[];
}
export interface OfflineConsolidationScheduleResult {
    scheduled: boolean;
    queueReason: 'noop_stub' | 'insufficient_signal' | 'scheduled_for_async_window';
}
interface OfflineConsolidationDependencies {
    db?: Database;
    factStore?: FactStore;
    entityStore?: EntityStore;
    beliefStore?: BeliefStore;
    compilerConfidenceStore?: CompilerConfidenceStore;
    semanticCompiler?: LocalSemanticCompiler;
    algorithmReviewBackend?: AlgorithmReviewBackend;
    plasticityProposalEmitter?: CoreProposalEmitter;
    plasticityProposalLedgerStore?: ProposalLedgerLike;
    graphEdgeStore?: GraphEdgeStoreLike;
    enableAutoEdgeSeeding?: boolean;
    deepWritePromotionPolicy?: DeepWritePromotionPolicy;
    topicSummaryBoard?: TopicSummaryBoard;
    topicDecayPolicy?: TopicDecayPolicy;
    memoryConsolidationEngine?: MemoryConsolidationEngine;
    userModelManager?: UserModelManager;
    proceduralLearningBridge?: IProceduralBridge;
    crossTopicSynthesizer?: CrossTopicSynthesizer;
    graphCommunityEngine?: GraphCommunityEngine;
    orphanCleaner?: OrphanCleaner;
    principleDecayPolicy?: PrincipleDecayPolicy;
    pipelineMetrics?: PipelineMetrics;
    maxBudgetMs?: number;
    checkpointExpiryMs?: number;
    workingMemoryDelta?: WorkingMemoryDelta;
}
export type PipelineStep = 'MemoryConsolidationEngine' | 'ProceduralLearningBridge' | 'CrossTopicSynthesizer' | 'PrincipleDecayPolicy' | 'GraphCommunityEngine' | 'WorkingMemoryDeltaCleanup';
/**
 * Offline deep consolidation stays asynchronous and independent from sync ingest.
 * v1 performs a minimal nightly pass:
 * - group interaction units / episodes inside a window
 * - revisit low-confidence provisional facts/events
 * - resolve pending entity references and same-name duplicates
 * - promote stable provisional outputs to verified records
 * - materialize belief updates from verified facts
 */
export declare class OfflineConsolidationPipeline {
    private readonly deps;
    private readonly semanticCompiler;
    private readonly algorithmReviewBackend;
    private readonly plasticityProposalEmitter;
    private readonly enableAutoEdgeSeeding;
    constructor(deps?: OfflineConsolidationDependencies);
    schedule(request: OfflineConsolidationScheduleRequest): OfflineConsolidationScheduleResult;
    run(input: OfflineConsolidationInput, reviewBackend?: AlgorithmReviewBackend): Promise<OfflineConsolidationOutput>;
    private refreshTopicMaintenance;
    private initCheckpointSchema;
    private assertInputProjectScope;
    private readCheckpointIndex;
    private recordRunAndCheckpoint;
    private shouldVerifyFact;
    private factToBeliefCandidate;
    private toFactKey;
    private inferEntityTypeFromFact;
    private scoreFactEvidence;
    private isImportedSummarySupport;
    private isImportedSummaryOnlyGroup;
    private applyReviewAdjudications;
}
export {};
//# sourceMappingURL=OfflineConsolidationPipeline.d.ts.map