import type { DreamCuratorWorker } from '../engine/DreamCuratorWorker.js';
import type { EpisodeStore } from '../episode/EpisodeStore.js';
export type DreamTickMode = 'auto' | 'micro' | 'normal' | 'deep';
export type SelectedDreamMode = 'none' | 'micro' | 'normal' | 'deep';
export interface DreamTickOptions {
    projectId?: string;
    mode?: DreamTickMode;
    maxEpisodes?: number;
    now?: number;
    softSealGraceMs?: number;
    leaseMs?: number;
    maxAttempts?: number;
    maintenanceReason?: 'daily' | 'upgrade_repair';
}
export interface DreamTickResult {
    runId: string;
    projectId?: string;
    requestedMode: DreamTickMode;
    selectedMode: SelectedDreamMode;
    selectedModes: {
        micro: number;
        normal: number;
        deep: number;
    };
    skipped: boolean;
    reason: string;
    processedEpisodeCount: number;
    failedEpisodeCount: number;
    candidateCount: number;
    episodeIds: string[];
    candidateIds: string[];
    durationMs: number;
    failedEpisodes: Array<{
        episodeId: string;
        error: string;
        failureCategory: string;
        retryAfter?: number;
    }>;
}
export declare class DreamScheduler {
    private readonly episodeStore;
    private readonly curator;
    constructor(episodeStore: EpisodeStore, curator: DreamCuratorWorker);
    tick(options?: DreamTickOptions): Promise<DreamTickResult>;
    private recordRun;
}
//# sourceMappingURL=DreamScheduler.d.ts.map