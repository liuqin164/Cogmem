import { expect, test } from 'bun:test';
import { createMemoryKernel } from '../src/factory.js';
import { callCogmemMcpTool, listCogmemMcpTools } from '../src/mcp/CoreMcpTools.js';

test('MCP exposes canonical-memory-safe Atlas tools and declares access activation side effects', async () => {
  const kernel = createMemoryKernel();
  try {
    const event = kernel.eventStore.append({ eventId: 'evt-mcp-atlas', streamId: 't', streamType: 'thread', eventType: 'MESSAGE', rawEventType: 'message', projectId: 'cogmem', role: 'user', payload: { text: '给 Hermes 配置 MCP' } });
    const entity = kernel.memoryBindingStore.upsertEntity({ projectId: 'cogmem', canonicalName: 'Hermes', entityType: 'project' });
    kernel.memoryBindingStore.insertBinding({ eventId: event.eventId, projectId: 'cogmem', role: 'user', entityId: entity.entityId, entityName: 'Hermes', entityType: 'project', topicPath: 'cogmem/hermes', bindingType: 'about', confidence: 1, source: 'deterministic', signal: 'Hermes', claimKey: 'mcp' });

    const names = listCogmemMcpTools().map((tool) => tool.name);
    expect(names).toContain('cogmem_graph_overview');
    expect(names).toContain('cogmem_graph_explore');
    expect(names).toContain('cogmem_graph_path');
    expect(listCogmemMcpTools().filter((tool) => tool.name.startsWith('cogmem_graph_')).every((tool) =>
      tool.annotations?.readOnlyHint === false && tool.annotations.destructiveHint === false && tool.annotations.idempotentHint === false)).toBe(true);

    const result = await callCogmemMcpTool('cogmem_graph_node', { projectId: 'cogmem', id: `entity:${entity.entityId}` }, { kernel });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(expect.objectContaining({ id: `entity:${entity.entityId}` }));
    expect(JSON.stringify(result.structuredContent)).toContain('memory show --event evt-mcp-atlas');
    expect((kernel.memoryAtlasStore.db.prepare(`SELECT COUNT(*) AS count FROM memory_atlas_access`).get() as { count: number }).count).toBeGreaterThan(0);
  } finally { kernel.close(); }
});

test('MCP Atlas tools fail closed without project scope', async () => {
  const kernel = createMemoryKernel();
  try {
    const result = await callCogmemMcpTool('cogmem_graph_explore', { query: 'Hermes' }, { kernel });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.structuredContent)).toContain('projectId');
  } finally { kernel.close(); }
});
