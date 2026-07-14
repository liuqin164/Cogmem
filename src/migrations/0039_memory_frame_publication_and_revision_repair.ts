import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';

export const migration_0039: Migration = {
  version: '0039',
  description: 'repair frame revisions and enforce one active frame per episode',
  up(db: Database) {
    const table = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_frames'`).get();
    if (!table) return;
    db.exec(`
      UPDATE memory_frames
      SET revision_number=-rowid
      WHERE revision_number IS NULL OR revision_number IN (
        SELECT revision_number FROM memory_frames GROUP BY episode_id, source_fingerprint, processor_prompt_version, revision_number HAVING COUNT(*) > 1
      );
    `);
    db.exec(`
      UPDATE memory_frames AS current
      SET revision_number=(SELECT COUNT(*) FROM memory_frames AS prior
        WHERE prior.episode_id=current.episode_id
          AND prior.source_fingerprint=current.source_fingerprint
          AND prior.processor_prompt_version=current.processor_prompt_version
          AND (prior.created_at < current.created_at OR (prior.created_at=current.created_at AND prior.frame_id<=current.frame_id)))
      WHERE current.revision_number < 0;
    `);
    db.exec(`
      UPDATE memory_frames
      SET publish_status='needs_confirmation', status=CASE WHEN status='active' THEN 'needs_confirmation' ELSE status END
      WHERE source_authority='deterministic_fallback' OR needs_review=1 OR publish_status IS NULL OR publish_status<>'active' OR status='needs_confirmation';
    `);
    db.exec(`
      UPDATE memory_frames
      SET status='superseded', updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
      WHERE status='active' AND frame_id NOT IN (
        SELECT frame_id FROM (
          SELECT frame_id, ROW_NUMBER() OVER (PARTITION BY episode_id ORDER BY revision_number DESC, created_at DESC, frame_id DESC) AS rank
          FROM memory_frames WHERE status='active'
        ) WHERE rank=1
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_frames_one_active_episode
        ON memory_frames(episode_id) WHERE status='active';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_frames_revision_number
        ON memory_frames(episode_id, source_fingerprint, processor_prompt_version, revision_number);
    `);
  },
  down() {},
};
