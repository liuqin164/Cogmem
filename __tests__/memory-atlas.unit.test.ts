import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';

function createFixture(): { kernel: MemoryKernel; hermesEventId: string; privateEventId: string; hermesEntityId: string; hermesClusterId: string } {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-atlas-')), 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  const hermes = kernel.eventStore.append({
    eventId: 'evt-hermes-config', streamId: 'thread-hermes', streamType: 'thread', eventType: 'MESSAGE',
    rawEventType: 'message', projectId: 'cogmem', sessionId: 'session-hermes', role: 'user',
    occurredAt: Date.UTC(2025, 5, 1), payload: { text: '去年请给 Hermes 配置 MCP，并把它连接到 Cogmem。' },
  });
  const privateEvent = kernel.eventStore.append({
    eventId: 'evt-private-hermes', streamId: 'thread-private', streamType: 'thread', eventType: 'MESSAGE',
    rawEventType: 'message', projectId: 'private', sessionId: 'session-private', role: 'user',
    occurredAt: Date.UTC(2025, 5, 2), payload: { text: 'Configure Hermes private secret integration' },
  });
  const entity = kernel.memoryBindingStore.upsertEntity({ projectId: 'cogmem', canonicalName: 'Hermes', entityType: 'project', now: hermes.occurredAt });
  const privateEntity = kernel.memoryBindingStore.upsertEntity({ projectId: 'private', canonicalName: 'Hermes Secret', entityType: 'project', now: privateEvent.occurredAt });
  kernel.memoryBindingStore.upsertTopic({ projectId: 'cogmem', topicPath: 'cogmem/hermes', topicType: 'project', summary: 'Hermes integration', now: hermes.occurredAt });
  kernel.memoryBindingStore.upsertTopic({ projectId: 'private', topicPath: 'private/hermes', topicType: 'project', summary: 'must not leak', now: privateEvent.occurredAt });
  const binding = kernel.memoryBindingStore.insertBinding({
    eventId: hermes.eventId, projectId: 'cogmem', role: 'user', rawEventType: 'message',
    entityId: entity.entityId, entityName: 'Hermes', entityType: 'project', topicPath: 'cogmem/hermes',
    bindingType: 'about', confidence: 0.96, source: 'deterministic', signal: 'Hermes', claimKey: 'hermes-mcp', createdAt: hermes.occurredAt,
  });
  kernel.memoryBindingStore.insertBinding({
    eventId: privateEvent.eventId, projectId: 'private', role: 'user', rawEventType: 'message',
    entityId: privateEntity.entityId, entityName: 'Hermes Secret', entityType: 'project', topicPath: 'private/hermes',
    bindingType: 'about', confidence: 0.99, source: 'deterministic', signal: 'secret', claimKey: 'secret', createdAt: privateEvent.occurredAt,
  });
  const cluster = kernel.memoryBindingStore.upsertCluster({
    projectId: 'cogmem', topicPath: 'cogmem/hermes', clusterType: 'decision', title: 'Hermes deployment decision',
    summary: 'Decision to configure Hermes MCP integration', claimKey: binding.claimKey, status: 'active', confidence: 0.95,
    eventId: hermes.eventId, now: hermes.occurredAt,
  });
  kernel.memoryBindingStore.upsertEdge({
    projectId: 'cogmem', sourceType: 'entity', sourceId: entity.entityId, relationType: 'ABOUT',
    targetType: 'cluster', targetId: cluster.clusterId, confidence: 0.95, activation: 0,
    evidenceEventIds: [hermes.eventId], createdAt: hermes.occurredAt,
  });
  return { kernel, hermesEventId: hermes.eventId, privateEventId: privateEvent.eventId, hermesEntityId: entity.entityId, hermesClusterId: cluster.clusterId };
}

