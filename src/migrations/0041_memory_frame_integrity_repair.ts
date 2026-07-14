import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';

function tableExists(db: Database, name: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}

export const migration_0041: Migration = {
  version: '0041',
  description: 'repair populated frame revisions, publication state, and alias provenance',
  up(db: Database) {
    if (!tableExists(db, 'memory_frames')) return;
    db.exec(`
      CREATE TEMP TABLE _memory_frame_repair_lineages AS
      SELECT episode_id, source_fingerprint, processor_prompt_version
      FROM memory_frames
      WHERE revision_number IS NULL
      GROUP BY episode_id, source_fingerprint, processor_prompt_version
      UNION
      SELECT episode_id, source_fingerprint, processor_prompt_version
      FROM memory_frames
      GROUP BY episode_id, source_fingerprint, processor_prompt_version, revision_number
      HAVING COUNT(*) > 1;
      UPDATE memory_frames
      SET revision_number=-rowid
      WHERE revision_number IS NULL OR EXISTS (
        SELECT 1 FROM _memory_frame_repair_lineages l
        WHERE l.episode_id=memory_frames.episode_id
          AND l.source_fingerprint=memory_frames.source_fingerprint
          AND l.processor_prompt_version=memory_frames.processor_prompt_version
      );
      UPDATE memory_frames AS current
      SET revision_number=(
        SELECT COUNT(*) FROM memory_frames AS prior
        WHERE prior.episode_id=current.episode_id
          AND prior.source_fingerprint=current.source_fingerprint
          AND prior.processor_prompt_version=current.processor_prompt_version
          AND (prior.created_at < current.created_at OR (prior.created_at=current.created_at AND prior.frame_id<=current.frame_id))
      )
      WHERE current.revision_number < 0;
      DROP TABLE _memory_frame_repair_lineages;
      UPDATE memory_frames
      SET publish_status='needs_confirmation',
          status=CASE WHEN status='active' THEN 'needs_confirmation' ELSE status END
      WHERE source_authority='deterministic_fallback' OR needs_review=1 OR status='needs_confirmation' OR publish_status IS NULL OR publish_status NOT IN ('active','needs_confirmation');
      UPDATE memory_frames
      SET status='superseded', publish_status='needs_confirmation', updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
      WHERE status='active' AND frame_id NOT IN (
        SELECT frame_id FROM (
          SELECT frame_id, ROW_NUMBER() OVER (PARTITION BY episode_id ORDER BY created_at DESC, revision_number DESC, frame_id DESC) AS rank
          FROM memory_frames WHERE status='active'
        ) WHERE rank=1
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_frames_one_active_episode ON memory_frames(episode_id) WHERE status='active';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_frames_revision_number ON memory_frames(episode_id, source_fingerprint, processor_prompt_version, revision_number);
    `);

    if (tableExists(db, 'memory_atlas_alias_supports') && tableExists(db, 'memory_atlas_aliases')) {
      db.exec(`
        INSERT OR IGNORE INTO memory_atlas_alias_supports
          (support_id, alias_id, project_id, node_id, source_frame_id, source_episode_id, evidence_event_ids_json, status, created_at)
        SELECT a.alias_id || ':' || a.source_frame_id, a.alias_id, a.project_id, a.node_id, a.source_frame_id,
               f.episode_id, COALESCE(a.evidence_event_ids_json, '[]'), 'active', COALESCE(a.created_at, strftime('%s','now')*1000)
        FROM memory_atlas_aliases a
        JOIN memory_frames f ON f.frame_id=a.source_frame_id
        WHERE a.source_frame_id IS NOT NULL AND a.status='active' AND f.status='active';
      `);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS _memory_frame_integrity_markers (
        marker TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );
      INSERT OR REPLACE INTO _memory_frame_integrity_markers(marker, created_at)
      VALUES ('memory_frame_integrity_0041', CAST(strftime('%s','now') AS INTEGER)*1000);
    `);
  },
  down() {},
};
