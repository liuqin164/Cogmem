import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { unpatchHermesHooksConfig } from '../src/host/hermes/HermesAutoMemoryHook.js';
import { unpatchOpenClawPluginEntry } from '../src/host/openclaw/AutoMemoryPluginInstaller.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #116. Leaving is part of installing: an integration that cannot be taken back out
 * leaves the user editing somebody else's config by hand.
 *
 * Every removal here is narrower than it could be, and each narrowing is a test: only
 * this project's key, only the entry pointing at this workspace and project, only a file
 * that still holds what this project writes. A command that deletes whatever sits at a
 * path it once used is a command that eats a user's own file.
 *
 * The two config patchers for pi and Hermes live in `src/bin/connect.ts`, and importing
 * an entry point runs it — so their removals are covered end to end through the CLI
 * below rather than by importing them. That is the stronger test anyway: it is the same
 * code path a user takes.
 */

test('the hermes hook entry goes and the other hooks stay (#116)', () => {
  const hookPath = '/home/someone/.hermes/hooks/cogmem-recall';
  const original = [
    'hooks:',
    '  pre_llm_call:',
    `    - command: ${JSON.stringify(hookPath)}`,
    '      timeout: 5',
    '    - command: "/opt/other-hook"',
    '      timeout: 9',
    '  other_event:',
    '    - command: "/opt/other-event"',
    '',
  ].join('\n');
  const unpatched = unpatchHermesHooksConfig(original, hookPath);
  expect(unpatched).not.toContain('cogmem-recall');
  expect(unpatched).toContain('/opt/other-hook');
  expect(unpatched).toContain('timeout: 9');
  expect(unpatched).toContain('other_event');
  expect(unpatched).toContain('/opt/other-event');

  // The last entry takes the now-empty event key with it, when it was the only one.
  const onlyOurs = unpatchHermesHooksConfig(
    `hooks:\n  pre_llm_call:\n    - command: ${JSON.stringify(hookPath)}\n      timeout: 5\n`,
    hookPath,
  );
  expect(onlyOurs).not.toContain('pre_llm_call');
});

test('the openclaw entry goes only when it points at this workspace and project (#116)', () => {
  const entry = (configPath: string, projectId: string) => JSON.stringify({
    plugins: { entries: { 'cogmem-auto-memory-abc': { enabled: true, config: { configPath, projectId } } }, allow: ['cogmem-auto-memory-abc'] },
  });

  const gone = JSON.parse(unpatchOpenClawPluginEntry(entry('/w/.cogmem/config.toml', 'p1'), 'cogmem-auto-memory-abc', '/w/.cogmem/config.toml', 'p1')) as Record<string, any>;
  expect(gone.plugins.entries).toBeUndefined();
  expect(gone.plugins.allow).toEqual([]);

  // Somebody else's workspace: the id matches, the integration does not.
  const kept = JSON.parse(unpatchOpenClawPluginEntry(entry('/other/.cogmem/config.toml', 'p2'), 'cogmem-auto-memory-abc', '/w/.cogmem/config.toml', 'p1')) as Record<string, any>;
  expect(kept.plugins.entries['cogmem-auto-memory-abc']).toBeDefined();

  // Another plugin in the same workspace is not ours to remove.
  const mixed = JSON.parse(unpatchOpenClawPluginEntry(
    JSON.stringify({ plugins: { entries: {
      'cogmem-auto-memory-abc': { config: { configPath: '/w/.cogmem/config.toml', projectId: 'p1' } },
      'someone-else': { enabled: true },
    } } }),
    'cogmem-auto-memory-abc', '/w/.cogmem/config.toml', 'p1',
  )) as Record<string, any>;
  expect(mixed.plugins.entries['someone-else']).toEqual({ enabled: true });
  expect(mixed.plugins.entries['cogmem-auto-memory-abc']).toBeUndefined();
});

const bin = join(import.meta.dir, '..', 'src', 'bin', 'connect.ts');

async function connectIn(cwd: string, env: Record<string, string>, args: string[]) {
  const proc = Bun.spawn([process.execPath, bin, ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env } });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