test('overview and search expose bounded project-scoped memory nodes', () => {
  const { kernel } = createFixture();
  try {
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    const overview = kernel.graphOverview({ projectId: 'cogmem', limit: 100 });
    expect(overview.version).toBe('memory_atlas.v1');
    expect(overview.nodes.length).toBeLessThanOrEqual(30);
    expect(overview.nodes.some((node) => node.id === 'project:cogmem')).toBe(true);
    expect(overview.nodes.some((node) => node.label === 'Hermes')).toBe(true);
    expect(overview.nodes.some((node) => node.label.includes('Secret'))).toBe(false);

    const search = kernel.graphSearch('Hermes', { projectId: 'cogmem' });
    expect(search.nodes.some((node) => node.nodeType === 'entity')).toBe(true);
    expect(search.nodes.every((node) => node.projectId === 'cogmem')).toBe(true);
  } finally { kernel.close(); }
});

test('Atlas projects user-shaped topic names and aliases from the governed topic registry', () => {
  const { kernel, hermesEventId } = createFixture();
  try {
    const created = kernel.topicGovernance.apply({
      projectId: 'cogmem', operationType: 'USER_DEFINED_TOPIC_CREATE', actor: 'user_explicit',
      payload: { topicPath: 'cogmem/episode-assembler', canonicalName: '事件组装器', ontologyClass: 'Topic' },
      evidenceEventIds: [hermesEventId],
    });
    kernel.topicGovernance.apply({
      projectId: 'cogmem', operationType: 'USER_DEFINED_TOPIC_ALIAS', actor: 'user_explicit', targetTopicId: created.targetTopicId,
      payload: { alias: '聊天事件归类器' }, evidenceEventIds: [hermesEventId],
    });
    const dream = kernel.topicGovernance.apply({
      projectId: 'cogmem', operationType: 'USER_DEFINED_TOPIC_CREATE', actor: 'user_explicit',
      payload: { topicPath: 'cogmem/dream', canonicalName: 'Dream', ontologyClass: 'Topic' }, evidenceEventIds: [hermesEventId],
    });
    kernel.topicGovernance.apply({
      projectId: 'cogmem', operationType: 'USER_DEFINED_TOPIC_RELATION_ADD', actor: 'user_explicit', targetTopicId: created.targetTopicId,
      payload: { relation: 'PRECEDES', targetTopicId: dream.targetTopicId }, evidenceEventIds: [hermesEventId],
    });
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    const result = kernel.graphSearch('聊天事件归类器', { projectId: 'cogmem' });
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeType: 'topic', label: '事件组装器', topicPath: 'cogmem/episode-assembler' }),
    ]));
    const path = kernel.graphPath('topic:cogmem:cogmem/episode-assembler', 'topic:cogmem:cogmem/dream', { projectId: 'cogmem' });
    expect(path.edges).toEqual(expect.arrayContaining([expect.objectContaining({ relation: 'PRECEDES' })]));
  } finally { kernel.close(); }
});

test('time nodes remain project scoped when multiple projects contain the same year', () => {
  const { kernel } = createFixture();
  try {
    kernel.rebuildMemoryAtlas();
    expect(kernel.graphNode('time:cogmem:2025', { projectId: 'cogmem' })?.projectId).toBe('cogmem');
    expect(kernel.graphNode('time:private:2025', { projectId: 'private' })?.projectId).toBe('private');
    expect(kernel.graphNode('time:private:2025', { projectId: 'cogmem' })).toBeNull();
  } finally { kernel.close(); }
});

test('Atlas refresh is source-driven and skips unchanged projects', () => {
  const { kernel } = createFixture();
  try {
    const first = kernel.ensureMemoryAtlas({ projectId: 'cogmem' });
    expect(first.refreshed).toBe(true);
    const unchanged = kernel.ensureMemoryAtlas({ projectId: 'cogmem' });
    expect(unchanged.refreshed).toBe(false);

    kernel.memoryBindingStore.upsertEntity({
      projectId: 'cogmem', canonicalName: 'OpenClaw', entityType: 'project', now: Date.UTC(2025, 6, 1),
    });
    const changed = kernel.ensureMemoryAtlas({ projectId: 'cogmem' });
    expect(changed.refreshed).toBe(true);
    expect(kernel.graphSearch('OpenClaw', { projectId: 'cogmem' }).nodes.some((node) => node.label === 'OpenClaw')).toBe(true);
  } finally { kernel.close(); }
});

