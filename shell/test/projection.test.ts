import { describe, expect, test } from 'bun:test';
import { EventBus } from '../src/bus.ts';
import { AgentRuntime, type AgentMessage, type ModelCompletionInput, type ModelProvider, type ModelTurn, type ToolInvoker } from '../src/state/agent-loop.ts';
import { ContextProjection, ProjectionTargetMissingError, UnpairedToolResultError } from '../src/state/projection.ts';
import { RunCage } from '../src/plugins/cage.ts';
import type { TraceLog } from '../src/trace.ts';
import type { RetryPolicy } from '../src/state/retry.ts';

function attempt(toolCallId: string): AgentMessage {
  return { role: 'assistant', content: 'failed attempt', toolCalls: [{ toolCallId, toolName: 'echo', input: {} }] };
}

describe('the append-only context projection', () => {
  test('omitting an attempt pulls its tool results out with it, and the log keeps everything', () => {
    const context = new ContextProjection();
    context.append({ role: 'user', content: 'go' });
    const assistant = context.append(attempt('c1'));
    context.append({ role: 'tool', content: 'result one', toolCallId: 'c1', toolName: 'echo', isError: false });
    context.append({ role: 'assistant', content: 'the real answer' });

    const before = context.project();
    expect(before).toHaveLength(4);

    const omitted = context.omitFailedAttempt(assistant.id);
    expect(omitted).toEqual([assistant.id, assistant.id + 1]);

    const after = context.project();
    expect(after.map((message) => message.content)).toEqual(['go', 'the real answer']);
    // Nothing was deleted: four source messages plus two context_edit entries.
    expect(context.log).toHaveLength(6);
    expect(context.log.filter((entry) => entry.type === 'context_edit')).toHaveLength(2);
  });

  test('a tool result whose tool call is omitted alone is refused, not sent', () => {
    const context = new ContextProjection();
    const assistant = context.append(attempt('c1'));
    context.append({ role: 'tool', content: 'orphan', toolCallId: 'c1', toolName: 'echo', isError: false });
    // Bypass the pairing API the way a careless caller would: omit only the assistant message.
    context.edit(assistant.id, null);
    expect(() => context.project()).toThrow(UnpairedToolResultError);
  });

  test('a later edit overrides an earlier one, and a replacement is projected in place', () => {
    const context = new ContextProjection();
    const user = context.append({ role: 'user', content: 'original' });
    context.edit(user.id, { role: 'user', content: 'rewritten' });
    context.edit(user.id, { role: 'user', content: 'rewritten twice' });
    expect(context.project().map((message) => message.content)).toEqual(['rewritten twice']);
  });

  test('the oldest tool exchange can be dropped, paired, and is undefined when there is none', () => {
    const context = new ContextProjection();
    context.append({ role: 'user', content: 'go' });
    const first = context.append(attempt('c1'));
    context.append({ role: 'tool', content: 'result one', toolCallId: 'c1', toolName: 'echo', isError: false });
    context.append({ role: 'assistant', content: 'later answer' });
    const dropped = context.omitOldestToolExchange();
    expect(dropped).toEqual([first.id, first.id + 1]);
    expect(context.project().map((message) => message.content)).toEqual(['go', 'later answer']);
    // With the only exchange already gone there is nothing left to drop.
    expect(context.omitOldestToolExchange()).toBeUndefined();

    const plain = new ContextProjection();
    plain.append({ role: 'user', content: 'no tools here' });
    expect(plain.omitOldestToolExchange()).toBeUndefined();
  });

  test('editing a target that is not in the log fails loudly', () => {
    const context = new ContextProjection();
    expect(() => context.edit(99, null)).toThrow(ProjectionTargetMissingError);
    expect(() => context.omitFailedAttempt(99)).toThrow(ProjectionTargetMissingError);
  });
});

class RecordingProvider implements ModelProvider {
  readonly name = 'recording';
  readonly model = 'recording/test';
  readonly calls: AgentMessage[][] = [];
  constructor(private readonly turns: ModelTurn[]) {}
  async complete(input: ModelCompletionInput): Promise<ModelTurn> {
    this.calls.push(input.messages);
    return this.turns[Math.min(this.calls.length - 1, this.turns.length - 1)];
  }
}

describe('omission on the retry path', () => {
  test('a failed attempt is edited out of the retry request but stays in the log', async () => {
    const provider = new RecordingProvider([
      { text: 'failed attempt', toolCalls: [], stopReason: 'error', error: '503 upstream unavailable' },
      { text: 'recovered', toolCalls: [] },
    ]);
    const records: Array<{ kind: string; record?: Record<string, unknown> }> = [];
    const retry: RetryPolicy = { enabled: true, maxRetries: 2, baseDelayMs: 1, maxDelayMs: 60_000 };
    const runtime = new AgentRuntime({
      bus: new EventBus(),
      tools: { list: () => [], invoke: async () => ({ toolCallId: 'x', toolName: 'x', output: '', isError: false }) } as ToolInvoker,
      provider,
      budget: new RunCage({ maxTurnsPerRun: 5, maxTokensPerRun: 10_000, toolWhitelist: null }),
      systemPrompt: () => 'system',
      retry,
      sleep: async () => {},
      trace: { append: (kind: string, record?: Record<string, unknown>) => { records.push({ kind, record }); } } as unknown as TraceLog,
    });
    const summary = await runtime.run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(summary.stopReason).toBe('run_complete');
    expect(provider.calls).toHaveLength(2);
    // The first (failed) request carried the attempt being made; the retry does not.
    expect(provider.calls[1].some((message) => message.content === 'failed attempt')).toBe(false);
    expect(provider.calls[1].some((message) => message.content === 'go')).toBe(true);
    // The omission is an appended entry, not a deletion, and it is legible in the trace.
    const omission = records.find((entry) => entry.kind === 'recovery_attempt_omitted');
    expect(omission?.record?.omitted).toHaveLength(1);
  });
});
