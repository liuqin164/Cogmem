import { describe, expect, test } from 'bun:test';
import { EventBus } from '../src/bus.ts';
import { AgentRuntime, type ToolInvoker } from '../src/state/agent-loop.ts';
import { accountRequest, estimateMessagesTokens, estimateTokens, type ContextAccount } from '../src/state/context-budget.ts';
import { RunCage } from '../src/plugins/cage.ts';
import { makeShell, makeTempDir, ScriptedProvider } from './helpers.ts';

function tools(): ToolInvoker {
  const definitions = [{ name: 'echo', description: 'echo a value', parameters: { type: 'object' }, source: 'test' }];
  return {
    list: () => definitions,
    invoke: async (name, call) => ({ toolCallId: call.toolCallId, toolName: name, output: 'ok', isError: false }),
  };
}

function runtime(bus: EventBus, provider: ScriptedProvider, onContextAssembled?: (account: ContextAccount) => void) {
  return new AgentRuntime({
    bus,
    tools: tools(),
    provider,
    budget: new RunCage({ maxTurnsPerRun: 10, maxTokensPerRun: 10_000, toolWhitelist: null }),
    systemPrompt: () => 'SYS',
    onContextAssembled,
  });
}

describe('context accounting (Pi chars/4 estimate, compaction.js:201-252)', () => {
  test('text is chars/4 rounded up, tool-call arguments are counted', () => {
    expect(estimateTokens({ role: 'user', content: 'abcd' })).toBe(1);
    expect(estimateTokens({ role: 'user', content: 'abcde' })).toBe(2);
    expect(estimateTokens({ role: 'tool', content: 'x'.repeat(8), toolCallId: 'c1', toolName: 'echo' })).toBe(2);
    // 'hi' (2) + 'echo' (4) + '{"value":1}' (11) = 17 chars.
    expect(estimateTokens({ role: 'assistant', content: 'hi', toolCalls: [{ toolCallId: 'c1', toolName: 'echo', input: { value: 1 } }] })).toBe(5);
    expect(estimateTokens({ role: 'system', content: '', toolsAdded: ['a', 'b'] })).toBe(3);
    expect(estimateMessagesTokens([{ role: 'user', content: 'abcd' }, { role: 'assistant', content: 'abcd' }])).toBe(2);
  });

  test('the account is the request sum: system prompt, tool schemas, messages, per role', () => {
    const account = accountRequest({
      messages: [{ role: 'user', content: 'abcd' }, { role: 'tool', content: 'x'.repeat(8), toolCallId: 'c1', toolName: 'echo' }],
      systemPrompt: 'abcdefgh',
      tools: [{ name: 'echo', description: 'echo a value', parameters: { type: 'object' } }],
    });
    expect(account.systemTokens).toBe(2);
    expect(account.messageTokens).toBe(3);
    expect(account.byRole).toEqual({ user: 1, assistant: 0, tool: 2, system: 0 });
    expect(account.toolTokens).toBeGreaterThan(0);
    expect(account.totalTokens).toBe(account.systemTokens + account.toolTokens + account.messageTokens);
    expect(account.messages).toBe(2);
  });

  test('a transformContext-injected block is inside the measured request', async () => {
    const bus = new EventBus();
    const accounts: ContextAccount[] = [];
    bus.on('transformContext', (value: unknown) => {
      if (!Array.isArray(value)) return value;
      return [...value, { role: 'system', content: 'X'.repeat(400) }];
    });
    const provider = new ScriptedProvider([{ text: 'ok', toolCalls: [] }]);
    await runtime(bus, provider, (account) => accounts.push(account)).run({ runId: 'r', sessionId: 's', userText: 'hi' });

    expect(accounts).toHaveLength(1);
    const sent = provider.calls[0];
    const expected = accountRequest({ messages: sent.messages, systemPrompt: sent.systemPrompt, tools: sent.tools });
    // The measured request is exactly what the provider received — including the injected block and
    // the system prompt, neither of which is a message event this process emits.
    expect(accounts[0]).toEqual(expected);
    expect(accounts[0].messageTokens).toBeGreaterThanOrEqual(100);
  });

  test('the gauge reports the measured request, not a running total of message events', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([{ text: '好的。', toolCalls: [] }]);
    const shell = makeShell(dir, provider);
    await shell.start();
    try {
      await shell.submit('你好，今天过得怎么样？');
      const sent = provider.calls[0];
      const account = accountRequest({ messages: sent.messages, systemPrompt: sent.systemPrompt, tools: sent.tools });
      expect(shell.currentStatus().contextTokens).toBe(account.totalTokens);
      // The old accumulator was a fixed 500 plus the text of every message event, so it could never
      // carry the system prompt or the four tool schemas — both of which the provider is charged for.
      expect(account.systemTokens).toBeGreaterThan(0);
      expect(account.toolTokens).toBeGreaterThan(0);
      expect(account.totalTokens).not.toBe(500 + Math.ceil('你好，今天过得怎么样？'.length / 4) + Math.ceil('好的。'.length / 4));
    } finally {
      await shell.stop();
    }
  });
});
