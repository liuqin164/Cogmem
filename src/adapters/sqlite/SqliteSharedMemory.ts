/**
 * SQLite implementation of the shared memory region.
 *
 * The shared region is a single table on the same database file. Publishing is
 * idempotent on `item_hash`, retraction is soft so a subscriber's earlier
 * reasoning stays explainable, and only the publishing host may retract its own
 * item.
 */

import type { Database } from 'bun:sqlite';

import type { SharedItem, SharedMemoryPort, SharedRetraction } from '../../ports/index.js';

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
  constructor(private readonly db: Database) {
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
    `);
  }

  async publish(items: SharedItem[]): Promise<number> {
    if (items.length === 0) return 0;

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

  async subscribe(collections: string[], options: { limit?: number } = {}): Promise<SharedItem[]> {
    if (collections.length === 0) return [];
    const limit = options.limit ?? 100;
    const placeholders = collections.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`
        SELECT * FROM shared_items
        WHERE collection IN (${placeholders}) AND retracted_at IS NULL
        ORDER BY published_at DESC
        LIMIT ?
      `)
      .all(...collections, limit) as SharedRow[];

    return rows.map(toItem);
  }

  async explain(itemHash: string): Promise<{ item: SharedItem; retractedAt: number | null } | null> {
    const row = this.db
      .prepare('SELECT * FROM shared_items WHERE item_hash = ?')
      .get(itemHash) as SharedRow | null;
    if (!row) return null;
    return { item: toItem(row), retractedAt: row.retracted_at };
  }
}
