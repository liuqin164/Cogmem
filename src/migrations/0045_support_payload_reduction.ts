import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';

function columns(db: Database, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
}

function addColumn(db: Database, table: string, name: string, definition: string): void {
  if (!columns(db, table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

export const migration_0045: Migration = {
  version: '0045',
  description: 'persist canonical support payloads for deterministic reduction',
  up(db: Database) {
    addColumn(db, 'memory_atlas_supports', 'payload_json', "TEXT NOT NULL DEFAULT '{}'");
    addColumn(db, 'memory_atlas_supports', 'confidence', 'REAL');
    addColumn(db, 'memory_atlas_supports', 'valid_from', 'INTEGER');
    addColumn(db, 'memory_atlas_supports', 'valid_to', 'INTEGER');
    addColumn(db, 'memory_atlas_supports', 'source_authority', "TEXT NOT NULL DEFAULT 'memory_frame_projector'");
    addColumn(db, 'memory_atlas_alias_supports', 'payload_json', "TEXT NOT NULL DEFAULT '{}'");
    addColumn(db, 'memory_atlas_alias_supports', 'confidence', 'REAL');
    addColumn(db, 'memory_atlas_alias_supports', 'source_authority', "TEXT NOT NULL DEFAULT 'memory_frame_projector'");
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_atlas_supports_reduction
        ON memory_atlas_supports(project_id, node_id, source_authority, status, confidence);
      CREATE INDEX IF NOT EXISTS idx_memory_atlas_alias_supports_reduction
        ON memory_atlas_alias_supports(project_id, alias_id, source_authority, status, confidence);
      CREATE TABLE IF NOT EXISTS _memory_frame_integrity_markers (
        marker TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );
      INSERT OR REPLACE INTO _memory_frame_integrity_markers(marker, created_at)
        VALUES ('memory_frame_integrity_0045', CAST(strftime('%s','now') AS INTEGER) * 1000);
    `);
  },
  down() {},
};
