import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PluginHost } from '../src/plugins/host.ts';
import { builtinToolsPlugin } from '../src/plugins/builtin-tools.ts';
import { makeTempDir } from './helpers.ts';

/** The four tools on a bare host: no kernel, so a 50 KiB result is a tool test, not an ingest test. */
async function runBash(input: string | { command: string; timeout?: number }) {
  const workspace = join(makeTempDir(), 'ws');
  mkdirSync(workspace, { recursive: true });
  const host = new PluginHost();
  host.register(builtinToolsPlugin(), { workspaceRoot: workspace });
  await host.start();
  try {
    const result = await host.tools.invoke('bash', { toolCallId: 'c1', input: typeof input === 'string' ? { command: input } : input }, { runId: 'r' });
    return { workspace, result };
  } finally {
    await host.stop();
  }
}

describe('bash output capping', () => {
  test('a long output keeps the tail and the whole thing is named on disk', async () => {
    // Past the 2000-line cap, so the last lines win: for bash the end is where the errors are
    // (Pi's `truncateTail`, truncate.js:118-181).
    const { workspace, result } = await runBash('seq 1 5000');
    expect(result.isError).toBe(false);
    expect(result.output).toContain('[showing lines ');
    const match = /full output: (\S+)\]/u.exec(result.output);
    expect(match).not.toBeNull();
    // The pointer is inside the workspace, so the `read` tool can follow it.
    expect(match![1].startsWith('.cogmem-shell/bash-output/')).toBe(true);
    expect(result.output).toContain('5000');
    expect(result.output).not.toContain('\n3\n');
    const full = readFileSync(join(workspace, match![1]), 'utf8');
    expect(full.startsWith('1\n')).toBe(true);
    expect(full.endsWith('5000\n')).toBe(true);
  }, 30_000);

  test('a single line past the byte cap is cut at the tail, not through a character', async () => {
    // 50 000 '日' joined into one line = 150 000 bytes. The last 50 KiB starts two bytes into a
    // 3-byte character, so a byte slice naive about UTF-8 would leave a replacement character.
    const { result } = await runBash("yes 日 | head -n 50000 | tr -d '\\n'");
    expect(result.isError).toBe(false);
    expect(result.output).toContain('[showing the last ');
    expect(result.output.length).toBeLessThan(150_000);
    expect(result.output).not.toContain('\uFFFD');
  }, 30_000);

  test('a character split across two pipe chunks is decoded whole, never as U+FFFD (#211)', async () => {
    // Each '日' (E6 97 A5) is written one byte at a time with a pause, so the bytes of a single
    // character land in separate `data` events. The flaky case above is the same defect with a
    // boundary the pipe picked by chance; this forces it. Per-chunk `chunk.toString()` decodes each
    // half on its own and leaves replacement characters behind.
    const script = "for i in $(seq 1 40); do printf '\\xe6'; sleep 0.001; printf '\\x97\\xa5'; sleep 0.001; done";
    const { result } = await runBash(script);
    expect(result.isError).toBe(false);
    expect(result.output).toBe('日'.repeat(40));
    expect(result.output).not.toContain('\uFFFD');
  }, 30_000);

  test('a genuinely truncated tail byte is flushed as one replacement character, not dropped silently', async () => {
    // The decoder holds back an incomplete sequence; `end()` is what turns a stream that really ended
    // mid-character into the visible U+FFFD instead of losing the bytes without a trace.
    const { result } = await runBash("printf 'ok\\xe6'");
    expect(result.output).toBe('ok\uFFFD');
  }, 30_000);

  test('a short output is returned whole, with no pointer', async () => {
    const { result } = await runBash('echo short-and-complete');
    expect(result.output).toBe('short-and-complete\n');
    expect(result.output).not.toContain('full output:');
  }, 30_000);

  test('a non-zero exit is a tool error (Pi sets isError, bash.js:295-302)', async () => {
    const { result } = await runBash('echo went-wrong >&2; exit 7');
    expect(result.isError).toBe(true);
    expect(result.output).toContain('went-wrong');
    expect(result.output).toContain('Command exited with code 7');
  }, 30_000);

  test('a timeout keeps what the command printed before it was killed', async () => {
    const { result } = await runBash({ command: 'echo before-hang; sleep 30', timeout: 1 });
    expect(result.isError).toBe(true);
    expect(result.output).toContain('before-hang');
    expect(result.output).toContain('timed out after 1');
  }, 20_000);
});
