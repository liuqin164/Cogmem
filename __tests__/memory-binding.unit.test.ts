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

test('binding classifier generalizes project topics beyond Cogmem-specific rules', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-binding-general-topic-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'general-topic-session',
    userText: 'MoneyPrinterTurbo 项目的插件架构必须保持本地优先，并且要把渲染队列分类清楚。',
    assistantText: '这应归到 MoneyPrinterTurbo 的项目架构主题，而不是 Cogmem 专项规则。',
    ingestMode: 'raw_archive_only',
  });

  const bindings = kernel.listMemoryBindings({
    projectId: 'demo',
    topicPath: 'PROJECT/MoneyPrinterTurbo/architecture',
  });
  expect(bindings).toHaveLength(1);
  expect(bindings[0].entityName).toBe('MoneyPrinterTurbo');
  expect(bindings[0].bindingType).toBe('boundary');

  kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

test('memory binding backfills valuable raw user events written outside agent turns', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-binding-backfill-'));
  const dbPath = join(dir, 'memory.db');
  const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });

  const event = kernel.recordRawEvent({
    projectId: 'demo',
    workspaceId: 'demo',
    threadId: 'import-thread',
    sessionId: 'import-session',
    role: 'user',
    sourceId: 'imported-history',
    content: 'MoneyPrinterTurbo 项目的部署策略需要离线优先，并且按照发布事件做时间线分类。',
  });
  expect(kernel.listMemoryBindings({ projectId: 'demo' })).toHaveLength(0);

  const result = kernel.bindRawEvents({
    projectId: 'demo',
    sinceGlobalSeq: Math.max(0, (event.globalSeq || 0) - 1),
    limit: 50,
  });
  expect(result.scannedEvents).toBe(1);
  expect(result.boundEvents).toBe(1);
  expect(result.createdBindings).toBeGreaterThanOrEqual(1);

  const bindings = kernel.listMemoryBindings({ projectId: 'demo' });
  expect(bindings.length).toBeGreaterThanOrEqual(1);
  expect(bindings[0].eventId).toBe(event.eventId);

  const proc = Bun.spawn([
    process.execPath,
    'src/bin/memory.ts',
    'bind',
    '--db',
    dbPath,
    '--project',
    'demo',
    '--since',
    String(event.globalSeq || 0),
    '--json',
  ], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(exitCode).toBe(0);
  expect(stderr).toBe('');
  const payload = JSON.parse(stdout) as { skippedAlreadyBound: number };
  expect(payload.skippedAlreadyBound).toBeGreaterThanOrEqual(1);

  kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

test('binding failures are non-fatal but observable through pipeline metrics and maintenance tick', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-binding-failure-metrics-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  const original = kernel.bindMemoryEvent.bind(kernel);
  kernel.bindMemoryEvent = () => {
    throw new Error('simulated binding breakage');
  };

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'failure-session',
    userText: 'Cogmem memory write pipeline 必须在失败时暴露绑定错误。',
    assistantText: 'Raw ledger must remain authoritative.',
    ingestMode: 'raw_archive_only',
  });

  expect(kernel.pipelineMetrics.getNonFatalCount('memory_binding_failed', { projectId: 'demo' })).toBe(1);
  const tick = kernel.runMaintenanceTick({ projectId: 'demo' });
  expect(tick.chargeVector.bindingFailures).toBe(1);
  expect(tick.suggestedActions.some((action) => action.kind === 'inspect_binding_failures')).toBe(true);

  kernel.bindMemoryEvent = original;
  kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

test('claim-key clusters prevent over-fusing different diagnostics under one topic', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-binding-claim-key-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'claim-key-session',
    timestamp: 1000,
    userText: 'Cogmem memory write pipeline 的问题是写入不看历史，所以每句话都像孤立表格。',
    assistantText: '记录历史绑定诊断。',
    ingestMode: 'raw_archive_only',
  });
  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'claim-key-session',
    timestamp: 2000,
    userText: 'Cogmem memory write pipeline 的另一个问题是分类树漂移，memory-storage 和 memory-write 会乱分。',
    assistantText: '记录分类漂移诊断。',
    ingestMode: 'raw_archive_only',
  });

  const clusters = kernel.listMemoryClusters({
    projectId: 'demo',
    topicPath: 'PROJECT/Cogmem/memory-write-pipeline',
    clusterType: 'diagnostic',
  });
  expect(clusters.length).toBeGreaterThanOrEqual(2);
  expect(new Set(clusters.map((cluster) => cluster.claimKey)).size).toBe(clusters.length);

  kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

