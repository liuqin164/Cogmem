import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KernelAgentMemoryBackend, createMemoryKernel } from '../src/public.js';

test('memory binding groups valuable user events under a stable topic path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-binding-stable-topic-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'binding-session',
    userText: '现在 Cogmem 的记忆写入像表格，没有和历史关联，也没有按主题分类。',
    assistantText: '我会把这个作为 memory write pipeline 的诊断输入。',
    ingestMode: 'raw_archive_only',
  });
  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'binding-session',
    userText: 'Cogmem memory write pipeline 需要写入时回看旧记忆，并绑定到同一个分类路径。',
    assistantText: '这应该归到同一个写入关联主题。',
    ingestMode: 'raw_archive_only',
  });

  const bindings = kernel.listMemoryBindings({
    projectId: 'demo',
    topicPath: 'PROJECT/Cogmem/memory-write-pipeline',
  });
  expect(bindings.length).toBeGreaterThanOrEqual(2);
  expect(new Set(bindings.map((binding) => binding.topicPath)).size).toBe(1);
  expect(bindings.every((binding) => binding.source === 'deterministic')).toBe(true);
  expect(bindings.every((binding) => binding.role === 'user')).toBe(true);

  const map = kernel.buildMemoryMap({ projectId: 'demo' });
  expect(map.anatomy.some((section) => section.id === 'memory_binding')).toBe(true);
  expect(map.dataLanes.some((lane) => lane.id === 'memory_binding')).toBe(true);
  expect(map.counters.memoryBindings).toBeGreaterThanOrEqual(2);
  expect(map.counters.memoryBindingClusters).toBeGreaterThanOrEqual(1);
  expect(map.counters.memoryBindingEdges).toBeGreaterThanOrEqual(2);

  kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

test('memory binding performs historical binding and cluster fusion for same-topic events', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-binding-cluster-fusion-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'cluster-session',
    timestamp: 1000,
    userText: 'Cogmem 的 memory write pipeline 不能只是存表格，必须把新对话和历史关联起来。',
    assistantText: '记录为写入管线诊断。',
    ingestMode: 'raw_archive_only',
  });
  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'cluster-session',
    timestamp: 2000,
    userText: 'Cogmem memory write pipeline 还需要分类到稳定 topic path，不能每句话孤立存储。',
    assistantText: '这会强化同一个写入关联主题。',
    ingestMode: 'raw_archive_only',
  });

  const bindings = kernel.listMemoryBindings({
    projectId: 'demo',
    topicPath: 'PROJECT/Cogmem/memory-write-pipeline',
  }).sort((a, b) => a.createdAt - b.createdAt);
  expect(bindings).toHaveLength(2);
  expect(bindings[0].bindingAction).toBe('create_new_cluster');
  expect(bindings[1].bindingAction).toBe('strengthen_existing');
  expect(bindings[1].clusterId).toBe(bindings[0].clusterId);
  expect(bindings[1].relatedEventIds).toContain(bindings[0].eventId);

  const clusters = kernel.listMemoryClusters({
    projectId: 'demo',
    topicPath: 'PROJECT/Cogmem/memory-write-pipeline',
  });
  expect(clusters).toHaveLength(1);
  expect(clusters[0].supportCount).toBe(2);
  expect(clusters[0].evidenceEventIds).toEqual(expect.arrayContaining(bindings.map((binding) => binding.eventId)));
  expect(clusters[0].status).toBe('active');

  kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

test('memory binding marks corrections as possible conflicts without overwriting prior clusters', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-binding-correction-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'correction-session',
    timestamp: 1000,
    userText: 'Cogmem memory write pipeline 的方向是写入时建立历史关联和分类。',
    assistantText: '先记录这个方向。',
    ingestMode: 'raw_archive_only',
  });
  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'correction-session',
    timestamp: 2000,
    userText: '纠正：Cogmem memory write pipeline 之前的分类策略不对，应该先做历史绑定再融合。',
    assistantText: '这应进入冲突/纠正审查。',
    ingestMode: 'raw_archive_only',
  });

  const bindings = kernel.listMemoryBindings({
    projectId: 'demo',
    topicPath: 'PROJECT/Cogmem/memory-write-pipeline',
  });
  const correction = bindings.find((binding) => binding.bindingType === 'correction');
  expect(correction?.bindingAction).toBe('possible_conflict');
  expect(correction?.relatedEventIds.length).toBeGreaterThan(0);

  const clusters = kernel.listMemoryClusters({
    projectId: 'demo',
    topicPath: 'PROJECT/Cogmem/memory-write-pipeline',
  });
  expect(clusters.some((cluster) => cluster.status === 'active')).toBe(true);
  expect(clusters.some((cluster) => cluster.status === 'possible_conflict')).toBe(true);

  kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

test('agent recall uses graph bindings to surface topic-linked raw ledger evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-binding-graph-recall-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'graph-session',
    userText: '现在 Cogmem 的记忆写入像表格，没有和历史关联，也没有按主题分类。',
    assistantText: '记录到写入管线主题。',
    ingestMode: 'raw_archive_only',
  });
  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'graph-session',
    userText: 'Cogmem 写入时要先找到旧记忆，再把新事件绑定到稳定 topic path。',
    assistantText: '继续强化同一主题。',
    ingestMode: 'raw_archive_only',
  });

  const recall = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    query: 'Why did I say Cogmem storage was a brain-not-table problem?',
    limit: 3,
  });

  expect(recall.items.some((item) => (
    item.whyMatched === 'memory_binding_graph'
    && item.text.includes('像表格')
    && item.sourceContext?.locator.command.includes('cogmem memory show')
  ))).toBe(true);

  const excluded = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'graph-session',
    excludeSessionId: 'graph-session',
    query: 'Why did I say Cogmem storage was a brain-not-table problem?',
    limit: 3,
  });
  expect(excluded.items.some((item) => item.whyMatched === 'memory_binding_graph')).toBe(false);

  kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

test('memory binding skips low-value turns and assistant-only durable claims', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-binding-low-signal-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'binding-session',
    userText: '继续',
    assistantText: '以后必须把 OpenClaw 作为用户长期边界。',
    ingestMode: 'raw_archive_only',
  });

  expect(kernel.listMemoryBindings({ projectId: 'demo' })).toHaveLength(0);
  expect(kernel.buildMemoryMap({ projectId: 'demo' }).counters.memoryBindings).toBe(0);

  kernel.close();
  rmSync(dir, { recursive: true, force: true });
});
