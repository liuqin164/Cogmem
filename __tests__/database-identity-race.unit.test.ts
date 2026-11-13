import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** The marker the concurrent initializer lands once its schema is up. */
function markInitialized(path: string): void {
  const db = new Database(path);
  // The other initializer is reading while this lands, exactly as two real initializers overlap;
  // without a busy timeout a momentary lock is a spurious `database is locked` in either process.
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('CREATE TABLE IF NOT EXISTS _meta(key TEXT PRIMARY KEY, value TEXT)');
  db.prepare('INSERT OR REPLACE INTO _meta(key, value) VALUES (?, ?)').run('schema_version', String(LATEST_SCHEMA_VERSION));
  db.close();
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'cogmem-identity-race-'));
}

const FINAL_SCHEMA_MODULE = join(import.meta.dir, '..', 'src', 'migrations', 'v3_7_4', 'FinalSchema.ts');

/**
 * The probe runs in the child and the *test* owns the clock (#212).
 *
 * The old shape spawned a writer child that had to land the marker inside the 1 s grace window while
 * the probe waited in the test process — so `bun` startup, script parsing and the 150 ms timer all
 * had to fit in that window, and a busy runner refused a database that was merely mid-initialization.
 * Here the child is the waiter: it announces READY from inside the window, the parent lands the
 * marker 150 ms later, and the child reports which verdict it reached. Process startup is outside
 * the window entirely.
 */
function probeScript(dbPath: string, readyPath: string, verdictPath: string): string {
  return `
    const { writeFileSync } = require('node:fs');
    const { Database } = require('bun:sqlite');
    const { assertSupportedDatabase } = await import(${JSON.stringify(FINAL_SCHEMA_MODULE)});
    const db = new Database(${JSON.stringify(dbPath)});
    // The probe stands in for a kernel connection, which configures a busy timeout; the marker
    // lands while this reads, and a momentary lock must not read as a foreign file.
    db.exec('PRAGMA busy_timeout = 2000');
    // READY says the grace loop is about to start, not that it has returned.
    writeFileSync(${JSON.stringify(readyPath)}, 'ready');
    try {
      assertSupportedDatabase(db);
      writeFileSync(${JSON.stringify(verdictPath)}, 'ok');
    } catch (error) {
      writeFileSync(${JSON.stringify(verdictPath)}, 'threw:' + (error && error.message));
      process.exitCode = 1;
    } finally {
      db.close();
    }
  `;
}

async function waitForFile(path: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`probe did not become ready within ${timeoutMs}ms`);
    await Bun.sleep(10);
  }
}

test('a populated database with no marker is given time for the writer initializing it', async () => {
  const dir = tempDir();
  try {
    const path = midInitialization(join(dir, 'mid-init.db'));
    const ready = join(dir, 'probe.ready');
    const verdict = join(dir, 'probe.verdict');
    const probe = Bun.spawn(['bun', '-e', probeScript(path, ready, verdict)], { stdout: 'ignore', stderr: 'pipe' });
    try {
      await waitForFile(ready);
      // The marker lands 150 ms into the wait, the way the other process's initializer lands it,
      // and well inside the 1 s window the product allows.
      await Bun.sleep(150);
      markInitialized(path);
      const code = await probe.exited;
      const text = readFileSync(verdict, 'utf8');
      expect({ code, text }).toEqual({ code: 0, text: 'ok' });
    } finally {
      probe.kill();
    }
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
