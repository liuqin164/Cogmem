import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tmp.js';

const CLI = join(import.meta.dir, '..', 'src', 'bin', 'cogmem.ts');

/** A foreign SQLite file, and a file shaped like a Cogmem 3.x database. */
function fixtures(): { foreign: string; old3x: string } {
  const dir = makeTempDir('cogmem-refusal-');
  const foreign = join(dir, 'foreign.db');
  const old3x = join(dir, 'old3x.db');
  const run = (name: string, sql: string): void => {
    const result = spawnSync('bun', ['-e', `const { Database } = require('bun:sqlite'); const db = new Database(${JSON.stringify(name)}); ${sql} db.close();`], { encoding: 'utf8' });
    expect(result.status).toBe(0);
  };
  run(foreign, `db.exec('CREATE TABLE notes (id integer primary key, body text)');`);
  run(old3x, `db.exec('CREATE TABLE _schema_migrations (id integer primary key, version integer)'); db.exec('INSERT INTO _schema_migrations VALUES (1, 31)'); db.exec('CREATE TABLE _meta (key text primary key, value text)'); db.exec("INSERT INTO _meta VALUES ('schema_version','31')");`);
  const foreignConfig = join(dir, 'c-foreign.toml');
  const oldConfig = join(dir, 'c-old3x.toml');
  writeFileSync(foreignConfig, `[core]\ndb_path = ${JSON.stringify(foreign)}\n`);
  writeFileSync(oldConfig, `[core]\ndb_path = ${JSON.stringify(old3x)}\n`);
  return { foreign: foreignConfig, old3x: oldConfig };
}

const runCli = (config: string, extra: string[] = []): { stdout: string; stderr: string; status: number } => {
  const result = spawnSync('bun', [CLI, 'memory', 'recall', '--config', config, '--project', 'p', '--query', 'x', ...extra], { encoding: 'utf8' });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status ?? -1 };
};

test('both refusals answer --json with the contract, and the message is the human sentence verbatim', () => {
  const { foreign, old3x } = fixtures();
  for (const [config, reason] of [[foreign, 'unsupported_database_identity'], [old3x, 'no_upgrade_path']] as const) {
    const json = runCli(config, ['--json']);
    const document = JSON.parse(json.stdout) as Record<string, unknown>;
    expect(document.schemaVersion).toBe('cogmem.cli.v1');
    expect(document.status).toBe('refused');
    expect(document.reason).toBe(reason);
    const steps = document.nextSteps as Array<{ id: string; action: string; safeForAutomation: boolean }>;
    expect(steps.length).toBe(2);
    expect(steps.map((step) => step.id)).toEqual(reason === 'no_upgrade_path'
      ? ['keep_with_3x', 'use_new_database']
      : ['use_new_database', 'verify_database_path']);
    for (const step of steps) expect(typeof step.action).toBe('string');
    // The human sentence, not a paraphrase: the plain run prints it byte for byte.
    // The human sentence is printed on stderr, unchanged by this work; compare the same stream.
    const human = runCli(config);
    expect((human.stdout + human.stderr).trim()).toBe(String(document.message).trim());
    expect(json.status).not.toBe(0);
  }
});

test('a non-refusal error is not dressed as a refusal', () => {
  // A healthy database answering "no such event" is an ordinary error; only a refused open becomes a
  // refusal document.
  const dir = makeTempDir('cogmem-no-refusal-');
  const dbPath = join(dir, 'brain.db');
  const created = spawnSync('bun', ['-e', `const { createMemoryKernel } = require(${JSON.stringify(join(import.meta.dir, '..', 'src', 'factory.ts'))}); createMemoryKernel({ dbPath: ${JSON.stringify(dbPath)} }).close();`], { encoding: 'utf8' });
  expect(created.status).toBe(0);
  const config = join(dir, 'config.toml');
  writeFileSync(config, `[core]
db_path = ${JSON.stringify(dbPath)}
`);
  const result = spawnSync('bun', [CLI, 'memory', 'show', '--event', 'nope', '--config', config, '--json'], { encoding: 'utf8' });
  expect(result.stdout).not.toContain('"status": "refused"');
});
