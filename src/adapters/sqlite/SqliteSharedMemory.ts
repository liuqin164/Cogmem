/**
 * SQLite implementation of the shared memory region.
 *
 * The shared region is a single table on the same database file. Publishing is
 * idempotent on `item_hash`, retraction is soft so a subscriber's earlier
 * reasoning stays explainable, and only the publishing host may retract its own
 * item.
 */

import type { Database } from 'bun:sqlite';

import type { SharedCollection, SharedItem, SharedMemoryPort, SharedRetraction } from '../../ports/index.js';

interface SharedRow {
  item_hash: string;
  source_host: string;
  source_item: string;
  collection: string;
  payload_json: string;
  published_at: number;
  retracted_at: number | null;
  retracted_by: string | null;
}

function toItem(row: SharedRow): SharedItem {
  return {
    itemHash: row.item_hash,
    sourceHost: row.source_host,
    sourceItem: row.source_item,
    collection: row.collection,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    publishedAt: row.published_at,
  };
}

export class SqliteSharedMemory implements SharedMemoryPort {
  private schemaReady = false;

  constructor(private readonly db: Database) {}

  /**
   * Tables are created on first use, not on construction: a kernel that never shares must leave a
   * database exactly as 4.0 left it — no shared tables at all — and `#68`'s fresh-database guard
   * asserts precisely that. Idempotent, and paid once per adapter instance.
   */
  private ensureSchema(): void {
    if (this.schemaReady) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shared_items (
        item_hash     TEXT PRIMARY KEY,
        source_host   TEXT NOT NULL,
        source_item   TEXT NOT NULL,
        collection    TEXT NOT NULL,
        payload_json  TEXT NOT NULL,
        published_at  INTEGER NOT NULL,
        retracted_at  INTEGER,
        retracted_by  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shared_collection
        ON shared_items(collection, published_at DESC);

      -- Who owns a collection and who may read it. Kept beside the shared region rather than in each
      -- host's config file: the owner is a runtime fact (whoever published first), and every host
      -- shares this one database, while config files are per host and would disagree.
      CREATE TABLE IF NOT EXISTS shared_collections (
        collection  TEXT PRIMARY KEY,
        owner_host  TEXT NOT NULL,
        created_at  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shared_collection_readers (
        collection  TEXT NOT NULL,
        reader_host TEXT NOT NULL,
        PRIMARY KEY (collection, reader_host)
      );
    `);
    this.schemaReady = true;
  }

  async publish(items: SharedItem[]): Promise<number> {
    this.ensureSchema();
    if (items.length === 0) return 0;

    // Ownership first: a publisher that does not own the collection must not get as far as writing an
    // item, and the first publisher of a collection becomes its owner.
    for (const item of items) {
      if (item.collection && item.sourceHost) this.claimCollection(item.collection, item.sourceHost);
    }

    for (const item of items) {
      if (!item.itemHash) throw new Error('shared_item_hash_required');
      if (!item.collection) throw new Error('shared_collection_required');
      if (!item.sourceHost) throw new Error('shared_source_host_required');
    }

    const insert = this.db.prepare(`
      INSERT INTO shared_items
        (item_hash, source_host, source_item, collection, payload_json, published_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const selectExisting = this.db.prepare(`
      SELECT source_host, source_item, collection, payload_json
      FROM shared_items WHERE item_hash = ?
    `);

    return this.db.transaction(() => {
      let inserted = 0;
      for (const item of items) {
        try {
          const result = insert.run(
            item.itemHash,
            item.sourceHost,
            item.sourceItem,
            item.collection,
            JSON.stringify(item.payload),
            item.publishedAt,
          );
          inserted += result.changes;
        } catch (err) {
          // SQLite constraint violation (UNIQUE constraint on item_hash)
          const existing = selectExisting.get(item.itemHash) as
            | { source_host: string; source_item: string; collection: string; payload_json: string }
            | null;
          if (!existing) {
            // Race condition: row disappeared? Re-throw original error
            throw err;
          }
          // Compare immutable fields - if identical, treat as idempotent success
          const existingPayload = JSON.parse(existing.payload_json);
          const payloadMatches = JSON.stringify(existingPayload) === JSON.stringify(item.payload);
          const fieldsMatch =
            existing.source_host === item.sourceHost &&
            existing.source_item === item.sourceItem &&
            existing.collection === item.collection &&
            payloadMatches;
          if (!fieldsMatch) {
            throw new Error(`shared_item_hash_conflict:${item.itemHash}`);
          }
          // Identical - idempotent, don't count as inserted
        }
      }
      return inserted;
    })();
  }

  async retract(retraction: SharedRetraction): Promise<void> {
    this.ensureSchema();
    const row = this.db
      .prepare('SELECT source_host, retracted_at FROM shared_items WHERE item_hash = ?')
      .get(retraction.itemHash) as { source_host: string; retracted_at: number | null } | null;

    if (!row) throw new Error(`shared_item_not_found:${retraction.itemHash}`);
    if (row.source_host !== retraction.retractedBy) {
      throw new Error(`shared_item_not_owned:${retraction.itemHash}`);
    }
    if (row.retracted_at !== null) return;

    this.db
      .prepare('UPDATE shared_items SET retracted_at = ?, retracted_by = ? WHERE item_hash = ?')
      .run(retraction.retractedAt, retraction.retractedBy, retraction.itemHash);
  }

  async subscribe(collections: string[], options: { readerHost?: string; limit?: number } = {}): Promise<SharedItem[]> {
    this.ensureSchema();
    if (collections.length === 0) return [];
    // No identity, nothing to authorize: fail closed rather than hand over every collection.
    if (!options.readerHost) return [];
    const limit = options.limit ?? 100;
    const placeholders = collections.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`
        SELECT s.* FROM shared_items s
        JOIN shared_collections c ON c.collection = s.collection
        WHERE s.collection IN (${placeholders})
          AND s.retracted_at IS NULL
          AND (c.owner_host = ? OR EXISTS (
            SELECT 1 FROM shared_collection_readers r
             WHERE r.collection = s.collection AND r.reader_host = ?
          ))
        ORDER BY s.published_at DESC
        LIMIT ?
      `)
      .all(...collections, options.readerHost, options.readerHost, limit) as SharedRow[];

    return rows.map(toItem);
  }

  /** The first publisher of a collection owns it; anyone else needs that owner's grant. */
  private claimCollection(collection: string, publisherHost: string): void {
    const row = this.db
      .prepare('SELECT owner_host FROM shared_collections WHERE collection = ?')
      .get(collection) as { owner_host: string } | null;
    if (!row) {
      this.db
        .prepare('INSERT INTO shared_collections (collection, owner_host, created_at) VALUES (?, ?, ?)')
        .run(collection, publisherHost, Date.now());
      return;
    }
    if (row.owner_host !== publisherHost) {
      // Same shape as `shared_item_not_owned`: the code names the thing that was refused.
      throw new Error(`shared_collection_not_owned:${collection}`);
    }
  }

  private requireOwner(collection: string, actorHost: string): void {
    const row = this.db
      .prepare('SELECT owner_host FROM shared_collections WHERE collection = ?')
      .get(collection) as { owner_host: string } | null;
    if (!row) throw new Error(`shared_collection_not_found:${collection}`);
    if (row.owner_host !== actorHost) throw new Error(`shared_collection_not_owned:${collection}`);
  }

  async grantReader(collection: string, readerHost: string, actorHost: string): Promise<void> {
    this.ensureSchema();
    if (!readerHost) throw new Error('shared_reader_host_required');
    this.requireOwner(collection, actorHost);
    this.db
      .prepare('INSERT OR IGNORE INTO shared_collection_readers (collection, reader_host) VALUES (?, ?)')
      .run(collection, readerHost);
  }

  async revokeReader(collection: string, readerHost: string, actorHost: string): Promise<void> {
    this.ensureSchema();
    this.requireOwner(collection, actorHost);
    // Grants already delivered into someone's session are not recalled; this stops the next read.
    this.db
      .prepare('DELETE FROM shared_collection_readers WHERE collection = ? AND reader_host = ?')
      .run(collection, readerHost);
  }

  async listCollections(): Promise<SharedCollection[]> {
    this.ensureSchema();
    const rows = this.db
      .prepare(`
        SELECT c.collection, c.owner_host, c.created_at,
               (SELECT COUNT(*) FROM shared_items s
                 WHERE s.collection = c.collection AND s.retracted_at IS NULL) AS item_count
          FROM shared_collections c
         ORDER BY c.collection
      `)
      .all() as Array<{ collection: string; owner_host: string; created_at: number; item_count: number }>;
    const readerRows = this.db
      .prepare('SELECT collection, reader_host FROM shared_collection_readers ORDER BY reader_host')
      .all() as Array<{ collection: string; reader_host: string }>;
    return rows.map((row) => ({
      collection: row.collection,
      ownerHost: row.owner_host,
      createdAt: row.created_at,
      itemCount: row.item_count,
      readers: readerRows.filter((r) => r.collection === row.collection).map((r) => r.reader_host),
    }));
  }

  async explain(itemHash: string): Promise<{ item: SharedItem; retractedAt: number | null } | null> {
    this.ensureSchema();
    const row = this.db
      .prepare('SELECT * FROM shared_items WHERE item_hash = ?')
      .get(itemHash) as SharedRow | null;
    if (!row) return null;
    return { item: toItem(row), retractedAt: row.retracted_at };
  }
}
