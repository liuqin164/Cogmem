import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The machine-readable half of a refusal: a failing gate carries the same two ways forward the human
 * message names, so an agent reading JSON does not have to parse a sentence.
 *
 * The fixture is a foreign SQLite file, which is exactly what the identity check refuses.
 */
test('a failing doctor gate carries the two ways forward as structured nextSteps', () => {
  const dir = makeTempDir('cogmem-refusal-steps-');
  const dbPath = join(dir, 'foreign.db');
  const sqlite = spawnSync('bun', ['-e', `const { Database } = require('bun:sqlite'); const db = new Database(${JSON.stringify(dbPath)}); db.exec('CREATE TABLE notes (id integer primary key, body text)'); db.close();`], { encoding: 'utf8' });
  expect(sqlite.status).toBe(0);
  const configPath = join(dir, 'config.toml');
  writeFileSync(configPath, `[core]\ndb_path = ${JSON.stringify(dbPath)}\n`);

  const run = spawnSync('bun', [join(import.meta.dir, '..', 'src', 'bin', 'cogmem.ts'), 'doctor', '--config', configPath, '--json'], { encoding: 'utf8' });
  const payload = JSON.parse(run.stdout) as {
    installGate?: { level?: string };
    nextSteps?: Array<{ id?: string; command?: string; safeForAutomation?: boolean }>;
  };
  expect(payload.installGate?.level).toBe('fail');
  const steps = payload.nextSteps ?? [];
  // Two ways forward, both actionable, matching the human message.
  expect(steps.length).toBeGreaterThanOrEqual(2);
  const ids = steps.map((step) => step.id);
  expect(ids).toContain('use_new_database');
  expect(ids).toContain('verify_database_path');
  // The contract gives a command only where a real one exists, so at least one step carries one and
  // any step that does must be a string.
  expect(steps.some((step) => typeof step.command === 'string')).toBe(true);
  for (const step of steps) if (step.command !== undefined) expect(typeof step.command).toBe('string');
  // A step that changes configuration is not offered as safe for unattended agents.
  expect(steps.find((step) => step.id === 'verify_database_path')?.safeForAutomation).toBe(false);
});
