import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertBunRuntime,
  installOpenClawAutoMemoryPlugin,
} from '../src/host/openclaw/AutoMemoryPluginInstaller.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const connectBin = join(coreRoot, 'src/bin/connect.ts');

function makeWorkspace(): { root: string; configPath: string; openclawConfigPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-bun-guard-'));
  const configPath = join(root, '.cogmem', 'config.toml');
  const openclawConfigPath = join(root, 'openclaw.json');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
  writeFileSync(openclawConfigPath, '{}');
  return { root, configPath, openclawConfigPath };
}

async function runCli(
  cmd: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd,
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

test('a --bun value that is not Bun is rejected before any config is written', () => {
  const { root, configPath, openclawConfigPath } = makeWorkspace();
  // The bridge imports bun:sqlite, so a Node binary installs cleanly and then fails
  // on every hook inside the gateway log. The installer must refuse it up front.
  expect(() => installOpenClawAutoMemoryPlugin({
    workspaceRoot: root,
    configPath,
    openclawConfigPath,
    bunPath: '/usr/bin/node',
    force: true,
  })).toThrow(/which is not Bun/);

  expect(readFileSync(openclawConfigPath, 'utf8')).toBe('{}');
  expect(existsSync(join(root, 'extensions'))).toBe(false);
});

test('a --bun path that cannot be executed reports the reason instead of installing', () => {
  const { root, configPath, openclawConfigPath } = makeWorkspace();
  expect(() => installOpenClawAutoMemoryPlugin({
    workspaceRoot: root,
    configPath,
    openclawConfigPath,
    bunPath: join(root, 'no-such-bun'),
    force: true,
  })).toThrow(/is not runnable/);
  expect(readFileSync(openclawConfigPath, 'utf8')).toBe('{}');
});

test('the real Bun runtime passes the guard', () => {
  expect(() => assertBunRuntime(process.execPath)).not.toThrow();
});

test('connect rejects a mistyped flag instead of silently ignoring it', async () => {
  const { root } = makeWorkspace();
  // `--bun-path` is the typo that used to leave the recorded bunPath unset.
  const result = await runCli(
    ['bun', connectBin, 'openclaw', '--auto', '--workspace', root, '--bun-path', '/usr/bin/node'],
    root,
  );
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('Unknown option --bun-path');
  expect(result.stderr).toContain('--bun');
});

test('connect openclaw --auto --bun <node> fails loudly and leaves the host config untouched', async () => {
  const { root, configPath, openclawConfigPath } = makeWorkspace();
  const result = await runCli(
    [
      'bun',
      connectBin,
      'openclaw',
      '--auto',
      '--workspace',
      root,
      '--config',
      configPath,
      '--openclaw-config',
      openclawConfigPath,
      '--bun',
      '/usr/bin/node',
    ],
    root,
  );
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('which is not Bun');
  expect(readFileSync(openclawConfigPath, 'utf8')).toBe('{}');
});
