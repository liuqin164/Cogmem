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
  projectId?: string;
}) {
  const projectId = input.projectId || 'openclaw';
  const event = kernel.eventStore.append({
    eventId: input.eventId,
    streamId: input.sessionId,
    streamType: 'thread',
    eventType: 'MESSAGE',
    rawEventType: 'message',
    projectId,
    sessionId: input.sessionId,
    threadId: input.sessionId,
    localDate: input.localDate,
    role: 'user',
    occurredAt: input.occurredAt,
    payload: { text: input.text },
  });
  kernel.appendRawEventToEpisode(event, { projectId, sessionId: input.sessionId, sourceAgent: 'openclaw', now: input.occurredAt });
  return event;
}

function seedMemoryBlackboxTimeline(kernel: MemoryKernel) {
  const context = addEpisode(kernel, {
    eventId: 'evt-2026-06-06-memory-context',
    sessionId: 'session-0606',
    localDate: '2026-06-06',
    occurredAt: Date.UTC(2026, 5, 6, 12),
    text: 'CogMem Memory Context 像黑盒，需要从摘要下钻到 sourceContext 原始对话。',
  });
  const graph = addEpisode(kernel, {
    eventId: 'evt-2026-06-28-graph-lock',
    sessionId: 'session-0628',
    localDate: '2026-06-28',
    occurredAt: Date.UTC(2026, 5, 28, 12),
    text: 'memory graph 卡死，database locked，还有 zombie process，像另一个记忆黑盒。',
  });
  const atlas = addEpisode(kernel, {
    eventId: 'evt-2026-07-03-atlas-readability',
    sessionId: 'session-0703',
    localDate: '2026-07-03',
    occurredAt: Date.UTC(2026, 6, 3, 12),
    text: 'Atlas 节点没有事件名称，需要多维图谱、父主题和 canonical episode 来解决记忆黑盒。',
  });
  kernel.rebuildMemoryAtlas({ projectId: 'openclaw' });
  return { context, graph, atlas };
}

function seedOperation(kernel: MemoryKernel, input: { entity: string; eventId: string; sessionId: string; text: string }) {
  const event = addEpisode(kernel, {
    eventId: input.eventId,
    sessionId: input.sessionId,
    localDate: '2026-06-05',
    occurredAt: Date.UTC(2026, 5, 5, 12, 22),
    text: input.text,
  });
  kernel.rebuildMemoryAtlas({ projectId: 'openclaw' });
  return event;
}

function seedHermesOperation(kernel: MemoryKernel) {
  return seedOperation(kernel, {
    entity: 'Hermes',
    eventId: 'evt-26d73f7c-ab5f-45be-b6d3-7ab5fa93d547',
    sessionId: 'session-2026-06-05-hermes',
    text: '启动本机安装的Hermes',
  });
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

test('EpisodeTitleGenerator keeps Memory Context precedence when automatic injection is also mentioned', () => {
  const generator = new EpisodeTitleGenerator();
  const result = generator.generate({
    episodeId: 'episode-memory-context-injection',
    summary: 'Memory Context and automatic injection discussion.',
    episodeType: 'discussion',
    startedAt: Date.UTC(2026, 5, 6),
    events: [{
      eventId: 'evt-memory-context-injection',
      streamId: 'thread',
      streamType: 'thread',
      eventType: 'MESSAGE',
      eventVersion: 1,
      role: 'user',
      projectId: 'openclaw',
      localDate: '2026-06-06',
      occurredAt: Date.UTC(2026, 5, 6),
      payload: { text: 'CogMem Memory Context 自动注入后还是黑盒，需要 sourceContext 原文下钻。' },
      payloadHash: 'hash',
      createdAt: Date.UTC(2026, 5, 6),
    }],
  });
  expect(result.issueHints).toEqual(['memory-context-blackbox']);
  expect(result.displayTitle).toBe('CogMem Memory Context 黑盒与原文下钻');
});

test('FacetQueryPlanner parses day and topic intersection without timezone drift', () => {
  const planner = new FacetQueryPlanner();
  const plan = planner.plan('6月6号关于记忆黑盒聊过什么？', { projectId: 'openclaw', now: Date.UTC(2026, 6, 3) });
  expect(plan.operator).toBe('intersection');
    expect(plan.facets).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'time', value: '2026-06-06', granularity: 'day' }),
      expect.objectContaining({ type: 'topic', value: 'PROJECT/openclaw/memory-blackbox' }),
    ]));
});

