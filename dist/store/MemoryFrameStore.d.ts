import type Database from 'bun:sqlite';
import type { MemoryFrameStatus, MemoryFrameV1 } from '../semantic/MemoryFrameTypes.js';
export interface MemoryFrameSaveInput {
    frame: MemoryFrameV1;
    sourceFingerprint: string;
    status?: MemoryFrameStatus;
    publishStatus?: 'active' | 'needs_confirmation';
    now?: number;
    dreamJobLeaseId?: string;
    leaseUntil?: number;
    attemptGeneration?: number;
}
export declare class MemoryFrameStore {
    readonly db: Database;
    constructor(db: Database);
    getDatabase(): Database;
    save(input: MemoryFrameSaveInput): MemoryFrameV1;
    get(frameId: string): MemoryFrameV1 | null;
    getByEpisode(projectId: string, episodeId: string, statuses?: MemoryFrameStatus[]): MemoryFrameV1 | null;
    list(projectId: string, options?: {
        statuses?: MemoryFrameStatus[];
        limit?: number;
        offset?: number;
    }): MemoryFrameV1[];
    publish(frameId: string, from: MemoryFrameStatus, to?: MemoryFrameStatus, now?: number): boolean;
    publishStaged(frameIds: string[], now?: number): void;
    review(frameId: string, projectId: string, action: 'approve' | 'reject', actor: string, reason: string, now?: number): boolean;
    failStaged(frameIds: string[], now?: number): void;
    failStagedForEpisode(episodeId: string, leaseId?: string, now?: number): void;
    failStagedOlderThan(_cutoff: number, now?: number): number;
    supersedeEpisodes(episodeIds: string[], now?: number): number;
    deleteByProject(projectId: string, now?: number): number;
    private tableExists;
    private markDirty;
    private publishUnsafe;
    private hasPublishableEvidence;
    private read;
}
export declare function frameSourceFingerprint(eventIds: string[], episodeId: string): string;
//# sourceMappingURL=MemoryFrameStore.d.ts.map