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

import {
  installMultidimensionalMemoryGraph374,
  multidimensionalMemoryGraph374Issue,
} from '../0032_multidimensional_memory_graph_3_7_4.js';

/** The release schema version this build creates and accepts. */
export const LATEST_SCHEMA_VERSION = 32;

/**
 * Create the 4.0 schema in a database that has none.
 *
 * `temp_store = MEMORY` is not decoration: the installation drops and rebuilds
 * projections, which needs SQLite temporary space, and a process whose temp
 * directory is unusable otherwise fails with the generic `unable to open
 * database file` (#61). The migration runner set this before doing the same
 * work; the runner is gone, so the work carries it.
 */
export function createFinalSchema(db: Database): void {
  db.exec('PRAGMA temp_store = MEMORY');
  installMultidimensionalMemoryGraph374(db);
}

/** What is wrong with this database's schema, or undefined when nothing is. */
export function finalSchemaIssue(db: Database): string | undefined {
  return multidimensionalMemoryGraph374Issue(db);
}

/**
 * Whether this file already holds a Cogmem schema of some kind.
 *
 * A file holding nothing but the bootstrap marker is *not* one: that marker is
 * the first thing a creation writes and the last thing it removes, so a process
 * killed mid-creation leaves exactly that shape, and treating it as foreign
 * would strand a user who did nothing wrong.
 */
export function hasUserSchema(db: Database): boolean {
  const tables = (db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `).all() as Array<{ name: string }>).map((row) => row.name);
  return tables.some((name) => name !== '_cogmem_bootstrap_state');
}

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
export function assertSupportedDatabase(db: Database): void {
  if (tableExists(db, '_schema_migrations')) {
    const versions = (db.prepare(`SELECT version FROM _schema_migrations ORDER BY version`).all() as Array<{ version: string }>)
      .map((row) => row.version);
    if (versions.length > 0) {
      const newer = versions.find((version) => Number(version) > LATEST_SCHEMA_VERSION);
      if (newer) throw new Error(`unsupported_development_schema:${newer}`);
      if (versions.some((version) => Number(version) === LATEST_SCHEMA_VERSION)) {
        // A 4.0 database from the release that still recorded receipts. Verify
        // the schema only when it cannot identify itself by the marker.
        if (readsSchemaVersion(db) === LATEST_SCHEMA_VERSION) return;
        assertFinalSchema(db);
        return;
      }
      throw new Error(refusalMessage(versions[versions.length - 1]));
    }
  }

  if (readsSchemaVersion(db) === LATEST_SCHEMA_VERSION) return;
  throw new Error('unsupported_database_identity');
}

/** Verify a database against the final schema; throws when it does not match. */
export function assertFinalSchema(db: Database): void {
  const issue = finalSchemaIssue(db);
  if (issue === undefined) return;
  // The Atlas dirty triggers are reinstalled at runtime by the indexer that owns
  // them, so a missing or differing one is not a reason to refuse the file.
  if (issue.startsWith('trigger_definition:trg_memory_atlas_dirty_')
    || issue.startsWith('trigger_missing:trg_memory_atlas_dirty_')) return;
  throw new Error(`final_schema_postcondition_failed:0032:${issue}`);
}

function refusalMessage(latest: string): string {
  return `no_upgrade_path:${latest} - this is a Cogmem 3.x database and 4.0 does not upgrade an old database. `
    + 'Keep it for Cogmem 3.x, or point 4.0 at a new database path (a new `db_path` in the config, or --db for one command) '
    + 'and move history across from the 3.x install. This file has not been changed.';
}

function readsSchemaVersion(db: Database): number {
  try {
    const row = db.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get() as { value?: string } | undefined;
    return Number(row?.value ?? 0);
  } catch {
    return 0;
  }
}

function tableExists(db: Database, name: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}
