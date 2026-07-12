import type { MemoryEvent } from '../types/index.js';
import type { EpisodeStore } from './EpisodeStore.js';
import type { TurnRelation } from './EpisodeTypes.js';
import type { EpisodeBoundaryConfig } from './EpisodeBoundaryPolicy.js';
export declare const EPISODE_SPLIT_PLANNER_VERSION = "episode_split_preview.v1";
export interface EpisodeSplitPlanSegment {
    segmentIndex: number;
    eventIds?: string[];
    eventIdsHash: string;
    eventIdsOmitted: number;
    startEventId?: string;
    endEventId?: string;
    eventCount: number;
    reason: string;
    startedAt?: number;
    endedAt?: number;
    userEventCount: number;
    assistantEventCount: number;
    toolEventCount: number;
    systemEventCount: number;
}
export interface EpisodeSplitProposedBoundary {
    boundaryIndex: number;
    beforeEventId?: string;
    afterEventId?: string;
    primaryUserEventId?: string;
    reason: string;
    relation?: TurnRelation;
    effective?: boolean;
    disposition?: 'explicit' | 'soft_review' | 'shadow' | 'enforced';
}
export interface EpisodeSplitImpactInventory {
    eventCount: number;
    userEventCount: number;
    assistantEventCount: number;
    toolEventCount: number;
    systemEventCount: number;
    hardShiftCount: number;
    trustedLocalDates: string[];
}
export interface EpisodeSplitPlan {
    planId: string;
    plannerVersion: string;
    projectId: string;
    episodeId: string;
    sourceFingerprint: string;
    policyFingerprint: string;
    normalizedPolicy: {
        enabled: boolean;
        maxEvents: number;
        maxDurationMs: number;
        maxIdleGapMs: number;
        splitOnTrustedLocalDateChange: boolean;
        mode: string;
        applyToLive: boolean;
        applyToImports: boolean;
        policyVersion: string;
        timezone?: string;
    };
    proposedBoundaries: EpisodeSplitProposedBoundary[];
    impactInventory: EpisodeSplitImpactInventory;
    segments: EpisodeSplitPlanSegment[];
    warnings: string[];
    unresolvedEventCount: number;
    missingRawEventIds: string[];
    evidenceIntegrityStatus: 'ok' | 'missing_raw_events';
    requiresManualReview: boolean;
    applyableInCurrentVersion: false;
    applyCommand: null;
}
export declare class EpisodeSplitPlanner {
    private readonly store;
    private readonly resolveEvent?;
    private readonly liveBoundaryConfig;
    private readonly liveConfigDiagnostics;
    constructor(store: EpisodeStore, resolveEvent?: ((eventId: string) => MemoryEvent | null | undefined) | undefined, liveBoundaryConfig?: Partial<EpisodeBoundaryConfig>, liveConfigDiagnostics?: Array<{
        code: string;
    }>);
    plan(options: {
        projectId: string;
        episodeId: string;
        maxEvents?: number;
        maxDurationMs?: number;
        maxIdleGapMs?: number;
        timezone?: string;
        includeEventIds?: boolean;
    }): EpisodeSplitPlan;
}
//# sourceMappingURL=EpisodeSplitPlanner.d.ts.map