test('corrections create explicit correction edges without poisoning active clusters', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-binding-correction-edges-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'correction-edge-session',
    timestamp: 1000,
    userText: 'Cogmem memory write pipeline 的诊断是写入不看历史，需要先绑定旧记忆。',
    assistantText: '记录诊断。',
    ingestMode: 'raw_archive_only',
  });
  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'correction-edge-session',
    timestamp: 2000,
    userText: '纠正：Cogmem memory write pipeline 不是写入不看历史的问题，真正问题是分类树漂移。',
    assistantText: '记录纠正。',
    ingestMode: 'raw_archive_only',
  });

  const correction = kernel.listMemoryBindings({
    projectId: 'demo',
    topicPath: 'PROJECT/Cogmem/memory-write-pipeline',
    bindingType: 'correction',
  })[0];
  expect(correction.bindingAction).toBe('corrects_prior_memory');
  expect(correction.relatedEventIds.length).toBeGreaterThan(0);

  const correctionEdges = kernel.listMemoryEdges({
    projectId: 'demo',
    sourceId: correction.eventId,
    relationType: 'CORRECTS',
  });
  expect(correctionEdges.length).toBeGreaterThanOrEqual(1);

  const clusters = kernel.listMemoryClusters({
    projectId: 'demo',
    topicPath: 'PROJECT/Cogmem/memory-write-pipeline',
  });
  expect(clusters.some((cluster) => cluster.clusterType === 'diagnostic' && cluster.status === 'active')).toBe(true);
  expect(clusters.some((cluster) => cluster.clusterType === 'correction' && cluster.reviewFlags.includes('possible_conflict'))).toBe(true);

  kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

test('graph recall ranks query-matching anchors ahead of older cluster evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-binding-rerank-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'rerank-session',
    timestamp: 1000,
    userText: 'Cogmem memory write pipeline 的问题是写入不看历史，像孤立表格。',
    assistantText: '记录历史绑定诊断。',
    ingestMode: 'raw_archive_only',
  });
  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'rerank-session',
    timestamp: 2000,
    userText: 'Cogmem memory write pipeline 的问题是分类树漂移，memory-storage 和 memory-write 会乱分。',
    assistantText: '记录分类树漂移诊断。',
    ingestMode: 'raw_archive_only',
  });

  const recall = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    query: '之前说分类树漂移 memory-storage memory-write 是什么问题？',
    limit: 1,
  });

  expect(recall.items[0].whyMatched).toBe('memory_binding_graph');
  expect(recall.items[0].text).toContain('分类树漂移');

  kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

test('memory binding sidecar schema is governed by schema version 13', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-binding-schema-version-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });

  const row = kernel.factStore.getDatabase().prepare(`
    SELECT value FROM _meta WHERE key = 'schema_version'
  `).get() as { value: string };
  expect(Number(row.value)).toBeGreaterThanOrEqual(13);

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

test('memory binding marks corrections with review flags without overwriting prior clusters', async () => {
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
  expect(correction?.bindingAction).toBe('corrects_prior_memory');
  expect(correction?.relatedEventIds.length).toBeGreaterThan(0);

  const clusters = kernel.listMemoryClusters({
    projectId: 'demo',
    topicPath: 'PROJECT/Cogmem/memory-write-pipeline',
  });
  expect(clusters.some((cluster) => cluster.status === 'active')).toBe(true);
  expect(clusters.some((cluster) => cluster.clusterType === 'correction' && cluster.reviewFlags.includes('possible_conflict'))).toBe(true);

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
