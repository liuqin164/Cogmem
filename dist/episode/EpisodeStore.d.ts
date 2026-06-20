import type Database from 'bun:sqlite';
import type { EpisodeClosureMode, EpisodeClosureReceipt, EpisodeDreamStatus, EpisodeEventLink, EpisodeListOptions, EpisodeType, MemoryEpisode, TurnRelation } from './EpisodeTypes.js';
interface CreateEpisodeInput {
    projectId: string;
    sessionId: string;
    sourceAgent?: string;
    topicPath?: string;
    episodeType: EpisodeType;
    importance: number;
    eventId: string;
    globalSeq?: number;
    occurredAt: number;
}
export interface ClaimedEpisodeDreamJob {
    episodeId: string;
    projectId: string;
    leaseId: string;
    modeHint: 'micro' | 'normal' | 'deep';
    attempts: number;
}
export declare class EpisodeStore {
    private readonly db;
    constructor(db: Database);
    createEpisode(input: CreateEpisodeInput): MemoryEpisode;
    findActiveEpisode(projectId: string, sessionId: string): MemoryEpisode | undefined;
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
    }): EpisodeEventLink;
    getEventLink(eventId: string): EpisodeEventLink | undefined;
    listEventLinks(episodeId: string): EpisodeEventLink[];
    reopenSoftEpisode(episodeId: string, now: number): MemoryEpisode;
    sealEpisode(episodeId: string, input: {
        mode: EpisodeClosureMode;
        reason: string;
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
    }): ClaimedEpisodeDreamJob[];
    completeDreamJob(episodeId: string, leaseId: string, candidateIds: string[], now: number): void;
    failDreamJob(episodeId: string, leaseId: string, error: string, now: number): void;
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
    deleteByProject(projectId: string): number;
    private enqueueDreamJob;
    private initializeSchema;
}
export {};
//# sourceMappingURL=EpisodeStore.d.ts.map