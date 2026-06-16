import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';

test('agent backend can record a raw-only turn without creating compiled vectors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-raw-only-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  const result = await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-raw',
    userText: '在吗',
    assistantText: '在。',
    timestamp: 1_700_000_000_000,
    ingestMode: 'raw_archive_only',
  });

  expect(result.compiled).toBe(false);
  expect(result.reason).toBe('raw_archive_only');
  expect(result.rawEventIds).toHaveLength(2);
  expect(kernel.eventStore.getEventCount()).toBe(2);
  expect(kernel.vectorStore.getCurrentCount()).toBe(0);
  expect(kernel.getThreadEvents('session-raw').map((event) => event.payload.text)).toEqual(['在吗', '在。']);

  kernel.close();
});

test('agent backend recall falls back to bounded raw ledger search for raw-only memories', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-raw-fallback-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-raw-fallback',
    userText: 'Raw-only anchor: vector pruning is not memory pruning.',
    assistantText: 'Stored only in the chronological ledger.',
    timestamp: 1_700_000_000_000,
    ingestMode: 'raw_archive_only',
  });

  const recalled = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    query: 'vector pruning memory pruning',
    limit: 3,
  });

  expect(kernel.vectorStore.getCurrentCount()).toBe(0);
  expect(recalled.recallMode).toBe('raw_ledger_fallback');
  expect(recalled.fallbackUsed).toBe(true);
  expect(recalled.items).toHaveLength(1);
  expect(recalled.items[0].id).toMatch(/^evt-/);
  expect(recalled.items[0].text).toContain('vector pruning is not memory pruning');
  expect(recalled.items[0].source).toMatch(/^evt-/);

  kernel.close();
});

test('agent backend raw fallback finds multilingual Hermes terms without hot vectors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-raw-fallback-multilingual-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'hermes',
    projectId: 'hermes',
    sessionId: 'hermes-raw-fallback',
    userText: '6月9日のエルビ库存 PRECIOUS FRUITS を確認した。',
    assistantText: 'Hermes raw ledger should preserve this imported inventory clue.',
    timestamp: Date.parse('2026-06-09T01:02:03.000Z'),
    ingestMode: 'raw_archive_only',
  });

  const events = kernel.searchRawEvents('エルビ 库存 PRECIOUS FRUITS', {
    projectId: 'hermes',
    limit: 5,
  });
  const recalled = backend.recall({
    agentId: 'hermes',
    projectId: 'hermes',
    query: 'Hermes 里关于 エルビ 库存 PRECIOUS FRUITS 的记忆',
    limit: 5,
  });

  expect(kernel.vectorStore.getCurrentCount()).toBe(0);
  expect(events.some((event) => String((event.payload as { text?: string }).text).includes('PRECIOUS FRUITS'))).toBe(true);
  expect(recalled.recallMode).toBe('raw_ledger_fallback');
  expect(recalled.items.some((item) => item.text.includes('PRECIOUS FRUITS'))).toBe(true);

  kernel.close();
});

test('agent backend prefers raw ledger cue matches over unrelated compiled recall', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-raw-fallback-cue-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await kernel.ingest({
    projectId: 'hermes',
    content: 'Maestro is an agent workflow framework with context management and tool orchestration notes.',
    source: 'hermes_state_db:/tmp/state.db',
    sourceType: 'llm_inference',
    tags: ['agent:hermes', 'source:hermes_state_db'],
  });
  await backend.rememberTurnWithResult({
    agentId: 'hermes',
    projectId: 'hermes',
    sessionId: 'hermes-inventory-session',
    userText: 'エルビ ページの库存管理を確認して。',
    assistantText: '库存管理には PRECIOUS FRUITS と产品コード 24412 が含まれます。',
    timestamp: Date.parse('2026-06-10T02:57:05.445Z'),
    ingestMode: 'raw_archive_only',
  });

  const recalled = backend.recall({
    agentId: 'hermes',
    projectId: 'hermes',
    query: '我们记录过哪些库存',
    limit: 5,
  });

  expect(recalled.recallMode).toBe('raw_ledger_fallback');
  expect(recalled.fallbackUsed).toBe(true);
  expect(recalled.queryPlan.searchTexts).toContain('库存管理');
  expect(recalled.items[0].sourceType).toBe('raw_ledger');
  expect(recalled.items.some((item) => item.text.includes('PRECIOUS FRUITS'))).toBe(true);

  kernel.close();
});

