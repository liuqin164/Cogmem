import type { MemoryEvent } from '../types/index.js';
import type { EpisodeStore } from './EpisodeStore.js';
export interface EpisodeSplitPlanSegment {
    segmentIndex: number;
    eventIds: string[];
    startEventId?: string;
    endEventId?: string;
    eventCount: number;
    reason: string;
}
export interface EpisodeSplitPlan {
    planId: string;
    projectId: string;
    episodeId: string;
    sourceFingerprint: string;
    segments: EpisodeSplitPlanSegment[];
    warnings: string[];
    requiresManualReview: boolean;
    applyableInCurrentVersion: false;
    applyCommand: null;
}
export declare class EpisodeSplitPlanner {
    private readonly store;
    private readonly resolveEvent?;
    constructor(store: EpisodeStore, resolveEvent?: ((eventId: string) => MemoryEvent | null | undefined) | undefined);
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