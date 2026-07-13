import type Database from 'bun:sqlite';
import type { MemoryFrameStore } from '../store/MemoryFrameStore.js';
import type { MemoryAtlasStore } from '../store/MemoryAtlasStore.js';
export interface MemoryFrameProjectionResult {
    frames: number;
    nodes: number;
    edges: number;
    needsReview: number;
}
export declare class MemoryFrameProjector {
    private readonly db;
    private readonly frameStore;
    private readonly atlasStore;
    constructor(db: Database, frameStore: MemoryFrameStore, atlasStore: MemoryAtlasStore);
    rebuild(projectId: string, now?: number): MemoryFrameProjectionResult;
    private nodeId;
    private upsertSupport;
    private upsertAlias;
    private upsertEdge;
    private evidenceTime;
}
//# sourceMappingURL=MemoryFrameProjector.d.ts.map