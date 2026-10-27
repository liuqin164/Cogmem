import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { EventStore } from '../src/store/EventStore.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * A search for a memory must not be ordered like a reading of the log.
 *
 * `global_seq` order is right for replay and audit: reading a conversation back,
 * the sequence is the point. It is wrong for recall, because it makes the oldest
 * match the best match — and when a common phrase matches more events than the
 * caller asked for, the ordering is what decides which ones survive. The event
 * that answers the question is then not ranked low, it is absent, and nothing
 * reports that the search had found it.
 *
 * `MEMORY_MODEL.md` already draws this line: "Chronological order is for replay
 * and audit. Recall ranking is for selecting useful current context." These tests
 * pin both halves of it.
 */

function store(): EventStore {
  return new EventStore(join(makeTempDir('cogmem-raw-order-'), 'memory.db'));
}

function seedMentions(instance: EventStore, count: number, startAt: number): void {
  const DAY = 86_400_000;
  for (let index = 0; index < count; index += 1) {
    instance.append({
      streamId: `thread-${index}`,
      streamType: 'thread',
      eventType: 'RAW_EVENT_RECORDED',
      projectId: 'p',
      payload: { text: `round ${index} notes, and by the way the memory black box came up once`, role: 'user' },
    });
    // append() stamps its own timestamps; the ordering under test is by
    // global_seq, so insertion order is what matters and startAt keeps the
    // fixtures readable.
    void startAt;
    void DAY;
  }
}

test('a common phrase does not bury the event that answers the question', () => {
  const instance = store();
  seedMentions(instance, 20, 0);
  instance.append({
    streamId: 'answer',
    streamType: 'thread',
    eventType: 'RAW_EVENT_RECORDED',
    projectId: 'p',
    payload: {
      text: 'memory black box decision — pruning is not deletion; raw events are kept forever',
      role: 'user',
    },
  });

  const chronological = instance.searchRawEvents('memory black box', { projectId: 'p', limit: 5 });
  const relevant = instance.searchRawEvents('memory black box', { projectId: 'p', limit: 5, orderBy: 'relevance' });

  const answers = (rows: typeof chronological) =>
    rows.filter((row) => String((row.payload as { text?: string }).text ?? '').includes('pruning is not deletion')).length;

  // Reading order loses it: the answer is the newest, so it is the last of 21
  // matches and the first five never include it.
  expect(answers(chronological)).toBe(0);
  // Recall order finds it, and first.
  expect(answers(relevant)).toBe(1);
  expect(String((relevant[0]!.payload as { text?: string }).text ?? '')).toContain('pruning is not deletion');

  instance.close();
});

test('chronological order is still available and still chronological', () => {
  const instance = store();
  seedMentions(instance, 5, 0);

  const rows = instance.searchRawEvents('memory black box', { projectId: 'p', limit: 5 });
  const sequences = rows.map((row) => row.globalSeq ?? 0);

  // Default unchanged: replay and audit still read the ledger in order.
  expect(sequences).toEqual([...sequences].sort((left, right) => left - right));

  instance.close();
});
