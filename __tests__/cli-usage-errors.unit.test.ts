import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from './helpers/tmp.js';

const CLI = join(import.meta.dir, '..', 'src', 'bin', 'cogmem.ts');

function run(args: string[], cwd: string, stdin?: string): { code: number; out: string; err: string } {
  const r = spawnSync('bun', [CLI, ...args], { encoding: 'utf8', cwd, input: stdin, env: { ...process.env, HOME: cwd } });
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/**
 * A path the caller named explicitly is not a config unless it is a file. Treating it as one let some
 * commands keep going against whatever database they found, and made others fail with
 * `invalid_toml: ENOENT` — a typo that never read like a typo.
 */
test('an explicit --config that is not a file is refused, not silently ignored', () => {
  const dir = makeTempDir('cogmem-badcfg-');
  const missing = join(dir, 'typo.toml');
  for (const args of [
    ['memory', 'status', '--config', missing, '--json'],
    ['memory', 'list', '--limit', '1', '--config', missing, '--json'],
    ['dream', 'status', '--config', missing, '--json'],
  ]) {
    const r = run(args, dir);
    expect({ args: args[1], code: r.code }).toEqual({ args: args[1], code: 1 });
    expect(r.err).toContain(`Missing cogmem config at ${missing}`);
    // One sentence with no bare code in front of it: pin the first line, not a substring of it.
    expect(r.err.split('\n')[0]).toMatch(/^Missing cogmem config at /);
    expect(r.err.split('\n')[0]).not.toContain(':');
  }
  // A directory is not a config either.
  const asDir = run(['memory', 'status', '--config', dir, '--json'], dir);
  expect(asDir.code).toBe(1);
  expect(asDir.err).toContain('Missing cogmem config at');
});

test('a missing subcommand exits non-zero instead of printing usage as success', () => {
  const dir = makeTempDir('cogmem-nocmd-');
  for (const [label, args] of [
    ['memory', ['memory']],
    ['dream', ['dream']],
    ['episode', ['episode']],
    ['repair', ['repair']],
    ['strategy', ['strategy']],
  ] as const) {
    const r = run(args as string[], dir);
    expect({ label, code: r.code }).toEqual({ label, code: 1 });
    // Usage still reaches the reader, on the stream errors use.
    expect(`${r.out}${r.err}`).toMatch(/Usage:|needs a subcommand/);
    expect(r.out).not.toMatch(/^Usage:/);
  }
});

test('host-bridge answers a plain mistake with its own protocol, not a stack trace', () => {
  const dir = makeTempDir('cogmem-bridge-err-');
  const r = run(['host-bridge', 'recall', '--host', 'openclaw', '--project', 'p', '--agent', 'a',
    '--config', join(dir, 'typo.toml')], dir, JSON.stringify({ query: 'x' }));
  expect(r.code).toBe(1);
  const payload = JSON.parse(r.out) as { ok?: boolean; error?: { message?: string } };
  expect(payload.ok).toBe(false);
  expect(payload.error?.message).toContain('Missing cogmem config at');
  expect(r.err).not.toContain('at Object');
  expect(r.err).not.toContain('Bun v');
});

// Not asserted, and reported instead: malformed TOML is collected as a diagnostic rather than thrown,
// so every command answers rc=0 with an error inside its payload. `doctor` must stay that tolerant —
// describing a broken config is its job — so the fix belongs in the commands that need a usable one.
// Not asserted, and reported instead: malformed TOML is collected as a diagnostic rather than thrown,
// so every command answers rc=0 with an error inside its payload. `doctor` must stay that tolerant —
// describing a broken config is its job — so the fix belongs in the commands that need a usable one.
