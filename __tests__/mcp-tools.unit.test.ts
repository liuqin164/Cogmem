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

test('core MCP tool list exposes recall, write, explain, strategy, map, tick, and prospective tools', () => {
  const tools = listCogmemMcpTools();
  expect(tools.map((tool) => tool.name)).toEqual([
    'cogmem_remember_turn',
    'cogmem_recall',
    'cogmem_explain_recall',
    'cogmem_strategy_plan',
    'cogmem_episode_append',
    'cogmem_episode_import',
    'cogmem_episode_status',
    'cogmem_topic_list',
    'cogmem_topic_operate',
    'cogmem_topic_rollback',
    'cogmem_episode_repair',
    'cogmem_episode_seal',
    'cogmem_dream_tick',
    'cogmem_dream_status',
    'cogmem_memory_map',
    'cogmem_candidate_review',
    'cogmem_graph_overview',
    'cogmem_graph_search',
    'cogmem_graph_explore',
    'cogmem_graph_node',
    'cogmem_graph_neighbors',
    'cogmem_graph_path',
    'cogmem_graph_timeline',
    'cogmem_graph_touch',
    'cogmem_maintenance_tick',
    'cogmem_prospective',
  ]);
  const recall = tools.find((tool) => tool.name === 'cogmem_recall');
  const explain = tools.find((tool) => tool.name === 'cogmem_explain_recall');
  const remember = tools.find((tool) => tool.name === 'cogmem_remember_turn');
  const strategy = tools.find((tool) => tool.name === 'cogmem_strategy_plan');
  const map = tools.find((tool) => tool.name === 'cogmem_memory_map');
  const tick = tools.find((tool) => tool.name === 'cogmem_maintenance_tick');
  expect(remember?.inputSchema.properties.ingestMode).toBeTruthy();
  expect(remember?.inputSchema.properties.collection).toBeTruthy();
  expect(recall?.inputSchema.properties.collection).toBeTruthy();
  expect(recall?.description).toContain('governed');
  expect(explain?.description).toContain('filteredEvidence');
  expect(explain?.description).toContain('governanceReason');
  expect(strategy?.annotations?.readOnlyHint).toBe(true);
  expect(strategy?.description).toContain('no instruction authority');
  expect(tools.find((tool) => tool.name === 'cogmem_episode_status')?.annotations?.readOnlyHint).toBe(true);
  expect(tools.find((tool) => tool.name === 'cogmem_episode_append')?.description).toContain('never runs Dream');
  expect(tools.find((tool) => tool.name === 'cogmem_dream_tick')?.description).toContain('sealed episodes only');
  expect(map?.description).toContain('memory map');
  expect(tick?.description).toContain('maintenance tick');
  const prospective = tools.find((tool) => tool.name === 'cogmem_prospective');
  expect(prospective?.description).toContain('never executes');
  expect(prospective?.annotations?.destructiveHint).toBe(true);
});

test('core MCP strategy plan is deterministic metadata and does not perform recall', async () => {
  const kernel = makeKernel();
  const planned = await callCogmemMcpTool('cogmem_strategy_plan', {
    projectId: 'brain', query: '我当时的原话是什么？',
  }, { kernel });

  expect(planned.isError).toBeFalsy();
  expect(planned.structuredContent).toMatchObject({
    templateId: 'source-first', instructionAuthority: 'none', persistAllowed: false,
  });
  expect(kernel.eventStore.getEventCount()).toBe(0);
});

test('core MCP prospective tool requires distinct user confirmation and never executes tasks', async () => {
  const kernel = makeKernel();
  const request = kernel.recordRawEvent({
    threadId: 'thread', projectId: 'brain', role: 'user', content: 'Remind me to check CI.',
  });
  const confirmation = kernel.recordRawEvent({
    threadId: 'thread', projectId: 'brain', role: 'user', content: 'Confirm the CI reminder.',
  });

  const created = await callCogmemMcpTool('cogmem_prospective', {
    action: 'create', projectId: 'brain', candidateType: 'reminder', canonicalKey: 'release:ci',
    title: 'Check CI', evidenceEventIds: [request.eventId], dueAt: 100,
  }, { kernel });
  expect(created.isError).toBeFalsy();
  const candidateId = String(created.structuredContent?.candidateId);
  const rejectedConfirmation = await callCogmemMcpTool('cogmem_prospective', {
    action: 'confirm', projectId: 'brain', candidateId, confirmationEvidenceEventId: request.eventId,
  }, { kernel });
  expect(rejectedConfirmation.isError).toBe(true);

  const confirmed = await callCogmemMcpTool('cogmem_prospective', {
    action: 'confirm', projectId: 'brain', candidateId, confirmationEvidenceEventId: confirmation.eventId,
  }, { kernel });
  expect(confirmed.isError).toBeFalsy();
  const due = await callCogmemMcpTool('cogmem_prospective', {
    action: 'due', projectId: 'brain', atTime: 200,
  }, { kernel });
  expect(due.structuredContent).toEqual(expect.objectContaining({ items: [expect.objectContaining({ candidateId })] }));
  expect('execute' in kernel.prospectiveMemoryService).toBe(false);
});