test('graph node returns evidence locators but hides raw excerpts by default', () => {
  const { kernel, hermesEntityId, hermesEventId, privateEventId } = createFixture();
  try {
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    kernel.memoryAtlasStore.db.prepare(`UPDATE memory_atlas_documents SET evidence_event_ids_json=? WHERE node_id=?`).run(JSON.stringify([privateEventId]), `entity:${hermesEntityId}`);
    kernel.memoryAtlasStore.db.prepare(`UPDATE memory_edges SET evidence_event_ids_json=? WHERE project_id=?`).run(JSON.stringify([privateEventId, hermesEventId]), 'cogmem');
    const node = kernel.graphNode(`entity:${hermesEntityId}`, { projectId: 'cogmem' });
    expect(node?.evidence[0]?.eventId).toBe(hermesEventId);
    expect(node?.evidence.some((item) => item.eventId === privateEventId)).toBe(false);
    expect(node?.evidence[0]?.drilldown).toContain(`memory show --event ${hermesEventId}`);
    expect(node?.evidence[0]?.excerpt).toBeUndefined();
    expect(node?.evidenceTotal).toBeGreaterThanOrEqual(node?.evidenceReturned || 0);
    expect(node?.evidenceReturned).toBe(node?.evidence.length);
    expect(node?.neighbors.flatMap((edge) => edge.evidenceEventIds)).not.toContain(privateEventId);
    expect(node?.neighbors.flatMap((edge) => edge.evidenceEventIds)).toContain(hermesEventId);

    const withEvidence = kernel.graphNode(`entity:${hermesEntityId}`, { projectId: 'cogmem', includeEvidence: true });
    expect(withEvidence?.evidence[0]?.excerpt).toContain('Hermes');
  } finally { kernel.close(); }
});

test('neighbors enforces the two-hop hard limit', () => {
  const { kernel, hermesEntityId } = createFixture();
  try {
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    expect(() => kernel.graphNeighbors(`entity:${hermesEntityId}`, { projectId: 'cogmem', hops: 3 })).toThrow('hops must be between 1 and 2');
    const result = kernel.graphNeighbors(`entity:${hermesEntityId}`, { projectId: 'cogmem', hops: 2 });
    expect(result.nodes.length).toBeLessThanOrEqual(30);
  } finally { kernel.close(); }
});

test('exact entity time and action constraints resurrect a cold memory as an action timeline', () => {
  const { kernel, hermesEventId } = createFixture();
  try {
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    const timeline = kernel.graphTimeline('去年我让你对 Hermes 做过什么操作', {
      projectId: 'cogmem',
      now: Date.UTC(2026, 5, 21),
    });
    expect(timeline.temporalResurrection).toBe(true);
    expect(timeline.actions.length).toBeGreaterThan(0);
    expect(timeline.actions[0]?.targetLabel).toBe('Hermes');
    expect(timeline.actions[0]?.evidence[0]?.eventId).toBe(hermesEventId);
  } finally { kernel.close(); }
});

test('timeline uses the available facets and can reconstruct decisions without requiring an action frame', () => {
  const { kernel, hermesClusterId } = createFixture();
  try {
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    const timeline = kernel.graphTimeline('2025 年 Hermes 的决策', { projectId: 'cogmem' });
    expect(timeline.temporalResurrection).toBe(true);
    expect(timeline.nodes.some((node) => node.id === `cluster:${hermesClusterId}`)).toBe(true);
  } finally { kernel.close(); }
});

