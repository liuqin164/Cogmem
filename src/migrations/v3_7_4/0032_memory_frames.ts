import type Database from 'bun:sqlite';
// Internal atomic 3.7.4 installation step; never receives its own migration receipt.
import type { Migration } from '../../types/Migration.js';

export const migration_0032: Migration = {
  version: '0032',
  description: 'staged structured memory frames and evidence-backed semantic projections',
  up(db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_frames (
        frame_id TEXT PRIMARY KEY,
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
        UNIQUE(episode_id, source_fingerprint, processor_prompt_version)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_frames_project_status
        ON memory_frames(project_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_frames_episode
        ON memory_frames(project_id, episode_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS memory_frame_nodes (
        frame_node_id TEXT PRIMARY KEY,
        frame_id TEXT NOT NULL,
        dimension TEXT NOT NULL,
        label TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        description TEXT,
        confidence REAL NOT NULL,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
        canonical_hint_json TEXT,
        FOREIGN KEY(frame_id) REFERENCES memory_frames(frame_id) ON DELETE CASCADE,
        UNIQUE(frame_id, frame_node_id)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_frame_nodes_lookup
        ON memory_frame_nodes(dimension, label, confidence DESC);
      CREATE TABLE IF NOT EXISTS memory_frame_relations (
        frame_relation_id TEXT PRIMARY KEY,
        frame_id TEXT NOT NULL,
        source_frame_node_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        target_frame_node_id TEXT NOT NULL,
        confidence REAL NOT NULL,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
        valid_from INTEGER,
        valid_to INTEGER,
        FOREIGN KEY(frame_id) REFERENCES memory_frames(frame_id) ON DELETE CASCADE,
        FOREIGN KEY(source_frame_node_id) REFERENCES memory_frame_nodes(frame_node_id) ON DELETE CASCADE,
        FOREIGN KEY(target_frame_node_id) REFERENCES memory_frame_nodes(frame_node_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_frame_relations_frame
        ON memory_frame_relations(frame_id, relation_type);
    `);
  },
  down(db: Database) {
    db.exec(`DROP TABLE IF EXISTS memory_frame_relations; DROP TABLE IF EXISTS memory_frame_nodes; DROP TABLE IF EXISTS memory_frames;`);
  },
};
