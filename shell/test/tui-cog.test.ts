/**
 * The `cog` command itself: attach to a running resident in line mode when there is no TTY, and
 * `--headless` reporting an already-running resident instead of spawning a second one.
 *
 * The TUI half needs a real TTY, so what is tested here is the process and socket wiring the TUI
 * rides on; the frame itself is covered by the layout snapshots.
 */
import { describe, expect, test } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { ScriptedProvider, makeShell, makeTempDir } from './helpers.ts';

const COG = join(import.meta.dir, '..', 'src', 'cog.ts');
const SHELL_DIR = join(import.meta.dir, '..');

async function waitForText(read: () => string, needle: string, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (!read().includes(needle)) {
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for ${needle}; saw: ${read()}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
  }
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs = 10_000): Promise<number | null> {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error('timeout waiting for cog to exit')), timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolvePromise(code);
    });
  });
}

describe('cog command (spec §0)', () => {
  test('non-TTY attaches to the running resident and answers line by line', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([{ text: '你好，我在。', toolCalls: [] }]);
    const shell = makeShell(dir, provider, { attach: { enabled: true } });
    await shell.start();
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      child = spawn(process.execPath, ['run', COG, '--data', join(dir, 'data'), '--no-http'], { cwd: SHELL_DIR });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      await waitForText(() => stderr, '行模式附着');
      child.stdin.write('你好\n');
      await waitForText(() => stdout, '你好，我在。');
      child.stdin.end();
      expect(await waitForExit(child)).toBe(0);
      expect(shell.state).toBe('IDLE');
    } finally {
      child?.kill('SIGKILL');
      await shell.stop();
    }
  }, 30_000);

  test('--headless reports an already-running resident instead of starting a second one', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([{ text: 'unused', toolCalls: [] }]);
    const shell = makeShell(dir, provider, { attach: { enabled: true } });
    await shell.start();
    try {
      const child = spawn(process.execPath, ['run', COG, '--headless', '--data', join(dir, 'data'), '--no-http'], { cwd: SHELL_DIR });
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      expect(await waitForExit(child)).toBe(0);
      expect(stdout).toContain('resident already running');
      // Still exactly one resident: the attach count never dropped and no second lock was taken.
      expect(shell.attachedClients).toBe(0);
      expect(shell.state).toBe('IDLE');
    } finally {
      await shell.stop();
    }
  }, 20_000);

  test('--help names the command and its flags', async () => {
    const child = spawn(process.execPath, ['run', COG, '--help'], { cwd: SHELL_DIR });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    expect(await waitForExit(child)).toBe(0);
    expect(stdout).toContain('cog [--headless]');
  }, 15_000);
});
