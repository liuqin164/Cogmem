import type { Migration } from '../types/Migration.js';

export const migration_0018: Migration = {
  version: '0018',
  description: 'project, entity, decision, and correction timelines',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_timeline_entries (
        entry_id TEXT PRIMARY KEY, project_id TEXT, entry_type TEXT NOT NULL, canonical_key TEXT,
        entity_id TEXT, belief_id TEXT, title TEXT NOT NULL, summary TEXT, reason TEXT,
        occurred_at INTEGER NOT NULL, evidence_event_ids_json TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_timeline_project_time
        ON memory_timeline_entries(project_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_timeline_canonical_time
        ON memory_timeline_entries(project_id, canonical_key, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_timeline_entity_time
        ON memory_timeline_entries(project_id, entity_id, occurred_at DESC);
    `);
  },
  down(db) {
    db.exec(`DROP INDEX IF EXISTS idx_memory_timeline_entity_time;`);
    db.exec(`DROP INDEX IF EXISTS idx_memory_timeline_canonical_time;`);
    db.exec(`DROP INDEX IF EXISTS idx_memory_timeline_project_time;`);
    db.exec(`DROP TABLE IF EXISTS memory_timeline_entries;`);
  },
};