test('FacetQueryPlanner prefers Memory Context issue for broad non-timeline memory-blackbox recall', () => {
  const planner = new FacetQueryPlanner();
  const broad = planner.plan('你还记得我们聊过的记忆黑盒吗？', { projectId: 'openclaw', now: Date.UTC(2026, 6, 3) });
  expect(broad.facets).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'topic', value: 'PROJECT/openclaw/memory-blackbox' }),
    expect.objectContaining({ type: 'issue', value: 'memory-context-blackbox' }),
  ]));
  const timeline = planner.plan('记忆黑盒后来有没有继续讨论？', { projectId: 'openclaw', now: Date.UTC(2026, 6, 3) });
  expect(timeline.temporalIntent).toBe('timeline');
  expect(timeline.facets.some((facet) => facet.type === 'issue' && facet.value === 'memory-context-blackbox')).toBe(false);
  expect(broad.facets.some((facet) => facet.type === 'entity' && facet.value === 'facet:记忆黑盒')).toBe(false);
});

test('FacetQueryPlanner parses memoryKind and actionKind facets', () => {
  const planner = new FacetQueryPlanner();
  expect(planner.plan('6月6号有哪些 bug？', { projectId: 'openclaw', now: Date.UTC(2026, 6, 3) }).facets).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'memoryKind', value: 'bug' }),
  ]));
  expect(planner.plan('之前实现过哪些修复？', { projectId: 'openclaw', now: Date.UTC(2026, 6, 3) }).facets).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'actionKind', value: 'implemented' }),
  ]));
  const actionHistory = planner.plan('查查还记不记得我之前让你对Hermes做过什么', { projectId: 'openclaw', now: Date.UTC(2026, 6, 3) });
  expect(actionHistory.intent).toBe('action_history');
  expect(actionHistory.facets).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'entity', value: 'facet:hermes', nodeId: 'entity:openclaw:facet:hermes' }),
    expect.objectContaining({ type: 'topic', value: 'PROJECT/openclaw/hermes' }),
    expect.objectContaining({ type: 'actionKind', value: 'started' }),
    expect.objectContaining({ type: 'actionKind', value: 'installed' }),
  ]));
  const genericActionHistory = planner.plan('查查还记不记得我之前让你对Raycast做过什么', { projectId: 'openclaw', now: Date.UTC(2026, 6, 3) });
  expect(genericActionHistory.intent).toBe('action_history');
  expect(genericActionHistory.facets).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'entity', value: 'facet:raycast' }),
    expect.objectContaining({ type: 'topic', value: 'PROJECT/openclaw/raycast' }),
    expect.objectContaining({ type: 'actionKind', value: 'operated' }),
  ]));
});

test('FacetQueryPlanner infers yearless dates from local date, not UTC year', () => {
  const planner = new FacetQueryPlanner();
  const plan = planner.plan('1月1日的原话', {
    projectId: 'openclaw',
    now: Date.UTC(2026, 11, 31, 15, 30),
    timeZone: 'Asia/Tokyo',
  });
  expect(plan.facets).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'time', value: '2027-01-01' }),
  ]));
  expect(planner.plan('1月1日的原话', {
    projectId: 'openclaw',
    now: Date.UTC(2026, 0, 1),
    localDateNow: '2028-01-01',
  }).facets).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'time', value: '2028-01-01' }),
  ]));
});

test('generic entity action-history facets do not depend on Hermes', () => {
  const kernel = createKernel();
  try {
    const event = seedOperation(kernel, {
      entity: 'Raycast',
      eventId: 'evt-generic-raycast-start',
      sessionId: 'session-2026-06-05-raycast',
      text: '启动本机安装的Raycast',
    });
    const result = kernel.graphTimeline('对 Raycast 做过什么操作', {
      projectId: 'openclaw',
      now: Date.UTC(2026, 6, 3),
      includeEvidence: true,
      limit: 10,
    });
    const card = result.cards?.[0];
    expect(card?.displayTitle).toContain('Raycast');
    expect(card?.matchedFacets).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'entity', value: 'facet:raycast' }),
      expect.objectContaining({ type: 'actionKind', value: 'started' }),
    ]));
    expect(card?.sourceLocator?.eventId).toBe(event.eventId);
  } finally {
    kernel.close();
  }
});

