import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';

// 0032 used an inline unique constraint that made two lease attempts for the
// same source impossible. Rebuild the small frame tables once so source
// fingerprints stay stable while revisions get their own identity.
export const migration_0037: Migration = {
  version: '0037',
  description: 'stable memory frame fingerprints and independent revisions',
  up(db: Database) {
    const hasFrames = Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_frames'`).get());
    if (!hasFrames) return;
    db.exec(`PRAGMA foreign_keys = OFF;`);
    db.exec(`
      ALTER TABLE memory_frame_nodes RENAME TO memory_frame_nodes_0037_old;
      ALTER TABLE memory_frame_relations RENAME TO memory_frame_relations_0037_old;
      ALTER TABLE memory_frame_reviews RENAME TO memory_frame_reviews_0037_old;
      ALTER TABLE memory_frames RENAME TO memory_frames_0037_old;
      DROP INDEX IF EXISTS idx_memory_frames_project_status;
      DROP INDEX IF EXISTS idx_memory_frames_episode;
      DROP INDEX IF EXISTS idx_memory_frame_nodes_lookup;
      DROP INDEX IF EXISTS idx_memory_frame_relations_frame;
      DROP INDEX IF EXISTS idx_memory_frames_dream_lease;
      CREATE TABLE memory_frames (
        frame_id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL,
        revision_number INTEGER NOT NULL DEFAULT 1,
        supersedes_frame_id TEXT,
        project_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        processor_prompt_version TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        episode_kind TEXT NOT NULL,
        confidence REAL NOT NULL,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
        processor_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'staged' CHECK(status IN ('staged','active','needs_confirmation','superseded','failed')),
        source_authority TEXT NOT NULL DEFAULT 'processor',
        semantic_completeness TEXT NOT NULL DEFAULT 'full',
        needs_review INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        primary_language TEXT,
        temporal_references_json TEXT NOT NULL DEFAULT '[]',
        state_transitions_json TEXT NOT NULL DEFAULT '[]',
        publish_status TEXT NOT NULL DEFAULT 'active' CHECK(publish_status IN ('active','needs_confirmation')),
        dream_job_lease_id TEXT,
        dream_lease_until INTEGER,
        attempt_generation INTEGER,
        UNIQUE(episode_id, source_fingerprint, processor_prompt_version, revision_id),
        UNIQUE(episode_id, source_fingerprint, processor_prompt_version, revision_number)
      );
      INSERT INTO memory_frames (
        frame_id, revision_id, revision_number, supersedes_frame_id, project_id, episode_id,
        schema_version, source_fingerprint, processor_prompt_version, title, summary, episode_kind,
        confidence, evidence_event_ids_json, processor_json, status, source_authority,
        semantic_completeness, needs_review, created_at, updated_at, primary_language,
        temporal_references_json, state_transitions_json, publish_status, dream_job_lease_id,
        dream_lease_until, attempt_generation
      )
      SELECT frame_id, frame_id, 1, NULL, project_id, episode_id, schema_version, source_fingerprint,
        processor_prompt_version, title, summary, episode_kind, confidence, evidence_event_ids_json,
        processor_json, status, source_authority, semantic_completeness, needs_review, created_at,
        updated_at, primary_language, temporal_references_json, state_transitions_json, publish_status,
        dream_job_lease_id, dream_lease_until, attempt_generation
      FROM memory_frames_0037_old;
      CREATE TABLE memory_frame_nodes (
        frame_node_id TEXT PRIMARY KEY, frame_id TEXT NOT NULL, dimension TEXT NOT NULL, label TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]', description TEXT, confidence REAL NOT NULL,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]', canonical_hint_json TEXT,
        FOREIGN KEY(frame_id) REFERENCES memory_frames(frame_id) ON DELETE CASCADE,
        UNIQUE(frame_id, frame_node_id)
      );
      INSERT INTO memory_frame_nodes SELECT * FROM memory_frame_nodes_0037_old;
      CREATE TABLE memory_frame_relations (
        frame_relation_id TEXT PRIMARY KEY, frame_id TEXT NOT NULL, source_frame_node_id TEXT NOT NULL,
        relation_type TEXT NOT NULL, target_frame_node_id TEXT NOT NULL, confidence REAL NOT NULL,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]', valid_from INTEGER, valid_to INTEGER,
        FOREIGN KEY(frame_id) REFERENCES memory_frames(frame_id) ON DELETE CASCADE,
        FOREIGN KEY(source_frame_node_id) REFERENCES memory_frame_nodes(frame_node_id) ON DELETE CASCADE,
        FOREIGN KEY(target_frame_node_id) REFERENCES memory_frame_nodes(frame_node_id) ON DELETE CASCADE
      );
      INSERT INTO memory_frame_relations SELECT * FROM memory_frame_relations_0037_old;
      CREATE TABLE memory_frame_reviews (
        review_id TEXT PRIMARY KEY, frame_id TEXT NOT NULL, project_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('approve','reject')), actor TEXT NOT NULL,
        reason TEXT NOT NULL, created_at INTEGER NOT NULL,
        FOREIGN KEY(frame_id) REFERENCES memory_frames(frame_id) ON DELETE CASCADE
      );
      INSERT INTO memory_frame_reviews SELECT * FROM memory_frame_reviews_0037_old;
      DROP TABLE memory_frame_reviews_0037_old;
      DROP TABLE memory_frame_relations_0037_old;
      DROP TABLE memory_frame_nodes_0037_old;
      DROP TABLE memory_frames_0037_old;
      CREATE INDEX idx_memory_frames_project_status ON memory_frames(project_id, status, updated_at DESC);
      CREATE INDEX idx_memory_frames_episode ON memory_frames(project_id, episode_id, updated_at DESC);
      CREATE INDEX idx_memory_frame_nodes_lookup ON memory_frame_nodes(dimension, label, confidence DESC);
      CREATE INDEX idx_memory_frame_relations_frame ON memory_frame_relations(frame_id, relation_type);
      CREATE INDEX idx_memory_frames_dream_lease ON memory_frames(status, dream_lease_until);
      PRAGMA foreign_keys = ON;
    `);
  },
  down() {},
};