test('agent backend selective mode compiles durable instructions but skips low-signal chatter', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-selective-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  const chatter = await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-selective',
    userText: '在吗',
    assistantText: '在。',
    timestamp: 1_700_000_000_000,
    ingestMode: 'selective_compile',
  });
  const durable = await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-selective',
    userText: '重要：这个项目以后不要做成 Obsidian 替代品，要保持 agent memory kernel 边界。',
    assistantText: '我会把这个架构边界作为长期约束。',
    timestamp: 1_700_000_060_000,
    ingestMode: 'selective_compile',
  });

  expect(chatter.compiled).toBe(false);
  expect(chatter.reason).toBe('low_signal_turn');
  expect(durable.compiled).toBe(true);
  expect(durable.reason).toBe('durable_signal_detected');
  expect(durable.compiledNeuronId).toBeTruthy();
  expect(kernel.vectorStore.getCurrentCount()).toBe(1);
  expect(kernel.getThreadEvents('session-selective')).toHaveLength(4);

  const recalled = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    query: '项目不要做成什么',
    limit: 5,
  });
  expect(recalled.items.some((item) => item.text.includes('Obsidian 替代品'))).toBe(true);

  kernel.close();
});

test('agent backend can recall the previous session from the raw ledger without semantic guessing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-previous-session-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-old-import',
    userText: '6月3日检查 OpenClaw 配置，并建议重启 Hermes。',
    assistantText: '这是旧摘要导入，不是刚结束的会话。',
    timestamp: 1_700_000_000_000,
    ingestMode: 'raw_archive_only',
  });
  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-previous',
    userText: '我们讨论 CogMem Memory Context 是否混入当前会话，以及记忆黑盒问题。',
    assistantText: '结论是要区分当前上下文、检索到的历史记忆和 raw ledger source。',
    timestamp: 1_700_000_060_000,
    ingestMode: 'raw_archive_only',
  });
  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-current',
    userText: '上一个会话我们聊了什么',
    assistantText: '我应该查询刚结束的上一会话，而不是旧摘要。',
    timestamp: 1_700_000_120_000,
    ingestMode: 'raw_archive_only',
  });

  const recalled = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-current',
    excludeSessionId: 'session-current',
    intent: 'previous_session_summary',
    query: '上一个会话我们聊了什么',
    limit: 6,
  });

  expect(recalled.recallMode).toBe('raw_ledger_fallback');
  expect(recalled.fallbackUsed).toBe(true);
  expect(recalled.items.length).toBeGreaterThan(0);
  expect(recalled.items.every((item) => item.sourceAnchor?.sessionId === 'session-previous')).toBe(true);
  expect(JSON.stringify(recalled.items)).toContain('CogMem Memory Context');
  expect(JSON.stringify(recalled.items)).toContain('记忆黑盒问题');
  expect(JSON.stringify(recalled.items)).not.toContain('重启 Hermes');

  kernel.close();
});

test('agent backend forensic quote recall returns raw user events with source anchors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-forensic-quote-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-source',
    userText: '你能看到记忆内核中存储的记忆吗？还是说它是黑盒的',
    assistantText: '我能看到注入摘要和日志，但不能直接读完整数据库。',
    timestamp: 1_700_000_000_000,
    ingestMode: 'raw_archive_only',
  });
  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-current',
    userText: '我问过你记忆黑盒的问题，原话是什么',
    assistantText: '需要从 raw ledger source 回答，不能猜。',
    timestamp: 1_700_000_060_000,
    ingestMode: 'raw_archive_only',
  });

  const recalled = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-current',
    excludeSessionId: 'session-current',
    intent: 'forensic_quote',
    query: '记忆 黑盒 原话',
    limit: 3,
  });

  expect(recalled.recallMode).toBe('raw_ledger_fallback');
  expect(recalled.items).toHaveLength(1);
  expect(recalled.items[0].text).toBe('你能看到记忆内核中存储的记忆吗？还是说它是黑盒的');
  expect(recalled.items[0].sourceType).toBe('raw_ledger');
  expect(recalled.items[0].canAnswerExactQuote).toBe(true);
  expect(recalled.items[0].sourceAnchor?.sessionId).toBe('session-source');
  expect(recalled.items[0].sourceAnchor?.role).toBe('user');

  kernel.close();
});

