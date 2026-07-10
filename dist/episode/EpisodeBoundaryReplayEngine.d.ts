import type { MemoryEvent } from '../types/index.js';
import type { EpisodeBoundaryConfig, EpisodeBoundaryGuardCode, EpisodeBoundaryGuardResult } from './EpisodeBoundaryPolicy.js';
import type { EpisodeEventLink, EpisodeStatus, TurnRelation } from './EpisodeTypes.js';
export type EpisodeReplayPair = {
    link: EpisodeEventLink;
    event?: MemoryEvent;
};
export interface EpisodeBoundaryReplayState {
    eventCount: number;
    startedAt?: number;
    lastEventAt?: number;
    lastTrustedUserLocalDate?: string;
    trustedLocalDates: string[];
}
export interface EpisodeBoundaryReplayBoundary {
    boundaryIndex: number;
    beforeEventId?: string;
    afterEventId?: string;
    primaryUserEventId?: string;
    relation?: TurnRelation;
    reason: string;
    guardCodes: EpisodeBoundaryGuardCode[];
    warnings: string[];
    detected: boolean;
    effective: boolean;
    disposition: 'explicit' | 'soft_review' | 'shadow' | 'enforced';
    guardResult?: EpisodeBoundaryGuardResult;
}
export interface EpisodeBoundaryReplayResult {
    logicalTurns: EpisodeReplayPair[][];
    detectedBoundaries: EpisodeBoundaryReplayBoundary[];
    effectiveBoundaries: EpisodeBoundaryReplayBoundary[];
    warnings: string[];
    structuralAnomalies: string[];
    runningState: EpisodeBoundaryReplayState;
    policyDisposition: 'disabled' | 'shadow' | 'enforce';
}
export declare function replayEpisodeBoundaries(input: {
    episode: {
        startedAt?: number;
        status?: EpisodeStatus;
    };
    pairs: EpisodeReplayPair[];
    config: EpisodeBoundaryConfig;
    imported?: boolean;
    live?: boolean;
    initialState?: EpisodeBoundaryReplayState;
}): EpisodeBoundaryReplayResult;
/** Reduces accepted evidence without evaluating a new boundary. */
export declare function replayEpisodeBoundaryState(input: {
    episode: {
        startedAt?: number;
    };
    pairs: EpisodeReplayPair[];
    timezone?: string;
}): EpisodeBoundaryReplayState;
export declare function replayPendingTurnBoundary(input: {
    config: EpisodeBoundaryConfig;
    active?: EpisodeBoundaryReplayState;
    pendingPairs: EpisodeReplayPair[];
    primaryEvent: MemoryEvent;
    imported?: boolean;
}): EpisodeBoundaryGuardResult;
export declare function logicalTurnsFromPairs(pairs: EpisodeReplayPair[]): EpisodeReplayPair[][];
//# sourceMappingURL=EpisodeBoundaryReplayEngine.d.ts.map