test('connect pi --remove takes back what connect wrote, and only that (#116)', async () => {
  const dir = makeTempDir('cogmem-remove-pi-');
  const workspace = join(dir, 'ws');
  const piConfig = join(dir, 'pi', 'mcp.json');
  const binDir = join(dir, 'bin');
  mkdirSync(join(workspace, '.cogmem'), { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(dirname(piConfig), { recursive: true });
  writeFileSync(join(workspace, '.cogmem', 'config.toml'), `[core]\ndb_path = "${join(workspace, 'memory.db')}"\n`);
  writeFileSync(join(binDir, 'cogmem'), '#!/bin/sh\nexit 0\n');
  // Two servers: ours after the install, and one the user configured themselves.
  writeFileSync(piConfig, `${JSON.stringify({ mcpServers: { keepme: { command: '/opt/keepme', args: [] } } }, null, 2)}\n`);
  const env = { COGMEM_BIN_DIR: binDir, COGMEM_BIN: '', COGMEM_MCP_BIN: '', PATH: '/usr/bin:/bin', HOME: dir };
  const common = ['--workspace', workspace, '--pi-config', piConfig];

  const install = await connectIn(workspace, env, ['pi', '--auto', '--json', ...common]);
  expect(install.code, install.stderr).toBe(0);
  const extension = join(dir, 'pi', 'extensions', 'cogmem-auto-memory.ts');
  expect(existsSync(extension)).toBe(true);
  expect(readFileSync(piConfig, 'utf8')).toContain('cogmem');

  const removed = await connectIn(workspace, env, ['pi', '--remove', '--json', ...common]);
  expect(removed.code, removed.stderr).toBe(0);
  const parsed = JSON.parse(removed.stdout) as { hosts: Array<{ removedPaths: string[]; preserved: string[] }> };
  expect(parsed.hosts[0]!.removedPaths).toEqual([extension]);
  expect(parsed.hosts[0]!.preserved).toEqual([]);
  expect(existsSync(extension)).toBe(false);
  const after = JSON.parse(readFileSync(piConfig, 'utf8')) as Record<string, any>;
  expect(after.mcpServers.cogmem).toBeUndefined();
  // The user's own server is untouched — the whole point of identifying ours by key.
  expect(after.mcpServers.keepme).toEqual({ command: '/opt/keepme', args: [] });
});

test('connect hermes --remove takes back the block and the hook, and only those (#116)', async () => {
  const dir = makeTempDir('cogmem-remove-hermes-');
  const workspace = join(dir, 'ws');
  const hermesConfig = join(dir, 'hermes', 'config.yaml');
  const binDir = join(dir, 'bin');
  mkdirSync(join(workspace, '.cogmem'), { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(dirname(hermesConfig), { recursive: true });
  writeFileSync(join(workspace, '.cogmem', 'config.toml'), `[core]\ndb_path = "${join(workspace, 'memory.db')}"\n`);
  writeFileSync(join(binDir, 'cogmem'), '#!/bin/sh\nexit 0\n');
  // A config with somebody else's server and somebody else's hook already in it.
  writeFileSync(hermesConfig, [
    'mcp_servers:',
    '  keepme:',
    '    command: "/opt/keepme"',
    '    args: []',
    'hooks:',
    '  pre_llm_call:',
    '    - command: "/opt/keepme-hook"',
    '      timeout: 7',
    '',
  ].join('\n'));
  const env = { COGMEM_BIN_DIR: binDir, COGMEM_BIN: '', COGMEM_MCP_BIN: '', PATH: '/usr/bin:/bin', HOME: dir };
  const common = ['--workspace', workspace, '--hermes-config', hermesConfig];

  const install = await connectIn(workspace, env, ['hermes', '--auto', '--json', ...common]);
  expect(install.code, install.stderr).toBe(0);
  const installed = readFileSync(hermesConfig, 'utf8');
  expect(installed).toContain('cogmem:');
  expect(installed).toContain('cogmem-recall');

  const removed = await connectIn(workspace, env, ['hermes', '--remove', '--json', ...common]);
  expect(removed.code, removed.stderr).toBe(0);
  const after = readFileSync(hermesConfig, 'utf8');
  expect(after).not.toContain('cogmem:');
  expect(after).not.toContain('cogmem-recall');
  // Both of the user's own entries are still there, byte for byte.
  expect(after).toContain('/opt/keepme');
  expect(after).toContain('/opt/keepme-hook');
  expect(after).toContain('timeout: 7');
});