test('agent backend forensic quote recall distills long follow-up queries before raw ledger search', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-forensic-long-query-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-source',
    userText: '你能看到记忆内核中存储的记忆吗？还是说它是黑盒的',
    assistantText: '我能看到注入摘要和日志，但不能直接读完整数据库。',
    timestamp: 1_700_000_000_000,
    ingestMode: 'raw_archive_only',
  });

  const recalled = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-current',
    excludeSessionId: 'session-current',
    intent: 'forensic_quote',
    query: '我不是要你泛泛解释现在的上下文，而是问我们之前讨论过记忆黑盒这个问题时，我问你的原话是什么',
    limit: 3,
  });

  expect(recalled.items).toHaveLength(1);
  expect(recalled.items[0].text).toBe('你能看到记忆内核中存储的记忆吗？还是说它是黑盒的');
  expect(recalled.items[0].whyMatched).toBe('forensic_quote_raw_event');
  expect(recalled.queryPlan?.searchTexts).toContain('记忆 黑盒');

  kernel.close();
});

test('agent backend cue recall finds old black-box archive wording and returns drill-down context', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-cue-source-context-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-source',
    userText: '我们的对话的存档位置是属于黑盒吧，我作为用户是无法看到的是吗？',
    assistantText: '这个问题指向记忆可审计性：注入摘要不是完整档案，raw ledger 才能下钻。',
    timestamp: 1_700_000_000_000,
    ingestMode: 'raw_archive_only',
  });

  const recalled = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-current',
    excludeSessionId: 'session-current',
    query: '几个月前我们是不是讨论过记忆黑盒的问题？',
    limit: 3,
  });

  expect(recalled.items).toHaveLength(1);
  expect(recalled.items[0].text).toContain('存档位置');
  expect(recalled.items[0].sourceType).toBe('raw_ledger');
  expect(recalled.items[0].sourceContext?.event.text).toContain('存档位置');
  expect(recalled.items[0].sourceContext?.after[0].text).toContain('记忆可审计性');
  expect(recalled.items[0].sourceContext?.locator.command).toContain('cogmem memory show --event');
  expect(recalled.queryPlan?.semanticCuePhrases).toContain('存档 黑盒');

  kernel.close();
});

test('agent backend compiled memory recall includes source locator and bounded surrounding raw context', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-compiled-source-context-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  const remembered = await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-compiled-source',
    userText: '重要：如果 CogMem 只注入摘要，agent 需要知道原始内容在哪。',
    assistantText: '我会把 source locator 和 surrounding context 放进 recall item。',
    timestamp: 1_700_000_000_000,
    ingestMode: 'immediate_compile',
  });

  const recalled = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    query: 'CogMem 摘要 原始内容 source locator',
    limit: 3,
  });
  const item = recalled.items.find((candidate) => candidate.id === remembered.compiledNeuronId);

  expect(item).toBeDefined();
  expect(item?.sourceType).toBe('compiled_memory');
  expect(item?.canAnswerExactQuote).toBe(false);
  expect(item?.sourceAnchor?.eventId).toBe(remembered.rawEventIds[0]);
  expect(item?.sourceContext?.event.eventId).toBe(remembered.rawEventIds[0]);
  expect(item?.sourceContext?.event.text).toContain('只注入摘要');
  expect(item?.sourceContext?.after[0].text).toContain('source locator');
  expect(item?.sourceContext?.locator.command).toContain(remembered.rawEventIds[0]);

  kernel.close();
});

