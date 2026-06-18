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

test('agent recall query compiler expands semantic cue phrases across wording drift', () => {
  const compiled = compileAgentRecallQuery({
    query: '几个月前我们是不是讨论过记忆黑盒的问题？',
  });

  expect(compiled.intent).toBe('memory_recall');
  expect(compiled.keywords).toContain('记忆');
  expect(compiled.keywords).toContain('黑盒');
  expect(compiled.semanticCuePhrases).toContain('记忆 黑盒');
  expect(compiled.semanticCuePhrases).toContain('存档 黑盒');
  expect(compiled.searchTexts).toContain('黑盒');
  expect(compiled.temporalHints).toContain('past');
});

test('agent recall query compiler expands inventory questions into structured ledger cues', () => {
  const compiled = compileAgentRecallQuery({
    query: '我们记录过哪些库存',
  });

  expect(compiled.intent).toBe('memory_recall');
  expect(compiled.primarySearchText).toBe('库存');
  expect(compiled.keywords).toContain('库存');
  expect(compiled.semanticCuePhrases).toContain('库存管理');
  expect(compiled.semanticCuePhrases).toContain('产品コード');
  expect(compiled.searchTexts).toContain('库存管理');
});

test('agent recall query compiler removes conversational remember-me filler from black-box queries', () => {
  const compiled = compileAgentRecallQuery({
    query: '你还记得我们聊过的黑盒问题吗',
  });

  expect(compiled.keywords).toContain('黑盒');
  expect(compiled.keywords).not.toContain('还记得');
  expect(compiled.primarySearchText).toBe('黑盒');
  expect(compiled.temporalHints).toContain('past');
});
