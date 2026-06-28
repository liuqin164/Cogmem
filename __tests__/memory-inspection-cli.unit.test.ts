import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const memoryBin = join(import.meta.dir, '..', 'src', 'bin', 'memory.ts');

async function run(args: string[]): Promise<Record<string, unknown>> {
  const proc = Bun.spawn({ cmd: ['bun', memoryBin, ...args], stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(stderr).toBe('');
  expect(exitCode).toBe(0);
  return JSON.parse(stdout) as Record<string, unknown>;
}

test('read-only status inspects an empty existing database without initializing the full Kernel schema', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-inspection-status-')), 'memory.db');
  new Database(dbPath).close();
  const output = await run(['status', '--db', dbPath, '--project', 'demo', '--json']);
  expect(output.rawEvents).toBe(0);
  expect(output.candidate).toBe(0);
  const db = new Database(dbPath, { readonly: true });
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all();
  db.close();
  expect(tables).toEqual([]);
});

test('read-only candidates inspects an empty existing database without creating candidate tables', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-inspection-candidates-')), 'memory.db');
  new Database(dbPath).close();
  const output = await run(['candidates', '--db', dbPath, '--project', 'demo', '--status', 'needs_confirmation', '--json']);
  expect(output.total).toBe(0);
  const db = new Database(dbPath, { readonly: true });
  expect(db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'`).get()).toEqual({ count: 0 });
  db.close();
});
