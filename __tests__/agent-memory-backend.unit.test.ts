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