test('Hermes action-history queries surface the canonical 2026-06-05 operation card', () => {
  const kernel = createKernel();
  try {
    const event = seedHermesOperation(kernel);
    for (const query of ['Hermes', '启动 Hermes', '6月5日 Hermes']) {
      const result = kernel.graphExplore(query, {
        projectId: 'openclaw',
        now: Date.UTC(2026, 6, 3),
        includeEvidence: true,
        limit: 10,
      });
      expect(result.cards?.[0]?.displayTitle).toContain('Hermes');
      expect(result.cards?.[0]?.evidenceEventIds).toContain(event.eventId);
      expect(result.cards?.[0]?.sourceLocator?.command).toContain(`memory show --event ${event.eventId}`);
    }
    const timeline = kernel.graphTimeline('对 Hermes 做过什么操作', {
      projectId: 'openclaw',
      now: Date.UTC(2026, 6, 3),
      includeEvidence: true,
      limit: 10,
    });
    const card = timeline.cards?.[0];
    expect(card?.displayTitle).toContain('Hermes');
    expect(card?.localDate).toBe('2026-06-05');
    expect(card?.matchedFacets).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'entity', value: 'facet:hermes' }),
      expect.objectContaining({ type: 'actionKind', value: 'started' }),
    ]));
    expect(card?.sourceLocator?.command).toContain(`memory show --event ${event.eventId}`);
  } finally {
    kernel.close();
  }
});

test('action-history recall selects Hermes operation and suppresses unrelated compiled memories', async () => {
  const kernel = createKernel();
  try {
    const event = seedHermesOperation(kernel);
    await kernel.ingest({
      projectId: 'openclaw',
      content: '6月28日 memory graph zombie process 和 Bun factory bug 导致 database locked。',
      tags: ['agent:openclaw'],
    });
    const result = new KernelAgentMemoryBackend(kernel).recall({
      agentId: 'openclaw',
      projectId: 'openclaw',
      sessionId: 'current',
      query: '查查还记不记得我之前让你对Hermes做过什么',
      limit: 5,
    });
    expect(result.queryPlan?.intent).toBe('action_history');
    expect(result.decisionTrace?.selectedLane).toBe('facet_graph_raw_ledger');
    expect(result.atlasCards?.[0]?.displayTitle).toContain('Hermes');
    expect(result.items[0]?.sourceAnchor?.eventId).toBe(event.eventId);
    expect(result.items.map((item) => item.text).join('\n')).not.toContain('zombie process');
  } finally {
    kernel.close();
  }
});

test('action-history compiled fallback requires entity and operational action match', async () => {
  const kernel = createKernel();
  try {
    await kernel.ingest({
      projectId: 'openclaw',
      content: '检查 Hermes 数据库是否被锁，memory graph zombie process 和 Bun factory bug 导致 database locked。',
      tags: ['agent:openclaw'],
    });
    await kernel.ingest({
      projectId: 'openclaw',
      content: '用户要求启动本机安装的 Hermes。',
      tags: ['agent:openclaw'],
    });
    const result = new KernelAgentMemoryBackend(kernel).recall({
      agentId: 'openclaw',
      projectId: 'openclaw',
      sessionId: 'current',
      query: '查查还记不记得我之前让你对Hermes做过什么',
      retrievalPolicy: { allowedLanes: ['compiled'], preferredLanes: ['compiled'] },
      limit: 5,
    });
    const text = result.items.map((item) => item.text).join('\n');
    expect(text).toContain('启动本机安装的 Hermes');
    expect(text).not.toContain('database locked');
    expect(result.decisionTrace?.reason).toBe('action_history');
  } finally {
    kernel.close();
  }
});

