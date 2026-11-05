import { expect, test } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTempDir } from './helpers/tmp.js';
import { patchHermesHooksConfig } from '../src/host/hermes/HermesAutoMemoryHook.js';

/**
 * Hermes' push half: a `pre_llm_call` shell hook that injects recall.
 *
 * Hermes injects what a `pre_llm_call` hook returns under `context`, into the user
 * message (`agent/turn_context.py` `_collect_pre_llm_call_context`), and a shell hook
 * reaches that same path because `agent/shell_hooks.py` parses its stdout as JSON. So
 * `connect hermes --auto` writes a script and one config entry — the same shape as pi's
 * generated extension, and for the same reason: a skill is documentation the model may
 * read, and measured, it does not.
 */
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const connectBin = join(coreRoot, 'src/bin/connect.ts');

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn({ cmd, cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NO_COLOR: '1', ...env } });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

function scratch() {
  const dir = makeTempDir('cogmem-hermes-hook-');
  const home = join(dir, 'home');
  const ws = join(dir, 'ws');
  mkdirSync(join(ws, '.cogmem'), { recursive: true });
  const configPath = join(ws, '.cogmem', 'config.toml');
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
  const hermesConfig = join(home, '.hermes', 'config.yaml');
  mkdirSync(dirname(hermesConfig), { recursive: true });
  return { dir, home, ws, configPath, hermesConfig };
}

test('connect hermes writes an executable pre_llm_call hook and records it', async () => {
  const p = scratch();
  const { exitCode, stdout } = await run([
    'bun', connectBin, 'hermes', '--workspace', p.ws, '--auto', '--hermes-config', p.hermesConfig, '--json',
  ], p.ws, { HOME: p.home });
  expect(exitCode).toBe(0);

  const hookPath = join(dirname(p.hermesConfig), 'hooks', 'cogmem-recall');
  expect(existsSync(hookPath)).toBe(true);
  // Hermes checks the exec bit (`hermes hooks doctor`), and a written-but-unrunnable hook
  // is the wired-and-silent shape this whole cycle is about.
  expect(statSync(hookPath).mode & 0o111).toBeGreaterThan(0);

  const source = readFileSync(hookPath, 'utf8');
  expect(source.startsWith('#!')).toBe(true);
  // The interpreter is absolute: Hermes spawns the hook with `shell=False` and an
  // environment it builds itself, so `/usr/bin/env bun` would depend on that PATH.
  expect(source.split('\n')[0]).toContain('/');
  expect(source).toContain(p.ws);

  const config = readFileSync(p.hermesConfig, 'utf8');
  expect(config).toContain('hooks:');
  expect(config).toContain('pre_llm_call:');
  expect(config).toContain(hookPath);
  // The MCP entry is still written; the hook is the push half, not a replacement.
  expect(config).toContain('mcp_servers:');

  const parsed = JSON.parse(stdout) as { hermesHook?: { hookPath?: string; configUpdated?: boolean; warning?: string } };
  expect(parsed.hermesHook?.hookPath).toBe(hookPath);
  expect(parsed.hermesHook?.configUpdated).toBe(true);
  // Hermes will not run a new hook until it is approved, and it approves the exact script
  // it saw. Both facts cost a silent integration on the box until they are written down.
  expect(parsed.hermesHook?.warning).toContain('--accept-hooks');
  expect(parsed.hermesHook?.warning).toContain('hooks revoke');
  expect(parsed.hermesHook?.warning).toContain('restarted');
});

test('a second connect hermes run leaves the hook and its config entry alone', async () => {
  const p = scratch();
  const args = ['bun', connectBin, 'hermes', '--workspace', p.ws, '--auto', '--hermes-config', p.hermesConfig, '--json'];
  expect((await run(args, p.ws, { HOME: p.home })).exitCode).toBe(0);
  const hookPath = join(dirname(p.hermesConfig), 'hooks', 'cogmem-recall');
  const firstConfig = readFileSync(p.hermesConfig, 'utf8');

  const second = await run(args, p.ws, { HOME: p.home });
  expect(second.exitCode).toBe(0);
  expect(readFileSync(p.hermesConfig, 'utf8')).toBe(firstConfig);
  const parsed = JSON.parse(second.stdout) as { hermesHook?: { configUpdated?: boolean } };
  expect(parsed.hermesHook?.configUpdated).toBe(false);
  // And it did not pile up a second entry for the same command.
  expect(readFileSync(p.hermesConfig, 'utf8').split(hookPath).length - 1).toBe(1);
});

test('the hook is given the dispatcher, not the MCP server binary', async () => {
  // Same defect class the pi extension had: `cogmem-mcp` is the server itself and reads
  // a positional `memory` as an unknown flag, so a hook built on it does nothing.
  const p = scratch();
  const binDir = join(p.dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'cogmem'), '#!/bin/sh\nexit 0\n');
  const mcpBin = join(binDir, 'cogmem-mcp');
  writeFileSync(mcpBin, '#!/bin/sh\nexit 0\n');

  const { exitCode } = await run([
    'bun', connectBin, 'hermes', '--workspace', p.ws, '--auto', '--hermes-config', p.hermesConfig, '--json',
  ], p.ws, { HOME: p.home, COGMEM_MCP_BIN: mcpBin });
  expect(exitCode).toBe(0);

  const source = readFileSync(join(dirname(p.hermesConfig), 'hooks', 'cogmem-recall'), 'utf8');
  expect(source).toContain(JSON.stringify(join(binDir, 'cogmem')));
  expect(source).not.toContain('cogmem-mcp');
});

