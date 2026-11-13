/**
 * Interrupt tidy-up (round 15, #165): what a graceful abort leaves on disk.
 *
 * The kill matrix asks what a SIGKILL leaves. This asks the other half of the Pi deep read's
 * question: when the run is aborted *while a tool is in flight* (Esc, shutdown), does the partial
 * output pollute the next run's context — a half assistant message, or a tool call with no result?
 *
 * The shell's provider is request/response, so there is no token-level stream that could persist a
 * half assistant message; the run's context lives and dies in memory. The dangling tool call was
 * real: a signal-killed `bash` rejects, and the rejection used to escape the tool pipeline before
 * `tool_execution_end`, leaving the ledger's call unpaired and the call in the checkpoint's
 * in-flight list. Pi never leaves that pair open (`agent-loop.js`, `executePreparedToolCall`).
 */
import { describe, expect, test } from 'bun:test';
import { makeShell, makeTempDir, ScriptedProvider } from './helpers.ts';

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('interrupt-tidy: timed out waiting for the run to reach the tool');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('a graceful abort mid-tool leaves no dangling tool call', () => {
  test('the rejected tool gets its result, the ledger pair is whole, and the checkpoint is cleared', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([
      { text: 'running a tool', toolCalls: [{ toolCallId: 'c1', toolName: 'bash', input: { command: 'sleep 10' } }] },
    ]);
    const shell = makeShell(dir, provider);
    await shell.start();
    try {
      const run = shell.submit('run a tool, then interrupt it');
      await waitFor(() => (shell.machine.runtime.inFlightToolCalls?.length ?? 0) === 1);
      shell.runtimeInstance!.abort('user_escape');
      const summary = await run;
      expect(summary!.stopReason).toBe('run_aborted');
      // The call is gone from the durable in-flight list as soon as its end lands, not at the next
      // recovery: a stale entry reads as "a replay must be judged" when nothing is running.
      expect(shell.machine.runtime.inFlightToolCalls ?? [], 'nothing is left in flight').toEqual([]);
      // The capture flush wrote the turn; call and observation travel together.
      const capture = shell.trace.read().find((record) => record.kind === 'capture_run')!;
      expect(capture, 'the aborted turn still reached the ledger').toBeDefined();
      expect(capture.toolCalls).toBe(1);
      expect(capture.toolResults, 'the call has its observation, so the ledger has no dangling call').toBe(1);
    } finally {
      await shell.stop();
    }
  }, 30_000);
});
