import type Database from 'bun:sqlite';
import type { EventStore } from '../store/EventStore.js';
import type { MemoryAtlasStore } from '../store/MemoryAtlasStore.js';
/** Builds source-anchored action frames from raw events; bindings improve the
 * target/topic facets but are not a prerequisite for an action to exist. */
export declare class ActionFrameExtractor {
    private db;
    private eventStore;
    private atlasStore;
    constructor(db: Database, eventStore: EventStore, atlasStore: MemoryAtlasStore);
    rebuild(projectId?: string): number;
    private clear;
    private resolveTarget;
}
//# sourceMappingURL=ActionFrameExtractor.d.ts.map