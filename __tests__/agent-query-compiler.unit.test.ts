import { expect, test } from 'bun:test';

import { compileAgentRecallQuery } from '../src/agent/AgentRecallQueryCompiler.js';

test('agent recall query compiler distills long Chinese memory questions into stable cues', () => {
  const compiled = compileAgentRecallQuery({
    query: '我现在不是问你泛泛解释，我是问你还记不记得我们之前讨论过关于 CogMem Memory Context 和记忆黑盒的问题，当时我问你的原话是什么？',
    intent: 'forensic_quote',
  });

  expect(compiled.intent).toBe('forensic_quote');
  expect(compiled.primarySearchText).toContain('CogMem Memory Context');
  expect(compiled.primarySearchText).toContain('记忆');
  expect(compiled.primarySearchText).toContain('黑盒');
  expect(compiled.searchTexts).toContain('CogMem Memory Context 记忆 黑盒');
  expect(compiled.searchTexts.every((candidate) => !candidate.includes('泛泛解释'))).toBe(true);
});

test('agent recall query compiler carries prior recall anchor text for follow-up quote questions', () => {
  const compiled = compileAgentRecallQuery({
    query: '那我当时的原话是什么',
    intent: 'forensic_quote',
    anchorText: '你能看到记忆内核中存储的记忆吗？还是说它是黑盒的',
  });

  expect(compiled.intent).toBe('forensic_quote');
  expect(compiled.primarySearchText).toContain('记忆');
  expect(compiled.primarySearchText).toContain('黑盒');
  expect(compiled.searchTexts[0]).toBe('记忆 黑盒');
});
