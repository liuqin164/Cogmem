import type { Migration } from '../types/Migration.js';
import { migration_0032 } from './0032_multidimensional_memory_graph_3_7_4.js';
/**
 * Ordered list of all schema migrations.
 * 4.0 baseline starts at 0032. Historical migrations (0001-0031) removed.
 * Add new migrations here in ascending version order.
 * MigrationRunner.up() applies only the pending ones.
 */
export declare const ALL_MIGRATIONS: Migration[];
export declare const KERNEL_MIGRATIONS: Migration[];
export { migration_0032 };
export { SchemaMigrationRunner } from './SchemaMigrationRunner.js';
export type { SchemaMigrationResult, SchemaMigrationRunOptions } from './SchemaMigrationRunner.js';
export type { Migration };
//# sourceMappingURL=index.d.ts.map