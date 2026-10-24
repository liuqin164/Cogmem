import type { Migration } from '../types/Migration.js';
import { migration_0032 } from './0032_multidimensional_memory_graph_3_7_4.js';

/**
 * 4.0 ships one schema and no upgrade path (ADR-0007).
 *
 * There is no ordered migration list and no runner to replay one: a new database
 * is created from the final schema by `createFinalSchema`, and a database this
 * release did not create is refused. `migration_0032` remains because it owns
 * that final schema and its postcondition, and it is exported so the schema
 * definition has one home.
 */
export { migration_0032 };
export type { Migration };