test('Atlas cards dedupe overlapping episodes by primary raw evidence', () => {
  const kernel = createKernel();
  try {
    const event = seedHermesOperation(kernel);
    const episodeId = kernel.episodeStore.getEventLink(event.eventId)?.episodeId;
    expect(episodeId).toBeTruthy();
    kernel.memoryAtlasStore.upsertDocument({
      id: 'episode:episode-duplicate-hermes',
      projectId: 'openclaw',
      nodeType: 'episode',
      sourceId: 'episode-duplicate-hermes',
      label: 'Hermes 启动重复 episode',
      summary: '用户要求启动本机安装的 Hermes。',
      topicPath: 'PROJECT/openclaw/hermes',
      confidence: 0.9,
      supportCount: 1,
      status: 'active',
      occurredAt: Date.UTC(2026, 5, 5, 12, 22),
      evidenceEventIds: [event.eventId],
      metadata: {
        localDate: '2026-06-05',
        topicHints: ['PROJECT/openclaw/hermes'],
        eventKind: 'operation',
      },
    });
    kernel.memoryAtlasStore.db.prepare(`
      INSERT INTO memory_edges(
        edge_id,project_id,source_type,source_id,relation_type,target_type,target_id,confidence,base_weight,stability,activation,
        evidence_event_ids_json,status,valid_from,valid_to,version,source_authority,created_at,updated_at
      )
      SELECT 'dup-' || edge_id,project_id,source_type,'episode-duplicate-hermes',relation_type,target_type,target_id,confidence,base_weight,stability,activation,
        evidence_event_ids_json,status,valid_from,valid_to,version,source_authority,created_at,updated_at
      FROM memory_edges
      WHERE project_id='openclaw' AND source_type='episode' AND source_id=?
    `).run(episodeId);

    const result = kernel.graphExplore('启动 Hermes', {
      projectId: 'openclaw',
      now: Date.UTC(2026, 6, 3),
      includeEvidence: true,
      limit: 10,
      refresh: false,
    });
    expect(result.cards?.filter((card) => card.evidenceEventIds.includes(event.eventId))).toHaveLength(1);
    expect(result.cards?.[0]?.relatedButNotSelected).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalId: 'episode:episode-duplicate-hermes', reason: 'same primary raw evidence' }),
    ]));
  } finally {
    kernel.close();
  }
});

test('forensic quote recall uses raw sourceLocator for 6月5日 original wording', () => {
  const kernel = createKernel();
  try {
    const event = seedHermesOperation(kernel);
    const result = new KernelAgentMemoryBackend(kernel).recall({
      agentId: 'openclaw',
      projectId: 'openclaw',
      sessionId: 'current',
      query: '能精确到6月5日的原文吗？我的原话',
      limit: 5,
    });
    expect(result.queryPlan?.intent).toBe('forensic_quote');
    expect(result.items[0]?.sourceType).toBe('raw_ledger');
    expect(result.items[0]?.sourceAnchor?.eventId).toBe(event.eventId);
    expect(result.items[0]?.sourceContext?.locator.command).toContain(`memory show --event ${event.eventId}`);
    expect(result.items[0]?.canAnswerExactQuote).toBe(true);
  } finally {
    kernel.close();
  }
});

test('targeted graph reindex restores one episode facets by raw event id', () => {
  const kernel = createKernel();
  try {
    const event = seedHermesOperation(kernel);
    const episodeId = kernel.episodeStore.getEventLink(event.eventId)?.episodeId;
    expect(episodeId).toBeTruthy();
    kernel.memoryAtlasStore.db.prepare(`
      DELETE FROM memory_edges
      WHERE project_id='openclaw' AND source_authority='atlas_curator'
        AND source_type='episode' AND source_id=?
    `).run(episodeId);
    expect(kernel.graphExplore('启动 Hermes', { projectId: 'openclaw', now: Date.UTC(2026, 6, 3), limit: 10, refresh: false }).cards ?? []).toHaveLength(0);
    const reindexed = kernel.reindexMemoryAtlas({ projectId: 'openclaw', eventId: event.eventId });
    expect(reindexed.episodeIds).toContain(episodeId);
    expect(kernel.memoryAtlasStore.getProjectionState('openclaw')?.status).toBe('dirty');
    const result = kernel.graphExplore('启动 Hermes', { projectId: 'openclaw', now: Date.UTC(2026, 6, 3), limit: 10, refresh: false });
    expect(result.cards?.[0]?.displayTitle).toContain('Hermes');
    expect(result.cards?.[0]?.sourceLocator?.eventId).toBe(event.eventId);
  } finally {
    kernel.close();
  }
});

test('broad memory-blackbox recall selects initial Memory Context episode and leaves later issues related', () => {
  const kernel = createKernel();
  try {
    seedMemoryBlackboxTimeline(kernel);
    const result = kernel.graphExplore('你还记得我们聊过的记忆黑盒吗？', {
      projectId: 'openclaw',
      now: Date.UTC(2026, 6, 3),
      includeEvidence: true,
      limit: 10,
    });
    expect(result.cards?.[0]?.displayTitle).toBe('CogMem Memory Context 黑盒与原文下钻');
    expect(result.cards?.[0]?.relatedButNotSelected.map((card) => card.displayTitle)).toEqual(expect.arrayContaining([
      expect.stringContaining('memory graph 卡死'),
      expect.stringContaining('Atlas 节点命名'),
    ]));
    expect(result.cards?.some((card) => card.displayTitle.includes('memory graph 卡死'))).toBe(false);
  } finally {
    kernel.close();
  }
});

