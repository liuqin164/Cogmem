import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repairBin = join(coreRoot, 'src', 'bin', 'repair.ts');

async function runRepair(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ['bun', repairBin, ...args],
    cwd: coreRoot,
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

test('repair project-scope previews and applies empty project_id rows conservatively', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-repair-project-scope-')), 'memory.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE memory_events(event_id TEXT PRIMARY KEY, project_id TEXT);
    CREATE TABLE memory_atlas_documents(node_id TEXT PRIMARY KEY, project_id TEXT);
    INSERT INTO memory_events(event_id, project_id) VALUES ('evt-empty', ''), ('evt-openclaw', 'openclaw');
    INSERT INTO memory_atlas_documents(node_id, project_id) VALUES ('node-empty', NULL);
  `);
  db.close();

  const dryRun = await runRepair(['project-scope', '--db', dbPath, '--from', '', '--to', 'openclaw', '--dry-run', '--json']);
  expect(dryRun.stderr).toBe('');
  expect(dryRun.exitCode).toBe(0);
  const dryRunJson = JSON.parse(dryRun.stdout);
  expect(dryRunJson.dryRun).toBe(true);
  expect(dryRunJson.tables.map((row: { table: string }) => row.table)).toContain('memory_events');

  const afterDryRun = new Database(dbPath, { readonly: true });
  expect(afterDryRun.prepare(`SELECT COUNT(*) AS count FROM memory_events WHERE project_id=''`).get()).toEqual({ count: 1 });
  afterDryRun.close();

  const applied = await runRepair(['project-scope', '--db', dbPath, '--from', '', '--to', 'openclaw', '--apply', '--json']);
  expect(applied.stderr).toBe('');
  expect(applied.exitCode).toBe(0);
  expect(JSON.parse(applied.stdout).changed).toBe(2);

  const repaired = new Database(dbPath, { readonly: true });
  expect(repaired.prepare(`SELECT COUNT(*) AS count FROM memory_events WHERE project_id='openclaw'`).get()).toEqual({ count: 2 });
  expect(repaired.prepare(`SELECT COUNT(*) AS count FROM memory_atlas_documents WHERE project_id='openclaw'`).get()).toEqual({ count: 1 });
  repaired.close();
});

test('repair project-scope refuses empty-to-openclaw merge when another project exists', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-repair-project-scope-refuse-')), 'memory.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE memory_events(event_id TEXT PRIMARY KEY, project_id TEXT);
    INSERT INTO memory_events(event_id, project_id) VALUES ('evt-empty', ''), ('evt-other', 'other');
  `);
  db.close();

  const result = await runRepair(['project-scope', '--db', dbPath, '--from', '', '--to', 'openclaw', '--apply', '--json']);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain('Refusing project-scope repair');
});
