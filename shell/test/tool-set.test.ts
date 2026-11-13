import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { EventBus } from '../src/bus.ts';
import { AgentRuntime, type ToolInvoker } from '../src/state/agent-loop.ts';
import { RunCage } from '../src/plugins/cage.ts';
import { CheckpointStore, emptyCheckpoint } from '../src/state/checkpoint.ts';
import { ScriptedProvider, makeShell, makeTempDir, recordEvents } from './helpers.ts';

function invoker(names: string[]): ToolInvoker {
  return {
    list: () => names.map((name) => ({ name, description: name, parameters: {}, source: 'test' })),
    invoke: async (name, call) => ({ toolCallId: call.toolCallId, toolName: name, output: 'ok', isError: false }),
  };
}

function runtime(bus: EventBus, provider: ScriptedProvider, tools: ToolInvoker, onToolsDeclared?: (names: string[]) => void) {
  return new AgentRuntime({
    bus,
    tools,
    provider,
    budget: new RunCage({ maxTurnsPerRun: 10, maxTokensPerRun: 10_000, toolWhitelist: null }),
    systemPrompt: () => 'system',
    onToolsDeclared,
  });
}

const turnWithTool = [
  { text: 'tool', toolCalls: [{ toolCallId: 'c1', toolName: 'echo', input: {} }] },
  { text: 'done', toolCalls: [] },
];

describe('the tool-loadout declaration', () => {
  test('a steady loadout declares nothing on the first run', async () => {
    const bus = new EventBus();
    const declared: string[][] = [];
    const provider = new ScriptedProvider(turnWithTool);
    await runtime(bus, provider, invoker(['echo']), (names) => declared.push(names)).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(declared).toEqual([]);
    expect(provider.calls.some((call) => call.messages.some((message) => message.toolsAdded || message.toolsRemoved))).toBe(false);
  });

  test('a tool hot-plugged mid-run is declared before the next request', async () => {
    const bus = new EventBus();
    const names = ['echo'];
    const declared: string[][] = [];
    const seen = recordEvents(bus, ['message_start', 'message_end']);
    bus.on('tool_execution_end', () => {
      if (!names.includes('spawn')) names.push('spawn');
    });
    const provider = new ScriptedProvider(turnWithTool);
    await runtime(bus, provider, invoker(names), (list) => declared.push(list)).run({ runId: 'r', sessionId: 's', userText: 'go' });
    const declaration = provider.calls[1].messages.find((message) => message.toolsAdded?.length);
    expect(declaration?.toolsAdded).toEqual(['spawn']);
    expect(declaration?.toolsRemoved).toBeUndefined();
    expect(declared).toEqual([['echo', 'spawn']]);
    // The declaration is a transcript message with the same lifecycle pair as any other.
    expect(seen.some((event) => event.payload.message?.toolsAdded?.[0] === 'spawn')).toBe(true);
  });

  test('a tool unloaded mid-run is declared as removed', async () => {
    const bus = new EventBus();
    const names = ['echo', 'spawn'];
    bus.on('tool_execution_end', () => {
      if (names.includes('spawn')) names.splice(names.indexOf('spawn'), 1);
    });
    const provider = new ScriptedProvider(turnWithTool);
    await runtime(bus, provider, invoker(names)).run({ runId: 'r', sessionId: 's', userText: 'go' });
    const declaration = provider.calls[1].messages.find((message) => message.toolsRemoved?.length);
    expect(declaration?.toolsRemoved).toEqual(['spawn']);
  });

  test('a hot-plug between runs is declared on the next run', async () => {
    const bus = new EventBus();
    const names = ['echo'];
    const declared: string[][] = [];
    // One runtime across two runs: the declaration baseline is the runtime's, not the run's.
    const provider = new ScriptedProvider([{ text: 'one', toolCalls: [] }, { text: 'two', toolCalls: [] }]);
    const runner = runtime(bus, provider, invoker(names), (list) => declared.push(list));
    await runner.run({ runId: 'r1', sessionId: 's', userText: 'go' });
    names.push('spawn'); // the shell was idle when the plugin landed
    await runner.run({ runId: 'r2', sessionId: 's', userText: 'go again' });
    const declaration = provider.calls[1].messages.find((message) => message.toolsAdded?.length);
    expect(declaration?.toolsAdded).toEqual(['spawn']);
    expect(declared).toEqual([['echo', 'spawn']]);
  });
});

describe('the declaration is durable, not just contextual', () => {
  test('a hot-plug declaration reaches the ledger transcript', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([
      { text: 'read', toolCalls: [{ toolCallId: 'c1', toolName: 'read', input: { path: 'missing.txt' } }] },
      { text: 'done', toolCalls: [] },
    ]);
    const shell = makeShell(dir, provider);
    await shell.start();
    try {
      let added = false;
      shell.host.bus.on('tool_execution_end', () => {
        if (added) return;
        added = true;
        shell.host.tools.register({ name: 'lateplug', description: 'late', parameters: {}, execute: () => 'ok' }, { source: 'plugin:late' });
      });
      await shell.submit('go');
      const events = shell.kernel.searchRawEvents('lateplug', { projectId: shell.config.projectId, limit: 10 });
      expect(events.length).toBeGreaterThan(0);
      const event = JSON.stringify(events[0]);
      expect(event).toContain('lateplug');
      expect(event).toContain('tool-loadout');
    } finally {
      await shell.stop();
    }
  }, 30_000);
});

describe('checkpoint recovery compares the declared loadout', () => {
  test('a declared loadout the process cannot execute fails loudly', async () => {
    const dir = makeTempDir();
    new CheckpointStore(join(dir, 'data')).save({ ...emptyCheckpoint(), runtime: { declaredTools: ['read', 'write'] } });
    const shell = makeShell(dir, new ScriptedProvider([{ text: 'x', toolCalls: [] }]));
    await expect(shell.start()).rejects.toThrow('tool_set_mismatch');
    const record = shell.trace.read().find((entry) => entry.kind === 'tool_set_mismatch');
    expect(record?.declared).toEqual(['read', 'write']);
    expect(record?.executable).toEqual(['bash', 'edit', 'propose_command', 'read', 'write']);
  });

  test('a matching declared loadout starts, and the current set becomes the declaration', async () => {
    const dir = makeTempDir();
    new CheckpointStore(join(dir, 'data')).save({ ...emptyCheckpoint(), runtime: { declaredTools: ['read', 'write', 'edit', 'bash', 'propose_command'] } });
    const shell = makeShell(dir, new ScriptedProvider([{ text: 'x', toolCalls: [] }]));
    await shell.start();
    try {
      expect([...shell.machine.runtime.declaredTools!].sort()).toEqual(['bash', 'edit', 'propose_command', 'read', 'write']);
    } finally {
      await shell.stop();
    }
  });
});