test('time-only facet query returns canonical cards on that day without duplicates', () => {
  const kernel = createKernel();
  try {
    seedMemoryBlackboxTimeline(kernel);
    addEpisode(kernel, {
      eventId: 'evt-2026-06-06-second',
      sessionId: 'session-0606-b',
      localDate: '2026-06-06',
      occurredAt: Date.UTC(2026, 5, 6, 15),
      text: '6月6号还讨论了 Cogmem sourceContext 的导入流程和原话定位。',
    });
    kernel.rebuildMemoryAtlas({ projectId: 'openclaw' });
    const result = kernel.graphExplore('6月6号聊过什么？', {
      projectId: 'openclaw',
      now: Date.UTC(2026, 6, 3),
      includeEvidence: true,
      limit: 10,
    });
    expect(result.cards?.length).toBe(2);
    expect(new Set(result.cards!.map((card) => card.canonicalId)).size).toBe(2);
    expect(result.cards!.every((card) => card.matchedFacets.some((facet) => facet.type === 'time' && facet.value === '2026-06-06'))).toBe(true);
  } finally {
    kernel.close();
  }
});

test('topic timeline uses facet cards sorted by localDate and grouped by issue', () => {
  const kernel = createKernel();
  try {
    seedMemoryBlackboxTimeline(kernel);
    const timeline = kernel.graphTimeline('记忆黑盒后来有没有继续讨论？', {
      projectId: 'openclaw',
      now: Date.UTC(2026, 6, 3),
      includeEvidence: true,
      limit: 10,
    });
    expect(timeline.cards?.map((card) => card.displayTitle)).toEqual([
      'CogMem Memory Context 黑盒与原文下钻',
      'memory graph 卡死与数据库锁',
      'Atlas 节点命名与多维导航',
    ]);
    expect(timeline.groupedByIssue?.map((group) => group.issueType)).toEqual(expect.arrayContaining([
      'memory-context-blackbox',
      'graph-runtime-blackbox',
      'atlas-readability',
    ]));
  } finally {
    kernel.close();
  }
});

test('graph-search shares facet relaxation and returns nearby day with trace', () => {
  const kernel = createKernel();
  try {
    seedMemoryBlackboxTimeline(kernel);
    const result = kernel.graphSearch('6月5号关于记忆黑盒聊过什么？', {
      projectId: 'openclaw',
      now: Date.UTC(2026, 6, 3),
      includeEvidence: true,
      limit: 10,
    });
    expect(result.cards?.[0]?.displayTitle).toBe('CogMem Memory Context 黑盒与原文下钻');
    expect(result.relaxationTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: '2026-06-05', to: '2026-06' }),
    ]));
  } finally {
    kernel.close();
  }
});

test('3.7 projection ignores stale clean memory_atlas.v1 and writes clean memory_atlas.v2', () => {
  const kernel = createKernel();
  try {
    addEpisode(kernel, {
      eventId: 'evt-2026-06-06-memory-context',
      sessionId: 'session-0606',
      localDate: '2026-06-06',
      occurredAt: Date.UTC(2026, 5, 6, 12),
      text: 'CogMem Memory Context 像黑盒，需要 sourceContext 原文下钻。',
    });
    kernel.memoryAtlasStore.db.prepare(`
      INSERT INTO memory_atlas_projection_state(project_id, projection_name, cursor_value, status, last_rebuild_at, last_error, metadata_json)
      VALUES('openclaw', 'memory_atlas.v1', 'legacy', 'clean', ?, NULL, '{}')
      ON CONFLICT(project_id, projection_name) DO UPDATE SET status='clean', cursor_value='legacy', last_rebuild_at=excluded.last_rebuild_at, metadata_json='{}'
    `).run(Date.UTC(2026, 5, 6));
    expect(kernel.memoryAtlasStore.projectionNeedsRefresh('openclaw')).toBe(true);
    kernel.ensureMemoryAtlas({ projectId: 'openclaw' });
    expect(kernel.memoryAtlasStore.getProjectionState('openclaw')?.status).toBe('clean');
    const row = kernel.memoryAtlasStore.db.prepare(`
      SELECT status, metadata_json FROM memory_atlas_projection_state
      WHERE project_id='openclaw' AND projection_name='memory_atlas.v2'
    `).get() as { status: string; metadata_json: string } | null;
    expect(row?.status).toBe('clean');
    expect(JSON.parse(row!.metadata_json).projectionSchemaVersion).toBe('3.7.2');
  } finally {
    kernel.close();
  }
});

