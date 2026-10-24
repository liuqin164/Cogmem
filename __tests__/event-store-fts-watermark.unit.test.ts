import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventStore } from '../src/store/EventStore.js';

function tempDbPath(prefix: string): string {
  return join(mkdtempSync(join(tmpdir(), prefix)), 'memory.db');
}

function seed(store: EventStore): void {
  store.append({ streamId: 's1', streamType: 'thread', eventType: 'RAW_EVENT_RECORDED', projectId: 'p', payload: { text: 'alpha beta' } });
  // No text/output/title: this event is stored but never gets an FTS row.
  store.append({ streamId: 's1', streamType: 'thread', eventType: 'INGESTED', projectId: 'p', payload: { state: 'idle' } });
  store.append({ streamId: 's1', streamType: 'thread', eventType: 'RAW_EVENT_RECORDED', projectId: 'p', payload: { text: 'gamma delta' } });
}

test('a second open does not rebuild the FTS index for events that carry no text', () => {
  const path = tempDbPath('cogmem-fts-watermark-');

  const first = new EventStore(path);
  seed(first);
  const afterSeed = first.getRawEventFtsState();
  expect(afterSeed.rebuilds).toBe(0);
  first.close();

  // The short count is permanent: one of the three events has nothing to index.
  const raw = new Database(path, { readonly: true });
  const counts = {
    events: (raw.query('SELECT COUNT(*) AS c FROM memory_events').get() as { c: number }).c,
    fts: (raw.query('SELECT COUNT(*) AS c FROM memory_events_fts').get() as { c: number }).c,
  };
  raw.close();
  expect(counts).toEqual({ events: 3, fts: 2 });

  const second = new EventStore(path);
  expect(second.getRawEventFtsState()).toMatchObject({ maxRowid: 3, watermark: 3, rebuilds: 0 });
  second.close();
});

test('new events are appended to the index without re-indexing old ones', () => {
  const path = tempDbPath('cogmem-fts-append-');

  const first = new EventStore(path);
  seed(first);
  first.close();

  const second = new EventStore(path);
  second.append({ streamId: 's1', streamType: 'thread', eventType: 'RAW_EVENT_RECORDED', projectId: 'p', payload: { text: 'epsilon zeta' } });
  second.close();

  const third = new EventStore(path);
  expect(third.getRawEventFtsState()).toMatchObject({ maxRowid: 4, watermark: 4, rebuilds: 0 });
  third.close();

  const raw = new Database(path, { readonly: true });
  const hits = raw.query("SELECT COUNT(*) AS c FROM memory_events_fts WHERE memory_events_fts MATCH 'zeta'").get() as { c: number };
  raw.close();
  expect(hits.c).toBe(1);
});

test('a truncated FTS table is still detected and rebuilt once', () => {
  const path = tempDbPath('cogmem-fts-truncate-');

  const first = new EventStore(path);
  seed(first);
  first.close();

  const raw = new Database(path);
  raw.exec('DELETE FROM memory_events_fts');
  raw.close();

  const repaired = new EventStore(path);
  expect(repaired.getRawEventFtsState().rebuilds).toBe(1);
  repaired.close();

  const settled = new EventStore(path);
  expect(settled.getRawEventFtsState().rebuilds).toBe(0);
  settled.close();
});
