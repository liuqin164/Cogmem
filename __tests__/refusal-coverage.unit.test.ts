import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tmp.js';

const BIN = join(import.meta.dir, '..', 'src', 'bin');

/**
 * Every entrypoint that can open a database must render a refusal the same way. This is a coverage
 * assertion, not a behaviour one: it fails when an entry gains a database open and is left out, which
 * is the failure mode that lets one command answer a refusal with a bare sentence.
 */
const WIRED = [
  'compact', 'connect', 'dream', 'episode', 'explain-recall', 'host-bridge', 'import', 'init',
  'memory', 'repair', 'prospective', 'snapshot', 'strategy', 'update',
];
/** Entries that reach a refusal through a path of their own, or cannot reach one at all. */
const NOT_WIRED: Record<string, string> = {
  'doctor': 'renders its own failing gate, which maps the same step definition',
  'import-support': 'a helper module for import, not a command entry: errors surface at import.ts',
};
/** Nothing to do with a database: they neither open a kernel nor accept a config. */
const NO_DATABASE = ['brain-eval', 'cleanup', 'cogmem', 'mcp', 'normalize-transcript', 'update-release', 'CliArgs', 'CliJson'];

test('every entrypoint that opens a database renders refusals through the shared document', () => {
  // The call, not the import: a file that imports the helper and never calls it is not covered.
  const CALL = /refusalDocumentFor\(\s*(error|err)\b/;
  for (const name of WIRED) {
    const source = readFileSync(join(BIN, `${name}.ts`), 'utf8');
    expect({ name, wired: CALL.test(source) }).toEqual({ name, wired: true });
  }
  // The exceptions are named, so a new entry cannot slip in unclassified.
  for (const [name, why] of Object.entries(NOT_WIRED)) {
    const source = readFileSync(join(BIN, `${name}.ts`), 'utf8');
    if (name === 'doctor') expect(source.includes('REFUSAL_NEXT_STEPS')).toBe(true);
    else expect(CALL.test(source)).toBe(false);
    expect(why.length).toBeGreaterThan(10);
  }
  for (const name of NO_DATABASE) {
    const source = readFileSync(join(BIN, `${name}.ts`), 'utf8');
    expect(source.includes('createMemoryKernel')).toBe(false);
  }
});

/**
 * Its own fixtures, on purpose: a test that reads a file under `.cogmem/` passes on the machine that
 * made it and fails on a fresh clone, which is exactly how this one shipped broken.
 */
function refusalFixtures(): { foreign: string; old3x: string } {
  const dir = makeTempDir('cogmem-refusal-coverage-');
  const foreign = join(dir, 'foreign.db');
  const old3x = join(dir, 'old3x.db');
  const create = (file: string, sql: string): void => {
    const result = spawnSync('bun', ['-e', `const { Database } = require('bun:sqlite'); const db = new Database(${JSON.stringify(file)}); ${sql} db.close();`], { encoding: 'utf8' });
    expect(result.status).toBe(0);
  };
  create(foreign, `db.exec('CREATE TABLE notes (id integer primary key, body text)');`);
  create(old3x, `db.exec('CREATE TABLE _schema_migrations (id integer primary key, version integer)'); db.exec('INSERT INTO _schema_migrations VALUES (1, 31)'); db.exec('CREATE TABLE _meta (key text primary key, value text)'); db.exec("INSERT INTO _meta VALUES ('schema_version','31')");`);
  const foreignConfig = join(dir, 'c-foreign.toml');
  const oldConfig = join(dir, 'c-old3x.toml');
  writeFileSync(foreignConfig, `[core]\ndb_path = ${JSON.stringify(foreign)}\n`);
  writeFileSync(oldConfig, `[core]\ndb_path = ${JSON.stringify(old3x)}\n`);
  return { foreign: foreignConfig, old3x: oldConfig };
}

test('host-bridge, the path every host turn takes, answers both refusals with the contract', () => {
  const { foreign, old3x } = refusalFixtures();
  const cases = [
    [foreign, 'unsupported_database_identity', ['use_new_database', 'verify_database_path']],
    [old3x, 'no_upgrade_path', ['keep_with_3x', 'use_new_database']],
  ] as const;
  for (const [config, reason, ids] of cases) {
    const result = spawnSync('bun', [join(BIN, 'cogmem.ts'), 'host-bridge', 'recall', '--project', 'p',
      '--agent', 'a', '--host', 'openclaw', '--config', config], {
      encoding: 'utf8', input: JSON.stringify({ query: 'x' }),
    });
    const document = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(document.status).toBe('refused');
    expect(document.reason).toBe(reason);
    expect(document.command).toBe('host-bridge recall');
    expect((document.nextSteps as Array<{ id: string }>).map((step) => step.id)).toEqual(ids);
    expect(result.status).not.toBe(0);
  }
});
