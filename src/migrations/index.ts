import type { Migration } from '../types/Migration.js';
import { migration_0032 } from './0032_multidimensional_memory_graph_3_7_4.js';

/**
 * Ordered list of all schema migrations.
 * 4.0 baseline starts at 0032. Historical migrations (0001-0031) removed.
 * Add new migrations here in ascending version order.
 * MigrationRunner.up() applies only the pending ones.
 */
export const ALL_MIGRATIONS: Migration[] = [
  migration_0032,
];

// Core stores bootstrap the pre-0015 tables themselves. Running the early
// historical migrations against a fresh kernel would try to ALTER optional
// legacy tables that do not exist yet. The kernel still runs every migration
// from the first schema that owns the runtime tables through the latest one;
// the CLI remains able to replay the complete historical chain.
export const KERNEL_MIGRATIONS: Migration[] = ALL_MIGRATIONS;

export { migration_0032 };
export { SchemaMigrationRunner } from './SchemaMigrationRunner.js';
export type { SchemaMigrationResult, SchemaMigrationRunOptions } from './SchemaMigrationRunner.js';
export type { Migration };
