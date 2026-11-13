import { describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { ScriptedProvider, makeShell, makeTempDir } from './helpers.ts';

function outputCollector() {
  let text = '';
  return {
    stream: {
      write(chunk: string | Uint8Array) {
        text += chunk.toString();
        return true;
      },
    } as NodeJS.WritableStream,
    text: () => text,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timeout waiting for terminal output');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}

describe('terminal channel round trip', () => {
  test('a line becomes a turn, the reply is printed, and the turn is captured', async () => {
    const dir = makeTempDir();
    const input = new PassThrough();
    const output = outputCollector();
    const provider = new ScriptedProvider([{ text: '你好，我在。', toolCalls: [] }]);
    const shell = makeShell(dir, provider, { terminalEnabled: true }, { terminalInput: input, terminalOutput: output.stream });
    await shell.start();
    try {
      expect(shell.state).toBe('IDLE');
      input.write('你好\n');
      await waitFor(() => output.text().includes('你好，我在。'));
      expect(shell.state).toBe('IDLE');

      input.write('/definitely-not-a-command\n');
      await waitFor(() => output.text().includes('unknown command'));

      const clock = shell.host.getService<{ localDate(at?: number): string }>('clock');
      const events = shell.kernel.getThreadEvents(`companion-day:${clock.localDate()}`, { projectId: shell.config.projectId, limit: 50 });
      expect(events.some((event) => JSON.stringify(event.payload).includes('你好'))).toBe(true);
    } finally {
      await shell.stop();
    }
  });

  test('a line typed during a long tool call is injected before the next turn, not the current one', async () => {
    const dir = makeTempDir();
    const input = new PassThrough();
    const output = outputCollector();
    const provider = new ScriptedProvider([
      { text: 'running the long one', toolCalls: [{ toolCallId: 'c1', toolName: 'bash', input: { command: 'sleep 0.5; printf long-tool-done' } }] },
      { text: '顺手回了你刚才那句。', toolCalls: [] },
    ]);
    const shell = makeShell(dir, provider, { terminalEnabled: true }, { terminalInput: input, terminalOutput: output.stream });
    await shell.start();
    try {
      const run = shell.submit('start the long one');
      await waitFor(() => provider.calls.length === 1);
      // The bash tool is in flight for half a second; a real user types now.
      input.write('顺便说一句，别忘了我喜欢蓝色\n');
      await waitFor(() => (shell.runtimeInstance?.pendingMessages ?? 0) === 1);
      const summary = await run;

      // Measured: the line lands on turn two. Turn one's request was already sent without it.
      expect(provider.calls).toHaveLength(2);
      expect(provider.calls[0].messages.map((message) => message.content).join('\n')).not.toContain('别忘了我喜欢蓝色');
      expect(provider.calls[1].messages.map((message) => message.content).join('\n')).toContain('别忘了我喜欢蓝色');
      expect(summary!.turns).toBe(2);
      expect(summary!.toolResults[0].output).toContain('long-tool-done');
      expect(shell.state).toBe('IDLE');
      expect(shell.trace.read().some((record) => record.kind === 'illegal_transition')).toBe(false);
      const injected = shell.trace.read().find((record) => record.kind === 'steering_injected')!;
      expect(injected.afterTurn).toBe(1);
      expect(injected.beforeTurn).toBe(2);
      expect(injected.count).toBe(1);
      await waitFor(() => output.text().includes('顺手回了你刚才那句。'));
    } finally {
      await shell.stop();
    }
  }, 30_000);
});
