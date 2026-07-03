import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { EpisodeTitleGenerator } from '../src/atlas/EpisodeTitleGenerator.js';
import { FacetQueryPlanner } from '../src/atlas/FacetQueryPlanner.js';

function createKernel(): MemoryKernel {
  return createMemoryKernel({ dbPath: join(mkdtempSync(join(tmpdir(), 'cogmem-atlas-facet-')), 'memory.db') });
}

function addEpisode(kernel: MemoryKernel, input: {
  eventId: string;
  sessionId: string;
  text: string;
  occurredAt: number;
  localDate: string;
}) {
  const event = kernel.eventStore.append({
    eventId: input.eventId,
    streamId: input.sessionId,
    streamType: 'thread',
    eventType: 'MESSAGE',
    rawEventType: 'message',
    projectId: 'openclaw',
    sessionId: input.sessionId,
    threadId: input.sessionId,
    localDate: input.localDate,
    role: 'user',
    occurredAt: input.occurredAt,
    payload: { text: input.text },
  });
  kernel.appendRawEventToEpisode(event, { projectId: 'openclaw', sessionId: input.sessionId, sourceAgent: 'openclaw', now: input.occurredAt });
  return event;
}

test('EpisodeTitleGenerator creates short issue-specific titles from user evidence', () => {
  const generator = new EpisodeTitleGenerator();
  const result = generator.generate({
    episodeId: 'episode-memory-context',
    summary: 'A long summary should not become the label.',
    topicPath: 'openclaw/cogmem',
    episodeType: 'discussion',
    startedAt: Date.UTC(2026, 5, 6),
    events: [{
      eventId: 'evt-memory-context',
      streamId: 'thread',
      streamType: 'thread',
      eventType: 'MESSAGE',
      eventVersion: 1,
      role: 'user',
      projectId: 'openclaw',
      localDate: '2026-06-06',
      occurredAt: Date.UTC(2026, 5, 6),
      payload: { text: 'CogMem Memory Context 像黑盒，需要 sourceContext 原文下钻。' },
      payloadHash: 'hash',
      createdAt: Date.UTC(2026, 5, 6),
    }],
  });
  expect(result.displayTitle).toBe('CogMem Memory Context 黑盒与原文下钻');
  expect(result.issueHints).toEqual(['memory-context-blackbox']);
  expect(result.topicHints).toContain('memory-blackbox');
  expect(result.localDate).toBe('2026-06-06');
  expect(result.generatorTrace.usedUserText).toBe(true);
  expect(result.reviewNeeded).toBe(false);
});

test('FacetQueryPlanner parses day and topic intersection without timezone drift', () => {
  const planner = new FacetQueryPlanner();
  const plan = planner.plan('6月6号关于记忆黑盒聊过什么？', { projectId: 'openclaw', now: Date.UTC(2026, 6, 3) });
  expect(plan.operator).toBe('intersection');
  expect(plan.facets).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'time', value: '2026-06-06', granularity: 'day' }),
    expect.objectContaining({ type: 'topic', value: 'PROJECT/Cogmem/memory-blackbox' }),
  ]));
});