test('core MCP remember turn supports raw-only mode without creating vectors', async () => {
  const kernel = makeKernel();

  const write = await callCogmemMcpTool('cogmem_remember_turn', {
    agentId: 'openclaw',
    projectId: 'mcp-raw-only',
    sessionId: 'session-raw',
    userText: '在吗',
    assistantText: '在。',
    ingestMode: 'raw_archive_only',
  }, { kernel });

  expect(write.isError).toBeFalsy();
  expect(write.structuredContent?.ok).toBe(true);
  expect(write.structuredContent?.compiled).toBe(false);
  expect(write.structuredContent?.reason).toBe('raw_archive_only');
  expect(kernel.eventStore.getEventCount()).toBe(2);
  expect(kernel.vectorStore.getCurrentCount()).toBe(0);
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

test('core MCP recall uses agent-facing raw ledger fallback when only projectId is provided', async () => {
  const kernel = makeKernel();

  const write = await callCogmemMcpTool('cogmem_remember_turn', {
    agentId: 'hermes',
    projectId: 'hermes',
    sessionId: 'hermes-moneyprinterturbo',
    userText: 'MoneyPrinterTurbo deployment note: keep the template cache under Hermes control.',
    assistantText: 'Stored in the raw ledger without immediate compilation.',
    ingestMode: 'raw_archive_only',
  }, { kernel });

  expect(write.isError).toBeFalsy();
  expect(write.structuredContent?.compiled).toBe(false);
  expect(kernel.vectorStore.getCurrentCount()).toBe(0);

  const recall = await callCogmemMcpTool('cogmem_recall', {
    projectId: 'hermes',
    query: 'MoneyPrinterTurbo',
    limit: 3,
  }, { kernel });

  expect(recall.isError).toBeFalsy();
  expect(recall.structuredContent?.agentId).toBe('hermes');
  expect(recall.structuredContent?.recallMode).toBe('raw_ledger_fallback');
  expect(recall.structuredContent?.fallbackUsed).toBe(true);
  expect((recall.structuredContent?.items as Array<{ text: string; sourceType?: string; sourceContext?: unknown }>).some((item) => (
    item.text.includes('MoneyPrinterTurbo deployment note')
    && item.sourceType === 'raw_ledger'
    && Boolean(item.sourceContext)
  ))).toBe(true);
});

test('core MCP explain infers agentId from projectId and matches normal recall', async () => {
  const kernel = makeKernel();

  await callCogmemMcpTool('cogmem_remember_turn', {
    agentId: 'hermes',
    projectId: 'hermes',
    sessionId: 'hermes-black-box',
    userText: 'The original memory black-box discussion must remain source-drillable.',
    assistantText: 'Stored only in the raw ledger.',
    ingestMode: 'raw_archive_only',
  }, { kernel });

  const recall = await callCogmemMcpTool('cogmem_recall', {
    projectId: 'hermes',
    query: 'memory black-box discussion',
    limit: 3,
  }, { kernel });
  const explained = await callCogmemMcpTool('cogmem_explain_recall', {
    projectId: 'hermes',
    query: 'memory black-box discussion',
    limit: 3,
  }, { kernel });

  expect(explained.isError).toBeFalsy();
  expect(explained.structuredContent?.agentId).toBe('hermes');
  expect(explained.structuredContent?.recallMode).toBe(recall.structuredContent?.recallMode);
  expect(explained.structuredContent?.decisionTrace).toEqual(recall.structuredContent?.decisionTrace);
  expect((explained.structuredContent?.evidence as Array<{ id: string }>).map((item) => item.id)).toEqual(
    (recall.structuredContent?.items as Array<{ id: string }>).map((item) => item.id),
  );
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
