import type Database from 'bun:sqlite';
import type { Migration } from '../../types/Migration.js';
export declare const migration_0060: Migration;
export declare function installAtlasProjectionDirtyTriggersV2(db: Database): void;
export declare function executionProjectionAndAtlasReliabilitySatisfied(db: Database): boolean;
//# sourceMappingURL=0060_execution_projection_and_atlas_reliability.d.ts.map