import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { callCogmemMcpTool } from '../src/mcp/CoreMcpTools.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #131: a caller can ask what is available before paying for it. `index` is a view of the same recall
 * result — the same fields the injected index line renders — and `full` is what every existing host keeps
 * getting, because the default does not change.
 */
async function seeded() {
  const dir = makeTempDir('cogmem-recall-granularity-');
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  await backend.rememberTurn({
    agentId: 'hermes', sessionId: 's1', projectId: 'project-a', turnId: 't1',
    userText: 'The deploy window is Tuesday at 02:00.', assistantText: 'noted', timestamp: Date.UTC(2026, 0, 1),
  });
  // The Atlas is where node ids live: build it, so the fixture has a node to fetch.
  kernel.rebuildMemoryAtlas({ projectId: 'project-a' });
  return kernel;
}

const runtime = { hostId: 'hermes' } as never;

test('granularity full is the default, unchanged', async () => {
  const kernel = await seeded();
  try {
    const result = await callCogmemMcpTool('cogmem_recall', { query: 'deploy window', projectId: 'project-a', limit: 5 }, { kernel, ...(runtime as object) } as never);
    expect(result.isError).toBeFalsy();
    const items = (result.structuredContent as { items?: Array<Record<string, unknown>> }).items ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty('text');
    expect((result.structuredContent as { granularity?: string }).granularity).toBeUndefined();
  } finally {
    kernel.close();
  }
});

test('granularity index returns one entry per memory with a locator, and no body', async () => {
  const kernel = await seeded();
  try {
    const result = await callCogmemMcpTool('cogmem_recall', { query: 'deploy window', projectId: 'project-a', limit: 5, granularity: 'index' }, { kernel, ...(runtime as object) } as never);
    expect(result.isError).toBeFalsy();
    const body = result.structuredContent as { granularity?: string; items?: Array<Record<string, unknown>>; itemCount?: number };
    expect(body.granularity).toBe('index');
    expect(body.items?.length).toBe(body.itemCount);
    expect(body.items!.length).toBeGreaterThan(0);
    for (const entry of body.items!) {
      expect(Object.keys(entry).sort()).toEqual(['id', 'sourceLocator', 'title', 'when']);
      expect(String(entry.sourceLocator)).toContain('cogmem memory show');
    }
  } finally {
    kernel.close();
  }
});

/** #131: drilling down from an index line has to be possible in one call for several ids. */
test('the batch fetch takes several ids and reports a missing one without failing the rest', async () => {
  const kernel = await seeded();
  try {
    const single = await callCogmemMcpTool('cogmem_graph_node', { projectId: 'project-a', id: 'project:project-a' }, { kernel } as never);
    expect(single.isError).toBeFalsy();
    const batch = await callCogmemMcpTool('cogmem_graph_node', { projectId: 'project-a', ids: ['project:project-a', 'topic:does-not-exist'] }, { kernel } as never);
    expect(batch.isError).toBeFalsy();
    const body = batch.structuredContent as { nodes: Array<Record<string, unknown>>; requested: number; found: number };
    expect(body.requested).toBe(2);
    expect(body.found).toBe(1);
    // The node that exists comes back exactly as the single-id form returns it.
    expect(body.nodes[0]).toEqual(single.structuredContent);
    expect(body.nodes[1]).toEqual({ id: 'topic:does-not-exist', found: false });
  } finally {
    kernel.close();
  }
});
