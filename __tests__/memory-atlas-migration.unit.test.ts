import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { createMemoryKernel } from '../src/factory.js';

const migrateBin = join(import.meta.dir, '..', 'src', 'bin', 'migrate.ts');
const fixturePath = join(import.meta.dir, 'fixtures', 'migrations', 'main-3.7.3-schema31.sqlite.gz');

async function migrate(dbPath: string, args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn({
    cmd: ['bun', migrateBin, '--db', dbPath, ...args, '--json'],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function materializeFixture(directory: string): string {
  const dbPath = join(directory, 'memory.db');
  writeFileSync(dbPath, gunzipSync(readFileSync(fixturePath)));
  return dbPath;
}

function canonicalEvidence(db: Database): unknown {
  return {
    events: db.prepare(`SELECT event_id,project_id,payload_hash FROM memory_events ORDER BY event_id`).all(),
    neurons: db.prepare(`SELECT id,project_id,content FROM neurons ORDER BY id`).all(),
  };
}

function schema(db: Database): unknown {
  const tables = (db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_schema_migrations'
    ORDER BY name
  `).all() as Array<{ name: string }>).map(({ name }) => ({
    name,
    columns: (db.prepare(`PRAGMA table_info(${name})`).all() as Array<Record<string, unknown>>)
      .map(({ name: column, type, notnull, dflt_value, pk }) => ({ column, type, notnull, dflt_value, pk }))
      .sort((left, right) => String(left.column).localeCompare(String(right.column))),
    foreignKeys: db.prepare(`PRAGMA foreign_key_list(${name})`).all(),
  }));
  const indexes = (db.prepare(`
    SELECT name,tbl_name FROM sqlite_master
    WHERE type='index' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name: string; tbl_name: string }>).map(({ name, tbl_name }) => ({
    name,
    table: tbl_name,
    definition: (({ unique, origin, partial }) => ({ unique, origin, partial }))(
      db.prepare(`PRAGMA index_list(${tbl_name})`).all()
        .find((row) => (row as { name: string }).name === name) as { unique: number; origin: string; partial: number },
    ),
    columns: (db.prepare(`PRAGMA index_info(${name})`).all() as Array<{ name: string; seqno: number }>)
      .sort((left, right) => left.seqno - right.seqno)
      .map((column) => column.name),
  }));
  const triggers = (db.prepare(`
    SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name
  `).all() as Array<{ name: string; sql: string }>).map(({ name, sql }) => ({
    name,
    sql: sql.replace(/\s+/gu, '').toLowerCase(),
  }));
  return { tables, indexes, triggers };
}

test('real main 3.7.3 schema 31 upgrades atomically through the sole 0032 release migration', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cogmem-main-373-'));
  const dbPath = materializeFixture(directory);
  const before = new Database(dbPath);
  const evidence = canonicalEvidence(before);
  const receiptCount = (before.prepare(`SELECT COUNT(*) AS count FROM _schema_migrations`).get() as { count: number }).count;
  before.close();

  const dryRun = await migrate(dbPath, ['--dry-run']);
  expect({ exitCode: dryRun.exitCode, stderr: dryRun.stderr }).toEqual({ exitCode: 0, stderr: '' });
  expect(JSON.parse(dryRun.stdout).pending).toEqual(['0032']);
  const afterDryRun = new Database(dbPath);
  expect(afterDryRun.prepare(`SELECT COUNT(*) AS count FROM _schema_migrations`).get()).toEqual({ count: receiptCount });
  afterDryRun.close();

  const applied = await migrate(dbPath, ['--yes']);
  expect({ exitCode: applied.exitCode, stderr: applied.stderr }).toEqual({ exitCode: 0, stderr: '' });
  const result = JSON.parse(applied.stdout);
  expect(result.applied).toEqual(['0032']);
  expect(existsSync(result.backupPath)).toBe(true);

  const upgraded = new Database(dbPath);
  expect(canonicalEvidence(upgraded)).toEqual(evidence);
  expect(upgraded.prepare(`SELECT MAX(version) AS version FROM _schema_migrations`).get()).toEqual({ version: '0032' });
  expect(upgraded.prepare(`SELECT COUNT(*) AS count FROM _schema_migrations WHERE version>'0032'`).get()).toEqual({ count: 0 });
  expect(upgraded.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_scope_quarantine'`).get()).toBeNull();
  expect(upgraded.prepare(`PRAGMA integrity_check`).get()).toEqual({ integrity_check: 'ok' });
  expect(upgraded.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  upgraded.close();

  createMemoryKernel({ dbPath, projectTimeZone: 'Asia/Tokyo' }).close();
  const repeated = await migrate(dbPath, ['--yes']);
  expect(JSON.parse(repeated.stdout).applied).toEqual([]);
  rmSync(directory, { recursive: true, force: true });
});

test('fresh and main-schema-31 upgrade paths produce the same runtime schema', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cogmem-schema-equivalence-'));
  const upgradedPath = materializeFixture(directory);
  const freshPath = join(directory, 'fresh.db');

  const applied = await migrate(upgradedPath, ['--yes']);
  expect(applied.exitCode).toBe(0);
  createMemoryKernel({ dbPath: upgradedPath, projectTimeZone: 'Asia/Tokyo' }).close();
  createMemoryKernel({ dbPath: freshPath, projectTimeZone: 'Asia/Tokyo' }).close();

  const upgraded = new Database(upgradedPath);
  const fresh = new Database(freshPath);
  expect(schema(upgraded)).toEqual(schema(fresh));
  upgraded.close();
  fresh.close();
  rmSync(directory, { recursive: true, force: true });
});

test('development schema receipts fail fast without creating a migration backup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cogmem-development-schema-'));
  const dbPath = materializeFixture(directory);
  const db = new Database(dbPath);
  db.prepare(`INSERT INTO _schema_migrations(version,description,applied_at) VALUES(?,?,?)`)
    .run('0033', 'unreleased development schema', new Date(0).toISOString());
  db.close();

  const result = await migrate(dbPath, ['--yes', '--backup']);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain('unsupported_development_schema:0033');
  expect(readdirSync(directory).filter((name) => name.includes('pre-migrate') || name.endsWith('.bak'))).toEqual([]);
  rmSync(directory, { recursive: true, force: true });
});
