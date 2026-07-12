import { type EpisodeReplayPair } from './EpisodeBoundaryReplayEngine.js';
import type { EpisodeClosureReceipt, MemoryEpisode } from './EpisodeTypes.js';
export interface EpisodeInvariantViolation {
    reason: string;
    severity: 'info' | 'warning' | 'critical';
    recommendedAction: 'none' | 'inspect' | 'split-plan';
    requiresManualReview: boolean;
}
export declare function validateEpisodeInvariants(input: {
    episode: MemoryEpisode;
    pairs: EpisodeReplayPair[];
    timezone?: string;
    closureReceipts?: EpisodeClosureReceipt[];
    dreamJobState?: string;
}): EpisodeInvariantViolation[];
//# sourceMappingURL=EpisodeInvariantValidator.d.ts.map