test('agent backend source context annotates labels, source positions, and strict window semantics', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-source-window-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  kernel.recordRawEvent({
    projectId: 'demo',
    workspaceId: 'demo',
    threadId: 'thread-source-window',
    sessionId: 'session-source-window',
    role: 'assistant',
    rawEventType: 'message',
    content: 'Before context from the previous turn.',
    occurredAt: 1_700_000_000_000,
    metadata: { messageId: 12694 },
    sourceOffset: 1,
    charStart: 0,
    charEnd: 38,
  });
  const anchor = kernel.recordRawEvent({
    projectId: 'demo',
    workspaceId: 'demo',
    threadId: 'thread-source-window',
    sessionId: 'session-source-window',
    role: 'user',
    rawEventType: 'message',
    content: 'Needle source quote: source windows must be exact and auditable.',
    occurredAt: 1_700_000_001_000,
    metadata: { messageId: 12695 },
    sourceOffset: 2,
    charStart: 39,
    charEnd: 104,
  });
  kernel.recordRawEvent({
    projectId: 'demo',
    workspaceId: 'demo',
    threadId: 'thread-source-window',
    sessionId: 'session-source-window',
    role: 'assistant',
    rawEventType: 'message',
    content: 'After context confirms the source locator contract.',
    occurredAt: 1_700_000_002_000,
    metadata: { messageId: 12696 },
    sourceOffset: 3,
    charStart: 105,
    charEnd: 154,
  });

  const recalled = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    query: 'Needle source quote exact auditable',
    limit: 3,
  });

  const item = recalled.items.find((candidate) => candidate.sourceAnchor?.eventId === anchor.eventId);
  expect(item).toBeDefined();
  expect(item?.sourceContext?.event.label).toBe('#12695');
  expect(item?.sourceContext?.event.charRange).toEqual({ start: 39, end: 104 });
  expect(item?.sourceContext?.event.textLength).toBe(anchor.payload.text.length);
  expect(item?.sourceContext?.before.map((event) => event.label)).toContain('#12694');
  expect(item?.sourceContext?.after.map((event) => event.label)).toContain('#12696');
  expect(item?.sourceContext?.before.some((event) => event.eventId === anchor.eventId)).toBe(false);
  expect(item?.sourceContext?.after.some((event) => event.eventId === anchor.eventId)).toBe(false);
  expect(item?.sourceContext?.window.before.excludesAnchor).toBe(true);
  expect(item?.sourceContext?.window.after.ordering).toBe('chronological');
  expect(item?.sourceContext?.window.overlapEventIds).toEqual([]);
  expect(item?.sourceContext?.window.overlapHandling).toBe('drop_from_after');

  kernel.close();
});

test('agent backend forensic quote recall can use a prior raw source anchor for vague follow-up questions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-followup-anchor-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  const remembered = await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-source',
    userText: '你能看到记忆内核中存储的记忆吗？还是说它是黑盒的',
    assistantText: '我能看到注入摘要和日志，但不能直接读完整数据库。',
    timestamp: 1_700_000_000_000,
    ingestMode: 'raw_archive_only',
  });

  const recalled = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-current',
    excludeSessionId: 'session-current',
    intent: 'forensic_quote',
    query: '那我当时的原话是什么',
    anchorEventId: remembered.rawEventIds[0],
    limit: 3,
  });

  expect(recalled.items).toHaveLength(1);
  expect(recalled.items[0].text).toBe('你能看到记忆内核中存储的记忆吗？还是说它是黑盒的');
  expect(recalled.items[0].sourceAnchor?.eventId).toBe(remembered.rawEventIds[0]);
  expect(recalled.items[0].whyMatched).toBe('forensic_quote_anchor_event');
  expect(recalled.items[0].canAnswerExactQuote).toBe(true);

  kernel.close();
});

test('agent backend remembers and recalls a project-scoped turn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurn({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-1',
    userText: 'Use Bun for local builds.',
    assistantText: 'I will use Bun for build and tests.',
    timestamp: 1_700_000_000_000,
  });

  const recalled = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    query: 'what runtime should local builds use?',
    limit: 3,
  });

  expect(recalled.items.some((item) => item.text.includes('Bun'))).toBe(true);
  expect(recalled.items.every((item) => item.projectId === 'demo')).toBe(true);

  kernel.close();
});

