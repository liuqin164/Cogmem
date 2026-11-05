import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTempDir } from './helpers/tmp.js';

/**
 * `connect <host> --auto` writes the server entry, and that entry carries a
 * `--config` path. The command half of that entry has been checked for years
 * (`commandResolves`); the file the command is told to read was not checked at all.
 *
 * A launcher that resolves is still a server that cannot start when its config is
 * missing: it exits with `invalid_toml: ENOENT` before answering `initialize`, and the
 * host's tool list silently has no cogmem tools in it (#108).
 */
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const connectBin = join(coreRoot, 'src/bin/connect.ts');

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn({ cmd, cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NO_COLOR: '1', ...env } });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

/** A Workspace whose cogmem config is written (so `init` is done), plus a host home. */
function workspace() {
  const dir = makeTempDir('cogmem-connect-config-warning-');
  const home = join(dir, 'home');
  const ws = join(dir, 'ws');
  mkdirSync(join(ws, '.cogmem'), { recursive: true });
  mkdirSync(join(home, '.hermes'), { recursive: true });
  mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
  const configPath = join(ws, '.cogmem', 'config.toml');
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n[integrations.hermes]\nenabled = true\n');
  return {
    dir,
    home,
    ws,
    configPath,
    hermesConfig: join(home, '.hermes', 'config.yaml'),
    piConfig: join(home, '.pi', 'agent', 'mcp.json'),
  };
}

type WarningJson = { hermesMcp?: { warning?: string }; piMcp?: { warning?: string } };

test('connect hermes warns when the --config it writes is not there', async () => {
  const p = workspace();
  // The state a Workspace with no `cogmem init` is in: `connect --auto` still runs.
  rmSync(p.configPath);

  const { exitCode, stdout } = await run([
    'bun', connectBin, 'hermes', '--workspace', p.ws, '--auto', '--hermes-config', p.hermesConfig, '--json',
  ], p.ws, { HOME: p.home });
  expect(exitCode).toBe(0);

  const warning = (JSON.parse(stdout) as WarningJson).hermesMcp?.warning;
  expect(warning).toBeString();
  expect(warning).toContain(p.configPath);
  // The entry is still written: reporting is not a reason to refuse the integration.
  expect(readFileSync(p.hermesConfig, 'utf8')).toContain(p.configPath);
});

test('connect hermes is quiet once that config exists', async () => {
  const p = workspace();
  expect(existsSync(p.configPath)).toBe(true);

  const { exitCode, stdout } = await run([
    'bun', connectBin, 'hermes', '--workspace', p.ws, '--auto', '--hermes-config', p.hermesConfig, '--json',
  ], p.ws, { HOME: p.home });
  expect(exitCode).toBe(0);
  expect((JSON.parse(stdout) as WarningJson).hermesMcp?.warning).toBeUndefined();
});

test('connect pi carries the same warning for the same reason', async () => {
  const p = workspace();
  rmSync(p.configPath);

  const { exitCode, stdout } = await run([
    'bun', connectBin, 'pi', '--workspace', p.ws, '--auto', '--pi-config', p.piConfig, '--json',
  ], p.ws, { HOME: p.home });
  expect(exitCode).toBe(0);
  expect((JSON.parse(stdout) as WarningJson).piMcp?.warning).toContain(p.configPath);
});

test('a Workspace path containing a space does not warn about a healthy config', async () => {
  // The first version read the path out of the `args` line with a regex that stopped at
  // whitespace, so `/tmp/my ws/.cogmem/config.toml` became `/tmp/my` — a path that never
  // exists — and a perfectly healthy integration got a "your config is missing" warning.
  // Reading the array as JSON is what makes the space stop mattering.
  const dir = makeTempDir('cogmem-connect-space-');
  const home = join(dir, 'home');
  const ws = join(dir, 'my workspace');
  mkdirSync(join(ws, '.cogmem'), { recursive: true });
  const configPath = join(ws, '.cogmem', 'config.toml');
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
  const hermesConfig = join(home, '.hermes', 'config.yaml');
  mkdirSync(dirname(hermesConfig), { recursive: true });

  const { exitCode, stdout } = await run([
    'bun', connectBin, 'hermes', '--workspace', ws, '--auto', '--hermes-config', hermesConfig, '--json',
  ], ws, { HOME: home });
  expect(exitCode).toBe(0);
  expect((JSON.parse(stdout) as WarningJson).hermesMcp?.warning).toBeUndefined();
  // The entry really does name the spaced path, so the test is not passing by omission.
  expect(readFileSync(hermesConfig, 'utf8')).toContain(configPath);
});
