import type Database from 'bun:sqlite';
import type { MemoryFrameStatus, MemoryFrameV1 } from '../semantic/MemoryFrameTypes.js';
export interface MemoryFrameSaveInput {
    frame: MemoryFrameV1;
    sourceFingerprint: string;
    status?: MemoryFrameStatus;
    now?: number;
}
export declare class MemoryFrameStore {
    readonly db: Database;
    constructor(db: Database);
    save(input: MemoryFrameSaveInput): MemoryFrameV1;
    get(frameId: string): MemoryFrameV1 | null;
    list(projectId: string, options?: {
        statuses?: MemoryFrameStatus[];
        limit?: number;
    }): MemoryFrameV1[];
    publish(frameId: string, from: MemoryFrameStatus, to: MemoryFrameStatus, now?: number): boolean;
    private read;
}
export declare function frameSourceFingerprint(eventIds: string[], episodeId: string): string;
//# sourceMappingURL=MemoryFrameStore.d.ts.map