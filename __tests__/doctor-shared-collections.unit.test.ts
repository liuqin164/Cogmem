import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { Database } from 'bun:sqlite';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteSharedMemory } from '../src/adapters/sqlite/SqliteSharedMemory.js';
import { createMemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

const CLI = join(import.meta.dir, '..', 'src', 'bin', 'cogmem.ts');

/** A self-contained install: its own directory, its own database, its own config file. */
function install(): { dir: string; configPath: string; dbPath: string } {
  const dir = makeTempDir('cogmem-doctor-shared-');
  const dbPath = join(dir, 'memory.db');
  const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  kernel.close();
  const configPath = join(dir, 'config.toml');
  writeFileSync(configPath, `[core]\ndb_path = ${JSON.stringify(dbPath)}\n`);
  return { dir, configPath, dbPath };
}

function doctor(configPath: string): { code: number; out: string } {
  const run = spawnSync('bun', [CLI, 'doctor', '--config', configPath, '--json'], { encoding: 'utf8' });
  return { code: run.status ?? -1, out: run.stdout ?? '' };
}

function human(configPath: string): string {
  const run = spawnSync('bun', [CLI, 'doctor', '--config', configPath], { encoding: 'utf8' });
  return `${run.stdout ?? ''}${run.stderr ?? ''}`;
}

/** #66 acceptance: doctor lists the collections, their owner and their size — and shows the switch (#146: the read rule). */
test('doctor lists a shared collection with its owner, its size and the read rule', () => {
  const { configPath, dbPath } = install();
  const db = new Database(dbPath);
  const shared = new SqliteSharedMemory(db);
  try {
    shared.publish([{ itemHash: 'h1', sourceHost: 'claude', sourceItem: 's1', collection: 'team-standards', payload: { t: 'x' }, publishedAt: 1 }]);
    shared.grantReader('team-standards', 'hermes', 'claude');
  } finally {
    db.close();
  }
  const listed = doctor(configPath);
  expect(listed.code).toBe(0);
  const payload = JSON.parse(listed.out) as { shared?: { enabled: boolean; collections: Array<Record<string, unknown>> } };
  expect(payload.shared?.enabled).toBe(false);
  expect(payload.shared?.collections).toHaveLength(1);
  expect(payload.shared?.collections[0]).toMatchObject({ collection: 'team-standards', ownerHost: 'claude', readers: ['hermes'], itemCount: 1 });
  // The human output names the same three facts.
  const text = human(configPath);
  expect(text).toContain('team-standards');
  expect(text).toContain('owner claude');
  // #146: the human line states the read rule instead of printing a list nobody can change.
  expect(text).toContain('readable by every agent that can connect');
});

/** #66 acceptance: a default install shares nothing, and says so rather than omitting the field. */
test('a default install reports sharing off with no collections', () => {
  const { configPath } = install();
  const listed = doctor(configPath);
  expect(listed.code).toBe(0);
  expect((JSON.parse(listed.out) as { shared?: unknown }).shared).toEqual({ enabled: false, collections: [] });
  expect(human(configPath)).toContain('sharing is off');
});
