import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { projectFrameRelationsToBeliefs } from '../src/belief/FrameRelationBeliefs.js';
import { deterministicFrameFallback } from '../src/semantic/DeterministicFrameFallback.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #102: a preference or a relationship must be queryable through the **belief** path,
 * not only stored in a frame.
 *
 * The frame layer answers "what did this episode say"; the belief layer answers "what is
 * true now and what did it replace", and that is the one a host's recall reads. The
 * ticket's acceptance was written in two halves and only the first (storable) was
 * implemented before the review caught it, so these tests go through the beliefs table.
 */
function createKernel(): MemoryKernel {
  return createMemoryKernel({ dbPath: join(makeTempDir('cogmem-frame-beliefs-'), 'memory.db') });
}

/** One real event with an episode link, so a frame built from it can be published. */
function seedEvent(
  kernel: MemoryKernel,
  text = '我喜欢钓鱼。',
  when: { eventId?: string; occurredAt?: number } = {},
): { eventId: string; episodeId: string; occurredAt: number } {
  const eventId = when.eventId ?? 'evt-1';
  const occurredAt = when.occurredAt ?? Date.UTC(2026, 5, 5, 12, 0, 0);
  const event = kernel.eventStore.append({
    eventId,
    streamId: 'session-1',
    streamType: 'thread',
    eventType: 'MESSAGE',
    rawEventType: 'message',
    projectId: 'p',
    sessionId: 'session-1',
    threadId: 'session-1',
    role: 'user',
    occurredAt,
    localDate: new Date(occurredAt).toISOString().slice(0, 10),
    payload: { text },
  });
  kernel.appendRawEventToEpisode(event, { projectId: 'p', sessionId: 'session-1', sourceAgent: 'test', now: occurredAt });
  // The assembler decides the episode id; a hand-written 'ep-1' would not be the one the
  // event is linked to, and `hasPublishableEvidence` joins on exactly that link.
  const link = kernel.memoryFrameStore.getDatabase()
    .prepare('SELECT episode_id FROM memory_episode_events WHERE event_id=?')
    .get(eventId) as { episode_id?: string } | null;
  return { eventId, episodeId: link?.episode_id ?? '', occurredAt };
}

function frameWith(
  evidence: { eventId: string; episodeId: string; occurredAt: number },
  relations: Array<{ sourceFrameNodeId: string; relationType: string; targetFrameNodeId: string }>,
) {
  const base = deterministicFrameFallback({
    projectId: 'p',
    episodeId: evidence.episodeId,
    events: [{ eventId: evidence.eventId, occurredAt: evidence.occurredAt } as never],
    now: evidence.occurredAt,
  });
  return {
    ...base,
    sourceAuthority: 'processor' as const,
    needsReview: false,
    evidenceEventIds: [evidence.eventId],
    nodes: [
      ...base.nodes,
      { frameNodeId: 'n-actor', dimension: 'actor' as const, label: '用户', confidence: 0.9, evidenceEventIds: [evidence.eventId] },
      { frameNodeId: 'n-fishing', dimension: 'object' as const, label: '钓鱼', confidence: 0.9, evidenceEventIds: [evidence.eventId] },
      { frameNodeId: 'n-hiking', dimension: 'object' as const, label: '登山', confidence: 0.9, evidenceEventIds: [evidence.eventId] },
      { frameNodeId: 'n-li', dimension: 'actor' as const, label: '李四', confidence: 0.9, evidenceEventIds: [evidence.eventId] },
      { frameNodeId: 'n-wang', dimension: 'actor' as const, label: '王五', confidence: 0.9, evidenceEventIds: [evidence.eventId] },
    ],
    relations: relations.map((relation) => ({ ...relation, confidence: 0.9, evidenceEventIds: [evidence.eventId] })),
  };
}

test('a published frame puts its preference in the belief path, where it can be queried', () => {
  const kernel = createKernel();
  try {
    const evidence = seedEvent(kernel);
    const frame = frameWith(evidence, [{ sourceFrameNodeId: 'n-actor', relationType: 'LIKES', targetFrameNodeId: 'n-fishing' }]);
    const saved = kernel.memoryFrameStore.save({ frame, sourceFingerprint: 'fp', publishStatus: 'active' });
    expect(kernel.memoryFrameStore.publish(saved.frameId, 'staged', 'active')).toBe(true);

    // The belief path, not the frame's own relations table.
    const beliefs = kernel.beliefStore.findByCanonicalKey('用户|preference.LIKES|project', 'p');
    expect(beliefs).toHaveLength(1);
    expect(beliefs[0]!.predicate).toBe('preference.LIKES');
    expect(beliefs[0]!.objectValue.raw).toBe('钓鱼');
    expect(beliefs[0]!.status).toBe('active');

    // And through the query API a host actually calls, with the intent that host passes
    // (`recall`, not `preference_lookup`) — the first version only proved the row existed.
    const recalled = kernel.beliefStore.getActiveBeliefsForQuery({ query: '我喜欢什么', projectId: 'p', limit: 6, intent: 'recall' });
    expect(recalled.map((belief) => belief.objectValue.raw)).toContain('钓鱼');
  } finally {
    kernel.close();
  }
});

test('a frame that is not active yet records no belief', () => {
  // The projection hangs off publication. A frame waiting for review is not a claim
  // about the world, and writing one would make an unreviewed reading recallable.
  const kernel = createKernel();
  try {
    const evidence = seedEvent(kernel);
    const frame = frameWith(evidence, [{ sourceFrameNodeId: 'n-actor', relationType: 'LIKES', targetFrameNodeId: 'n-fishing' }]);
    kernel.memoryFrameStore.save({ frame, sourceFingerprint: 'fp', publishStatus: 'needs_confirmation' });
    expect(kernel.beliefStore.findByCanonicalKey('用户|preference.LIKES|project', 'p')).toHaveLength(0);
  } finally {
    kernel.close();
  }
});

