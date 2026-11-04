import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

test('host-bridge, the path every host turn takes, answers both refusals with the contract', () => {
  const dir = join(import.meta.dir, '..', '.cogmem', 'refusecheck');
  const cases = [
    ['c-foreign.toml', 'unsupported_database_identity', ['use_new_database', 'verify_database_path']],
    ['c-old3x.toml', 'no_upgrade_path', ['keep_with_3x', 'use_new_database']],
  ] as const;
  for (const [config, reason, ids] of cases) {
    const result = spawnSync('bun', [join(BIN, 'cogmem.ts'), 'host-bridge', 'recall', '--project', 'p',
      '--agent', 'a', '--host', 'openclaw', '--config', join(dir, config)], {
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