test('agent backend recall uses universe navigation as the default first path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-universe-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  const day = Date.parse('2026-05-07T09:00:00+09:00');

  await backend.rememberTurn({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-1',
    userText: 'Bluetooth protocol project used a GATT configuration service.',
    assistantText: 'I will keep the Bluetooth protocol project context.',
    timestamp: day,
  });
  await backend.rememberTurn({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-1',
    userText: 'Bluetooth headset pairing was discussed in the same work session.',
    assistantText: 'I will keep the neighboring Bluetooth memory available.',
    timestamp: day + 60_000,
  });

  const recalled = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    query: 'Bluetooth protocol project',
    limit: 5,
  });

  expect(recalled.recallMode).toBe('universe_navigation');
  expect(recalled.narrative?.headline).toContain('universe navigation');
  expect(recalled.pulseTrace?.some((item) => item.stage === 'evidence_fusion')).toBe(true);
  expect(recalled.temporalTraversal?.labels).toContain('2026-05-07');
  expect(recalled.items.some((item) => item.text.includes('GATT configuration service'))).toBe(true);
  expect(recalled.items.some((item) => item.text.includes('Bluetooth headset pairing'))).toBe(true);

  kernel.close();
});

test('agent backend recall overfetches before agent tag filtering', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-scope-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  const day = Date.parse('2026-05-07T10:00:00+09:00');

  await backend.rememberTurn({
    agentId: 'hermes',
    projectId: 'shared-project',
    sessionId: 'hermes-session',
    userText: 'Bluetooth protocol project for Hermes uses a separate pairing note.',
    assistantText: 'Stored Hermes Bluetooth note.',
    timestamp: day,
  });
  await backend.rememberTurn({
    agentId: 'openclaw',
    projectId: 'shared-project',
    sessionId: 'openclaw-session',
    userText: 'Bluetooth protocol project for OpenClaw uses the GATT configuration service.',
    assistantText: 'Stored OpenClaw Bluetooth note.',
    timestamp: day + 60_000,
  });

  const recalled = backend.recall({
    agentId: 'openclaw',
    projectId: 'shared-project',
    query: 'Bluetooth protocol project',
    limit: 1,
  });

  expect(recalled.items).toHaveLength(1);
  expect(recalled.items[0].tags).toContain('agent:openclaw');
  expect(recalled.items[0].text).toContain('GATT configuration service');

  kernel.close();
});

test('agent backend recalls project-scoped imported evidence without requiring an agent tag', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-project-evidence-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await kernel.ingest({
    projectId: 'demo',
    content: 'Imported project profile says the release memory vector backend is sqlite-vec.',
    tags: ['source:profile'],
    sourceType: 'verified_fact',
  });

  const recalled = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    query: 'which vector backend should the release memory use?',
    limit: 3,
  });

  const item = recalled.items.find((candidate) => candidate.text.includes('sqlite-vec'));
  expect(item).toBeDefined();
  expect(item?.tags).not.toContain('agent:openclaw');
  expect(item?.source).toMatch(/^evt-/);

  kernel.close();
});

test('agent backend suppresses archived and suspect memory from recall context', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-backend-status-filter-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  const active = await kernel.ingest({
    projectId: 'demo',
    content: 'Release governance policy says active scoped evidence may enter agent context.',
    tags: ['agent:openclaw', 'release'],
  });
  const archived = await kernel.ingest({
    projectId: 'demo',
    content: 'Release governance policy says archived stale evidence must stay out of agent context.',
    tags: ['agent:openclaw', 'release'],
  });
  const suspect = await kernel.ingest({
    projectId: 'demo',
    content: 'Release governance policy says suspect disputed evidence must stay out of agent context.',
    tags: ['agent:openclaw', 'release'],
  });

  kernel.memoryGraph.updateNeuronStatus(archived.id, 'archived');
  kernel.memoryGraph.updateNeuronMetadata(suspect.id, { status: 'suspect' });

  const recalled = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    query: 'release governance policy evidence',
    limit: 10,
  });

  expect(recalled.items.some((item) => item.id === active.id)).toBe(true);
  expect(recalled.items.some((item) => item.id === archived.id)).toBe(false);
  expect(recalled.items.some((item) => item.id === suspect.id)).toBe(false);
  expect(JSON.stringify(recalled.items)).not.toContain('archived stale evidence');
  expect(JSON.stringify(recalled.items)).not.toContain('suspect disputed evidence');

  kernel.close();
});