test('entity facet nodes are project-scoped and do not overwrite same-name entities', () => {
  const kernel = createKernel();
  try {
    addEpisode(kernel, {
      eventId: 'evt-project-a-hermes',
      sessionId: 'session-a',
      projectId: 'project-a',
      localDate: '2026-06-05',
      occurredAt: Date.UTC(2026, 5, 5, 10),
      text: '启动本机安装的Hermes',
    });
    addEpisode(kernel, {
      eventId: 'evt-project-b-hermes',
      sessionId: 'session-b',
      projectId: 'project-b',
      localDate: '2026-06-05',
      occurredAt: Date.UTC(2026, 5, 5, 11),
      text: '启动本机安装的Hermes',
    });
    kernel.rebuildMemoryAtlas({ projectId: 'project-a' });
    kernel.rebuildMemoryAtlas({ projectId: 'project-b' });
    expect(kernel.memoryAtlasStore.getNode('entity:project-a:facet:hermes', 'project-a')?.projectId).toBe('project-a');
    expect(kernel.memoryAtlasStore.getNode('entity:project-b:facet:hermes', 'project-b')?.projectId).toBe('project-b');
    expect(kernel.memoryAtlasStore.getNode('entity:project-b:facet:hermes', 'project-a')).toBeNull();
  } finally {
    kernel.close();
  }
});

test('forensic anchor rejects raw events outside the requested project', () => {
  const kernel = createKernel();
  try {
    const foreign = addEpisode(kernel, {
      eventId: 'evt-foreign-anchor',
      sessionId: 'foreign-session',
      projectId: 'project-b',
      localDate: '2026-06-05',
      occurredAt: Date.UTC(2026, 5, 5, 10),
      text: '用户在另一个项目里的原话。',
    });
    const result = new KernelAgentMemoryBackend(kernel).recall({
      agentId: 'openclaw',
      projectId: 'project-a',
      sessionId: 'current',
      query: '我的原话是什么',
      intent: 'forensic_quote',
      anchorEventId: foreign.eventId,
      limit: 3,
    });
    expect(result.items.some((item) => item.sourceAnchor?.eventId === foreign.eventId)).toBe(false);
  } finally {
    kernel.close();
  }
});

test('non-Cogmem projects still receive generic project topic facets', () => {
  const kernel = createKernel();
  try {
    addEpisode(kernel, {
      eventId: 'evt-custom-memory-blackbox',
      sessionId: 'custom-session',
      projectId: 'customapp',
      localDate: '2026-06-06',
      occurredAt: Date.UTC(2026, 5, 6, 12),
      text: '这个项目的记忆黑盒需要 sourceContext 原文下钻。',
    });
    kernel.rebuildMemoryAtlas({ projectId: 'customapp' });
    const result = kernel.graphExplore('记忆黑盒', { projectId: 'customapp', now: Date.UTC(2026, 6, 3), limit: 10 });
    expect(result.cards?.[0]?.matchedFacets).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'topic', value: 'PROJECT/customapp/memory-blackbox' }),
    ]));
  } finally {
    kernel.close();
  }
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
    expect(card.matchedFacets.some((facet) => facet.type === 'time' && facet.value === '2026-06-06')).toBe(true);
    expect(card.matchedFacets.some((facet) => facet.type === 'topic' && facet.value === 'PROJECT/openclaw/memory-blackbox')).toBe(true);
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

test('GraphCurator relation projection is bounded by hint buckets instead of all episode pairs', () => {
  const kernel = createKernel();
  try {
    for (let index = 0; index < 40; index += 1) {
      addEpisode(kernel, {
        eventId: `evt-bounded-${index}`,
        sessionId: `session-bounded-${index}`,
        localDate: '2026-06-06',
        occurredAt: Date.UTC(2026, 5, 6, 12, index),
        text: `CogMem Memory Context 黑盒第 ${index} 次，需要 sourceContext 原文下钻。`,
      });
    }
    kernel.rebuildMemoryAtlas({ projectId: 'openclaw' });
    const row = kernel.memoryAtlasStore.db.prepare(`
      SELECT COUNT(*) AS count FROM memory_edges
      WHERE project_id='openclaw' AND source_authority='atlas_curator'
        AND relation_type IN ('SAME_ISSUE','FOLLOWS_UP','RELATED_TO')
    `).get() as { count: number };
    expect(row.count).toBeLessThanOrEqual(90);
  } finally {
    kernel.close();
  }
});
