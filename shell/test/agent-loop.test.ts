import { describe, expect, test } from 'bun:test';
import { EventBus } from '../src/bus.ts';
import { AgentRuntime, type ToolInvoker } from '../src/state/agent-loop.ts';
import { RunCage } from '../src/plugins/cage.ts';
import { recordEvents, ScriptedProvider, type RecordedEvent } from './helpers.ts';

function tools(overrides: Partial<ToolInvoker> = {}): ToolInvoker {
  const definitions = [{ name: 'echo', description: 'echo', parameters: {}, source: 'test' }];
  return {
    list: () => definitions,
    invoke: async (name, call) => ({ toolCallId: call.toolCallId, toolName: name, output: `echo:${JSON.stringify(call.input)}`, isError: false }),
    ...overrides,
  };
}

function runtime(bus: EventBus, provider: ScriptedProvider, invoker = tools(), cage = new RunCage({ maxTurnsPerRun: 10, maxTokensPerRun: 10_000, toolWhitelist: null })) {
  return new AgentRuntime({ bus, tools: invoker, provider, budget: cage, systemPrompt: () => 'system' });
}

describe('Pi-aligned loop', () => {
  test('event order is verbatim and a tool call adds a second turn', async () => {
    const bus = new EventBus();
    const seen = recordEvents(bus, [
      'before_agent_start', 'agent_start', 'turn_start', 'message_start', 'message_update', 'message_end',
      'tool_execution_start', 'tool_execution_end', 'turn_end', 'agent_end', 'agent_settled',
    ]);
    const provider = new ScriptedProvider([
      { text: 'let me look', toolCalls: [{ toolCallId: 'c1', toolName: 'echo', input: { value: 1 } }] },
      { text: 'all done', toolCalls: [] },
    ]);
    const summary = await runtime(bus, provider).run({ runId: 'r1', sessionId: 's1', userText: 'hi' });
    expect(seen.map((event) => event.name)).toEqual([
      'before_agent_start', 'agent_start',
      'message_start', 'message_end',
      'turn_start', 'message_start', 'message_update', 'message_end', 'tool_execution_start', 'tool_execution_end', 'turn_end',
      'turn_start', 'message_start', 'message_update', 'message_end', 'turn_end',
      'agent_end', 'agent_settled',
    ]);
    // The two leading message events are the user message entering the loop (Pi's tree: message_start/end).
    expect(seen[2].payload.message.role).toBe('user');
    expect(summary.stopReason).toBe('run_complete');
    expect(summary.assistantText).toContain('all done');
    expect(summary.toolResults[0].output).toBe('echo:{"value":1}');
    // The model sees the tool result as a `tool` message before the second call.
    expect(provider.calls[1].messages.some((message) => message.role === 'tool' && message.content.includes('echo:'))).toBe(true);
  });

  test('beforeToolCall block short-circuits execution and later hooks', async () => {
    const bus = new EventBus();
    const calls: string[] = [];
    bus.on('beforeToolCall', () => {
      calls.push('first');
      return { block: true, reason: 'whitelist says no' };
    });
    bus.on('beforeToolCall', () => {
      calls.push('second');
      return undefined;
    });
    let executed = 0;
    const provider = new ScriptedProvider([
      { text: 'tool', toolCalls: [{ toolCallId: 'c1', toolName: 'echo', input: {} }] },
      { text: 'done', toolCalls: [] },
    ]);
    const summary = await runtime(bus, provider, tools({ invoke: async (name, call) => { executed += 1; return { toolCallId: call.toolCallId, toolName: name, output: 'ran', isError: false }; } })).run({ runId: 'r', sessionId: 's', userText: 'x' });
    expect(calls).toEqual(['first']);
    expect(executed).toBe(0);
    expect(summary.toolResults[0].isError).toBe(true);
    expect(summary.toolResults[0].output).toBe('whitelist says no');
  });

  test('steering drains after the tool batch and before the next turn', async () => {
    const bus = new EventBus();
    const provider = new ScriptedProvider([
      { text: 'first', toolCalls: [{ toolCallId: 'c1', toolName: 'echo', input: {} }] },
      { text: 'second', toolCalls: [] },
    ]);
    const runner = runtime(bus, provider);
    bus.on('tool_execution_end', () => runner.steer('change of plan'));
    const summary = await runner.run({ runId: 'r', sessionId: 's', userText: 'start' });
    expect(summary.turns).toBe(2);
    const secondCall = provider.calls[1].messages;
    expect(secondCall.some((message) => message.role === 'user' && message.content === 'change of plan')).toBe(true);
  });

  test('steering injected with no tools still gets a turn before follow-up', async () => {
    const bus = new EventBus();
    const provider = new ScriptedProvider([
      { text: 'plain answer', toolCalls: [] },
      { text: 'after steering', toolCalls: [] },
      { text: 'after followup', toolCalls: [] },
    ]);
    const runner = runtime(bus, provider);
    let steered = false;
    bus.on('message_end', (event: { message?: { role?: string } }) => {
      if (event.message?.role === 'assistant' && !steered) {
        steered = true;
        runner.steer('steer now');
      }
    });
    runner.followUp('follow up later');
    const summary = await runner.run({ runId: 'r', sessionId: 's', userText: 'start' });
    expect(summary.turns).toBe(3);
    expect(provider.calls[1].messages.some((message) => message.role === 'user' && message.content === 'steer now')).toBe(true);
    expect(provider.calls[2].messages.some((message) => message.role === 'user' && message.content === 'follow up later')).toBe(true);
  });

  test('turn budget overrun ends the run with budget_exceeded', async () => {
    const bus = new EventBus();
    const provider = new ScriptedProvider([{ text: 'looping', toolCalls: [{ toolCallId: 'c', toolName: 'echo', input: {} }] }]);
    const cage = new RunCage({ maxTurnsPerRun: 2, maxTokensPerRun: 10_000, toolWhitelist: null });
    const summary = await runtime(bus, provider, tools(), cage).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(summary.stopReason).toBe('budget_exceeded');
    expect(summary.turns).toBe(2);
    expect(summary.error).toContain('turn_budget_exceeded');
  });

  test('afterToolCall can replace a result and terminate the run', async () => {
    const bus = new EventBus();
    bus.on('afterToolCall', () => ({ result: { toolCallId: 'c1', toolName: 'echo', output: 'rewritten', isError: false }, terminate: true }));
    const provider = new ScriptedProvider([
      { text: 'tool', toolCalls: [{ toolCallId: 'c1', toolName: 'echo', input: {} }] },
      { text: 'should not be called', toolCalls: [] },
    ]);
    const summary = await runtime(bus, provider).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(summary.toolResults[0].output).toBe('rewritten');
    expect(summary.turns).toBe(1);
    expect(summary.stopReason).toBe('run_complete');
  });

  test('a length-truncated turn voids its whole tool batch, one correctable error each', async () => {
    const bus = new EventBus();
    let executed = 0;
    const invoker = tools({
      invoke: async (name, call) => {
        executed += 1;
        return { toolCallId: call.toolCallId, toolName: name, output: 'ran', isError: false };
      },
    });
    const provider = new ScriptedProvider([
      {
        text: 'let me read',
        stopReason: 'length',
        toolCalls: [
          { toolCallId: 'c1', toolName: 'echo', input: { path: 'half' } },
          { toolCallId: 'c2', toolName: 'echo', input: { path: 'the-other-half' } },
        ],
      },
      { text: 're-issued', toolCalls: [] },
    ]);
    const summary = await runtime(bus, provider, invoker).run({ runId: 'r', sessionId: 's', userText: 'go' });
    // Before the fix both calls executed; now the batch is refused whole.
    expect(executed).toBe(0);
    expect(summary.toolResults).toHaveLength(2);
    expect(summary.toolResults.every((result) => result.isError)).toBe(true);
    for (const result of summary.toolResults) {
      expect(result.output).toContain('output token limit');
      expect(result.output).toContain('Re-issue the call with complete arguments');
    }
    // Each refusal is a tool message the model can read before re-issuing (one per call, in order).
    const toolMessages = provider.calls[1].messages.filter((message) => message.role === 'tool');
    expect(toolMessages.map((message) => message.toolCallId)).toEqual(['c1', 'c2']);
    // The batch is voided, not the run: the model is asked again and can correct itself.
    expect(summary.stopReason).toBe('run_complete');
    expect(summary.assistantText).toContain('re-issued');
  });

  test('a nested tool call goes through the cage instead of around it', async () => {
    const bus = new EventBus();
    const executed: string[] = [];
    const seenByHooks: string[] = [];
    bus.on('beforeToolCall', (payload: { toolName?: string }) => {
      seenByHooks.push(payload.toolName ?? '');
      return undefined;
    });
    const invoker: ToolInvoker = {
      list: () => [
        { name: 'outer', description: 'nest', parameters: {}, source: 'test' },
        { name: 'bash', description: 'shell', parameters: {}, source: 'test' },
      ],
      invoke: async (name, call, ctx) => {
        if (name === 'outer') {
          const nested = await ctx.runToolCall!('bash', { command: 'printf nested > escaped.txt' });
          return { toolCallId: call.toolCallId, toolName: name, output: `nested->${nested.output}`, isError: nested.isError };
        }
        executed.push(name);
        return { toolCallId: call.toolCallId, toolName: name, output: 'ran', isError: false };
      },
    };
    const cage = new RunCage({ maxTurnsPerRun: 5, maxTokensPerRun: 10_000, toolWhitelist: ['outer'] });
    cage.register(bus);
    const provider = new ScriptedProvider([
      { text: 'nest', toolCalls: [{ toolCallId: 'c1', toolName: 'outer', input: {} }] },
      { text: 'done', toolCalls: [] },
    ]);
    const summary = await runtime(bus, provider, invoker, cage).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(executed).toEqual([]); // the nested bash never ran
    expect(seenByHooks).toEqual(['outer', 'bash']); // but the veto hook saw it
    expect(summary.toolResults[0].output).toContain('tool_not_in_whitelist');
  });

  test('a nested call to an allowed tool runs and returns its result', async () => {
    const bus = new EventBus();
    const invoker: ToolInvoker = {
      list: () => [
        { name: 'outer', description: 'nest', parameters: {}, source: 'test' },
        { name: 'bash', description: 'shell', parameters: {}, source: 'test' },
      ],
      invoke: async (name, call, ctx) => {
        if (name === 'outer') {
          const nested = await ctx.runToolCall!('bash', { command: 'echo hi' });
          return { toolCallId: call.toolCallId, toolName: name, output: `nested->${nested.output}`, isError: nested.isError };
        }
        return { toolCallId: call.toolCallId, toolName: name, output: 'ran', isError: false };
      },
    };
    const provider = new ScriptedProvider([
      { text: 'nest', toolCalls: [{ toolCallId: 'c1', toolName: 'outer', input: {} }] },
      { text: 'done', toolCalls: [] },
    ]);
    const summary = await runtime(bus, provider, invoker).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(summary.toolResults[0].output).toBe('nested->ran');
  });

  test('runaway nesting is refused at a bounded depth', async () => {
    const bus = new EventBus();
    const invoker: ToolInvoker = {
      list: () => [{ name: 'recurse', description: 'nest', parameters: {}, source: 'test' }],
      invoke: async (name, call, ctx) => {
        const nested = await ctx.runToolCall!('recurse', {});
        return { toolCallId: call.toolCallId, toolName: name, output: nested.output, isError: nested.isError };
      },
    };
    const provider = new ScriptedProvider([
      { text: 'nest', toolCalls: [{ toolCallId: 'c1', toolName: 'recurse', input: {} }] },
      { text: 'done', toolCalls: [] },
    ]);
    const summary = await runtime(bus, provider, invoker).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(summary.toolResults[0].output).toContain('nested_tool_depth_exceeded');
    expect(summary.toolResults[0].isError).toBe(true);
  });

  test('agent_settled always follows agent_end and carries the abort', async () => {
    const bus = new EventBus();
    const seen: Array<{ name: string; aborted?: boolean }> = [];
    bus.on('agent_end', () => {
      seen.push({ name: 'agent_end' });
    });
    bus.on('agent_settled', (payload: { aborted?: boolean }) => {
      seen.push({ name: 'agent_settled', aborted: payload.aborted });
    });
    const runner = runtime(bus, new ScriptedProvider([{ text: 'ok', toolCalls: [] }]));
    bus.on('agent_start', () => runner.abort('test'));
    const summary = await runner.run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(summary.stopReason).toBe('run_aborted');
    expect(seen.map((entry) => entry.name)).toEqual(['agent_end', 'agent_settled']);
    expect(seen[1].aborted).toBe(true);
  });

  test('an abort surfacing as a provider throw stays run_aborted and is not retried', async () => {
    const bus = new EventBus();
    const settled: Array<{ aborted?: boolean; stopReason?: string }> = [];
    bus.on('agent_settled', (payload: { aborted?: boolean; stopReason?: string }) => {
      settled.push(payload);
    });
    const seen = recordEvents(bus, ['finishTurn', 'turn_end']);
    let attempts = 0;
    let runner: AgentRuntime;
    const provider = new ScriptedProvider([
      () => {
        attempts += 1;
        runner.abort('test'); // the abort fires, then the call throws with the abort's text
        throw new Error('The operation was aborted');
      },
    ]);
    runner = new AgentRuntime({
      bus,
      tools: tools(),
      provider,
      budget: new RunCage({ maxTurnsPerRun: 10, maxTokensPerRun: 10_000, toolWhitelist: null }),
      systemPrompt: () => 'system',
      retry: { enabled: true, maxRetries: 3, baseDelayMs: 1, maxDelayMs: 1_000 },
      sleep: async () => {},
    });
    const summary = await runner.run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(summary.stopReason).toBe('run_aborted');
    expect(attempts).toBe(1); // an abort is terminal, never a retryable failure
    // Pi still runs finishTurn and emits turn_end for an aborted turn.
    expect(seen.map((event) => event.name)).toEqual(['finishTurn', 'turn_end']);
    expect(settled[0]?.aborted).toBe(true);
    expect(settled[0]?.stopReason).toBe('run_aborted');
  });

  test('prepareRequest is the last gate before every request, the first included', async () => {
    const bus = new EventBus();
    const seen: Array<{ turnIndex?: number; systemPrompt: string }> = [];
    bus.on('prepareRequest', (request: { systemPrompt: string }, ctx: { turnIndex?: number }) => {
      seen.push({ turnIndex: ctx.turnIndex, systemPrompt: request.systemPrompt });
      return { systemPrompt: `system@turn${ctx.turnIndex}`, model: `model@turn${ctx.turnIndex}` };
    });
    const provider = new ScriptedProvider([
      { text: 'tool', toolCalls: [{ toolCallId: 'c1', toolName: 'echo', input: {} }] },
      { text: 'done', toolCalls: [] },
    ]);
    await runtime(bus, provider).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(seen.map((entry) => entry.turnIndex)).toEqual([1, 2]);
    expect(seen[0].systemPrompt).toBe('system');
    expect(provider.calls[0].systemPrompt).toBe('system@turn1');
    expect(provider.calls[1].systemPrompt).toBe('system@turn2');
    expect(provider.calls[0].model).toBe('model@turn1');
    expect(provider.calls[1].model).toBe('model@turn2');
  });

  test('finishTurn { action: end } stops after the turn without polling the queues', async () => {
    const bus = new EventBus();
    bus.on('finishTurn', () => ({ action: 'end' }));
    const provider = new ScriptedProvider([
      { text: 'one', toolCalls: [{ toolCallId: 'c1', toolName: 'echo', input: {} }] },
      { text: 'must never be asked for', toolCalls: [] },
    ]);
    const runner = runtime(bus, provider);
    runner.steer('queued but the run ends');
    const summary = await runner.run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(summary.turns).toBe(1);
    expect(provider.calls.length).toBe(1);
    expect(summary.stopReason).toBe('run_complete');
  });

  test('finishTurn { action: continue } guarantees one more context-only request', async () => {
    const bus = new EventBus();
    bus.on('finishTurn', (payload: { turnIndex: number }) => (payload.turnIndex === 1 ? { action: 'continue' } : undefined));
    const provider = new ScriptedProvider([
      { text: 'first', toolCalls: [] },
      { text: 'explicit second', toolCalls: [] },
    ]);
    const summary = await runtime(bus, provider).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(summary.turns).toBe(2);
    expect(summary.assistantText).toContain('explicit second');
  });

  test('prepareNextTurn appends messages at the turn boundary, with lifecycle events', async () => {
    const bus = new EventBus();
    const seen = recordEvents(bus, ['message_start', 'message_end']);
    bus.on('prepareNextTurn', (payload: { turnIndex: number }) => (payload.turnIndex === 1 ? { messages: [{ role: 'system', content: 'boundary-note' }] } : undefined));
    const provider = new ScriptedProvider([
      { text: 'tool', toolCalls: [{ toolCallId: 'c1', toolName: 'echo', input: {} }] },
      { text: 'done', toolCalls: [] },
    ]);
    await runtime(bus, provider).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(provider.calls[1].messages.some((message) => message.content === 'boundary-note')).toBe(true);
    expect(seen.some((event) => event.payload.message?.content === 'boundary-note')).toBe(true);
  });

  test('steering typed while prepareNextTurn runs is not dropped', async () => {
    const bus = new EventBus();
    const provider = new ScriptedProvider([
      { text: 'tool', toolCalls: [{ toolCallId: 'c1', toolName: 'echo', input: {} }] },
      { text: 'done', toolCalls: [] },
    ]);
    const runner = runtime(bus, provider);
    let steered = false;
    bus.on('prepareNextTurn', async () => {
      if (steered) return undefined;
      steered = true;
      // The line arrives inside the prepare window; the queue is read again after it returns.
      await new Promise<void>((resolve) => setTimeout(() => { runner.steer('typed during prepare'); resolve(); }, 5));
      return undefined;
    });
    const summary = await runner.run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(summary.turns).toBe(2);
    expect(provider.calls[1].messages.some((message) => message.role === 'user' && message.content === 'typed during prepare')).toBe(true);
  });

  test('a tool that rejects still gets its tool_execution_end and an error result', async () => {
    // Pi's guarantee: a thrown tool failure comes back as `isError: true` and the start/end pair is
    // never left dangling. Without it the capture buffer holds a call with no observation and the
    // checkpoint's in-flight list keeps the call until the next recovery.
    const bus = new EventBus();
    const seen = recordEvents(bus, ['tool_execution_start', 'tool_execution_end', 'turn_end']);
    const invoker = tools({
      invoke: async () => {
        throw new Error('bash aborted');
      },
    });
    const provider = new ScriptedProvider([
      { text: 'tool', toolCalls: [{ toolCallId: 'c1', toolName: 'echo', input: {} }] },
      { text: 'recovered', toolCalls: [] },
    ]);
    const summary = await runtime(bus, provider, invoker).run({ runId: 'r', sessionId: 's', userText: 'go' });
    const ends = seen.filter((event) => event.name === 'tool_execution_end');
    expect(ends).toHaveLength(1);
    expect(ends[0].payload.isError).toBe(true);
    expect(String(ends[0].payload.result.output)).toContain('bash aborted');
    // The turn still closes, and the model can read the failure and re-plan.
    expect(seen.filter((event) => event.name === 'turn_end')).toHaveLength(2);
    expect(summary.stopReason).toBe('run_complete');
  });

  test('a provider failure becomes run_error, not an unhandled rejection', async () => {
    const bus = new EventBus();
    const provider = new ScriptedProvider([() => {
      throw new Error('gateway down');
    }]);
    const summary = await runtime(bus, provider).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(summary.stopReason).toBe('run_error');
    expect(summary.error).toContain('gateway down');
  });
});
