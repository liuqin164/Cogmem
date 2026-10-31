import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { deterministicFrameFallback } from '../src/semantic/DeterministicFrameFallback.js';
import { validateMemoryFrame } from '../src/semantic/MemoryFrameValidator.js';
import { StructuredSemanticProcessor } from '../src/semantic/StructuredSemanticProcessor.js';
import { makeTempDir } from './helpers/tmp.js';

function createKernel(): MemoryKernel {
  return createMemoryKernel({ dbPath: join(makeTempDir('cogmem-frame-relations-'), 'memory.db') });
}

function frameWithRelations(relations: Array<{ sourceFrameNodeId: string; relationType: string; targetFrameNodeId: string }>) {
  const base = deterministicFrameFallback({
    projectId: 'p',
    episodeId: 'ep-1',
    events: [{ eventId: 'evt-1', occurredAt: 0 } as never],
    now: 0,
  });
  return {
    ...base,
    sourceAuthority: 'processor' as const,
    needsReview: false,
    evidenceEventIds: ['evt-1'],
    nodes: [
      ...base.nodes,
      { frameNodeId: 'n-event', dimension: 'event' as const, label: '部署决定', confidence: 0.9, evidenceEventIds: ['evt-1'] },
      { frameNodeId: 'n-topic', dimension: 'topic' as const, label: '部署', confidence: 0.9, evidenceEventIds: ['evt-1'] },
      { frameNodeId: 'n-episode', dimension: 'episode' as const, label: 'ep-1', confidence: 1, evidenceEventIds: ['evt-1'] },
      { frameNodeId: 'n-project', dimension: 'project' as const, label: 'p', confidence: 1, evidenceEventIds: ['evt-1'] },
      { frameNodeId: 'n-actor', dimension: 'actor' as const, label: '用户', confidence: 0.9, evidenceEventIds: ['evt-1'] },
      { frameNodeId: 'n-object', dimension: 'object' as const, label: '钓鱼', confidence: 0.9, evidenceEventIds: ['evt-1'] },
      { frameNodeId: 'n-entity', dimension: 'entity' as const, label: '张伟', confidence: 0.9, evidenceEventIds: ['evt-1'] },
    ],
    relations: relations.map((relation) => ({ ...relation, confidence: 0.9, evidenceEventIds: ['evt-1'] })),
  };
}

test('a preference and a relationship are relations a frame may carry', () => {
  const kernel = createKernel();
  try {
    const frame = frameWithRelations([
      { sourceFrameNodeId: 'n-actor', relationType: 'LIKES', targetFrameNodeId: 'n-object' },
      { sourceFrameNodeId: 'n-actor', relationType: 'FRIEND_OF', targetFrameNodeId: 'n-entity' },
      { sourceFrameNodeId: 'n-actor', relationType: 'FAMILY_OF', targetFrameNodeId: 'n-entity' },
    ]);
    // The vocabulary is what the model is allowed to use; these three are in it.
    expect(validateMemoryFrame(frame).valid).toBe(true);

    const saved = kernel.memoryFrameStore.save({ frame, sourceFingerprint: 'fp', status: 'active' });
    const rows = kernel.memoryFrameStore.getDatabase()
      .prepare(`SELECT relation_type FROM memory_frame_relations WHERE frame_id=?`)
      .all(saved.frameId) as Array<{ relation_type: string }>;
    expect(rows.map((row) => row.relation_type).sort()).toEqual(['FAMILY_OF', 'FRIEND_OF', 'LIKES']);
  } finally {
    kernel.close();
  }
});

test('a relation the model invented is kept as RELATED_TO instead of dropping the frame', () => {
  const kernel = createKernel();
  try {
    const frame = frameWithRelations([
      { sourceFrameNodeId: 'n-actor', relationType: 'ADMIRES', targetFrameNodeId: 'n-entity' },
    ]);
    const saved = kernel.memoryFrameStore.save({ frame, sourceFingerprint: 'fp', status: 'active' });
    const rows = kernel.memoryFrameStore.getDatabase()
      .prepare(`SELECT relation_type FROM memory_frame_relations WHERE frame_id=?`)
      .all(saved.frameId) as Array<{ relation_type: string }>;
    // The claim survives under the vocabulary's catch-all rather than failing
    // validation and losing the whole reading.
    expect(rows.map((row) => row.relation_type)).toEqual(['RELATED_TO']);
  } finally {
    kernel.close();
  }
});

test('the reading path keeps a claim whose relation the vocabulary does not know', async () => {
  // The processor validates what the model returned before anything stores it:
  // if the rewrite did not happen there, one invented word would throw and lose
  // the whole reading — which is what the vocabulary's catch-all exists for.
  const processor = new StructuredSemanticProcessor(async () => frameWithRelations([
    { sourceFrameNodeId: 'n-actor', relationType: 'ADMIRES', targetFrameNodeId: 'n-entity' },
  ]));
  const frame = await processor.process({
    projectId: 'p',
    episodeId: 'ep-1',
    events: [{ eventId: 'evt-1', occurredAt: 0 } as never],
  });
  expect(frame.relations.map((relation) => relation.relationType)).toEqual(['RELATED_TO']);
});

test('a known relation used between the wrong dimensions keeps the frame', async () => {
  // Measured on the box: the model wrote `event -[INVOLVES]-> topic`, which the
  // registry does not allow (INVOLVES takes an entity or an object), and the
  // whole frame was rejected instead of the one claim being generalised —
  // exactly what already happens for a relation the vocabulary never knew.
  const kernel = createKernel();
  try {
    const frame = frameWithRelations([{ sourceFrameNodeId: 'n-event', relationType: 'INVOLVES', targetFrameNodeId: 'n-topic' }]);
    const processor = new StructuredSemanticProcessor(async () => frame);
    const processed = await processor.process({ projectId: 'p', episodeId: 'ep-1', episodeType: 'discussion', events: [{ eventId: 'evt-1', occurredAt: 0 } as never] });
    expect(processed.relations.map((relation) => relation.relationType)).toEqual(['RELATED_TO']);
    expect(validateMemoryFrame(processed).valid).toBe(true);
  } finally {
    kernel.close();
  }
});
