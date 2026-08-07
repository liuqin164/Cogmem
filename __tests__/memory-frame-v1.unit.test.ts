import { describe, expect, test } from 'bun:test';
import { deterministicFrameFallback, memoryFrameJsonSchema, MEMORY_DIMENSIONS, MEMORY_FRAME_JSON_SCHEMA, MEMORY_FRAME_LIMITS, MEMORY_FRAME_REQUIRED_DIMENSIONS, normalizeAlias, validateMemoryFrame } from '../src/semantic/index.js';
import { MemoryFrameStore } from '../src/store/MemoryFrameStore.js';
import Database from 'bun:sqlite';
import { installMultidimensionalMemoryGraph374 } from '../src/migrations/0032_multidimensional_memory_graph_3_7_4.js';
import { createMemoryKernel } from '../src/factory.js';
import { MultidimensionalQueryPlanner } from '../src/recall/index.js';
import { MemoryFrameProjector } from '../src/atlas/MemoryFrameProjector.js';
import { GraphCurator } from '../src/atlas/GraphCurator.js';
import { memoryEdgeId } from '../src/binding/MemoryBindingIdentity.js';

describe('MemoryFrame V1 contract', () => {
  test('normalizes Unicode aliases without changing display labels', () => {
    expect(normalizeAlias('  CogＭｅｍ  ')).toBe('cogmem');
    expect(normalizeAlias('记忆  内核')).toBe('记忆 内核');
  });

  test('fallback contains only deterministic evidence-backed facts', () => {
    const frame = deterministicFrameFallback({
      projectId: 'cogmem', episodeId: 'ep-1',
      events: [{ eventId: 'evt-1', occurredAt: 0 } as never], now: 0,
    });
    expect(frame.sourceAuthority).toBe('deterministic_fallback');
    expect(frame.needsReview).toBe(true);
    expect(validateMemoryFrame(frame).valid).toBe(true);
    expect(frame.evidenceEventIds).toEqual(['evt-1']);
  });

  test('rejects relations whose endpoints are not registered', () => {
    const frame = deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] });
    frame.nodes.push({ frameNodeId: 'topic', dimension: 'topic', label: 'topic', confidence: 1, evidenceEventIds: [] });
    frame.relations.push({ sourceFrameNodeId: 'topic', relationType: 'PARTICIPATED_IN', targetFrameNodeId: 'project', confidence: 1, evidenceEventIds: [] });
    expect(validateMemoryFrame(frame).valid).toBe(false);
    expect(validateMemoryFrame(frame).errors.some((error) => error.startsWith('invalid_memory_frame_relation'))).toBe(true);
  });

  test('returns structured errors for malformed nested model output', () => {
    const frame = deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] });
    expect(validateMemoryFrame({ ...frame, nodes: [{}] }).errors).toEqual(['invalid_memory_frame_nested_shape']);
  });

  test('runtime validation matches revision and nested schema constraints', () => {
    const frame = deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] });
    expect(validateMemoryFrame({ ...frame, revisionNumber: 0 }).errors).toEqual(['invalid_memory_frame_shape']);
    expect(validateMemoryFrame({ ...frame, revisionNumber: 1.5 }).errors).toEqual(['invalid_memory_frame_shape']);
    expect(validateMemoryFrame({ ...frame, revisionId: '' }).errors).toEqual(['invalid_memory_frame_shape']);
    expect(validateMemoryFrame({ ...frame, supersedesFrameId: '' }).errors).toEqual(['invalid_memory_frame_shape']);
    expect(validateMemoryFrame({ ...frame, processor: { ...frame.processor, unknown: true } }).errors).toEqual(['invalid_memory_frame_shape']);
    expect(validateMemoryFrame({ ...frame, nodes: frame.nodes.map((node, index) => index ? node : { ...node, unknown: true }) }).errors).toEqual(['invalid_memory_frame_shape']);
  });

  test('public JSON schema shares runtime dimensions, bounds, and required nodes', () => {
    const schema = MEMORY_FRAME_JSON_SCHEMA as any;
    expect(schema.properties.nodes.minItems).toBe(1);
    expect(schema.properties.nodes.maxItems).toBe(MEMORY_FRAME_LIMITS.nodes);
    expect(schema.properties.nodes.items.properties.dimension.enum).toEqual(MEMORY_DIMENSIONS);
    expect(schema.properties.evidenceEventIds.minItems).toBe(1);
    expect(schema.allOf.map((entry: any) => entry.properties.nodes.contains.properties.dimension.const)).toEqual(MEMORY_FRAME_REQUIRED_DIMENSIONS);
    expect(schema.properties.relations.items.properties.evidenceEventIds.minItems).toBe(1);
    expect(schema.properties.temporalReferences.items.properties.evidenceEventIds.minItems).toBe(1);
    expect(schema.properties.stateTransitions.items.properties.evidenceEventIds.minItems).toBe(1);
    expect(schema.properties.frameId.pattern).toBe('.*\\S.*');
    expect(schema.properties.nodes.items.properties.label.pattern).toBe('.*\\S.*');
    const repairSchema = memoryFrameJsonSchema({ allowEmptyEvidence: true }) as any;
    expect(repairSchema.properties.evidenceEventIds.minItems).toBe(0);
    expect(repairSchema.properties.nodes.items.properties.evidenceEventIds.minItems).toBe(0);
  });

  test('immutable frame identities cannot be redirected by canonical hints', () => {
    const frame = deterministicFrameFallback({ projectId: 'p', episodeId: 'episode-b', events: [] });
    const episode = frame.nodes.find((node) => node.dimension === 'episode');
    expect(episode).toBeDefined();
    episode!.canonicalHint = { nodeId: 'episode:episode-a' };
    expect(validateMemoryFrame(frame, { allowEmptyEvidence: true }).errors).toContain('immutable_identity_hint_mismatch:episode');
  });

  test('stores frames idempotently and publishes with CAS', () => {
    const db = new Database(':memory:');
    installMultidimensionalMemoryGraph374(db);
    seedMemoryFrameEvidence(db);
    const store = new MemoryFrameStore(db);
    const frame = deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] });
    store.save({ frame, sourceFingerprint: 'source-1', dreamJobLeaseId: 'lease-1', attemptGeneration: 1, now: 0 });
    store.save({ frame: { ...frame, frameId: 'different-id' }, sourceFingerprint: 'source-1', dreamJobLeaseId: 'lease-1', attemptGeneration: 1, now: 1 });
    expect(store.list('p', { statuses: ['staged'] })).toHaveLength(1);
    expect(store.publish(frame.frameId, 'staged', 'needs_confirmation', 2)).toBe(true);
    expect(() => store.publish(frame.frameId, 'staged', 'active', 3)).toThrow('memory_frame_publish_conflict');
    expect(store.get(frame.frameId)?.relations).toHaveLength(1);
    db.close();
  });

  test('staged revisions preserve the previous active frame until publish', () => {
    const db = new Database(':memory:');
    installMultidimensionalMemoryGraph374(db);
    seedMemoryFrameEvidence(db);
    const store = new MemoryFrameStore(db);
    const base = deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] });
    const frame = { ...base, evidenceEventIds: ['event-1'], needsReview: false, sourceAuthority: 'processor' as const,
      nodes: base.nodes.map((node) => ({ ...node, evidenceEventIds: ['event-1'] })),
      relations: base.relations.map((relation) => ({ ...relation, evidenceEventIds: ['event-1'] })) };
    const first = store.save({ frame, sourceFingerprint: 'same', status: 'active', now: 1 });
    expect(store.publish(first.frameId, 'staged', 'active', 2)).toBe(true);
    const second = store.save({ frame: { ...frame, title: 'new revision' }, sourceFingerprint: 'same', status: 'active', now: 3 });
    expect(store.get(first.frameId)?.status).toBe('active');
    expect(second.frameId).not.toBe(first.frameId);
    expect(store.get(second.frameId)?.status).toBe('staged');
    store.failStaged([second.frameId], 4);
    expect(store.get(first.frameId)?.status).toBe('active');
    db.close();
  });

  test('review publication preserves the previous active frame', () => {
    const db = new Database(':memory:');
    installMultidimensionalMemoryGraph374(db);
    seedMemoryFrameEvidence(db);
    const store = new MemoryFrameStore(db);
    const frame = { ...deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] }), evidenceEventIds: ['event-1'], needsReview: false, sourceAuthority: 'processor' as const,
      nodes: deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] }).nodes.map((node) => ({ ...node, evidenceEventIds: ['event-1'] })),
      relations: deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] }).relations.map((relation) => ({ ...relation, evidenceEventIds: ['event-1'] })) };
    const first = store.save({ frame, sourceFingerprint: 'a', now: 1 });
    expect(store.publish(first.frameId, 'staged', 'active', 2)).toBe(true);
    const second = store.save({ frame: { ...frame, frameId: 'frame-b' }, sourceFingerprint: 'b', publishStatus: 'needs_confirmation', now: 3 });
    expect(store.publish(second.frameId, 'staged', 'needs_confirmation', 4)).toBe(true);
    expect(store.get(first.frameId)?.status).toBe('active');
    expect(store.get(second.frameId)?.status).toBe('needs_confirmation');
    db.close();
  });

  test('active revision replacement satisfies the one-active partial index', () => {
    const db = new Database(':memory:');
    installMultidimensionalMemoryGraph374(db);
    seedMemoryFrameEvidence(db);
    const store = new MemoryFrameStore(db);
    const base = deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] });
    const frame = { ...base, evidenceEventIds: ['event-1'], needsReview: false, sourceAuthority: 'processor' as const,
      nodes: base.nodes.map((node) => ({ ...node, evidenceEventIds: ['event-1'] })),
      relations: base.relations.map((relation) => ({ ...relation, evidenceEventIds: ['event-1'] })) };
    const first = store.save({ frame, sourceFingerprint: 'first', now: 1 });
    expect(store.publish(first.frameId, 'staged', 'active', 2)).toBe(true);
    const second = store.save({ frame: { ...frame, frameId: 'second-frame', title: 'newer' }, sourceFingerprint: 'second', now: 3 });
    expect(store.publish(second.frameId, 'staged', 'active', 4)).toBe(true);
    expect(store.get(first.frameId)?.status).toBe('superseded');
    expect(store.get(second.frameId)?.status).toBe('active');
    expect(db.prepare(`SELECT COUNT(*) AS count FROM memory_frames WHERE episode_id='e' AND status='active'`).get()).toEqual({ count: 1 });
    db.close();
  });

  test('projects active frames into the existing Atlas graph', () => {
    const kernel = createMemoryKernel();
    const event = kernel.eventStore.append({
      eventId: 'event-1', streamId: 'thread-1', streamType: 'thread',
      eventType: 'MESSAGE', rawEventType: 'message', projectId: 'p',
      sessionId: 'session-1', threadId: 'thread-1', role: 'user',
      occurredAt: 0, payload: { text: 'atlas projection evidence' },
    });
    const episode = kernel.episodeStore.createEpisode({
      projectId: 'p', sessionId: 'session-1', conversationThreadId: 'thread-1',
      episodeType: 'discussion', importance: 0.5, eventId: event.eventId,
      globalSeq: event.globalSeq, occurredAt: event.occurredAt,
    });
    kernel.episodeStore.appendEvent({
      episodeId: episode.episodeId, eventId: event.eventId, relation: 'primary',
      confidence: 1, globalSeq: event.globalSeq, occurredAt: event.occurredAt,
    });
    kernel.rebuildMemoryAtlas({ projectId: 'p' });
    const canonicalProject = kernel.memoryAtlasStore.getNode('project:p', 'p')!;
    const frame = { ...deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] }),
      evidenceEventIds: ['event-1'], needsReview: false, sourceAuthority: 'processor' as const,
      nodes: deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] }).nodes.map((node) => ({ ...node, evidenceEventIds: ['event-1'] })),
      relations: deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] }).relations.map((relation) => ({ ...relation, evidenceEventIds: ['event-1'] })) };
    const storedFrame = { ...frame, episodeId: episode.episodeId };
    const savedFrame = kernel.memoryFrameStore.save({ frame: storedFrame, sourceFingerprint: 'projection-source', status: 'active', now: 0 });
    expect(kernel.memoryFrameStore.get(savedFrame.frameId)?.status).toBe('staged');
    kernel.memoryFrameStore.publish(savedFrame.frameId, 'staged', 'active', 1);
    const result = kernel.rebuildMemoryAtlas({ projectId: 'p' });
    expect(result.documents).toBeGreaterThanOrEqual(2);
    expect(kernel.memoryAtlasStore.getNode(`episode:${episode.episodeId}`, 'p')?.nodeType).toBe('episode');
    expect(kernel.memoryAtlasStore.getNode('project:p', 'p')?.nodeType).toBe('project');
    const projectedProject = kernel.memoryAtlasStore.getNode('project:p', 'p')!;
    const directProjector = new MemoryFrameProjector(kernel.factStore.getDatabase(), kernel.memoryFrameStore, kernel.memoryAtlasStore, 'UTC');
    for (let index = 0; index < 3; index += 1) directProjector.rebuild('p', 10 + index);
    const repeatedProject = kernel.memoryAtlasStore.getNode('project:p', 'p')!;
    expect({ supportCount: repeatedProject.supportCount, evidence: repeatedProject.evidenceEventIds })
      .toEqual({ supportCount: projectedProject.supportCount, evidence: projectedProject.evidenceEventIds });
    kernel.factStore.getDatabase().prepare(`UPDATE memory_atlas_documents SET label=?,summary=?,confidence=?,support_count=? WHERE project_id='p' AND node_id='project:p'`)
      .run('Updated canonical project', 'Updated canonical summary', 0.91, canonicalProject.supportCount + 2);
    directProjector.rebuild('p', 19, { canonicalDocumentsRebuilt: true });
    kernel.memoryFrameStore.supersedeEpisodes([episode.episodeId], 2);
    directProjector.rebuild('p', 20);
    const restoredProject = kernel.memoryAtlasStore.getNode('project:p', 'p')!;
    expect({ label: restoredProject.label, summary: restoredProject.summary, confidence: restoredProject.confidence, supportCount: restoredProject.supportCount, evidence: restoredProject.evidenceEventIds })
      .toEqual({ label: 'Updated canonical project', summary: 'Updated canonical summary', confidence: 0.91, supportCount: canonicalProject.supportCount + 2, evidence: canonicalProject.evidenceEventIds });
    kernel.close();
  });

  test('frame authority wins curator collisions and remains stable across rebuilds', () => {
    const kernel = createMemoryKernel();
    const event = kernel.eventStore.append({
      eventId: 'authority-event', streamId: 'authority-thread', streamType: 'thread', eventType: 'MESSAGE',
      rawEventType: 'message', projectId: 'p', sessionId: 'authority-session', threadId: 'authority-thread',
      localDate: '1970-01-01', role: 'user', occurredAt: 1, payload: { text: 'shared time evidence' },
    });
    const episode = kernel.episodeStore.createEpisode({
      projectId: 'p', sessionId: 'authority-session', conversationThreadId: 'authority-thread',
      episodeType: 'discussion', importance: 0.5, eventId: event.eventId, globalSeq: event.globalSeq, occurredAt: 1,
    });
    kernel.episodeStore.appendEvent({ episodeId: episode.episodeId, eventId: event.eventId, relation: 'primary', confidence: 1, globalSeq: event.globalSeq, occurredAt: 1 });
    const db = kernel.factStore.getDatabase();
    db.prepare(`UPDATE memory_episodes SET status='active' WHERE episode_id=?`).run(episode.episodeId);
    db.prepare(`INSERT INTO memory_atlas_aliases(alias_id,project_id,node_id,normalized_alias,alias,dimension,status,confidence,evidence_event_ids_json,created_at,updated_at) VALUES(?,?,?,?,?,?,'active',1,'[]',1,1)`)
      .run('governed-shared-time', 'p', 'time:p:1970-01-01', '1970-01-01', '1970-01-01', 'time');
    const base = deterministicFrameFallback({ projectId: 'p', episodeId: episode.episodeId, events: [event] });
    const episodeNode = base.nodes.find((node) => node.dimension === 'episode')!;
    const frame = {
      ...base,
      needsReview: false,
      sourceAuthority: 'processor' as const,
      nodes: [...base.nodes, { frameNodeId: 'shared-time', dimension: 'time' as const, label: '1970-01-01', confidence: 0.97, evidenceEventIds: [event.eventId] }],
      relations: [...base.relations, { sourceFrameNodeId: episodeNode.frameNodeId, relationType: 'OCCURRED_ON' as const, targetFrameNodeId: 'shared-time', confidence: 0.97, evidenceEventIds: [event.eventId] }],
    };
    const saved = kernel.memoryFrameStore.save({ frame, sourceFingerprint: 'authority-collision', status: 'active', now: 1 });
    kernel.memoryFrameStore.publish(saved.frameId, 'staged', 'active', 2);
    const edgeId = memoryEdgeId({ projectId: 'p', sourceType: 'episode', sourceId: episode.episodeId, relationType: 'OCCURRED_ON', targetType: 'time', targetId: '1970-01-01' });
    for (let index = 0; index < 2; index += 1) {
      kernel.rebuildMemoryAtlas({ projectId: 'p' });
      expect(db.prepare(`SELECT source_authority,confidence FROM memory_edges WHERE edge_id=?`).get(edgeId))
        .toEqual({ source_authority: 'memory_frame_projector', confidence: 0.97 });
    }
    new GraphCurator(db, kernel.eventStore, kernel.memoryAtlasStore).rebuild('p', 10);
    expect(db.prepare(`SELECT source_authority,confidence FROM memory_edges WHERE edge_id=?`).get(edgeId))
      .toEqual({ source_authority: 'memory_frame_projector', confidence: 0.97 });
    kernel.memoryFrameStore.supersedeEpisodes([episode.episodeId], 11);
    kernel.rebuildMemoryAtlas({ projectId: 'p' });
    const fallback = db.prepare(`SELECT source_authority,confidence,evidence_event_ids_json,status,valid_from,valid_to FROM memory_edges WHERE edge_id=?`).get(edgeId);
    expect(fallback).toMatchObject({ source_authority: 'atlas_curator', confidence: 1, status: 'active' });
    expect(JSON.parse(String((fallback as { evidence_event_ids_json: string }).evidence_event_ids_json))).toEqual([event.eventId]);
    kernel.rebuildMemoryAtlas({ projectId: 'p' });
    expect(db.prepare(`SELECT source_authority,confidence,evidence_event_ids_json,status,valid_from,valid_to FROM memory_edges WHERE edge_id=?`).get(edgeId)).toEqual(fallback);
    kernel.close();
  });

  test('builds a bounded multilingual query frame', () => {
    const frame = new MultidimensionalQueryPlanner().plan('谁参与了 2026 年的 database issue？', Date.UTC(2026, 6, 13));
    expect(frame.schemaVersion).toBe('memory_query_frame.v1');
    expect(frame.intent).toBe('historical_summary');
    expect(frame.time?.from).toBe(Date.UTC(2026, 0, 1));
    expect(frame.issues?.[0]?.label).toBe('issue');
  });

  test('lease retry creates an independent staged revision without changing the source row', () => {
    const db = new Database(':memory:');
    installMultidimensionalMemoryGraph374(db);
    const store = new MemoryFrameStore(db);
    const frame = { ...deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] }),
      evidenceEventIds: ['evt-1'], nodes: deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] }).nodes.map((node) => ({ ...node, evidenceEventIds: ['evt-1'] })),
      relations: deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] }).relations.map((relation) => ({ ...relation, evidenceEventIds: ['evt-1'] })) };
    const first = store.save({ frame, sourceFingerprint: 'stable-source', dreamJobLeaseId: 'lease-a', attemptGeneration: 1, now: 1 });
    const retry = store.save({ frame: { ...frame, frameId: 'retry-frame' }, sourceFingerprint: 'stable-source', dreamJobLeaseId: 'lease-b', attemptGeneration: 2, now: 2 });
    expect(retry.frameId).not.toBe(first.frameId);
    expect(store.get(first.frameId)?.status).toBe('staged');
    expect(store.get(retry.frameId)?.status).toBe('staged');
    expect(db.prepare('SELECT COUNT(*) AS count FROM memory_frame_nodes').get()).toEqual({ count: 4 });
    db.close();
  });

  test('planner resolves a month before the containing year and accepts Chinese inflection', () => {
    const frame = new MultidimensionalQueryPlanner().plan('谁参与了 2026年6月的升级？', Date.UTC(2026, 6, 13));
    expect(frame.actors?.[0]?.label).toBe('谁参与了');
    expect(frame.time).toEqual({ from: Date.UTC(2026, 5, 1), to: Date.UTC(2026, 6, 1), expressions: ['2026年6月'] });
  });

  test('planner resolves relative dates using the supplied project timezone', () => {
    const frame = new MultidimensionalQueryPlanner().plan('今天', { now: Date.UTC(2026, 6, 16, 15, 30), timeZone: 'Asia/Tokyo' });
    expect(frame.time?.from).toBe(Date.UTC(2026, 6, 16, 15));
    expect(frame.time?.to).toBe(Date.UTC(2026, 6, 17, 15));
  });

  test('kernel recomputes the default project-local date for each query', () => {
    const originalNow = Date.now;
    const kernel = createMemoryKernel({ projectTimeZone: 'Asia/Tokyo' });
    try {
      Date.now = () => Date.UTC(2026, 6, 16, 14, 59);
      const before = kernel.planMemoryQuery('今天', { projectId: 'clock-project' }).queryFrame.time;
      Date.now = () => Date.UTC(2026, 6, 16, 15, 1);
      const after = kernel.planMemoryQuery('今天', { projectId: 'clock-project' }).queryFrame.time;
      expect(before?.from).not.toBe(after?.from);
    } finally {
      Date.now = originalNow;
      kernel.close();
    }
  });
});

function seedMemoryFrameEvidence(db: Database): void {
  db.exec(`
    INSERT INTO memory_events(
      event_id,global_seq,stream_id,stream_type,event_type,event_version,project_id,project_scope,
      local_date,role,occurred_at,payload_json,payload_hash
    ) VALUES('event-1',1,'stream-1','thread','MESSAGE',1,'p','p','1970-01-01','user',1,'{}','hash');
    INSERT INTO memory_episode_events(episode_id,event_id,position,relation,confidence,created_at)
    VALUES('e','event-1',0,'primary',1,1);
  `);
}