test('patching the hooks block keeps other hooks and other events', () => {
  const original = [
    'model: gpt-4',
    'hooks:',
    '  pre_tool_call:',
    '    - matcher: terminal',
    '      command: "/usr/local/bin/guard"',
    '      timeout: 3',
    'mcp_servers:',
    '  cogmem:',
    '    command: "cogmem"',
    '',
  ].join('\n');

  const patched = patchHermesHooksConfig(original, '/home/u/.hermes/hooks/cogmem-recall');

  // The hand-written hook and everything outside the block survive untouched.
  expect(patched).toContain('matcher: terminal');
  expect(patched).toContain('command: "/usr/local/bin/guard"');
  expect(patched).toContain('mcp_servers:');
  expect(patched).toContain('  cogmem:');
  // Ours is added under the new event, not into somebody else's list.
  expect(patched).toContain('  pre_llm_call:');
  expect(patched).toContain('    - command: "/home/u/.hermes/hooks/cogmem-recall"');

  // Idempotent: a second pass changes nothing.
  expect(patchHermesHooksConfig(patched, '/home/u/.hermes/hooks/cogmem-recall')).toBe(patched);

  // The event exists already, with somebody else's hook in its list: ours joins it and
  // theirs survives. This is the branch that inserts at the head of the list.
  const shared = [
    'hooks:',
    '  pre_llm_call:',
    '    - command: "/opt/other/recall"',
    '      timeout: 9',
    '',
  ].join('\n');
  const withOurs = patchHermesHooksConfig(shared, '/home/u/.hermes/hooks/cogmem-recall');
  expect(withOurs).toContain('command: "/opt/other/recall"');
  expect(withOurs).toContain('command: "/home/u/.hermes/hooks/cogmem-recall"');
  expect(patchHermesHooksConfig(withOurs, '/home/u/.hermes/hooks/cogmem-recall')).toBe(withOurs);
});

test('the hook does not depend on the PATH Hermes happens to pass down', async () => {
  // Measured on the box: `cogmem` is a shim whose shebang is `#!/usr/bin/env bun`, and
  // Hermes builds the hook's environment itself, so the recall call failed with
  // `env: 'bun': No such file or directory` even though the installer could see bun.
  const p = scratch();
  const { exitCode } = await run([
    'bun', connectBin, 'hermes', '--workspace', p.ws, '--auto', '--hermes-config', p.hermesConfig, '--json',
  ], p.ws, { HOME: p.home });
  expect(exitCode).toBe(0);

  const source = readFileSync(join(dirname(p.hermesConfig), 'hooks', 'cogmem-recall'), 'utf8');
  expect(source).toContain('const BUN_DIR =');
  expect(source).toContain('PATH: BUN_DIR + ":"');
  // And the interpreter is absolute for the same reason.
  expect(source.split('\n')[0]).not.toContain('/usr/bin/env');
});

test('the hook reads the user message where Hermes actually puts it', async () => {
  // Measured on the box: the runtime payload is
  // {hook_event_name, session_id, cwd, profile, extra: {user_message, ...}} — a top-level
  // `user_message` read yielded an empty string, so the hook was invoked on every turn and
  // contributed nothing. Silent, and indistinguishable from "no memory matched".
  const p = scratch();
  const { exitCode } = await run([
    'bun', connectBin, 'hermes', '--workspace', p.ws, '--auto', '--hermes-config', p.hermesConfig, '--json',
  ], p.ws, { HOME: p.home });
  expect(exitCode).toBe(0);

  const source = readFileSync(join(dirname(p.hermesConfig), 'hooks', 'cogmem-recall'), 'utf8');
  expect(source).toContain('payload?.extra?.user_message');
  // The flat shape stays as a fallback; it is what `hermes hooks test` documents.
  expect(source).toContain('payload?.user_message');
});

test('a hook the user chmod-ed is repaired, even though its bytes did not change', async () => {
  // The exec bit is not part of the content compare: a 644 hook is byte-identical to the
  // one we wrote and still unrunnable, and Hermes skips it without saying why.
  const p = scratch();
  const args = ['bun', connectBin, 'hermes', '--workspace', p.ws, '--auto', '--hermes-config', p.hermesConfig, '--json'];
  expect((await run(args, p.ws, { HOME: p.home })).exitCode).toBe(0);
  const hookPath = join(dirname(p.hermesConfig), 'hooks', 'cogmem-recall');
  chmodSync(hookPath, 0o644);
  expect(statSync(hookPath).mode & 0o111).toBe(0);

  const second = await run(args, p.ws, { HOME: p.home });
  expect(second.exitCode).toBe(0);
  expect(statSync(hookPath).mode & 0o111).toBeGreaterThan(0);
  // And it did not pretend the file changed.
  expect((JSON.parse(second.stdout) as { hermesHook?: { configUpdated?: boolean } }).hermesHook?.configUpdated).toBe(false);
});
