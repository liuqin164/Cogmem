import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeTempDir } from './helpers/tmp.js';

/**
 * `npm uninstall` cannot run our code, so the launcher `init` wrote stays behind pointing
 * at a directory that no longer exists. `cogmem cleanup` removes exactly that state — and
 * refuses to touch a launcher whose installation is still there, because removing that one
 * would break a working install.
 */
const bin = join(import.meta.dir, '..', 'src', 'bin', 'cleanup.ts');

async function cleanup(home: string, args: string[] = []) {
  const proc = Bun.spawn([process.execPath, bin, ...args, '--json'], {
    cwd: home, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, HOME: home, COGMEM_LAUNCHER_DIR: '' },
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(code, stderr).toBe(0);
  return JSON.parse(stdout) as { status: string; launcher: string; record: string; removed: string[] };
}

function writeLauncher(home: string, target: string): { launcher: string; record: string } {
  const dir = join(home, '.cogmem', 'bin');
  mkdirSync(dir, { recursive: true });
  const launcher = join(dir, 'cogmem');
  const record = join(dir, 'cogmem.target');
  writeFileSync(launcher, '#!/bin/sh\n');
  writeFileSync(record, `${target}\n${join(home, 'runtime')}\n`);
  return { launcher, record };
}

test('a launcher whose installation is gone is removed (#136)', async () => {
  const home = makeTempDir('cogmem-cleanup-stale-');
  const { launcher, record } = writeLauncher(home, join(home, 'gone', 'dist', 'bin', 'cogmem.js'));

  const result = await cleanup(home);
  expect(result.status).toBe('cleaned');
  expect(result.removed.sort()).toEqual([launcher, record].sort());
  expect(existsSync(launcher)).toBe(false);
  expect(existsSync(record)).toBe(false);
});

test('a launcher whose installation is still present is left alone (#136)', async () => {
  const home = makeTempDir('cogmem-cleanup-live-');
  const install = join(home, 'install', 'dist', 'bin', 'cogmem.js');
  mkdirSync(join(home, 'install', 'dist', 'bin'), { recursive: true });
  writeFileSync(install, '');
  const { launcher, record } = writeLauncher(home, install);

  const result = await cleanup(home);
  expect(result.status).toBe('installation_present');
  expect(result.removed).toEqual([]);
  expect(existsSync(launcher)).toBe(true);
  expect(existsSync(record)).toBe(true);
});

test('a dry run reports and removes nothing (#136)', async () => {
  const home = makeTempDir('cogmem-cleanup-dry-');
  const { launcher, record } = writeLauncher(home, join(home, 'gone', 'cogmem.js'));

  const result = await cleanup(home, ['--dry-run']);
  expect(result.status).toBe('cleaned');
  expect(result.removed.length).toBe(2);
  // The claim is the same; the files are the difference.
  expect(existsSync(launcher)).toBe(true);
  expect(existsSync(record)).toBe(true);
});

test('nothing to clean is not an error (#136)', async () => {
  const home = makeTempDir('cogmem-cleanup-none-');
  const result = await cleanup(home);
  expect(result.status).toBe('nothing_to_clean');
  expect(result.removed).toEqual([]);
});
