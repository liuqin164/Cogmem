/**
 * 4.0's database entry points: create a new one, or refuse a database it did not
 * create. There is no third case where one is quietly rewritten (ADR-0007).
 *
 * Both callers - a file-backed kernel and an in-memory one - go through here, so
 * the decision is made once. The checks are ordered cheapest-first on purpose:
 * receipts settle an old database, and `_meta.schema_version` settles a new one,
 * without either paying for a walk over every table and projection. That walk is
 * what made the first version of this file slow enough to matter.
 */
import type Database from 'bun:sqlite';
/** The release schema version this build creates and accepts. */
export declare const LATEST_SCHEMA_VERSION = 32;
/**
 * Create the 4.0 schema in a database that has none.
 *
 * `temp_store = MEMORY` is not decoration: the installation drops and rebuilds
 * projections, which needs SQLite temporary space, and a process whose temp
 * directory is unusable otherwise fails with the generic `unable to open
 * database file` (#61). The migration runner set this before doing the same
 * work; the runner is gone, so the work carries it.
 */
export declare function createFinalSchema(db: Database): void;
/** What is wrong with this database's schema, or undefined when nothing is. */
export declare function finalSchemaIssue(db: Database): string | undefined;
/**
 * Whether this file already holds a Cogmem schema of some kind.
 *
 * A file holding nothing but the bootstrap marker is *not* one: that marker is
 * the first thing a creation writes and the last thing it removes, so a process
 * killed mid-creation leaves exactly that shape, and treating it as foreign
 * would strand a user who did nothing wrong.
 */
export declare function hasUserSchema(db: Database): boolean;
/**
 * Refuse a database 4.0 did not create, or accept a 4.0 one.
 *
 * Three cheap signals, in order, and no schema walk unless none of them applies:
 *
 * 1. **Receipts.** Only a migrated database has them, and this release creates
 *    the table and leaves it *empty* - so an empty one says nothing, and reading
 *    it as "old" would refuse the databases this build just created.
 * 2. **`_meta.schema_version`.** The kernel writes it once a database is set up,
 *    which is what separates "created by this release" from "a SQLite file
 *    someone pointed us at". A 3.x database has `_meta` too, with its own
 *    version, so the number is compared rather than the column merely found.
 * 3. **The schema itself**, for a 4.0 database that predates the marker.
 */
export declare function assertSupportedDatabase(db: Database): void;
/** Verify a database against the final schema; throws when it does not match. */
export declare function assertFinalSchema(db: Database): void;
//# sourceMappingURL=FinalSchema.d.ts.map