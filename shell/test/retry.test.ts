import { describe, expect, test } from 'bun:test';
import { EventBus } from '../src/bus.ts';
import { AgentRuntime, type AgentMessage, type ModelProvider, type ModelTurn, type ToolInvoker } from '../src/state/agent-loop.ts';
import { RunCage } from '../src/plugins/cage.ts';
import type { TraceLog } from '../src/trace.ts';
import {
  classifyEndpointFailure,
  classifyProviderError,
  planFailure,
  retryDelayMs,
  sleepAbortable,
  type RetryPolicy,
} from '../src/state/retry.ts';

const policy: RetryPolicy = { enabled: true, maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 60_000 };

describe('the failure ladder classification', () => {
  test('overflow first, then account limits, then the transient table', () => {
    expect(classifyProviderError('mg_gateway_error: 503 The service is temporarily unavailable')).toBe('retryable');
    expect(classifyProviderError('mg_gateway_error: 429 Too Many Requests')).toBe('retryable');
    expect(classifyProviderError('insufficient_quota: you exceeded your current quota')).toBe('fatal');
    expect(classifyProviderError('mg_gateway_error: 400 billing hard limit reached')).toBe('fatal');
    expect(classifyProviderError('Your input exceeds the context window of this model')).toBe('overflow');
    expect(classifyProviderError('prompt is too long: 213462 tokens > 200000 maximum')).toBe('overflow');
    expect(classifyProviderError('tool_name_conflict: nope')).toBe('fatal');
    expect(classifyProviderError('')).toBe('fatal');
    // Matches both tables (a 429 and a quota word): the account limit wins, so it is not retried.
    expect(classifyProviderError('mg_gateway_error: 429 quota exceeded')).toBe('fatal');
  });

  test('a throttle that also mentions tokens is not read as an overflow', () => {
    // Without the non-overflow exclusion this matches /too many tokens/ and would take the overflow
    // rung (Pi's own comment on that exclusion names this exact Bedrock message).
    expect(classifyProviderError('Throttling error: Too many tokens, please wait before trying again.')).toBe('fatal');
  });

  test('backoff is exponential and capped at one minute', () => {
    expect(retryDelayMs(policy, 1)).toBe(1_000);
    expect(retryDelayMs(policy, 3)).toBe(4_000);
    expect(retryDelayMs(policy, 20)).toBe(60_000);
  });

  test('the overflow recovery latch turns the second overflow into a failure, not a loop', () => {
    const first = planFailure({ message: 'prompt is too long', attempt: 0, policy, overflowRecoveryUsed: false });
    expect(first.action).toBe('recover_overflow');
    const second = planFailure({ message: 'prompt is too long', attempt: 0, policy, overflowRecoveryUsed: true });
    expect(second).toEqual({ action: 'fail', kind: 'overflow', reason: 'overflow_recovery_exhausted: prompt is too long' });
  });

  test('a limit error fails immediately even with retries left', () => {
    expect(planFailure({ message: 'insufficient_quota', attempt: 0, policy, overflowRecoveryUsed: false }).action).toBe('fail');
  });

  test('an abort during the backoff sleep ends the wait', async () => {
    const controller = new AbortController();
    const waiting = sleepAbortable(60_000, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow('aborted');
  });
});

describe('the endpoint failure classes (named for diagnosis, decided by the ladder)', () => {
  const cases: Array<{ message: string; kind: string; ladder: string; action: 'retry' | 'fail' | 'recover_overflow' }> = [
    { message: 'mg_gateway_error: 401 unauthorized', kind: 'auth', ladder: 'fatal', action: 'fail' },
    { message: 'mg_gateway_error: 403 forbidden', kind: 'auth', ladder: 'fatal', action: 'fail' },
    { message: 'mg_gateway_error: 404 {"error":{"message":"model not found"}}', kind: 'model_not_found', ladder: 'fatal', action: 'fail' },
    { message: 'mg_gateway_error: 429 rate limit exceeded', kind: 'rate_limit', ladder: 'retryable', action: 'retry' },
    { message: 'Unable to connect. Is the computer able to access the url?', kind: 'unreachable', ladder: 'retryable', action: 'retry' },
    { message: 'TimeoutError: The operation was aborted due to timeout', kind: 'timeout', ladder: 'retryable', action: 'retry' },
    { message: 'mg_gateway_error: 500 internal server error', kind: 'http', ladder: 'retryable', action: 'retry' },
  ];

  test('each class is named, and the ladder owns the retry decision', () => {
    for (const entry of cases) {
      expect(`${entry.message} -> ${classifyEndpointFailure(entry.message)}`).toBe(`${entry.message} -> ${entry.kind}`);
      expect(`${entry.message} -> ${classifyProviderError(entry.message)}`).toBe(`${entry.message} -> ${entry.ladder}`);
      expect(planFailure({ message: entry.message, attempt: 0, policy, overflowRecoveryUsed: false }).action).toBe(entry.action);
    }
  });

  test('a status code must not be read out of a longer number', () => {
    // A request id or byte count containing "404"/"429" is not an HTTP status.
    expect(classifyEndpointFailure('request id req_abc404def failed')).toBe('unknown');
    expect(classifyEndpointFailure('read 1404 bytes and then died')).toBe('unknown');
  });
});

/** A provider whose recorded turns are returned in order; the last repeats. */
class RecordingTurns implements ModelProvider {
  readonly name = 'recording-turns';
  readonly model = 'recording-turns/test';
  calls = 0;
  constructor(private readonly turns: ModelTurn[]) {}
  async complete(): Promise<ModelTurn> {
    const turn = this.turns[Math.min(this.calls, this.turns.length - 1)];
    this.calls += 1;
    return turn;
  }
}

/** Overflows only while the big tool exchange is still in the request; that is what recovery drops. */
class OverflowUntilToolExchangeGone implements ModelProvider {
  readonly name = 'overflow-until-trimmed';
  readonly model = 'overflow-until-trimmed/test';
  readonly calls: AgentMessage[][] = [];
  async complete(input: { messages: AgentMessage[] }): Promise<ModelTurn> {
    this.calls.push(input.messages);
    if (this.calls.length === 1) return { text: 'call', toolCalls: [{ toolCallId: 'c1', toolName: 'echo', input: {} }] };
    if (input.messages.some((message) => message.role === 'tool' && message.content === 'BIG')) {
      return { text: '', toolCalls: [], stopReason: 'error', error: 'Your input exceeds the context window of this model' };
    }
    return { text: 'recovered', toolCalls: [] };
  }
}

/** A provider whose scripted outcomes are thrown error messages or a final turn. */
class FlakyProvider implements ModelProvider {
  readonly name = 'flaky';
  readonly model = 'flaky/test';
  calls = 0;
  constructor(private readonly script: Array<string | ModelTurn>) {}
  async complete(): Promise<ModelTurn> {
    const step = this.script[Math.min(this.calls, this.script.length - 1)];
    this.calls += 1;
    if (typeof step === 'string') throw new Error(step);
    return step;
  }
}

function echoTools(): ToolInvoker {
  return {
    list: () => [{ name: 'echo', description: 'echo', parameters: {}, source: 'test' }],
    invoke: async (name, call) => ({ toolCallId: call.toolCallId, toolName: name, output: 'BIG', isError: false }),
  };
}

function ladderRuntime(bus: EventBus, provider: ModelProvider, retry: RetryPolicy, cage: RunCage, delays: number[], trace?: TraceLog, tools?: ToolInvoker) {
  return new AgentRuntime({
    bus,
    tools: tools ?? ({ list: () => [], invoke: async () => ({ toolCallId: 'x', toolName: 'x', output: '', isError: false }) } as ToolInvoker),
    provider,
    budget: cage,
    systemPrompt: () => 'system',
    retry,
    trace,
    // The recorded delay is the assertion; a real backoff would make the suite wait.
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  });
}

describe('the failure ladder inside the run', () => {
  const fast: RetryPolicy = { enabled: true, maxRetries: 2, baseDelayMs: 7, maxDelayMs: 60_000 };

  test('a transient failure retries without charging the turn budget', async () => {
    const provider = new FlakyProvider(['mg_gateway_error: 503 temporarily unavailable', { text: 'recovered', toolCalls: [] }]);
    const delays: number[] = [];
    // Budget of exactly one turn: if the retry charged the cage, the run would die as budget_exceeded.
    const cage = new RunCage({ maxTurnsPerRun: 1, maxTokensPerRun: 10_000, toolWhitelist: null });
    const summary = await ladderRuntime(new EventBus(), provider, fast, cage, delays).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(summary.stopReason).toBe('run_complete');
    expect(summary.turns).toBe(1);
    expect(provider.calls).toBe(2);
    expect(delays).toEqual([7]);
    expect(summary.assistantText).toContain('recovered');
  });

  test('an account limit is not retried, and retries are bounded', async () => {
    const limitProvider = new FlakyProvider(['insufficient_quota: out of credits']);
    const limitSummary = await ladderRuntime(new EventBus(), limitProvider, fast, new RunCage({ maxTurnsPerRun: 10, maxTokensPerRun: 10_000, toolWhitelist: null }), []).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(limitProvider.calls).toBe(1);
    expect(limitSummary.stopReason).toBe('run_error');
    expect(limitSummary.error).toContain('insufficient_quota');

    const flaky = new FlakyProvider(['503 upstream unavailable']);
    const delays: number[] = [];
    const bounded = await ladderRuntime(new EventBus(), flaky, fast, new RunCage({ maxTurnsPerRun: 10, maxTokensPerRun: 10_000, toolWhitelist: null }), delays).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(flaky.calls).toBe(3); // the first call plus two retries
    expect(delays).toEqual([7, 14]);
    expect(bounded.stopReason).toBe('run_error');
  });

  test('an overflow with nothing left to drop fails as unavailable', async () => {
    const provider = new FlakyProvider(['Your input exceeds the context window of this model']);
    const summary = await ladderRuntime(new EventBus(), provider, fast, new RunCage({ maxTurnsPerRun: 10, maxTokensPerRun: 10_000, toolWhitelist: null }), []).run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(provider.calls).toBe(1); // re-sending the same bytes would not be a recovery
    expect(summary.stopReason).toBe('run_error');
    expect(summary.error).toContain('overflow_recovery_unavailable');
  });

  test('overflow recovers at most once per run', async () => {
    const overflow = { text: '', toolCalls: [], stopReason: 'error' as const, error: 'Your input exceeds the context window of this model' };
    const provider = new RecordingTurns([
      { text: 'call', toolCalls: [{ toolCallId: 'c1', toolName: 'echo', input: {} }] },
      overflow,
      overflow,
    ]);
    const records: Array<{ kind: string; record?: Record<string, unknown> }> = [];
    const trace = { append: (kind: string, record?: Record<string, unknown>) => { records.push({ kind, record }); } } as unknown as TraceLog;
    const runtime = ladderRuntime(new EventBus(), provider, fast, new RunCage({ maxTurnsPerRun: 10, maxTokensPerRun: 10_000, toolWhitelist: null }), [], trace, echoTools());
    const summary = await runtime.run({ runId: 'r', sessionId: 's', userText: 'go' });
    // turn 1's call, the overflowing request, then its one recovery attempt -- which overflows again.
    expect(provider.calls).toBe(3);
    expect(summary.stopReason).toBe('run_error');
    expect(summary.error).toContain('overflow_recovery_exhausted');
    const ladder = records.filter((entry) => entry.kind === 'provider_call_failed').map((entry) => entry.record?.next);
    expect(ladder).toEqual(['recover_overflow', 'fail']);
    expect(records.some((entry) => entry.kind === 'overflow_recovery' && Array.isArray(entry.record?.trimmed))).toBe(true);
  });

  test('the overflow recovery shrinks the context, so the retry can succeed', async () => {
    const provider = new OverflowUntilToolExchangeGone();
    const runtime = ladderRuntime(new EventBus(), provider, fast, new RunCage({ maxTurnsPerRun: 10, maxTokensPerRun: 10_000, toolWhitelist: null }), [], undefined, echoTools());
    const summary = await runtime.run({ runId: 'r', sessionId: 's', userText: 'go' });
    expect(provider.calls).toHaveLength(3);
    expect(provider.calls[1].some((message) => message.role === 'tool' && message.content === 'BIG')).toBe(true);
    // The retry no longer carries the exchange the recovery dropped.
    expect(provider.calls[2].some((message) => message.role === 'tool' && message.content === 'BIG')).toBe(false);
    expect(summary.stopReason).toBe('run_complete');
    expect(summary.assistantText).toContain('recovered');
  });
});
