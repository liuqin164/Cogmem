import { afterAll, describe, expect, test } from 'bun:test';
import { rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'bun:sqlite';

import { MemoryObservatory } from '../src/observatory/MemoryObservatory.js';
import { RECALL_CHAIN_LIMIT } from '../src/observatory/RecallTraces.js';
import { TraceQuery } from '../src/observability/TraceQuery.js';
import { TraceStore } from '../src/observability/TraceStore.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #206: one parent-chain traversal, two readers, and a read-only construction path.
 *
 * `RecallTraces` and `TraceQuery` used to walk `parent_event_id` in two places; the page capped at
 * 32 and the query did not. Now the page reuses `TraceStore.getDecisionChain` and supplies the cap,
 * so order and de-duplication cannot fork. The acceptance is the 40-hop chain: the page returns 32
 * and says it truncated, the query returns all 40, and the two agree on a cycle.
 *
 * The observatory opens the database `readonly: true`; the store it constructs must therefore not
 * initialize the schema and must refuse every write. The file's mtime is the zero-write check.
 */

const scratch = makeTempDir('cogmem-observatory-chain-');
const dbPath = join(scratch, 'trace.db');
const PROJECT = 'p-chain';

function seed(): void {
  const db = new Database(dbPath);
  const store = new TraceStore(db);
  store.initSchema();
  for (let i = 0; i < 40; i += 1) {
    store.append({
      id: `e${i}`,
      timestamp: 1_700_000_000_000 + i,
      projectId: PROJECT,
      eventType: 'recall.result',
      payload: { step: i },
      ...(i > 0 ? { parentEventId: `e${i - 1}` } : {}),
    });
  }
  // A cycle, so the two readers' de-duplication is exercised by the same fixture.
  store.append({ id: 'c1', timestamp: 1_700_000_100_000, projectId: PROJECT, eventType: 'recall.result', payload: { cycle: 1 }, parentEventId: 'c2' });
  store.append({ id: 'c2', timestamp: 1_700_000_100_001, projectId: PROJECT, eventType: 'recall.result', payload: { cycle: 2 }, parentEventId: 'c1' });
  db.close();
}

seed();

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function openReadOnly(): Database {
  return new Database(dbPath, { readonly: true });
}

describe('the page and the query share one traversal (#206)', () => {
  test('a 40-hop chain is 32 on the page with an honest marker, and 40 in the query', () => {
    const writable = new Database(dbPath);
    const store = new TraceStore(writable);
    expect(new TraceQuery(store).decisionChain('e39').map((event) => event.id)).toHaveLength(40);
    writable.close();

    const readonly = openReadOnly();
    try {
      const observatory = new MemoryObservatory({ db: readonly });
      const detail = observatory.recall('e39', { projectId: PROJECT })!;
      expect(detail.chain).toHaveLength(RECALL_CHAIN_LIMIT);
      expect(detail.chainLimit).toBe(RECALL_CHAIN_LIMIT);
      expect(detail.chainTruncated).toBe(true);
      // The page keeps the nearest ancestors, root-first: e8 is the oldest it shows, e39 the newest.
      expect(detail.chain[0]!.id).toBe('e8');
      expect(detail.chain.at(-1)!.id).toBe('e39');
    } finally {
      readonly.close();
    }
  });

  test('order and de-duplication agree on a cycle', () => {
    const writable = new Database(dbPath);
    const expected = new TraceQuery(new TraceStore(writable)).decisionChain('c1').map((event) => event.id);
    writable.close();
    const readonly = openReadOnly();
    try {
      const detail = new MemoryObservatory({ db: readonly }).recall('c1', { projectId: PROJECT })!;
      expect(detail.chain.map((event) => event.id)).toEqual(expected);
      expect(detail.chainTruncated).toBe(false);
    } finally {
      readonly.close();
    }
  });

  test('the read-only store refuses writes and leaves the file untouched', () => {
    const before = statSync(dbPath);
    const readonly = openReadOnly();
    try {
      const store = TraceStore.readOnly(readonly);
      expect(store.getDecisionChain('e39', 5).map((event) => event.id)).toEqual(['e35', 'e36', 'e37', 'e38', 'e39']);
      expect(() => store.initSchema()).toThrow('trace_store_read_only');
      expect(() => store.append({
        id: 'nope', timestamp: 0, eventType: 'recall.result', payload: {},
      })).toThrow('trace_store_read_only');
      expect(() => store.pruneToLimit(10)).toThrow('trace_store_read_only');
    } finally {
      readonly.close();
    }
    const after = statSync(dbPath);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });
});
