import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';

export const migration_0038: Migration = {
  version: '0038',
  description: 'repair frame revision uniqueness and publication values',
  up(db: Database) {
    const table = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_frames'`).get();
    if (!table) return;
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_frames_revision_number ON memory_frames(episode_id, source_fingerprint, processor_prompt_version, revision_number);`);
    db.exec(`UPDATE memory_frames SET publish_status='needs_confirmation' WHERE publish_status NOT IN ('active','needs_confirmation') OR needs_review=1 OR status='needs_confirmation' OR source_authority='deterministic_fallback';`);
  },
  down() {},
};
