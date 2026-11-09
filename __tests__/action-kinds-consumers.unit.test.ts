import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { resolveTaxonomy } from '../src/config/MemoryTaxonomy.js';
import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #183: a project's `action_kinds` is a vocabulary two more consumers read. Both used to reach for the shipped
 * registry, so a kind a project invented was validated, saved and then invisible. These walk the real paths.
 *
 * The memory text carries no shipped action word on purpose: `brewed` only matches this project's rule, so if
 * either consumer is unwired the facet and the item both disappear and no assertion can pass by coincidence.
 */
const PROJECT_ID = 'brewery';
const TAXONOMY = resolveTaxonomy({
  action_kinds: [{ kind: 'brewed', label: '煮', verb: '煮', pattern: 'brewed|煮了' }],
});

function createKernel(): MemoryKernel {
  return createMemoryKernel({
    dbPath: join(makeTempDir('cogmem-action-kinds-'), 'memory.db'),
    taxonomy: TAXONOMY,
  });
}

function appendBrewedEvent(kernel: MemoryKernel, text: string): string {
  const event = kernel.eventStore.append({
    eventId: 'evt-brewed',
    streamId: 'session-brewed',
    streamType: 'thread',
    eventType: 'MESSAGE',
    rawEventType: 'message',
    projectId: PROJECT_ID,
    sessionId: 'session-brewed',
    threadId: 'session-brewed',
    localDate: '2026-11-09',
    role: 'user',
    occurredAt: Date.UTC(2026, 10, 9, 12),
    payload: { text },
  });
  kernel.appendRawEventToEpisode(event, {
    projectId: PROJECT_ID,
    sessionId: 'session-brewed',
    sourceAgent: 'openclaw',
    now: event.occurredAt,
  });
  return event.eventId;
}

test('a project action kind reaches the atlas action facet', () => {
  const kernel = createKernel();
  try {
    appendBrewedEvent(kernel, '今天 brewed 了一杯咖啡，豆子是耶加雪菲。');
    kernel.rebuildMemoryAtlas({ projectId: PROJECT_ID });

    const rows = kernel.factStore.getDatabase()
      .prepare(`SELECT node_id FROM memory_atlas_documents WHERE project_id=? AND node_type='actionKind'`)
      .all(PROJECT_ID) as Array<{ node_id: string }>;
    expect(rows.map((row) => row.node_id)).toContain(`actionKind:${PROJECT_ID}:brewed`);
  } finally { kernel.close(); }
});

test('the compiled action filter accepts a project-invented kind, named or inferred', async () => {
  const kernel = createKernel();
  try {
    await kernel.ingest({ projectId: PROJECT_ID, content: '用户要求 brewed 咖啡机，一杯浓缩。', tags: ['agent:openclaw'] });
    const backend = new KernelAgentMemoryBackend(kernel);
    for (const query of [
      // The query names the kind itself.
      '查查还记不记得我之前让你对咖啡机做过什么 brewed',
      // It names no action: the fallback is the project's vocabulary, not a hand-copied shipped subset.
      '查查还记不记得我之前让你对咖啡机做过什么',
    ]) {
      const result = backend.recall({
        agentId: 'openclaw',
        projectId: PROJECT_ID,
        sessionId: 'current',
        query,
        retrievalPolicy: { allowedLanes: ['compiled'], preferredLanes: ['compiled'] },
        limit: 5,
      });
      const text = result.items.map((item) => item.text).join('\n');
      expect({ query, intent: result.queryPlan?.intent, matched: text.includes('brewed 咖啡机') })
        .toEqual({ query, intent: 'action_history', matched: true });
    }
  } finally { kernel.close(); }
});
