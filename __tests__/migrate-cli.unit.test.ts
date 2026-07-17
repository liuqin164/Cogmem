import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createMemoryKernel } from '../src/factory.js';
import { LEGACY_MIGRATION_RECEIPT_PROFILES } from '../src/migrations/MigrationDigestManifest.js';

const migrateBin = join(import.meta.dir, '..', 'src', 'bin', 'migrate.ts');
const distMigrateBin = join(import.meta.dir, '..', 'dist', 'bin', 'migrate.js');

async function run(args: string[], bin = migrateBin): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({ cmd: ['bun', bin, ...args], stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

test('cogmem migrate plans and upgrades a 2.7.1 database with a backup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-migrate-'));
  const dbPath = join(dir, 'memory.db');
  const db = new Database(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA wal_autocheckpoint = 0;
    CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO _meta (key, value) VALUES ('schema_version', '14');
    CREATE TABLE legacy_wal_evidence (value TEXT NOT NULL);
    INSERT INTO legacy_wal_evidence (value) VALUES ('must-survive-backup');
    CREATE TABLE memory_edges (
      edge_id TEXT PRIMARY KEY, project_id TEXT, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
      relation_type TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
      confidence REAL NOT NULL, evidence_event_ids_json TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL
    );
  `);

  const dryRun = await run(['--db', dbPath, '--dry-run', '--json']);
  expect(dryRun.exitCode).toBe(0);
    expect(JSON.parse(dryRun.stdout).pending).toEqual(['0015', '0016', '0017', '0018', '0019', '0020', '0021', '0022', '0023', '0024', '0025', '0026', '0027', '0028', '0029', '0030', '0031', '0032', '0033', '0034', '0035', '0036', '0037', '0038', '0039', '0040', '0041', '0042', '0043', '0044', '0045', '0046', '0047', '0048', '0049', '0050']);
  expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_migrations'`).get()).toBeNull();

  const applied = await run(['--db', dbPath, '--yes', '--backup', '--json']);
  expect(applied.exitCode).toBe(0);
  const result = JSON.parse(applied.stdout);
    expect(result.applied).toEqual(['0015', '0016', '0017', '0018', '0019', '0020', '0021', '0022', '0023', '0024', '0025', '0026', '0027', '0028', '0029', '0030', '0031', '0032', '0033', '0034', '0035', '0036', '0037', '0038', '0039', '0040', '0041', '0042', '0043', '0044', '0045', '0046', '0047', '0048', '0049', '0050']);
  expect(existsSync(result.backupPath)).toBe(true);
  const backup = new Database(result.backupPath, { readonly: true });
  expect(backup.prepare('SELECT value FROM legacy_wal_evidence').get()).toEqual({
    value: 'must-survive-backup',
  });
  backup.close();
  db.close();

  const migrated = new Database(dbPath);
  const columns = migrated.prepare('PRAGMA table_info(memory_edges)').all() as Array<{ name: string }>;
  expect(columns.map((column) => column.name)).toContain('activation');
  const prospectiveIndexes = migrated.prepare(`PRAGMA index_list(prospective_memories)`).all() as Array<{ name: string }>;
  expect(prospectiveIndexes.map((index) => index.name)).toContain('idx_prospective_project_status_deferred');
  const transitionIndexes = migrated.prepare(`PRAGMA index_list(prospective_memory_transitions)`).all() as Array<{ name: string }>;
  expect(transitionIndexes.map((index) => index.name)).toContain('idx_prospective_transitions_candidate');
  const strategyIndexes = migrated.prepare(`PRAGMA index_list(context_strategy_outcomes)`).all() as Array<{ name: string }>;
  expect(strategyIndexes.map((index) => index.name)).toContain('idx_context_strategy_project_time');
  expect(migrated.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get()).toEqual({ value: '50' });
  expect(migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'topic_nodes'`).get()).toEqual({ name: 'topic_nodes' });
  expect(migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_episodes'`).get()).toEqual({ name: 'memory_episodes' });
  expect(migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_memory_episodes_one_active_scope'`).get()).toEqual({ name: 'idx_memory_episodes_one_active_scope' });
  const episodeColumns = migrated.prepare('PRAGMA table_info(memory_episodes)').all() as Array<{ name: string }>;
  expect(episodeColumns.map((column) => column.name)).toContain('dream_status');
  expect(episodeColumns.map((column) => column.name)).toContain('semantic_summary_json');
  const eventTable = migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_events'`).get();
  if (eventTable) {
    const eventColumns = migrated.prepare('PRAGMA table_info(memory_events)').all() as Array<{ name: string }>;
    expect(eventColumns.map((column) => column.name)).toContain('local_date_source');
  }
  const episodeEventIndexes = migrated.prepare(`PRAGMA index_list(memory_episode_events)`).all() as Array<{ name: string }>;
  expect(episodeEventIndexes.map((index) => index.name)).toContain('idx_memory_episode_events_episode_position_unique');
  expect(migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_atlas_documents'`).get()).toEqual({ name: 'memory_atlas_documents' });
  migrated.close();

  const repeated = await run(['--db', dbPath, '--yes', '--json']);
  expect(JSON.parse(repeated.stdout).applied).toEqual([]);

  const legacyReceipts = new Database(dbPath);
  const profile = LEGACY_MIGRATION_RECEIPT_PROFILES.f71b20a_source!;
  const update = legacyReceipts.prepare(`UPDATE _schema_migrations SET checksum=? WHERE version=?`);
  for (const [version, checksum] of Object.entries(profile)) update.run(checksum, version);
  legacyReceipts.close();
  const normalized = await run(['--db', dbPath, '--yes', '--json']);
  expect(normalized.exitCode).toBe(0);
  const kernel = createMemoryKernel({ dbPath });
  kernel.close();
});

test('real f71b20a source and dist databases upgrade through current source and dist', async () => {
  const fixtures = ['source', 'dist'] as const;
  const targets = [migrateBin, distMigrateBin] as const;
  for (const fixture of fixtures) {
    for (const target of targets) {
      const dir = mkdtempSync(join(tmpdir(), `cogmem-f71-${fixture}-`));
      const dbPath = join(dir, 'memory.db');
      const fixturePath = join(import.meta.dir, 'fixtures', 'migrations', `f71b20a-${fixture}.sqlite.gz`);
      writeFileSync(dbPath, gunzipSync(readFileSync(fixturePath)));

      const upgraded = await run(['--db', dbPath, '--yes', '--json'], target);
      expect({ fixture, target: target === migrateBin ? 'source' : 'dist', stderr: upgraded.stderr, exitCode: upgraded.exitCode }).toMatchObject({ exitCode: 0 });
      expect(JSON.parse(upgraded.stdout).applied).toEqual(['0046', '0047', '0048', '0049', '0050']);

      const db = new Database(dbPath, { readonly: true });
      expect(db.prepare(`SELECT MAX(version) AS version FROM _schema_migrations`).get()).toEqual({ version: '0050' });
      expect(db.prepare(`SELECT COUNT(*) AS count FROM _schema_migrations WHERE checksum IS NULL OR checksum=''`).get()).toEqual({ count: 0 });
      db.close();

      const kernel = createMemoryKernel({ dbPath });
      kernel.close();
    }
  }
});
