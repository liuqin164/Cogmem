import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { EventStore } from '../src/store/EventStore.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * A person asks a question; the memory holds a statement.
 *
 * "when does the pelican migration window open" is how someone asks. The ledger
 * holds "the pelican migration window opens in October". Splitting the question
 * into tokens and requiring every one of them is a query the answer can never
 * satisfy: "when", "does", "the" and "open" (against "opens") are not in the
 * statement. The memory is right there and the search says nothing.
 */

function tempDbPath(prefix: string): string {
  return join(makeTempDir(prefix), 'memory.db');
}

function seed(store: EventStore): void {
  store.append({
    streamId: 's1', streamType: 'thread', eventType: 'RAW_EVENT_RECORDED', projectId: 'p',
    payload: { text: 'the pelican migration window opens in October', role: 'user' },
  });
  store.append({
    streamId: 's1', streamType: 'thread', eventType: 'RAW_EVENT_RECORDED', projectId: 'p',
    payload: { text: '我今天下午去了北京出差，见了张伟', role: 'user' },
  });
  store.append({
    streamId: 's1', streamType: 'thread', eventType: 'RAW_EVENT_RECORDED', projectId: 'p',
    payload: { text: 'the invoice export drops its second batch', role: 'user' },
  });
}

test('a question reaches the statement that answers it', () => {
  const store = new EventStore(tempDbPath('cogmem-raw-question-'));
  seed(store);

  // The words that are actually in the memory still work, exactly.
  const exact = store.searchRawEvents('pelican migration window', { projectId: 'p' });
  expect(exact.length).toBe(1);

  // A question must not be a query the answer cannot satisfy.
  const asked = store.searchRawEvents('when does the pelican migration window open', { projectId: 'p' });
  expect(asked.length).toBe(1);
  expect(JSON.stringify(asked[0]!.payload)).toContain('pelican');

  store.close();
});

test('a Chinese question reaches the Chinese statement that answers it', () => {
  const store = new EventStore(tempDbPath('cogmem-raw-question-zh-'));
  seed(store);

  const exact = store.searchRawEvents('北京', { projectId: 'p' });
  expect(exact.length).toBe(1);

  const asked = store.searchRawEvents('我什么时候去的北京', { projectId: 'p' });
  expect(asked.length).toBe(1);
  expect(JSON.stringify(asked[0]!.payload)).toContain('北京');

  store.close();
});

test('a question with no matching words still finds nothing', () => {
  const store = new EventStore(tempDbPath('cogmem-raw-question-none-'));
  seed(store);

  // Loose matching must not turn into matching everything: a query whose words
  // appear nowhere in the ledger is still an empty result, not the whole table.
  const unrelated = store.searchRawEvents('quarterly revenue forecast spreadsheet', { projectId: 'p' });
  expect(unrelated.length).toBe(0);

  store.close();
});

test('an exact match is not diluted by looser candidates', () => {
  const store = new EventStore(tempDbPath('cogmem-raw-question-rank-'));
  store.append({
    streamId: 's1', streamType: 'thread', eventType: 'RAW_EVENT_RECORDED', projectId: 'p',
    payload: { text: 'unrelated chatter about window cleaning', role: 'user' },
  });
  store.append({
    streamId: 's1', streamType: 'thread', eventType: 'RAW_EVENT_RECORDED', projectId: 'p',
    payload: { text: 'the pelican migration window opens in October', role: 'user' },
  });

  // "window" alone appears in both. An event holding every word of the query
  // answers it exactly, so the loose pass never runs and the chatter stays out.
  const rows = store.searchRawEvents('pelican migration window', { projectId: 'p' });
  expect(rows.length).toBe(1);
  expect(JSON.stringify(rows[0]!.payload)).toContain('pelican');

  store.close();
});
