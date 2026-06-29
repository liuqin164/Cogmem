import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const migrateBin = join(import.meta.dir, '..', 'src', 'bin', 'migrate.ts');

async function run(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({ cmd: ['bun', migrateBin, ...args], stdout: 'pipe', stderr: 'pipe' });
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
  expect(JSON.parse(dryRun.stdout).pending).toEqual(['0015', '0016', '0017', '0018', '0019', '0020', '0021', '0022', '0023', '0024', '0025', '0026', '0027']);

  const applied = await run(['--db', dbPath, '--yes', '--backup', '--json']);
  expect(applied.exitCode).toBe(0);
  const result = JSON.parse(applied.stdout);
  expect(result.applied).toEqual(['0015', '0016', '0017', '0018', '0019', '0020', '0021', '0022', '0023', '0024', '0025', '0026', '0027']);
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
  expect(migrated.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get()).toEqual({ value: '27' });
  expect(migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'topic_nodes'`).get()).toEqual({ name: 'topic_nodes' });
  expect(migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_episodes'`).get()).toEqual({ name: 'memory_episodes' });
  const episodeColumns = migrated.prepare('PRAGMA table_info(memory_episodes)').all() as Array<{ name: string }>;
  expect(episodeColumns.map((column) => column.name)).toContain('dream_status');
  expect(episodeColumns.map((column) => column.name)).toContain('semantic_summary_json');
  expect(migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_atlas_documents'`).get()).toEqual({ name: 'memory_atlas_documents' });
  migrated.close();

  const repeated = await run(['--db', dbPath, '--yes', '--json']);
  expect(JSON.parse(repeated.stdout).applied).toEqual([]);
});
