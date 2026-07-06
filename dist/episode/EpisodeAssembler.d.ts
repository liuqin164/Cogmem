import type { MemoryEvent } from '../types/index.js';
import { type TurnClassificationContext, type TurnRelationAdvisoryReviewer, type TurnRelationReviewStatus } from './TurnRelationClassifier.js';
import type { EpisodeClosureReceipt, MemoryEpisode } from './EpisodeTypes.js';
import { EpisodeStore } from './EpisodeStore.js';
import { EpisodeBoundaryPolicy } from './EpisodeBoundaryPolicy.js';
export interface EpisodeAssemblyResult {
    episode?: MemoryEpisode;
    assignedEventIds: string[];
    unassignedEventIds: string[];
    ignoredEventIds: string[];
    closureReceipt?: EpisodeClosureReceipt;
    reopened: boolean;
    boundaryTriggered?: boolean;
    boundaryDetected?: boolean;
    boundaryApplied?: boolean;
    boundaryMode?: string;
    boundaryDecisionId?: string;
    boundaryGuardCodes?: string[];
    boundaryAuditRecorded?: boolean;
    boundaryAuditStatus?: 'disabled' | 'inserted' | 'duplicate' | 'failed' | 'not_applicable';
    previousEpisodeId?: string;
    reviewerRawResultStatus?: TurnRelationReviewStatus;
    warnings?: string[];
}
export declare class EpisodeAssembler {
    private readonly store;
    private readonly resolveEvent?;
    private readonly softReopenWindowMs;
    private readonly reviewer?;
    private readonly resolveTopicContext?;
    private readonly boundaryPolicy;
    constructor(store: EpisodeStore, resolveEvent?: ((eventId: string) => MemoryEvent | null | undefined) | undefined, softReopenWindowMs?: number, reviewer?: TurnRelationAdvisoryReviewer | undefined, resolveTopicContext?: ((primary: MemoryEvent, episode?: MemoryEpisode) => Partial<TurnClassificationContext>) | undefined, boundaryPolicy?: EpisodeBoundaryPolicy);
    appendTurn(events: MemoryEvent[], input: {
        projectId: string;
        sessionId: string;
        sourceAgent?: string;
        conversationThreadId?: string;
        now?: number;
        batchSeal?: boolean;
        forceBatchSeal?: boolean;
        allowNonUserEpisodeStart?: boolean;
    }): EpisodeAssemblyResult;
    appendTurnAsync(events: MemoryEvent[], input: {
        projectId: string;
        sessionId: string;
        sourceAgent?: string;
        conversationThreadId?: string;
        now?: number;
        batchSeal?: boolean;
        forceBatchSeal?: boolean;
        allowNonUserEpisodeStart?: boolean;
    }): Promise<EpisodeAssemblyResult>;
    private appendTurnClassified;
    appendEvent(event: MemoryEvent, input: {
        projectId: string;
        sessionId: string;
        sourceAgent?: string;
        now?: number;
    }): EpisodeAssemblyResult;
    appendEventAsync(event: MemoryEvent, input: {
        projectId: string;
        sessionId: string;
        sourceAgent?: string;
        now?: number;
    }): Promise<EpisodeAssemblyResult>;
    private classificationContext;
    private classifyPrimary;
    private appendOrderedEvents;
    private evaluateBoundary;
    private recordBoundaryDecisionSafe;
}
//# sourceMappingURL=EpisodeAssembler.d.ts.map