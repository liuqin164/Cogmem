import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LATEST_SCHEMA_VERSION, assertSupportedDatabase, createFinalSchema } from '../src/migrations/v3_7_4/FinalSchema.js';

/**
 * The shape a concurrent initializer leaves: real user tables, no `_meta.schema_version` yet. That
 * is exactly what a second writer starting at the same moment sees, and it used to be refused as
 * `unsupported_database_identity` (#126).
 */
function midInitialization(path: string): string {
  const db = new Database(path);
  createFinalSchema(db);
  db.close();
  return path;
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'cogmem-identity-race-'));
}

test('a populated database with no marker is given time for the writer initializing it', async () => {
  const dir = tempDir();
  try {
    const path = midInitialization(join(dir, 'mid-init.db'));
    // The marker lands 150 ms in, the way the other process's initializer lands it.
    const writer = Bun.spawn(['bun', '-e', `
      const { Database } = require('bun:sqlite');
      const db = new Database(${JSON.stringify(path)});
      setTimeout(() => {
        db.exec('CREATE TABLE IF NOT EXISTS _meta(key TEXT PRIMARY KEY, value TEXT)');
        db.prepare('INSERT OR REPLACE INTO _meta(key, value) VALUES (?, ?)').run('schema_version', ${JSON.stringify(String(LATEST_SCHEMA_VERSION))});
        db.close();
      }, 150);
    `], { stdout: 'ignore', stderr: 'pipe' });

    const probe = new Database(path);
    expect(() => assertSupportedDatabase(probe)).not.toThrow();
    probe.close();
    expect(await writer.exited).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a populated database that stays unmarked is still refused', () => {
  const dir = tempDir();
  try {
    const path = midInitialization(join(dir, 'foreign.db'));
    const probe = new Database(path);
    // No writer is coming: the file is simply not ours, and the refusal has to survive the wait.
    expect(() => assertSupportedDatabase(probe)).toThrow('unsupported_database_identity');
    probe.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
