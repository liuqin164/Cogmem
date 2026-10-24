import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';

import { SqliteSharedMemory } from '../src/adapters/sqlite/SqliteSharedMemory.js';
import type { SharedItem } from '../src/ports/index.js';

function fresh() {
  const db = new Database(':memory:');
  return { db, shared: new SqliteSharedMemory(db) };
}

const item = (over: Partial<SharedItem> = {}): SharedItem => ({
  itemHash: 'hash-1',
  sourceHost: 'claude',
  sourceItem: 'mem-1',
  collection: 'team-standards',
  payload: { text: 'always run typecheck before commit' },
  publishedAt: 1_700_000_000_000,
  ...over,
});

describe('SharedMemoryPort: publish', () => {
  test('publishing the same item twice is idempotent', async () => {
    const { shared } = fresh();
    expect(await shared.publish([item()])).toBe(1);
    expect(await shared.publish([item()])).toBe(0);

    const subscribed = await shared.subscribe(['team-standards']);
    expect(subscribed).toHaveLength(1);
  });

  test('batch publish reports only newly inserted rows', async () => {
    const { shared } = fresh();
    await shared.publish([item({ itemHash: 'hash-1' })]);

    const inserted = await shared.publish([
      item({ itemHash: 'hash-1' }),
      item({ itemHash: 'hash-2', sourceItem: 'mem-2' }),
      item({ itemHash: 'hash-3', sourceItem: 'mem-3' }),
    ]);

    expect(inserted).toBe(2);
  });

  test('payload survives the round trip as an object', async () => {
    const { shared } = fresh();
    await shared.publish([item({ payload: { nested: { a: [1, 2] }, ok: true } })]);

    const [read] = await shared.subscribe(['team-standards']);
    expect(read.payload).toEqual({ nested: { a: [1, 2] }, ok: true });
  });

  test('an item without a hash is rejected', async () => {
    const { shared } = fresh();
    await expect(shared.publish([item({ itemHash: '' })])).rejects.toThrow(/shared_item_hash_required/);
  });
});

describe('SharedMemoryPort: subscribe', () => {
  test('only the requested collections are returned', async () => {
    const { shared } = fresh();
    await shared.publish([
      item({ itemHash: 'a', collection: 'standards' }),
      item({ itemHash: 'b', collection: 'secrets' }),
    ]);

    const standards = await shared.subscribe(['standards']);
    expect(standards.map((i) => i.itemHash)).toEqual(['a']);
  });

  test('subscribing to nothing returns nothing', async () => {
    const { shared } = fresh();
    await shared.publish([item()]);
    expect(await shared.subscribe([])).toEqual([]);
  });

  test('newest published item comes first', async () => {
    const { shared } = fresh();
    await shared.publish([
      item({ itemHash: 'old', publishedAt: 1 }),
      item({ itemHash: 'new', publishedAt: 2 }),
    ]);

    const list = await shared.subscribe(['team-standards']);
    expect(list.map((i) => i.itemHash)).toEqual(['new', 'old']);
  });
});

describe('SharedMemoryPort: retraction', () => {
  test('retracted items leave the subscription but stay explainable', async () => {
    const { shared } = fresh();
    await shared.publish([item()]);

    await shared.retract({ itemHash: 'hash-1', retractedAt: 1_700_000_100_000, retractedBy: 'claude' });

    expect(await shared.subscribe(['team-standards'])).toEqual([]);

    const explained = await shared.explain('hash-1');
    expect(explained).not.toBeNull();
    expect(explained?.retractedAt).toBe(1_700_000_100_000);
    expect(explained?.item.itemHash).toBe('hash-1');
  });

  test('only the publishing host may retract', async () => {
    const { shared } = fresh();
    await shared.publish([item({ sourceHost: 'claude' })]);

    await expect(
      shared.retract({ itemHash: 'hash-1', retractedAt: 1, retractedBy: 'cursor' }),
    ).rejects.toThrow(/shared_item_not_owned/);
  });

  test('retracting an unknown item fails loudly', async () => {
    const { shared } = fresh();
    await expect(
      shared.retract({ itemHash: 'missing', retractedAt: 1, retractedBy: 'claude' }),
    ).rejects.toThrow(/shared_item_not_found/);
  });

  test('retracting twice is a no-op, not an error', async () => {
    const { shared } = fresh();
    await shared.publish([item()]);

    await shared.retract({ itemHash: 'hash-1', retractedAt: 1, retractedBy: 'claude' });
    await shared.retract({ itemHash: 'hash-1', retractedAt: 2, retractedBy: 'claude' });

    const explained = await shared.explain('hash-1');
    expect(explained?.retractedAt).toBe(1);
  });
});
