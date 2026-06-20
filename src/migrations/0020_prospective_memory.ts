import type { Migration } from '../types/Migration.js';

export const migration_0020: Migration = {
  version: '0020',
  description: 'confirmed-only prospective memory candidates',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS prospective_memories (
        candidate_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, candidate_type TEXT NOT NULL,
        canonical_key TEXT NOT NULL, title TEXT NOT NULL, details TEXT, status TEXT NOT NULL,
        proposed_by TEXT NOT NULL, evidence_event_ids_json TEXT NOT NULL,
        confirmation_evidence_event_id TEXT, due_at INTEGER, deferred_until INTEGER,
        version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_prospective_project_status_due
        ON prospective_memories(project_id, status, due_at, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_prospective_project_status_deferred
        ON prospective_memories(project_id, status, deferred_until, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_prospective_project_key_version
        ON prospective_memories(project_id, canonical_key, version DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_prospective_project_key_version_unique
        ON prospective_memories(project_id, canonical_key, version);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_prospective_confirmation_evidence_unique
        ON prospective_memories(project_id, confirmation_evidence_event_id)
        WHERE confirmation_evidence_event_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS prospective_memory_transitions (
        transition_id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, from_status TEXT,
        to_status TEXT NOT NULL, action TEXT NOT NULL, evidence_event_id TEXT, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_prospective_transitions_candidate
        ON prospective_memory_transitions(candidate_id, created_at DESC);
    `);
  },
  down(db) {
    db.exec(`DROP INDEX IF EXISTS idx_prospective_transitions_candidate;`);
    db.exec(`DROP TABLE IF EXISTS prospective_memory_transitions;`);
    db.exec(`DROP INDEX IF EXISTS idx_prospective_confirmation_evidence_unique;`);
    db.exec(`DROP INDEX IF EXISTS idx_prospective_project_key_version_unique;`);
    db.exec(`DROP INDEX IF EXISTS idx_prospective_project_key_version;`);
    db.exec(`DROP INDEX IF EXISTS idx_prospective_project_status_deferred;`);
    db.exec(`DROP INDEX IF EXISTS idx_prospective_project_status_due;`);
    db.exec(`DROP TABLE IF EXISTS prospective_memories;`);
  },
};
