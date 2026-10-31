import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  cogmemShimPath,
  ensureCogmemShim,
  hasCogmemShim,
  readCogmemShimTarget,
  resolveCogmemInvocation,
  writeCogmemShim,
} from '../src/install/InstallSteps.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #114. A host configuration outlives the installation it was written from: the npm
 * prefix changes, the checkout moves, the package manager changes. `connect` used to
 * resolve the installation's own absolute path and bake it into every host artifact,
 * which is the root cause behind #86, #94 and #96 — each answered by noticing harder
 * rather than by not writing the path.
 *
 * A launcher at a fixed per-user path is the way out, and these tests are about the
 * two properties that make it one: nothing but that path is written down, and the
 * installation is resolved when the launcher runs.
 */

function fakeInstall(root: string, dir: string): string {
  const installDir = join(root, dir);
  mkdirSync(installDir, { recursive: true });
  const bin = join(installDir, 'cogmem');
  // Prints the path that actually ran, so a test can tell which installation answered.
  writeFileSync(bin, '#!/bin/sh\necho "ran:$0" "$@"\n');
  chmodSync(bin, 0o755);
  return bin;
}

function run(bin: string, env: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(bin, ['recall', '--project', 'p'], {
    encoding: 'utf8',
    env: { ...env, PATH: env.PATH ?? '' },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test("a host configuration pointing at the launcher survives the installation moving (#114)", () => {
  const root = makeTempDir('cogmem-shim-');
  const env = { HOME: join(root, 'home'), PATH: '/usr/bin:/bin' };
  const installed = fakeInstall(root, 'install-a');

  const shim = writeCogmemShim({ env, target: installed });
  expect(shim?.shim).toBe(cogmemShimPath(env));
  expect(hasCogmemShim(env)).toBe(true);
  expect(run(shim!.shim, env).stdout.trim()).toBe(`ran:${installed} recall --project p`);

  // The installation moves. The host configuration is not touched, and the path it
  // would have named before this — the installation's own — no longer exists.
  const moved = join(root, 'install-b');
  renameSync(join(root, 'install-a'), moved);
  expect(readCogmemShimTarget(env)).toBeUndefined();
  const onPath = { ...env, PATH: `${moved}:/usr/bin:/bin` };
  expect(run(shim!.shim, onPath).stdout.trim()).toBe(`ran:${join(moved, 'cogmem')} recall --project p`);

  // With nothing to run, it says so and exits 127 rather than running something else.
  const nowhere = run(shim!.shim, { ...onPath, PATH: '/nonexistent' });
  expect(nowhere.status).toBe(127);
  expect(nowhere.stderr).toContain('found no installation to run');
  expect(nowhere.stdout).toBe('');
});

test('the recorded installation wins, and COGMEM_BIN wins over it (#114)', () => {
  const root = makeTempDir('cogmem-shim-recorded-');
  const env = { HOME: join(root, 'home'), PATH: '/usr/bin:/bin' };
  const recorded = fakeInstall(root, 'recorded');
  const other = fakeInstall(root, 'other');
  const shim = writeCogmemShim({ env, target: recorded })!;

  const asked = { ...env, PATH: `${join(root, 'other')}:/usr/bin:/bin` };
  expect(run(shim.shim, asked).stdout.trim()).toBe(`ran:${recorded} recall --project p`);
  expect(run(shim.shim, { ...asked, COGMEM_BIN: other }).stdout.trim()).toBe(`ran:${other} recall --project p`);
});

test('the launcher is the invocation a host configuration gets, once it exists (#114)', () => {
  const root = makeTempDir('cogmem-shim-invocation-');
  const env = { HOME: join(root, 'home'), PATH: '/usr/bin:/bin' };
  const installed = fakeInstall(root, 'install');
  const argv1 = join(root, 'install', 'cogmem');
  const onPath = { ...env, PATH: `${join(root, 'install')}:${env.PATH}` };

  // Before a launcher exists the previous answer stands, so nothing changes for an
  // installation that has not written one yet.
  expect(resolveCogmemInvocation(onPath, argv1)).toBe('cogmem');

  writeCogmemShim({ env, target: installed });
  expect(resolveCogmemInvocation(onPath, argv1)).toBe(cogmemShimPath(env));
  // An operator who names the binary still means it.
  expect(resolveCogmemInvocation({ ...onPath, COGMEM_BIN: installed }, argv1)).toBe(installed);
});

test('a source checkout has no installation to point at, so no launcher is written (#114)', () => {
  const root = makeTempDir('cogmem-shim-checkout-');
  const env = { HOME: join(root, 'home'), PATH: '/usr/bin:/bin' };
  // `src/bin/doctor.ts` is not an installed layout, which is what `resolveCliBinDir`
  // already decides; the launcher must not invent a target it cannot run.
  expect(ensureCogmemShim(env, join(root, 'src', 'bin', 'doctor.ts'))).toBeUndefined();
  expect(hasCogmemShim(env)).toBe(false);
  expect(resolveCogmemInvocation(env, join(root, 'src', 'bin', 'doctor.ts'))).toBe('cogmem');
});