test('explore resurrects cold memory with generic table-like facets, not only action frames', () => {
  const { kernel } = createFixture();
  try {
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    const result = kernel.graphExplore('2025 年 Hermes 的决策', {
      projectId: 'cogmem', now: Date.UTC(2026, 5, 21),
    }) as unknown as Record<string, unknown>;
    expect(result.coldMemoryResurrected).toBe(true);
    expect(result.facets).toEqual(expect.objectContaining({ memoryKinds: ['decision'] }));
    expect((result.nodes as Array<Record<string, unknown>>).some((node) => node.nodeType === 'cluster')).toBe(true);
  } finally { kernel.close(); }
});

test('one precise available facet can revive cold memory without a fixed tuple', () => {
  const { kernel } = createFixture();
  try {
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    const result = kernel.graphExplore('Hermes', { projectId: 'cogmem' });
    expect(result.coldMemoryResurrected).toBe(true);
  } finally { kernel.close(); }
});

test('facet-only time queries never fall back to an unfiltered node list', () => {
  const { kernel } = createFixture();
  try {
    kernel.memoryAtlasStore.upsertDocument({ id: 'event:old', projectId: 'cogmem', nodeType: 'event', sourceId: 'old',
      label: 'old event', confidence: 1, supportCount: 1, status: 'active', occurredAt: Date.UTC(2024, 2, 1) });
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    const result = kernel.graphExplore('去年', { projectId: 'cogmem', now: Date.UTC(2026, 5, 21), limit: 30 });
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.nodes.every((node) => !node.occurredAt || new Date(node.occurredAt).getUTCFullYear() === 2025)).toBe(true);
    expect(result.nodes.some((node) => node.id === 'event:old')).toBe(false);
  } finally { kernel.close(); }
});

test('target time and kind facets are intersected exactly like table filters', () => {
  const { kernel, hermesClusterId } = createFixture();
  try {
    const openclawEvent = kernel.eventStore.append({
      eventId: 'evt-openclaw-decision', streamId: 'thread-openclaw', streamType: 'thread', eventType: 'MESSAGE',
      rawEventType: 'message', projectId: 'cogmem', sessionId: 'session-openclaw', role: 'user',
      occurredAt: Date.UTC(2025, 4, 1), payload: { text: 'OpenClaw deployment decision' },
    });
    kernel.memoryBindingStore.upsertCluster({ projectId: 'cogmem', topicPath: 'cogmem/openclaw', clusterType: 'decision',
      title: 'OpenClaw decision', summary: 'unrelated decision', status: 'active', confidence: 0.99,
      claimKey: 'openclaw-decision', eventId: openclawEvent.eventId, now: Date.UTC(2025, 5, 1) });
    kernel.memoryBindingStore.upsertCluster({ projectId: 'cogmem', topicPath: 'cogmem/hermes', clusterType: 'goal',
      title: 'Hermes goal', summary: 'unrelated memory kind', status: 'active', confidence: 0.99,
      claimKey: 'hermes-goal', eventId: 'evt-hermes-config', now: Date.UTC(2025, 5, 1) });
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    const result = kernel.graphExplore('2025 年 Hermes 的决策', { projectId: 'cogmem', limit: 30 });
    expect(result.nodes.some((node) => node.id === `cluster:${hermesClusterId}`)).toBe(true);
    expect(result.nodes.filter((node) => node.nodeType === 'cluster').every((node) => node.id === `cluster:${hermesClusterId}`)).toBe(true);
  } finally { kernel.close(); }
});

test('memory kind filtering uses structured kind fields rather than summary text', () => {
  const { kernel } = createFixture();
  try {
    kernel.memoryBindingStore.upsertCluster({ projectId: 'cogmem', topicPath: 'cogmem/hermes', clusterType: 'diagnostic',
      title: 'Diagnostic mentioning plan', summary: 'The word plan appears but this is not a plan memory',
      status: 'active', confidence: 0.9, claimKey: 'diagnostic-plan-word', eventId: 'evt-hermes-config', now: Date.UTC(2025, 5, 1) });
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    const result = kernel.graphExplore('Hermes plan', { projectId: 'cogmem', limit: 30 });
    expect(result.nodes.some((node) => node.label === 'Diagnostic mentioning plan')).toBe(false);
  } finally { kernel.close(); }
});

