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
    private readonly projectTimeZone?;
    private rebuildAliasIndex;
    private affectedNodeIds;
    constructor(db: Database, frameStore: MemoryFrameStore, atlasStore: MemoryAtlasStore, projectTimeZone?: string | undefined);
    rebuild(projectId: string, now?: number, options?: {
        canonicalDocumentsRebuilt?: boolean;
    }): MemoryFrameProjectionResult;
    private rebuildUnsafe;
    private loadActiveAliasIndex;
    private nodeId;
    private upsertSupport;
    private contributeSupport;
    private flushNodeSnapshots;
    /** Preserve legacy/governed document fields as an authority support before
     * Frame reduction can touch a shared canonical node. */
    private ensureCanonicalBaselineSupport;
    private refreshCanonicalBaselineSupports;
    private contributeAlias;
    private flushAliasSnapshots;
    private upsertAlias;
    private tableExists;
    private hasColumn;
    private contributeEdge;
    private flushEdgeSnapshots;
    private resolveCurrentStates;
    private isActiveEndpoint;
    private reduceAffectedDocuments;
    private evidenceTime;
    private latestEvidenceOrder;
    private evidenceLocalDate;
    private frameEvidenceTime;
}
//# sourceMappingURL=MemoryFrameProjector.d.ts.map