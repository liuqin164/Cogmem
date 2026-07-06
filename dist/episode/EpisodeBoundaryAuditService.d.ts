import type { MemoryEvent } from '../types/index.js';
import type { EpisodeStore } from './EpisodeStore.js';
import type { EpisodeStatus } from './EpisodeTypes.js';
export interface EpisodeBoundaryAuditItem {
    episodeId: string;
    projectId: string;
    status: EpisodeStatus;
    sessionId: string;
    threadId?: string;
    sourceAgent?: string;
    storedEventCount: number;
    actualLinkedEventCount: number;
    startedAt: number;
    firstEventAt?: number;
    lastEventAt?: number;
    durationMs: number;
    maxEventGapMs: number;
    maxUserTurnGapMs: number;
    trustedLocalDates: string[];
    localDateConfidence: 'trusted' | 'unknown';
    crossesTrustedLocalDate: boolean;
    storedRelationCounts: Record<string, number>;
    strongShiftCount: number;
    ambiguousShiftCount: number;
    userEventCount: number;
    assistantEventCount: number;
    toolEventCount: number;
    systemEventCount: number;
    outOfOrderEventCount: number;
    sourceFingerprint: string;
    unresolvedEventCount: number;
    missingRawEventIds: string[];
    evidenceIntegrityStatus: 'ok' | 'missing_raw_events';
    requiresManualReview: boolean;
    severity: 'info' | 'warning' | 'critical';
    reasons: string[];
    warnings: string[];
    recommendedAction: 'none' | 'split-plan' | 'inspect';
}
export interface EpisodeBoundaryAuditResult {
    items: EpisodeBoundaryAuditItem[];
    nextCursor?: string;
}
export declare class EpisodeBoundaryAuditService {
    private readonly store;
    private readonly resolveEvent?;
    constructor(store: EpisodeStore, resolveEvent?: ((eventId: string) => MemoryEvent | null | undefined) | undefined);
    audit(options: {
        projectId?: string;
        episodeId?: string;
        status?: EpisodeStatus;
        limit?: number;
        cursor?: string;
        maxEvents?: number;
        maxDurationMs?: number;
        maxIdleGapMs?: number;
        timezone?: string;
    }): EpisodeBoundaryAuditResult;
    private auditEpisode;
}
//# sourceMappingURL=EpisodeBoundaryAuditService.d.ts.map