test('Atlas facet projection returns one canonical episode with matched facets and related-but-not-selected cards', () => {
  const kernel = createKernel();
  try {
    const contextEvent = addEpisode(kernel, {
      eventId: 'evt-2026-06-06-memory-context',
      sessionId: 'session-0606',
      localDate: '2026-06-06',
      occurredAt: Date.UTC(2026, 5, 6, 12),
      text: 'CogMem Memory Context 像黑盒，需要从摘要下钻到 sourceContext 原始对话。',
    });
    addEpisode(kernel, {
      eventId: 'evt-2026-06-28-graph-lock',
      sessionId: 'session-0628',
      localDate: '2026-06-28',
      occurredAt: Date.UTC(2026, 5, 28, 12),
      text: 'memory graph 卡死，database locked，还有 zombie process，像另一个记忆黑盒。',
    });
    kernel.rebuildMemoryAtlas({ projectId: 'openclaw' });

    const result = kernel.graphExplore('6月6号关于记忆黑盒聊过什么？', {
      projectId: 'openclaw',
      now: Date.UTC(2026, 6, 3),
      includeEvidence: true,
      limit: 10,
    });
    expect(result.cards?.length).toBeGreaterThan(0);
    const card = result.cards![0]!;
    expect(card.displayTitle).toBe('CogMem Memory Context 黑盒与原文下钻');
    expect(card.evidenceEventIds).toContain(contextEvent.eventId);
    expect(card.sourceLocator?.command).toContain(`memory show --event ${contextEvent.eventId}`);
    expect(card.matchedFacets).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'time', value: '2026-06-06' }),
      expect.objectContaining({ type: 'topic', value: 'PROJECT/Cogmem/memory-blackbox' }),
    ]));
    expect(new Set(result.cards!.map((item) => item.canonicalId)).size).toBe(result.cards!.length);
    expect(card.relatedButNotSelected.some((item) => item.displayTitle.includes('memory graph 卡死'))).toBe(true);
    expect(result.cards!.some((item) => item.displayTitle.includes('database locked'))).toBe(false);
  } finally {
    kernel.close();
  }
});

test('historical recall exposes facet graph cards and dedupes by canonical event evidence', () => {
  const kernel = createKernel();
  try {
    addEpisode(kernel, {
      eventId: 'evt-2026-06-06-memory-context',
      sessionId: 'session-0606',
      localDate: '2026-06-06',
      occurredAt: Date.UTC(2026, 5, 6, 12),
      text: 'CogMem Memory Context 像黑盒，需要从摘要下钻到 sourceContext 原始对话。',
    });
    kernel.rebuildMemoryAtlas({ projectId: 'openclaw' });

    const result = new KernelAgentMemoryBackend(kernel).recall({
      agentId: 'openclaw',
      projectId: 'openclaw',
      sessionId: 'current',
      query: '你还记得我们聊过的记忆黑盒吗？',
      intent: 'historical_discussion',
      limit: 5,
    });
    expect(result.decisionTrace?.selectedLane).toBe('facet_graph_raw_ledger');
    expect(result.atlasCards?.[0]?.displayTitle).toBe('CogMem Memory Context 黑盒与原文下钻');
    expect(result.items[0]?.canonicalId).toBe(result.atlasCards?.[0]?.canonicalId);
    expect(result.items[0]?.sourceContext?.locator.command).toContain('cogmem memory show');
  } finally {
    kernel.close();
  }
});

test('GraphCurator rebuild deletes only its own projection edges', () => {
  const kernel = createKernel();
  try {
    addEpisode(kernel, {
      eventId: 'evt-2026-07-03-atlas',
      sessionId: 'session-0703',
      localDate: '2026-07-03',
      occurredAt: Date.UTC(2026, 6, 3, 12),
      text: 'Atlas 节点没有事件名称，需要多维图谱和 canonical episode。',
    });
    const db = kernel.memoryAtlasStore.db;
    db.prepare(`INSERT INTO memory_edges(
      edge_id,project_id,source_type,source_id,relation_type,target_type,target_id,confidence,base_weight,stability,activation,
      evidence_event_ids_json,status,valid_from,version,source_authority,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'raw-related-edge',
      'openclaw',
      'entity',
      'facet:cogmem',
      'RELATED_TO',
      'cluster',
      'canonical-cluster',
      0.91,
      1,
      1,
      0,
      JSON.stringify(['evt-2026-07-03-atlas']),
      'active',
      Date.UTC(2026, 6, 3, 12),
      1,
      'raw_evidence',
      Date.UTC(2026, 6, 3, 12),
      Date.UTC(2026, 6, 3, 12),
    );
    kernel.rebuildMemoryAtlas({ projectId: 'openclaw' });
    expect(db.prepare(`SELECT source_authority FROM memory_edges WHERE edge_id='raw-related-edge'`).get()).toEqual({ source_authority: 'raw_evidence' });
  } finally {
    kernel.close();
  }
});
