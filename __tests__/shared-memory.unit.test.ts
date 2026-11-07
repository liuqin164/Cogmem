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

    const subscribed = await shared.subscribe(['team-standards'], { readerHost: 'claude' });
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

    const [read] = await shared.subscribe(['team-standards'], { readerHost: 'claude' });
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

    const standards = await shared.subscribe(['standards'], { readerHost: 'claude' });
    expect(standards.map((i) => i.itemHash)).toEqual(['a']);
  });

  test('subscribing to nothing returns nothing', async () => {
    const { shared } = fresh();
    await shared.publish([item()]);
    expect(await shared.subscribe([], { readerHost: 'claude' })).toEqual([]);
  });

  test('newest published item comes first', async () => {
    const { shared } = fresh();
    await shared.publish([
      item({ itemHash: 'old', publishedAt: 1 }),
      item({ itemHash: 'new', publishedAt: 2 }),
    ]);

    const list = await shared.subscribe(['team-standards'], { readerHost: 'claude' });
    expect(list.map((i) => i.itemHash)).toEqual(['new', 'old']);
  });
});

describe('SharedMemoryPort: retraction', () => {
  test('retracted items leave the subscription but stay explainable', async () => {
    const { shared } = fresh();
    await shared.publish([item()]);

    await shared.retract({ itemHash: 'hash-1', retractedAt: 1_700_000_100_000, retractedBy: 'claude' });

    expect(await shared.subscribe(['team-standards'], { readerHost: 'claude' })).toEqual([]);

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

  test('explaining an unknown item returns nothing rather than throwing', async () => {
    // The port has no 4.0 caller (#68 removed the MCP tools), so this contract
    // is specified here, next to the adapter, instead of through the dispatcher.
    const { shared } = fresh();
    expect(await shared.explain('never-published')).toBeNull();
  });
});

/**
 * #66 acceptance: a collection has an owner and an explicit reader list, and reading is authorized in
 * one place — the adapter — so no surface can be the one that forgot.
 */
describe('SharedMemoryPort: collection access control (#66)', () => {
  test('a host that knows the collection name reads it without ever being granted (#146)', async () => {
    const db = new Database(':memory:');
    const shared = new SqliteSharedMemory(db);
    try {
      await shared.publish([item({ collection: 'team-standards', sourceHost: 'claude' })]);
      // The owner reads it, and so does a third host that was never granted anything: reading is not gated per
      // reader while sharing is on (#146). Identity is still required — the anonymous case is below.
      expect(await shared.subscribe(['team-standards'], { readerHost: 'claude' })).toHaveLength(1);
      expect(await shared.subscribe(['team-standards'], { readerHost: 'intruder' })).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test('a subscribe with no identity reads nothing, so a missing identity fails closed', async () => {
    const db = new Database(':memory:');
    const shared = new SqliteSharedMemory(db);
    try {
      await shared.publish([item({ collection: 'team-standards', sourceHost: 'claude' })]);
      expect(await shared.subscribe(['team-standards'])).toEqual([]);
    } finally {
      db.close();
    }
  });

  test('a fresh collection has its publisher as owner and no readers at all', async () => {
    const db = new Database(':memory:');
    const shared = new SqliteSharedMemory(db);
    try {
      expect(await shared.listCollections()).toEqual([]);
      await shared.publish([item({ collection: 'team-standards', sourceHost: 'claude' })]);
      const [collection] = await shared.listCollections();
      expect(collection).toMatchObject({ collection: 'team-standards', ownerHost: 'claude', readers: [], itemCount: 1 });
    } finally {
      db.close();
    }
  });

  test('only the owner may publish into an existing collection', async () => {
    const db = new Database(':memory:');
    const shared = new SqliteSharedMemory(db);
    try {
      await shared.publish([item({ collection: 'team-standards', sourceHost: 'claude' })]);
      await expect(shared.publish([item({ itemHash: 'other', collection: 'team-standards', sourceHost: 'hermes' })]))
        .rejects.toThrow(/shared_collection_not_owned:team-standards/);
    } finally {
      db.close();
    }
  });

  test('granting and revoking change the registry, not what a reader can read (#146)', async () => {
    const db = new Database(':memory:');
    const shared = new SqliteSharedMemory(db);
    try {
      await shared.publish([item({ collection: 'team-standards', sourceHost: 'claude' })]);
      await shared.grantReader('team-standards', 'hermes', 'claude');
      expect(await shared.subscribe(['team-standards'], { readerHost: 'hermes' })).toHaveLength(1);
      await shared.revokeReader('team-standards', 'hermes', 'claude');
      // Reading is not gated per reader any more, so revoking an entry in a registry nobody consults changes nothing
      // about access. The registry still records the revoke, which is what a future multi-user deployment would use.
      expect(await shared.subscribe(['team-standards'], { readerHost: 'hermes' })).toHaveLength(1);
      expect(await shared.listCollections()).toMatchObject([{ readers: [] }]);
    } finally {
      db.close();
    }
  });

  test('only the owner may grant or revoke, and unknown collections are named', async () => {
    const db = new Database(':memory:');
    const shared = new SqliteSharedMemory(db);
    try {
      await shared.publish([item({ collection: 'team-standards', sourceHost: 'claude' })]);
      await expect(shared.grantReader('team-standards', 'hermes', 'hermes')).rejects.toThrow(/shared_collection_not_owned/);
      await expect(shared.revokeReader('team-standards', 'hermes', 'hermes')).rejects.toThrow(/shared_collection_not_owned/);
      await expect(shared.grantReader('nope', 'hermes', 'claude')).rejects.toThrow(/shared_collection_not_found:nope/);
    } finally {
      db.close();
    }
  });
});
