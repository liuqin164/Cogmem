import type Database from 'bun:sqlite';
import type { EventStore } from '../store/EventStore.js';
import type { MemoryAtlasStore } from '../store/MemoryAtlasStore.js';
export declare class ActionFrameExtractor {
    private db;
    private eventStore;
    private atlasStore;
    constructor(db: Database, eventStore: EventStore, atlasStore: MemoryAtlasStore);
    rebuild(projectId?: string): number;
}
//# sourceMappingURL=ActionFrameExtractor.d.ts.map