test('ActionFrame extraction scans raw events, captures every action, and aggregates year evidence', () => {
  const { kernel, hermesEventId } = createFixture();
  try {
    const unbound = kernel.eventStore.append({
      eventId: 'evt-hermes-update', streamId: 'thread-hermes', streamType: 'thread', eventType: 'MESSAGE',
      rawEventType: 'message', projectId: 'cogmem', sessionId: 'session-hermes', role: 'user',
      occurredAt: Date.UTC(2025, 7, 1), payload: { text: '请更新 Hermes。' },
    });
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    const actions = kernel.graphTimeline('2025 Hermes 操作', { projectId: 'cogmem', limit: 30 }).actions;
    expect(actions.map((action) => action.action)).toEqual(expect.arrayContaining(['配置', '连接', '更新']));
    expect(actions.flatMap((action) => action.evidence.map((item) => item.eventId))).toEqual(expect.arrayContaining([hermesEventId, unbound.eventId]));
    const year = kernel.graphNode('time:cogmem:2025', { projectId: 'cogmem', evidenceLimit: 10 });
    expect(year?.supportCount).toBeGreaterThanOrEqual(2);
    expect(year?.evidence.map((item) => item.eventId)).toEqual(expect.arrayContaining([hermesEventId, unbound.eventId]));
  } finally { kernel.close(); }
});

test('path and explore return a bounded source-anchored local graph without vectors', () => {
  const { kernel, hermesEntityId } = createFixture();
  try {
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    const explore = kernel.graphExplore('Hermes 去年配置操作', { projectId: 'cogmem', limit: 8 });
    expect(explore.nodes.length).toBeLessThanOrEqual(8);
    expect(explore.nextActions.some((action) => action.tool === 'cogmem_graph_node')).toBe(true);
    const action = explore.nodes.find((node) => node.nodeType === 'action');
    expect(action).toBeDefined();
    const path = kernel.graphPath(`entity:${hermesEntityId}`, action!.id, { projectId: 'cogmem' });
    expect(path.path[0]?.id).toBe(`entity:${hermesEntityId}`);
    expect(path.path.at(-1)?.id).toBe(action!.id);
  } finally { kernel.close(); }
});

