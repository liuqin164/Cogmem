import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';

export const migration_0033: Migration = {
  version: '0033',
  description: 'canonical Atlas aliases and shared projection support ledger',
  up(db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_atlas_aliases (
        alias_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        alias TEXT NOT NULL,
        dimension TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        confidence REAL NOT NULL DEFAULT 1,
        source_frame_id TEXT,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, normalized_alias, dimension, node_id)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_atlas_aliases_lookup
        ON memory_atlas_aliases(project_id, dimension, normalized_alias, status);
      CREATE TABLE IF NOT EXISTS memory_atlas_supports (
        support_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_episode_id TEXT,
        source_frame_id TEXT,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        invalidated_at INTEGER,
        UNIQUE(node_id, source_type, source_id)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_atlas_supports_node
        ON memory_atlas_supports(project_id, node_id, status);
      CREATE INDEX IF NOT EXISTS idx_memory_atlas_supports_source
        ON memory_atlas_supports(project_id, source_type, source_id, status);
    `);
  },
  down(db: Database) {
    db.exec(`DROP TABLE IF EXISTS memory_atlas_supports; DROP TABLE IF EXISTS memory_atlas_aliases;`);
  },
};
