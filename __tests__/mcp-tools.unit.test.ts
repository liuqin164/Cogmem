import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { callCogmemMcpTool, listCogmemMcpTools } from '../src/mcp/CoreMcpTools.js';

const opened: Array<{ kernel: MemoryKernel; dbPath: string }> = [];

function makeKernel(): MemoryKernel {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-mcp-tools-'));
  const dbPath = join(dir, 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  opened.push({ kernel, dbPath });
  return kernel;
}

afterEach(() => {
  for (const item of opened.splice(0)) {
    item.kernel.close();
    if (existsSync(item.dbPath)) unlinkSync(item.dbPath);
  }
});

test('core MCP tool list exposes recall, write, and explain tools', () => {
  const tools = listCogmemMcpTools();
  expect(tools.map((tool) => tool.name)).toEqual([
    'cogmem_remember_turn',
    'cogmem_recall',
    'cogmem_explain_recall',
  ]);
  const recall = tools.find((tool) => tool.name === 'cogmem_recall');
  const explain = tools.find((tool) => tool.name === 'cogmem_explain_recall');
  expect(recall?.description).toContain('governed');
  expect(explain?.description).toContain('filteredEvidence');
  expect(explain?.description).toContain('governanceReason');
});

test('core MCP tools can remember a turn and recall prepared narrative context', async () => {
  const kernel = makeKernel();

  const write = await callCogmemMcpTool('cogmem_remember_turn', {
    agentId: 'hermes',
    projectId: 'hermes-test',
    sessionId: 'session-1',
    userText: 'The Bluetooth protocol project used a GATT configuration service.',
    assistantText: 'Stored.',
  }, { kernel });

  expect(write.isError).toBeFalsy();
  expect(write.structuredContent?.ok).toBe(true);

  const recall = await callCogmemMcpTool('cogmem_recall', {
    agentId: 'hermes',
    projectId: 'hermes-test',
    query: 'What did the Bluetooth project use?',
    limit: 5,
  }, { kernel });

  expect(recall.isError).toBeFalsy();
  expect(recall.structuredContent?.recallMode).toBe('universe_navigation');
  expect(String(recall.content[0]?.text)).toContain('GATT configuration service');
  expect((recall.structuredContent?.items as Array<{ text: string }>).some((item) => (
    item.text.includes('GATT configuration service')
  ))).toBe(true);
});

test('core MCP explain tool returns pulse and temporal recall details', async () => {
  const kernel = makeKernel();
  await kernel.ingest({
    content: 'Release memory: use sqlite-vec for the public release.',
    projectId: 'mcp-explain',
    tags: ['agent:openclaw', 'openclaw'],
  });

  const explained = await callCogmemMcpTool('cogmem_explain_recall', {
    agentId: 'openclaw',
    projectId: 'mcp-explain',
    query: 'Which vector backend should release use?',
  }, { kernel });

  expect(explained.isError).toBeFalsy();
  expect(explained.structuredContent?.recallMode).toBe('universe_navigation');
  expect(explained.structuredContent?.pulseTrace).toBeTruthy();
  expect(explained.structuredContent?.temporalTraversal).toBeTruthy();
  expect((explained.structuredContent?.evidence as Array<{ text: string }>).some((item) => (
    item.text.includes('sqlite-vec')
  ))).toBe(true);
});
