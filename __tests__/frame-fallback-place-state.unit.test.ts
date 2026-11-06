import { expect, test } from 'bun:test';
import type { MemoryEvent } from '../src/types/index.js';
import { deterministicFrameFallback } from '../src/semantic/DeterministicFrameFallback.js';

/**
 * #141: the deterministic fallback must produce the two dimensions the model path produces, in the shape the query
 * side already accepts (`__tests__/facet-state-place-e2e.unit.test.ts` hand-builds that shape, and it is what the
 * README means by "align with the model path"). Susan's rule for this ticket: places may be generous, states must
 * be strict, and the negative cases come first.
 */
function event(text: string, index = 0): MemoryEvent {
  return {
    eventId: `evt-${index}`, globalSeq: index + 1, projectId: 'p', workspaceId: 'w', threadId: 't', sessionId: 's',
    eventType: 'RAW_EVENT_RECORDED', rawEventType: 'message', role: 'user', actorId: 'hermes',
    occurredAt: Date.UTC(2026, 10, 6, 12, 0, 0) + index, localDate: '2026-11-06', text,
    payload: { text }, createdAt: Date.UTC(2026, 10, 6, 12, 0, 0) + index, globalSeqOrder: index + 1,
  } as unknown as MemoryEvent;
}
const frameOf = (texts: string[]) => deterministicFrameFallback({ projectId: 'p', episodeId: 'ep-1', events: texts.map(event) });
const locations = (texts: string[]) => frameOf(texts).nodes.filter((node) => node.dimension === 'location');
const states = (texts: string[]) => frameOf(texts).stateTransitions;

// Negative cases first (#141): no marker, no node — generosity is about which place counts, not about inventing one.
test('a turn with no place marker grows no location node', () => {
  expect(locations(['We spent the whole afternoon arguing about the schema.'])).toHaveLength(0);
  expect(locations(['办公室很大，采光不错。'])).toHaveLength(0);
});
test('a turn with no state marker grows no state transition', () => {
  expect(states(['The database is SQLite now and that is fine.'])).toHaveLength(0);
  expect(states(['我们讨论了一下数据库选型。'])).toHaveLength(0);
});

// Places may be generous: the marker plus a noun phrase is enough.
test('a Chinese place phrase grows a location node with a LOCATED_AT edge', () => {
  const frame = frameOf(['我们在东京办公室把迁移方案定了下来。']);
  const place = frame.nodes.find((node) => node.dimension === 'location');
  expect(place).toBeDefined();
  expect(String(place?.label)).toContain('东京');
  expect(frame.relations.some((relation) => relation.relationType === 'LOCATED_AT' && relation.targetFrameNodeId === place?.frameNodeId)).toBe(true);
});
test('an English at/in phrase grows a location node', () => {
  const frame = frameOf(['We settled the migration plan at the Tokyo Office.']);
  const place = frame.nodes.find((node) => node.dimension === 'location');
  expect(place).toBeDefined();
  expect(String(place?.label).toLowerCase()).toContain('tokyo');
});

// States must be strict: only the explicit markers, and only with something to name.
test('an explicit state marker grows one transition in the model path shape', () => {
  const frame = frameOf(['当时还是 SQLite，所以那次迁移要手写。']);
  expect(frame.stateTransitions).toHaveLength(1);
  const transition = frame.stateTransitions[0] as unknown as { subjectFrameNodeId?: string; to?: string };
  expect(transition.to).toBe('SQLite');
  expect(typeof transition.subjectFrameNodeId).toBe('string');
});
test('a state marker with nothing after it grows no transition', () => {
  expect(states(['当时还是'])).toHaveLength(0);
  expect(states(['当时还是，所以那次迁移要手写。'])).toHaveLength(0);
});
test('the English state marker names the state it was on', () => {
  const frame = frameOf(['It was while still on Postgres that we noticed the lock.']);
  expect(frame.stateTransitions).toHaveLength(1);
  expect((frame.stateTransitions[0] as unknown as { to?: string }).to).toBe('Postgres');
});
