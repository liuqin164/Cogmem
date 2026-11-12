import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tmp.js';

const BIN = join(import.meta.dir, '..', 'src', 'bin');

/**
 * Every entrypoint that can open a database must render a refusal the same way. This is a coverage
 * assertion, not a behaviour one: it fails when an entry gains a database open and is left out, which
 * is the failure mode that lets one command answer a refusal with a bare sentence.
 */
/**
 * Every file in `src/bin` belongs to exactly one of these three lists, and the guard asserts that
 * exhaustively — a new bin cannot appear unclassified. A derived rule was tried first and abandoned:
 * literal heuristics miss the entries that declare their flags through `assertCliArgs` or delegate
 * their database open, so it flagged two of twenty-four files that were already correct.
 */
const WIRED = [
  'compact', 'dream', 'episode', 'explain-recall', 'import', 'init',
  'memory', 'prospective', 'repair', 'snapshot', 'strategy', 'update',
];
/** Reaches a refusal through a path of its own, or does not speak the CLI protocol at all. */
const EXCEPTIONS: Record<string, string> = {
  'doctor': 'renders its own failing gate, which maps the same step definition',
  'observatory': 'answers over HTTP, where a CLI refusal document is not the protocol',
  'import-support': 'a helper module for import, not a command entry: errors surface at import.ts',
  'RefusalDocument': 'defines the shared exit every other entry calls',
};
/**
 * No database to be refused: shared helpers, the two dispatcher entry points (`cog` forwards to
 * `cogmem`), and commands that never open a kernel. `version-check-refresh` is the detached half
 * of the version check (#150): it reads the registry and writes a cache file, and it is silent by
 * contract, so it has no refusal document to render.
 */
const NO_DATABASE = ['CliArgs', 'CliJson', 'brain-eval', 'cleanup', 'cog', 'cogmem', 'normalize-transcript', 'update-release', 'version-check-refresh'];

test('every entrypoint that opens a database renders refusals through the shared document', () => {
  const entries = readdirSync(BIN).filter((file) => file.endsWith('.ts')).map((file) => file.slice(0, -3));
  expect(entries.length).toBeGreaterThan(15);
  // Exhaustive: every file is in exactly one list, so an unclassified bin fails here.
  expect([...WIRED, ...Object.keys(EXCEPTIONS), ...NO_DATABASE].sort()).toEqual([...entries].sort());
  for (const name of WIRED) {
    const source = readFileSync(join(BIN, `${name}.ts`), 'utf8');
    // The call, not the import: a file that imports the helper and never calls it is not covered.
    expect({ name, wired: /emitRefusalDocument\(|refusalDocumentFor\(/.test(source) }).toEqual({ name, wired: true });
  }
  for (const [name, why] of Object.entries(EXCEPTIONS)) expect(why.length).toBeGreaterThan(10);
});

/**
 * Its own fixtures, on purpose: a test that reads a file under `.cogmem/` passes on the machine that
 * made it and fails on a fresh clone.
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

test('the episode path answers both refusals with the contract', () => {
  const { foreign, old3x } = refusalFixtures();
  const cases = [
    [foreign, 'unsupported_database_identity', ['use_new_database', 'verify_database_path']],
    [old3x, 'no_upgrade_path', ['keep_with_3x', 'use_new_database']],
  ] as const;
  for (const [config, reason, ids] of cases) {
    const result = spawnSync('bun', [join(BIN, 'cogmem.ts'), 'episode', 'list', '--project', 'p',
      '--config', config, '--json'], { encoding: 'utf8' });
    const document = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(document.status).toBe('refused');
    expect(document.reason).toBe(reason);
    expect(document.command).toBe('episode');
    expect((document.nextSteps as Array<{ id: string }>).map((step) => step.id)).toEqual(ids);
    expect(result.status).not.toBe(0);
  }
});
