import { describe, expect, test } from 'bun:test';
import { deterministicFrameFallback, normalizeAlias, validateMemoryFrame } from '../src/semantic/index.js';
import { MemoryFrameStore } from '../src/store/MemoryFrameStore.js';
import Database from 'bun:sqlite';
import { migration_0032, migration_0035, migration_0036 } from '../src/migrations/index.js';
import { createMemoryKernel } from '../src/factory.js';
import { MultidimensionalQueryPlanner } from '../src/recall/index.js';

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

  test('stores frames idempotently and publishes with CAS', () => {
    const db = new Database(':memory:');
    migration_0032.up(db);
    migration_0035.up(db);
    const store = new MemoryFrameStore(db);
    const frame = deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] });
    store.save({ frame, sourceFingerprint: 'source-1', now: 0 });
    store.save({ frame: { ...frame, frameId: 'different-id' }, sourceFingerprint: 'source-1', now: 1 });
    expect(store.list('p', { statuses: ['staged'] })).toHaveLength(1);
    expect(store.publish(frame.frameId, 'staged', 'needs_confirmation', 2)).toBe(true);
    expect(store.publish(frame.frameId, 'staged', 'active', 3)).toBe(false);
    expect(store.get(frame.frameId)?.relations).toHaveLength(1);
    db.close();
  });

  test('staged revisions preserve the previous active frame until publish', () => {
    const db = new Database(':memory:');
    migration_0032.up(db); migration_0035.up(db);
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
    migration_0032.up(db); migration_0035.up(db); migration_0036.up(db);
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

  test('projects active frames into the existing Atlas graph', () => {
    const kernel = createMemoryKernel();
    const frame = { ...deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] }),
      evidenceEventIds: ['event-1'], needsReview: false, sourceAuthority: 'processor' as const,
      nodes: deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] }).nodes.map((node) => ({ ...node, evidenceEventIds: ['event-1'] })),
      relations: deterministicFrameFallback({ projectId: 'p', episodeId: 'e', events: [] }).relations.map((relation) => ({ ...relation, evidenceEventIds: ['event-1'] })) };
    kernel.memoryFrameStore.save({ frame, sourceFingerprint: 'projection-source', status: 'active', now: 0 });
    kernel.memoryFrameStore.publish(frame.frameId, 'staged', 'active', 1);
    const result = kernel.rebuildMemoryAtlas({ projectId: 'p' });
    expect(result.documents).toBeGreaterThanOrEqual(2);
    expect(kernel.memoryAtlasStore.getNode('episode:e', 'p')?.nodeType).toBe('episode');
    expect(kernel.memoryAtlasStore.getNode('project:p', 'p')?.nodeType).toBe('project');
    kernel.close();
  });

  test('builds a bounded multilingual query frame', () => {
    const frame = new MultidimensionalQueryPlanner().plan('谁参与了 2026 年的 database issue？', Date.UTC(2026, 6, 13));
    expect(frame.schemaVersion).toBe('memory_query_frame.v1');
    expect(frame.intent).toBe('historical_summary');
    expect(frame.time?.from).toBe(Date.UTC(2026, 0, 1));
    expect(frame.issues?.[0]?.label).toBe('issue');
  });
});