test('a superseded preference keeps the old row and points at the new one', () => {
  const kernel = createKernel();
  try {
    // Two episodes, not one: the second is later, which is what makes it a revision
    // rather than a restatement. `validFrom` now comes from the evidence event, so the
    // times have to differ for the supersession rule to fire at all.
    const first = seedEvent(kernel, '我喜欢钓鱼。', { eventId: 'evt-1', occurredAt: Date.UTC(2026, 5, 5, 12) });
    const later = seedEvent(kernel, '现在喜欢登山了。', { eventId: 'evt-2', occurredAt: Date.UTC(2026, 6, 5, 12) });
    projectFrameRelationsToBeliefs(kernel.beliefStore, frameWith(first, [
      { sourceFrameNodeId: 'n-actor', relationType: 'LIKES', targetFrameNodeId: 'n-fishing' },
    ]) as never, first.occurredAt);
    projectFrameRelationsToBeliefs(kernel.beliefStore, frameWith(later, [
      { sourceFrameNodeId: 'n-actor', relationType: 'LIKES', targetFrameNodeId: 'n-hiking' },
    ]) as never, later.occurredAt);

    const rows = kernel.beliefStore.findByCanonicalKey('用户|preference.LIKES|project', 'p');
    const current = rows.filter((row) => row.status === 'active');
    const superseded = rows.filter((row) => row.status === 'superseded');
    expect(current).toHaveLength(1);
    expect(current[0]!.objectValue.raw).toBe('登山');
    // The old row survives, with the pointer the ticket asks for.
    expect(superseded).toHaveLength(1);
    expect(superseded[0]!.objectValue.raw).toBe('钓鱼');
    expect(superseded[0]!.supersededByBeliefId).toBe(current[0]!.id);

    // Recall returns the current value and not the row it replaced.
    const recalled = kernel.beliefStore.getActiveBeliefsForQuery({ query: '我喜欢什么', projectId: 'p', limit: 6, intent: 'recall' });
    expect(recalled.map((belief) => belief.objectValue.raw)).toEqual(['登山']);
  } finally {
    kernel.close();
  }
});

test('two relationships on the same subject coexist instead of replacing each other', () => {
  // A person has many friends. A single-valued key here would have made 王五 supersede
  // 李四 and silently forget one of them.
  const kernel = createKernel();
  try {
    const evidence = seedEvent(kernel);
    projectFrameRelationsToBeliefs(kernel.beliefStore, frameWith(evidence, [
      { sourceFrameNodeId: 'n-actor', relationType: 'FRIEND_OF', targetFrameNodeId: 'n-li' },
    ]) as never, 1_000);
    projectFrameRelationsToBeliefs(kernel.beliefStore, frameWith(evidence, [
      { sourceFrameNodeId: 'n-actor', relationType: 'FRIEND_OF', targetFrameNodeId: 'n-wang' },
    ]) as never, 2_000);

    const friends = kernel.beliefStore.findByCanonicalKey('用户|FRIEND_OF|project|李四', 'p')
      .concat(kernel.beliefStore.findByCanonicalKey('用户|FRIEND_OF|project|王五', 'p'));
    expect(friends.map((row) => row.objectValue.raw).sort()).toEqual(['李四', '王五']);
    expect(friends.every((row) => row.status === 'active')).toBe(true);
  } finally {
    kernel.close();
  }
});

test('a relation the vocabulary has no name for is still recorded, as RELATED_TO', () => {
  const kernel = createKernel();
  try {
    const evidence = seedEvent(kernel);
    // The name the model invented is rewritten to RELATED_TO where the frame is stored,
    // and the claim must survive into the belief path too.
    const frame = frameWith(evidence, [{ sourceFrameNodeId: 'n-actor', relationType: 'ADMIRES', targetFrameNodeId: 'n-li' }]);
    const saved = kernel.memoryFrameStore.save({ frame, sourceFingerprint: 'fp', publishStatus: 'active' });
    expect(kernel.memoryFrameStore.publish(saved.frameId, 'staged', 'active')).toBe(true);
    const beliefs = kernel.beliefStore.findByCanonicalKey('用户|RELATED_TO|project|李四', 'p');
    expect(beliefs).toHaveLength(1);
    expect(beliefs[0]!.objectValue.raw).toBe('李四');
  } finally {
    kernel.close();
  }
});

test('publishing the same frame twice does not duplicate its beliefs', () => {
  const kernel = createKernel();
  try {
    const evidence = seedEvent(kernel);
    const frame = frameWith(evidence, [{ sourceFrameNodeId: 'n-actor', relationType: 'LIKES', targetFrameNodeId: 'n-fishing' }]);
    const first = projectFrameRelationsToBeliefs(kernel.beliefStore, frame as never, 1_000);
    const second = projectFrameRelationsToBeliefs(kernel.beliefStore, frame as never, 2_000);
    expect(first.written).toBe(1);
    expect(second.written).toBe(0);
    expect(second.skipped).toContainEqual({ relation: 'LIKES', reason: 'already_recorded' });
    expect(kernel.beliefStore.findByCanonicalKey('用户|preference.LIKES|project', 'p')).toHaveLength(1);
  } finally {
    kernel.close();
  }
});
