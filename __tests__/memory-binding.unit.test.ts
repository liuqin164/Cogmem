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
