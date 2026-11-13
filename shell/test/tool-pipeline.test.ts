/**
 * Tool execution pipeline (round 16, #165): the two event-stream guarantees the Pi 1.5.0 deep read
 * turned up as divergences.
 *
 * 1. `tool_execution_start` is emitted before the tool hooks run, so a *blocked* call still gets a
 *    start/end pair. Pi emits `start` in `executeToolCalls*` before `prepareToolCall` (which runs
 *    `beforeToolCall`), so unknown, invalid, blocked and failed calls all pair; the shell emitted
 *    only the `end` for a blocked call, which is the same dangling-observation shape round 15 closed
 *    for a rejecting invoker.
 * 2. A batch ends the loop early only when *every* finalized call asked to terminate
 *    (`shouldTerminateToolBatch`, `agent-loop.js:471-473`); the shell ended on the first one.
 */
import { describe, expect, test } from 'bun:test';
import { EventBus } from '../src/bus.ts';
import { RunCage } from '../src/plugins/cage.ts';
import { AgentRuntime, type ToolInvoker } from '../src/state/agent-loop.ts';
import { recordEvents, ScriptedProvider } from './helpers.ts';

function tools(overrides: Partial<ToolInvoker> = {}): ToolInvoker {
  const definitions = [{ name: 'echo', description: 'echo', parameters: {}, source: 'test' }];
  return {
    list: () => definitions,
    invoke: async (name, call) => ({ toolCallId: call.toolCallId, toolName: name, output: `echo:${name}`, isError: false }),
    ...overrides,
  };
}

function runtime(bus: EventBus, provider: ScriptedProvider, invoker = tools()) {
  return new AgentRuntime({
    bus,
    tools: invoker,
    provider,
    budget: new RunCage({ maxTurnsPerRun: 10, maxTokensPerRun: 10_000, toolWhitelist: null }),
    systemPrompt: () => 'system',
  });
}

describe('the tool call event pair is whole for every call', () => {
  test('a blocked call emits tool_execution_start before its tool_execution_end', async () => {
    const bus = new EventBus();
    const seen = recordEvents(bus, ['tool_execution_start', 'tool_execution_end']);
    bus.on('beforeToolCall', () => ({ block: true, reason: 'not on the whitelist' }));
    const provider = new ScriptedProvider([
      { text: 'try a tool', toolCalls: [{ toolCallId: 'c1', toolName: 'echo', input: {} }] },
      { text: 'understood', toolCalls: [] },
    ]);
    const summary = await runtime(bus, provider).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(summary.toolResults[0].isError).toBe(true);
    expect(seen.map((event) => event.name)).toEqual(['tool_execution_start', 'tool_execution_end']);
    expect(seen.map((event) => (event.payload as { toolCallId?: string }).toolCallId)).toEqual(['c1', 'c1']);
  });
});

describe('a tool batch terminates early only when every call asks to', () => {
  test('one of two calls asking to terminate leaves the loop running', async () => {
    const bus = new EventBus();
    bus.on('afterToolCall', (payload: { tool?: { toolCallId?: string } }) =>
      payload.tool?.toolCallId === 'c1' ? { terminate: true } : undefined,
    );
    const provider = new ScriptedProvider([
      {
        text: 'two tools',
        toolCalls: [
          { toolCallId: 'c1', toolName: 'echo', input: {} },
          { toolCallId: 'c2', toolName: 'echo', input: {} },
        ],
      },
      { text: 'second turn', toolCalls: [] },
    ]);
    const summary = await runtime(bus, provider).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(summary.turns).toBe(2);
    expect(summary.toolResults).toHaveLength(2);
  });

  test('every call asking to terminate ends the batch after one turn', async () => {
    const bus = new EventBus();
    bus.on('afterToolCall', () => ({ terminate: true }));
    const provider = new ScriptedProvider([
      {
        text: 'two tools',
        toolCalls: [
          { toolCallId: 'c1', toolName: 'echo', input: {} },
          { toolCallId: 'c2', toolName: 'echo', input: {} },
        ],
      },
    ]);
    const summary = await runtime(bus, provider).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(summary.turns).toBe(1);
    expect(summary.toolResults).toHaveLength(2);
  });

  test('a blocked call that asks to terminate ends the batch too', async () => {
    const bus = new EventBus();
    bus.on('beforeToolCall', () => ({ block: true, reason: 'stop here', terminate: true }));
    const provider = new ScriptedProvider([
      { text: 'try a tool', toolCalls: [{ toolCallId: 'c1', toolName: 'echo', input: {} }] },
      { text: 'never asked for', toolCalls: [] },
    ]);
    const summary = await runtime(bus, provider).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(summary.turns).toBe(1);
    expect(summary.toolResults[0].output).toBe('stop here');
  });
});
