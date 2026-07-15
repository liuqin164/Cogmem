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
    private rebuildAliasIndex;
    constructor(db: Database, frameStore: MemoryFrameStore, atlasStore: MemoryAtlasStore);
    rebuild(projectId: string, now?: number): MemoryFrameProjectionResult;
    private rebuildUnsafe;
    private loadActiveAliasIndex;
    private nodeId;
    private upsertSupport;
    private upsertAlias;
    private tableExists;
    private hasColumn;
    private upsertEdge;
    private evidenceTime;
    private latestEvidenceTime;
    private evidenceLocalDate;
    private frameEvidenceTime;
}
//# sourceMappingURL=MemoryFrameProjector.d.ts.map