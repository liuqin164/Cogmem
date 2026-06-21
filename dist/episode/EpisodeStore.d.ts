import type Database from 'bun:sqlite';
import type { MemoryEvent } from '../types/index.js';
import type { EpisodeClosureMode, EpisodeClosureReasonCode, EpisodeClosureReceipt, EpisodeDreamStatus, EpisodeEventLink, EpisodeListOptions, EpisodeType, MemoryEpisode, TurnRelation } from './EpisodeTypes.js';
interface CreateEpisodeInput {
    projectId: string;
    sessionId: string;
    sourceAgent?: string;
    conversationThreadId?: string;
    topicPath?: string;
    episodeType: EpisodeType;
    importance: number;
    eventId: string;
    globalSeq?: number;
    occurredAt: number;
    episodeTags?: string[];
    candidateTypes?: MemoryEpisode['candidateTypes'];
    importanceSignals?: string[];
    importanceReason?: string;
    linkedEpisodeId?: string;
}
export interface ClaimedEpisodeDreamJob {
    episodeId: string;
    projectId: string;
    leaseId: string;
    modeHint: 'micro' | 'normal' | 'deep';
    attempts: number;
    createdAt: number;
}
export declare class EpisodeStore {
    private readonly db;
    private readonly resolveEvent?;
    constructor(db: Database, resolveEvent?: ((eventId: string) => MemoryEvent | null | undefined) | undefined, options?: {
        initializeSchemaForTests?: boolean;
    });
    createEpisode(input: CreateEpisodeInput): MemoryEpisode;
    findActiveEpisode(projectId: string, sessionId: string, sourceAgent?: string, conversationThreadId?: string): MemoryEpisode | undefined;
    private findActiveEpisodeRow;
    claimLegacyEpisodeScope(episodeId: string, sourceAgent?: string, conversationThreadId?: string): MemoryEpisode | undefined;
    getEpisode(episodeId: string): MemoryEpisode | undefined;
    listEpisodes(options?: EpisodeListOptions): MemoryEpisode[];
    appendEvent(input: {
        episodeId: string;
        eventId: string;
        relation: TurnRelation;
        confidence: number;
        globalSeq?: number;
        occurredAt: number;
        episodeType?: EpisodeType;
        importance?: number;
        summaryText?: string;
        candidateTypes?: MemoryEpisode['candidateTypes'];
        importanceSignals?: string[];
        importanceReason?: string;
    }): EpisodeEventLink;
    getEventLink(eventId: string): EpisodeEventLink | undefined;
    listEventLinks(episodeId: string): EpisodeEventLink[];
    addCrossReference(input: {
        projectId: string;
        episodeId: string;
        referencedEpisodeId?: string;
        eventId?: string;
        relation: string;
        createdBy: string;
        confidence?: number;
        now?: number;
    }): string;
    moveEventForRepair(eventId: string, targetEpisodeId: string, now?: number): {
        sourceEpisodeId: string;
        targetEpisodeId: string;
    };
    reclassifyForRepair(episodeId: string, input: {
        episodeType?: EpisodeType;
        topicPath?: string;
        importance?: number;
        now?: number;
    }): MemoryEpisode;
    requeueDreamForRepair(episodeId: string, modeHint?: 'micro' | 'normal' | 'deep', now?: number): void;
    recordRepairAudit(input: {
        projectId: string;
        operation: string;
        payload: unknown;
        before: unknown;
        after: unknown;
        now?: number;
    }): string;
    private invalidateEpisodeDerivedState;
    private resequenceEpisode;
    reopenSoftEpisode(episodeId: string, now: number): MemoryEpisode;
    sealEpisode(episodeId: string, input: {
        mode: EpisodeClosureMode;
        reason: string;
        reasonCode?: EpisodeClosureReasonCode;
        reasonDetail?: string;
        requiresReview?: boolean;
        semanticSummary?: MemoryEpisode['semanticSummary'];
        ignoredNearbyEventIds?: string[];
        unassignedNearbyEventIds?: string[];
        now?: number;
    }): EpisodeClosureReceipt;
    listClosureReceipts(options?: {
        episodeId?: string;
        projectId?: string;
        limit?: number;
    }): EpisodeClosureReceipt[];
    sealIdleEpisodes(input: {
        projectId?: string;
        idleBefore: number;
        now?: number;
    }): EpisodeClosureReceipt[];
    finalizeMatureSoftSeals(input: {
        projectId?: string;
        sealedBefore: number;
        now?: number;
    }): number;
    claimDreamJobs(input: {
        projectId?: string;
        limit: number;
        now: number;
        leaseMs: number;
        maxAttempts: number;
        runId?: string;
    }): ClaimedEpisodeDreamJob[];
    completeDreamJob(episodeId: string, leaseId: string, candidateIds: string[], now: number): void;
    failDreamJob(episodeId: string, leaseId: string, error: string, input: {
        now: number;
        failureCategory: string;
        terminal: boolean;
        retryAfter?: number;
    }): void;
    retryFailed(projectId?: string): number;
    getDreamStatus(projectId?: string): EpisodeDreamStatus;
    countUnassignedRawEvents(projectId?: string): number;
    markEventDisposition(input: {
        eventId: string;
        projectId: string;
        disposition: 'ignored';
        reason: string;
        now?: number;
    }): void;
    hasEventDisposition(eventId: string): boolean;
    recordDreamRun(input: {
        runId: string;
        projectId?: string;
        requestedMode: string;
        selectedMode: string;
        reason: string;
        episodeIds: string[];
        candidateIds: string[];
        status: string;
        durationMs: number;
        error?: string;
        createdAt: number;
        failedEpisodes?: Array<{
            episodeId: string;
            error: string;
            failureCategory: string;
            retryAfter?: number;
        }>;
    }): void;
    getIngestedEvent(projectId: string, sourceAgent: string, sourceSessionId: string, externalMessageId: string): string | undefined;
    recordIngestKey(input: {
        projectId: string;
        sourceAgent: string;
        sourceSessionId: string;
        externalMessageId: string;
        eventId: string;
        now?: number;
    }): void;
    markIngestState(input: {
        projectId: string;
        sourceAgent: string;
        sourceSessionId: string;
        externalMessageId: string;
        state: 'reserved' | 'committed' | 'failed';
        error?: string;
        now?: number;
    }): void;
    getIngestState(projectId: string, sourceAgent: string, sourceSessionId: string, externalMessageId: string): {
        eventId: string;
        state: 'reserved' | 'committed' | 'failed';
        error?: string;
        updatedAt?: number;
    } | undefined;
    deleteByProject(projectId: string): number;
    private enqueueDreamJob;
    private initializeSchema;
}
export {};
//# sourceMappingURL=EpisodeStore.d.ts.map