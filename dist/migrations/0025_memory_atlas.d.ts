import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';
export declare const migration_0025: Migration;
export declare function backfillAtlasDocuments(db: Database, projectId?: string): void;
export declare function installAtlasProjectionDirtyTriggers(db: Database): void;
//# sourceMappingURL=0025_memory_atlas.d.ts.map