test('precise path lookup is not hidden by thousands of newer higher-confidence edges', () => {
  const { kernel, hermesEntityId, hermesClusterId } = createFixture();
  try {
    const db = kernel.memoryAtlasStore.db;
    const insert = db.prepare(`INSERT INTO memory_edges(
      edge_id,project_id,source_type,source_id,relation_type,target_type,target_id,confidence,stability,activation,status,evidence_event_ids_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    db.transaction(() => {
      for (let index = 0; index < 4100; index += 1) {
        insert.run(`noise-${index}`, 'cogmem', 'entity', hermesEntityId, 'ABOUT', 'cluster', `noise-target-${index}`, 1, 1, 0, 'active', '[]', index + 1, index + 1);
      }
    })();
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    const path = kernel.graphPath(`entity:${hermesEntityId}`, `cluster:${hermesClusterId}`, { projectId: 'cogmem' });
    expect(path.path.map((node) => node.id)).toEqual([`entity:${hermesEntityId}`, `cluster:${hermesClusterId}`]);
    const action = kernel.graphExplore('Hermes 配置', { projectId: 'cogmem' }).nodes.find((node) => node.nodeType === 'action');
    expect(action).toBeDefined();
    const actionPath = kernel.graphPath(`entity:${hermesEntityId}`, action!.id, { projectId: 'cogmem' });
    expect(actionPath.path.map((node) => node.id)).toEqual([`entity:${hermesEntityId}`, action!.id]);
  } finally { kernel.close(); }
});

test('path traversal expands every bounded frontier chunk instead of only the first 30 nodes', () => {
  const { kernel, hermesEntityId } = createFixture();
  try {
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    const start = `entity:${hermesEntityId}`;
    const insert = kernel.memoryAtlasStore.db.prepare(`INSERT INTO memory_edges(
      edge_id,project_id,source_type,source_id,relation_type,target_type,target_id,confidence,stability,activation,status,evidence_event_ids_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (let index = 0; index < 31; index += 1) {
      kernel.memoryAtlasStore.upsertDocument({ id: `cluster:branch-${index}`, projectId: 'cogmem', nodeType: 'cluster', sourceId: `branch-${index}`,
        label: `branch ${index}`, confidence: 1, supportCount: 1, status: 'active' });
      insert.run(`frontier-${index}`, 'cogmem', 'entity', hermesEntityId, 'ABOUT', 'cluster', `branch-${index}`,
        index === 30 ? 0.1 : 1, 1, 0, 'active', '[]', index, index);
    }
    kernel.memoryAtlasStore.upsertDocument({ id: 'cluster:middle', projectId: 'cogmem', nodeType: 'cluster', sourceId: 'middle',
      label: 'middle', confidence: 1, supportCount: 1, status: 'active' });
    kernel.memoryAtlasStore.upsertDocument({ id: 'cluster:target', projectId: 'cogmem', nodeType: 'cluster', sourceId: 'target',
      label: 'target', confidence: 1, supportCount: 1, status: 'active' });
    insert.run('hidden-middle', 'cogmem', 'cluster', 'branch-30', 'RELATED_TO', 'cluster', 'middle', 1, 1, 0, 'active', '[]', 100, 100);
    insert.run('middle-target', 'cogmem', 'cluster', 'middle', 'RELATED_TO', 'cluster', 'target', 1, 1, 0, 'active', '[]', 101, 101);

    const path = kernel.memoryAtlasService.path(start, 'cluster:target', { projectId: 'cogmem', maxHops: 3 });
    expect(path.path.map((node) => node.id)).toEqual([start, 'cluster:branch-30', 'cluster:middle', 'cluster:target']);
  } finally { kernel.close(); }
});

test('path ranking prefers a stronger evidence route over a weak shorter BFS route', () => {
  const { kernel, hermesEntityId } = createFixture();
  try {
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });
    const db = kernel.memoryAtlasStore.db;
    kernel.memoryAtlasStore.upsertDocument({ id: 'cluster:strong-middle', projectId: 'cogmem', nodeType: 'cluster', sourceId: 'strong-middle',
      label: 'strong middle', confidence: 1, supportCount: 2, status: 'active' });
    kernel.memoryAtlasStore.upsertDocument({ id: 'cluster:weighted-target', projectId: 'cogmem', nodeType: 'cluster', sourceId: 'weighted-target',
      label: 'weighted target', confidence: 1, supportCount: 2, status: 'active' });
    const insert = db.prepare(`INSERT INTO memory_edges(
      edge_id,project_id,source_type,source_id,relation_type,target_type,target_id,confidence,stability,activation,status,evidence_event_ids_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insert.run('weak-shortcut', 'cogmem', 'entity', hermesEntityId, 'RELATED_TO', 'cluster', 'weighted-target', 0.1, 1, 0, 'active', '[]', 1, 1);
    insert.run('strong-first', 'cogmem', 'entity', hermesEntityId, 'ABOUT', 'cluster', 'strong-middle', 0.98, 1, 0, 'active', '[]', 2, 2);
    insert.run('strong-second', 'cogmem', 'cluster', 'strong-middle', 'SUPPORTS', 'cluster', 'weighted-target', 0.98, 1, 0, 'active', '[]', 3, 3);
    const result = kernel.graphPath(`entity:${hermesEntityId}`, 'cluster:weighted-target', { projectId: 'cogmem', maxHops: 3 });
    expect(result.path.map((node) => node.id)).toEqual([`entity:${hermesEntityId}`, 'cluster:strong-middle', 'cluster:weighted-target']);
  } finally { kernel.close(); }
});
