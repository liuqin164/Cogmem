import type Database from 'bun:sqlite';
import type { EventStore } from '../store/EventStore.js';
import type { MemoryAtlasStore } from '../store/MemoryAtlasStore.js';
export declare class MemoryAtlasIndexer {
    private db;
    private store;
    private readonly actions;
    constructor(db: Database, eventStore: EventStore, store: MemoryAtlasStore);
    rebuild(options?: {
        projectId?: string;
    }): {
        documents: number;
        actions: number;
    };
    ensureFresh(options: {
        projectId: string;
    }): {
        documents: number;
        actions: number;
        refreshed: boolean;
    };
    ensureAllFresh(): {
        documents: number;
        actions: number;
        refreshed: boolean;
        errors: Array<{
            projectId: string;
            error: string;
        }>;
    };
}
//# sourceMappingURL=MemoryAtlasIndexer.d.ts.map