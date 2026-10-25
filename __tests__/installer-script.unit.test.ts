import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTempDir } from './helpers/tmp.js';

/**
 * `install.sh` is the documented first step of the install path, and nothing else
 * executed it: the journey check reproduces the layout it produces instead, so a
 * broken spec — `bun add "cogmem@/path/to/cogmem-4.0.0.tgz"` — shipped unnoticed,
 * which made `COGMEM_RELEASE_TARBALL` unusable and a local install impossible.
 *
 * `bun` is stubbed so this is deterministic and offline, but the stub is not
 * permissive: it resolves like a package manager and fails on `cogmem@<a location>`,
 * which is the regression this file exists to catch. A stub that accepted any argv
 * would stay green while the product was broken.
 */
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const installScript = join(coreRoot, 'install.sh');
const BUN_DIR = dirname(process.execPath);

const STUB = `#!/bin/sh
# A stand-in for \`bun add\`: it records the spec and produces the executable the
# script's own link_cli step expects.
printf '%s\\n' "$*" >> "$STUB_LOG"
target="$2"
case "$target" in
  cogmem@*)
    rest="\${target#cogmem@}"
    case "$rest" in
      *:* | /* | ./* | ../*)
        printf 'error: could not resolve %s (a version range cannot be a location)\\n' "$target" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    case "$target" in
      *:*) ;;
      *)
        if [ ! -e "$target" ]; then
          printf 'error: could not resolve %s\\n' "$target" >&2
          exit 1
        fi
        ;;
    esac
    ;;
esac
mkdir -p "$COGMEM_INSTALL_HOME/node_modules/.bin"
printf '#!/bin/sh\\nexit 0\\n' > "$COGMEM_INSTALL_HOME/node_modules/.bin/cogmem"
chmod +x "$COGMEM_INSTALL_HOME/node_modules/.bin/cogmem"
`;

function runInstaller(spec: string | undefined, extraEnv: Record<string, string> = {}) {
  const scratch = makeTempDir('cogmem-installer-');
  const stubDir = join(scratch, 'stub');
  const installHome = join(scratch, 'pkg');
  const binDir = join(scratch, 'bin');
  const logPath = join(scratch, 'bun.log');
  mkdirSync(stubDir, { recursive: true });
  mkdirSync(installHome, { recursive: true });

  const stub = join(stubDir, 'bun');
  writeFileSync(stub, STUB.replace('$STUB_LOG', JSON.stringify(logPath)));
  chmodSync(stub, 0o755);
  // The locations a spec can name, so the stub's resolution has something to find:
  // one beside the package home for the relative form, one absolute.
  writeFileSync(join(installHome, 'cogmem-4.0.0.tgz'), 'tarball\n');
  const distDir = join(scratch, 'dist');
  mkdirSync(distDir, { recursive: true });
  const tarball = join(distDir, 'cogmem-4.0.0.tgz');
  writeFileSync(tarball, 'tarball\n');

  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${stubDir}:${BUN_DIR}:${process.env.PATH ?? ''}`,
    HOME: scratch,
    STUB_LOG: logPath,
    COGMEM_INSTALL_HOME: installHome,
    COGMEM_BIN_DIR: binDir,
    NO_COLOR: '1',
  };
  // Cleared rather than inherited: a developer shell exporting one of these would
  // otherwise decide what the assertions see.
  delete env.COGMEM_PACKAGE_SPEC;
  delete env.COGMEM_NPM_SPEC;
  delete env.COGMEM_RELEASE_TARBALL;
  if (spec !== undefined) env.COGMEM_PACKAGE_SPEC = spec;
  Object.assign(env, extraEnv);

  const proc = Bun.spawnSync({ cmd: ['bash', installScript], cwd: scratch, env, stdout: 'pipe', stderr: 'pipe' });
  return {
    exitCode: proc.exitCode,
    stderr: proc.stderr.toString(),
    chunks: existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n') : [],
    launcher: join(binDir, 'cogmem'),
    tarball,
  };
}

describe('install.sh installs the package it was asked for', () => {
  test('a registry spec keeps the package name', () => {
    const run = runInstaller('latest');
    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    expect(run.chunks).toEqual(['add cogmem@latest']);
    // And the script's own link_cli step linked what `bun add` produced.
    expect(existsSync(run.launcher)).toBe(true);
  });

  test('a version and a range keep the package name', () => {
    expect(runInstaller('4.0.0').chunks).toEqual(['add cogmem@4.0.0']);
    expect(runInstaller('^4.0.0').chunks).toEqual(['add cogmem@^4.0.0']);
    expect(runInstaller('*').chunks).toEqual(['add cogmem@*']);
  });

  test('a tarball, a path, a URL and a scheme are locations, not versions', () => {
    // `cogmem@/tmp/cogmem-4.0.0.tgz` is a version range that cannot resolve, which is
    // what made COGMEM_RELEASE_TARBALL unusable and a local install impossible.
    const absolute = runInstaller('./cogmem-4.0.0.tgz');
    expect(absolute.chunks).toEqual(['add ./cogmem-4.0.0.tgz']);
    // The absolute form of the same fixture, which the stub resolves on disk.
    const byAbsolutePath = runInstaller(absolute.tarball);
    expect(byAbsolutePath.chunks).toEqual([`add ${absolute.tarball}`]);
    expect(runInstaller('https://example.test/cogmem-4.0.0.tgz').chunks).toEqual(['add https://example.test/cogmem-4.0.0.tgz']);
    expect(runInstaller('file:../cogmem-4.0.0.tgz').chunks).toEqual(['add file:../cogmem-4.0.0.tgz']);
    // The README names `npm:cogmem@latest` as the update source, and `update` falls
    // back to `github:<repo>#<tag>`, so both are specs a reader will pass here.
    expect(runInstaller('npm:cogmem@4.0.0').chunks).toEqual(['add npm:cogmem@4.0.0']);
    expect(runInstaller('github:liuqin164/Cogmem#v4.0.0').chunks).toEqual(['add github:liuqin164/Cogmem#v4.0.0']);
  });

  test('the stub resolves, so a location that does not exist fails the install', () => {
    // The other half of the guard: the spec form is not merely echoed, so the
    // assertions above are not passing against a stub that accepts anything.
    const run = runInstaller(join(makeTempDir('cogmem-installer-missing-'), 'cogmem-4.0.0.tgz'));
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain('could not resolve ');
  });

  test('COGMEM_RELEASE_TARBALL still selects the spec, and the general name wins', () => {
    const fixture = runInstaller('latest');
    const fromTarball = runInstaller(undefined, { COGMEM_RELEASE_TARBALL: fixture.tarball });
    expect(fromTarball.exitCode).toBe(0);
    expect(fromTarball.chunks).toEqual([`add ${fixture.tarball}`]);

    // The same precedence `resolveLatestNpmSpec` uses, pinned on both sides, so
    // setting two cannot install one thing and update another.
    expect(runInstaller('4.0.0', { COGMEM_NPM_SPEC: '3.6.5', COGMEM_RELEASE_TARBALL: '5.0.0' }).chunks)
      .toEqual(['add cogmem@4.0.0']);
    expect(runInstaller(undefined, { COGMEM_NPM_SPEC: '3.6.5', COGMEM_RELEASE_TARBALL: '5.0.0' }).chunks)
      .toEqual(['add cogmem@3.6.5']);
  });
});
