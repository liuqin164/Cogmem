import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { createMemoryKernel } from '../src/factory.js';
import { LATEST_SCHEMA_VERSION } from '../src/migrations/v3_7_4/FinalSchema.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #59: 4.0 creates a database or refuses one. It never upgrades one.
 *
 * This file used to test the migration runner - it accepted a 3.7.3 database and
 * upgraded it, rejected a half-applied one, replayed a stale plan under a lock,
 * and so on. That machinery is gone, so what is pinned here is the decision that
 * replaced it, including the part the acceptance calls out by name: a refused
 * file must be left alone.
 */

function tempDir(): string {
  return makeTempDir('cogmem-schema-gate-');
}

function fileDigest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** A database shaped like a Cogmem 3.x release: `_meta`, and receipts to 0031. */
function writeLegacyDatabase(path: string, extraReceipt?: string): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE _schema_migrations (version TEXT PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL);
    CREATE TABLE neurons (id TEXT PRIMARY KEY, project_id TEXT);
  `);
  db.prepare(`INSERT INTO _meta (key, value) VALUES ('schema_version', '31')`).run();
  for (let version = 15; version <= 31; version += 1) {
    db.prepare(`INSERT INTO _schema_migrations (version, description, applied_at) VALUES (?, 'legacy', '2026-01-01T00:00:00.000Z')`)
      .run(String(version).padStart(4, '0'));
  }
  if (extraReceipt) {
    db.prepare(`INSERT INTO _schema_migrations (version, description, applied_at) VALUES (?, 'legacy', '2026-01-01T00:00:00.000Z')`)
      .run(extraReceipt);
  }
  db.close();
}

describe('a database 4.0 creates', () => {
  test('is created, and identifies itself to the next process that opens it', () => {
    const dir = tempDir();
    const path = join(dir, 'memory.db');
    createMemoryKernel({ dbPath: path }).close();

    // The marker is what lets the next open accept this file without walking the
    // whole schema, so it is pinned rather than assumed. The receipts table is
    // created and left empty: 4.0 records no migration history.
    const db = new Database(path, { readonly: true });
    const marker = db.prepare(`SELECT value FROM _meta WHERE key='schema_version'`).get() as { value?: string } | undefined;
    const receipts = db.prepare(`SELECT COUNT(*) AS count FROM _schema_migrations`).get() as { count: number };
    db.close();

    expect(Number(marker?.value)).toBe(LATEST_SCHEMA_VERSION);
    expect(receipts.count).toBe(0);

    createMemoryKernel({ dbPath: path }).close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('the created schema matches the pinned 4.0 baseline, object for object', () => {
    const dir = tempDir();
    const path = join(dir, 'memory.db');
    createMemoryKernel({ dbPath: path }).close();

    const db = new Database(path, { readonly: true });
    const rows = db.prepare("SELECT type, name, IFNULL(sql,'') AS sql FROM sqlite_master ORDER BY type, name")
      .all() as Array<{ type: string; name: string; sql: string }>;
    db.close();

    const digest = createHash('sha256')
      .update(rows.map((row) => `${row.type}|${row.name}|${String(row.sql).replace(/\s+/g, ' ').trim()}`).join('\n'))
      .digest('hex');

    // The final schema, as installed by the part of the old migration 0032 that a
    // new database actually needed. The extraction was verified by comparing this
    // digest and per-table row counts against the original installer's output, so
    // this line is what keeps that equivalence from silently drifting: a
    // legitimate schema change updates it, and a projection or auxiliary object
    // that stopped installing fails here.
    expect(rows.length).toBe(501);
    expect(digest).toBe('28c9722a43abae280475855feb710fef423f07eb819bab568cef3314fadcaecf');
    rmSync(dir, { recursive: true, force: true });
  });

  test('an interrupted creation is treated as new, not as someone else\'s file', () => {
    const dir = tempDir();
    const path = join(dir, 'half-created.db');
    const db = new Database(path);
    db.exec('CREATE TABLE _cogmem_bootstrap_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), started_at INTEGER NOT NULL)');
    db.close();

    createMemoryKernel({ dbPath: path }).close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('a database 4.0 did not create', () => {
  test('a Cogmem 3.x database is refused, and left byte-identical', () => {
    const dir = tempDir();
    const path = join(dir, 'legacy.db');
    writeLegacyDatabase(path);
    const before = fileDigest(path);

    expect(() => createMemoryKernel({ dbPath: path })).toThrow(/no_upgrade_path:0031/);

    // Not modified, and no backup or journal beside it: the directory holds the
    // file that was there, and nothing else.
    expect(fileDigest(path)).toBe(before);
    expect(readdirSync(dir).sort()).toEqual(['legacy.db']);
    rmSync(dir, { recursive: true, force: true });
  });

  test('the refusal says what to do, not only what went wrong', () => {
    const dir = tempDir();
    const path = join(dir, 'legacy.db');
    writeLegacyDatabase(path);

    let message = '';
    try {
      createMemoryKernel({ dbPath: path });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('does not upgrade an old database');
    expect(message).toContain('new database path');
    expect(message).toContain('has not been changed');
    rmSync(dir, { recursive: true, force: true });
  });

  test('a file that is not a Cogmem database at all is refused as an unknown identity', () => {
    const dir = tempDir();
    const path = join(dir, 'other.db');
    const db = new Database(path);
    db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)');
    db.prepare('INSERT INTO notes (body) VALUES (?)').run('not cogmem');
    db.close();

    expect(() => createMemoryKernel({ dbPath: path })).toThrow(/unsupported_database_identity/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a development schema newer than this release is refused by version', () => {
    const dir = tempDir();
    const path = join(dir, 'future.db');
    writeLegacyDatabase(path, '0033');

    expect(() => createMemoryKernel({ dbPath: path })).toThrow(/unsupported_development_schema:0033/);
    rmSync(dir, { recursive: true, force: true });
  });
});
