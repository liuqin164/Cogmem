/**
 * SQLite implementation of the shared memory region.
 *
 * The shared region is a single table on the same database file. Publishing is
 * idempotent on `item_hash`, retraction is soft so a subscriber's earlier
 * reasoning stays explainable, and only the publishing host may retract its own
 * item.
 */
import type { Database } from 'bun:sqlite';
import type { SharedItem, SharedMemoryPort, SharedRetraction } from '../../ports/index.js';
export declare class SqliteSharedMemory implements SharedMemoryPort {
    private readonly db;
    constructor(db: Database);
    publish(items: SharedItem[]): Promise<number>;
    retract(retraction: SharedRetraction): Promise<void>;
    subscribe(collections: string[], options?: {
        limit?: number;
    }): Promise<SharedItem[]>;
    explain(itemHash: string): Promise<{
        item: SharedItem;
        retractedAt: number | null;
    } | null>;
}
//# sourceMappingURL=SqliteSharedMemory.d.ts.map