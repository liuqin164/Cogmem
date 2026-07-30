import type Database from 'bun:sqlite';
import type { Migration } from '../../types/Migration.js';
export declare const migration_0061: Migration;
export declare function runtimeScopeAndProjectionIntegritySatisfied(db: Database): boolean;
export declare function installAtlasProjectionDirtyTriggersV3(db: Database): void;
export declare function atlasProjectionDirtyTriggersV3Satisfied(db: Database): boolean;
//# sourceMappingURL=0061_runtime_scope_and_projection_integrity.d.ts.map