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
    CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO _meta (key, value) VALUES ('schema_version', '14');
    CREATE TABLE memory_edges (
      edge_id TEXT PRIMARY KEY, project_id TEXT, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
      relation_type TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
      confidence REAL NOT NULL, evidence_event_ids_json TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL
    );
  `);
  db.close();

  const dryRun = await run(['--db', dbPath, '--dry-run', '--json']);
  expect(dryRun.exitCode).toBe(0);
  expect(JSON.parse(dryRun.stdout).pending).toEqual(['0015', '0016', '0017']);

  const applied = await run(['--db', dbPath, '--yes', '--backup', '--json']);
  expect(applied.exitCode).toBe(0);
  const result = JSON.parse(applied.stdout);
  expect(result.applied).toEqual(['0015', '0016', '0017']);
  expect(existsSync(result.backupPath)).toBe(true);

  const migrated = new Database(dbPath);
  const columns = migrated.prepare('PRAGMA table_info(memory_edges)').all() as Array<{ name: string }>;
  expect(columns.map((column) => column.name)).toContain('activation');
  expect(migrated.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get()).toEqual({ value: '17' });
  migrated.close();

  const repeated = await run(['--db', dbPath, '--yes', '--json']);
  expect(JSON.parse(repeated.stdout).applied).toEqual([]);
});
