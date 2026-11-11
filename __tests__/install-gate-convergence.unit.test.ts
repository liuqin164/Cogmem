import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTempDir } from './helpers/tmp.js';

/**
 * #114: the managed launcher is the one entry that survives an installation move.
 *
 * A launcher that points at nothing is the state a moved installation leaves, and
 * the gate has to name a command that puts it back. The launcher's absence is not a
 * failure — `init` writes it — and this pins that both output paths do.
 */
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const doctorBin = join(coreRoot, 'src/bin/doctor.ts');
const BUN_DIR = dirname(process.execPath);

function run(cmd: string[], options: { cwd: string; env?: Record<string, string> }) {
  const env = { ...process.env, NO_COLOR: '1', ...options.env };
  env.PATH = [BUN_DIR, env.PATH].filter(Boolean).join(':');
  const proc = Bun.spawn({ cmd, cwd: options.cwd, stdout: 'pipe', stderr: 'pipe', env });
  return Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
}

function writeConfig(dir: string, body: string): string {
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, body);
  return configPath;
}

async function doctor(dir: string, configPath: string, env: Record<string, string> = {}) {
  const result = await run(['bun', doctorBin, '--config', configPath, '--json'], { cwd: dir, env: { HOME: join(dir, 'home'), ...env } });
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as {
    nextSteps: Array<{ id: string; command: string; actor: string }>;
  };
}

describe('the gate reports the managed launcher (#114)', () => {
  test('a launcher with nothing to run is a diagnostic, and the fix names a real command', async () => {
    const dir = makeTempDir('cogmem-gate-shim-');
    const home = join(dir, 'home');
    const configPath = writeConfig(dir, '[core]\ndb_path = "memory.db"\n');
    // The state a host configuration lands in after the installation moves and nothing
    // rewrote the launcher: the recorded target is gone, so every host calling it fails.
    const shimDir = join(home, '.cogmem', 'bin');
    mkdirSync(shimDir, { recursive: true });
    writeFileSync(join(shimDir, 'cogmem.target'), join(dir, 'moved-away', 'cogmem') + '\n');
    writeFileSync(join(shimDir, 'cogmem'), '#!/bin/sh\nexit 127\n');

    const parsed = await doctor(dir, configPath) as unknown as { installGate: { diagnostics: Array<{ code: string; message: string }> } };
    const finding = parsed.installGate.diagnostics.find((diagnostic) => diagnostic.code === 'launcher_target_missing');
    expect(finding).toBeDefined();
    expect(finding!.message).toContain(join(shimDir, 'cogmem'));
    expect(finding!.message).toContain('init --yes');

    // A launcher that is fine says nothing: a warning here would be noise on every run.
    writeFileSync(join(shimDir, 'cogmem.target'), process.execPath + '\n');
    const clean = await doctor(dir, configPath) as unknown as { installGate: { diagnostics: Array<{ code: string }> } };
    expect(clean.installGate.diagnostics.some((diagnostic) => diagnostic.code.startsWith('shim_'))).toBe(false);
  });
});

// #114 follow-up. The managed launcher was created inside the `--json` output path, so an
// interactive `cogmem init` left no launcher and every host configuration written after it
// named the installation directly — the prefix-change failure #114 exists to prevent. The
// output format must not decide what lands on disk.
test('init writes the managed launcher on both output paths', async () => {
  const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const bin = join(coreRoot, 'src', 'bin', 'init.ts');
  for (const json of [false, true]) {
    const home = makeTempDir(`cogmem-init-launcher-${json ? 'json' : 'human'}-`);
    const workspace = join(home, 'ws');
    const install = join(home, 'install');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(install, 'dist', 'bin'), { recursive: true });
    writeFileSync(join(install, 'cogmem'), '#!/bin/sh\n');
    chmodSync(join(install, 'cogmem'), 0o755);
    writeFileSync(join(install, 'dist', 'bin', 'cogmem.js'), '');

    const proc = Bun.spawn([process.execPath, bin, '--yes', '--no-probe', ...(json ? ['--json'] : [])], {
      cwd: workspace, stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, HOME: home, COGMEM_BIN_DIR: install, PATH: '/usr/bin:/bin' },
    });
    const code = await proc.exited;
    expect(code).toBe(0);
    expect({ json, launcher: existsSync(join(home, '.cogmem', 'bin', 'cogmem')) }).toEqual({ json, launcher: true });
  }
});
