/**
 * The three Pi-compat lifecycle deviations #208 names, each pinned by a discriminator that fails
 * without its fix: load-failure isolation, `session_start` timing, and hook-exception containment.
 */
import { describe, expect, test } from 'bun:test';
import { ScriptedProvider, makeShell, makeTempDir } from './helpers.ts';

/** One tool call then a final text turn, so every run exercises the tool hooks as well as the plain ones. */
function toolThenDone(): ScriptedProvider {
  return new ScriptedProvider([
    (_input, call) =>
      call % 2 === 0
        ? { text: 'tool', toolCalls: [{ toolCallId: `c${call}`, toolName: 'read', input: { path: 'missing.txt' } }], usage: { input: 1, output: 1 } }
        : { text: 'done', toolCalls: [], usage: { input: 1, output: 1 } },
  ]);
}

const MID_RUN_HOOKS = [
  'before_agent_start',
  'agent_start',
  'message_start',
  'message_update',
  'message_end',
  'turn_start',
  'tool_execution_start',
  'tool_execution_end',
  'beforeToolCall',
  'afterToolCall',
  'turn_end',
  'finishTurn',
  'prepareNextTurn',
  'turn_usage',
  'transformContext',
  'prepareRequest',
];

describe('#208-3 a throwing hook cannot drag down the run', () => {
  test('the run finishes normally, the machine returns to IDLE, and the trace names the hook', async () => {
    const dir = makeTempDir('pi-hook-');
    const shell = makeShell(dir, toolThenDone());
    let throwOn: string | undefined;
    for (const event of MID_RUN_HOOKS) {
      shell.host.bus.on(event, () => {
        if (event === throwOn) throw new Error(`boom:${event}`);
      });
    }
    await shell.start();
    try {
      for (const event of MID_RUN_HOOKS) {
        throwOn = event;
        const summary = await shell.submit(`trigger ${event}`);
        expect(summary!.stopReason, `${event} does not abort the run`).toBe('run_complete');
        expect(shell.state, `${event} leaves the machine in IDLE`).toBe('IDLE');
      }
      throwOn = undefined;
      const failures = shell.trace.read().filter((record) => record.kind === 'bus_handler_failed');
      for (const event of MID_RUN_HOOKS) {
        expect(
          failures.some((record) => record.event === event && String(record.message) === `boom:${event}`),
          `${event} is attributed in the trace`,
        ).toBe(true);
      }
    } finally {
      await shell.stop();
    }
  }, 60_000);
});
