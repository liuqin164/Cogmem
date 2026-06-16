import { expect, test } from 'bun:test';

import { stripCogmemRecallBlocks } from '../src/agent/ContextHygiene.js';
import {
  createMemoryUsageReceipt,
  formatMemoryUsageBridge,
  shouldInjectMemoryUsageBridge,
} from '../src/agent/MemoryUsageReceipt.js';
import {
  formatSessionWorkingState,
  updateSessionWorkingState,
} from '../src/agent/SessionWorkingState.js';

test('context hygiene strips only bounded Cogmem recall blocks', () => {
  const input = [
    'System: keep OpenClaw tools intact.',
    '<COGMEM_RECALL_CONTEXT volatile="true">',
    'remembered context that must not be persisted',
    '</COGMEM_RECALL_CONTEXT>',
    'User: ordinary markdown and <tool>instructions</tool> remain.',
  ].join('\n');

  const result = stripCogmemRecallBlocks(input);

  expect(result.stripped).toBe(true);
  expect(result.blockCount).toBe(1);
  expect(result.strippedChars).toBeGreaterThan(0);
  expect(result.text).toContain('System: keep OpenClaw tools intact.');
  expect(result.text).toContain('User: ordinary markdown and <tool>instructions</tool> remain.');
  expect(result.text).not.toContain('remembered context that must not be persisted');
});

test('context hygiene does not strip ordinary user, system, tool, or skill text', () => {
  const input = [
    '# User Note',
    'Please keep this normal markdown.',
    '<OpenClawSystem>native prompt</OpenClawSystem>',
    '<tool>do not delete tool instructions</tool>',
    '<skill>do not delete skill instructions</skill>',
  ].join('\n');

  const result = stripCogmemRecallBlocks(input);

  expect(result).toEqual({
    text: input,
    stripped: false,
    strippedChars: 0,
    blockCount: 0,
  });
});

test('memory usage bridge is compact, non-durable, and same-topic gated', () => {
  const receipt = createMemoryUsageReceipt({
    sessionId: 'session-hygiene',
    turnId: 'turn-1',
    userText: '这个 OpenClaw 记忆注入策略会污染上下文吗？',
    assistantText: '结论：应该使用 volatile recall 和短期 bridge，而不是接管 OpenClaw prompt。',
    recallItems: [
      {
        id: 'memory-alpha',
        text: 'User is developing Cogmem as an OpenClaw memory kernel.',
        sourceAnchor: { eventId: 'evt-alpha', sessionId: 'old-session', role: 'user' },
        tags: ['agent:openclaw'],
      },
    ],
    ttlTurns: 3,
    createdAt: 1_700_000_000_000,
  });

  const bridge = formatMemoryUsageBridge(receipt);

  expect(receipt.compileAllowed).toBe(false);
  expect(receipt.usedMemoryIds).toEqual(['memory-alpha']);
  expect(receipt.sourceAnchors[0]).toEqual({
    memoryId: 'memory-alpha',
    eventId: 'evt-alpha',
    sessionId: 'old-session',
    role: 'user',
  });
  expect(bridge).toContain('<COGMEM_TURN_BRIDGE');
  expect(bridge).toContain('compile_allowed="false"');
  expect(bridge).toContain('Previous assistant answer used Cogmem memory.');
  expect(bridge).not.toContain('<COGMEM_RECALL_CONTEXT');
  expect(shouldInjectMemoryUsageBridge('继续这个策略', receipt)).toBe(true);
  expect(shouldInjectMemoryUsageBridge('帮我把这句话翻译成日语', receipt)).toBe(false);
});

test('session working state stays compact and explicitly non-durable', () => {
  const state = updateSessionWorkingState(undefined, {
    sessionId: 'session-hygiene',
    userText: '继续 Cogmem OpenClaw 上下文卫生方案',
    assistantText: '方向是保持 OpenClaw 原生 prompt 不动，使用 volatile recall 和短期 bridge。',
    maxChars: 360,
    updatedAt: 1_700_000_001_000,
  });
  const rendered = formatSessionWorkingState(state);

  expect(state.compileAllowed).toBe(false);
  expect(state.sessionId).toBe('session-hygiene');
  expect(rendered).toContain('<COGMEM_SESSION_STATE');
  expect(rendered).toContain('compile_allowed="false"');
  expect(rendered.length).toBeLessThanOrEqual(360);
});
