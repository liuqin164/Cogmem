import type { Migration } from '../types/Migration.js';

export const migration_0023: Migration = {
  version: '0023',
  description: 'episode dream engine hardening metadata and retry controls',
  up(db) {
    db.exec(`
      ALTER TABLE memory_episodes ADD COLUMN conversation_thread_id TEXT;
      ALTER TABLE memory_episodes ADD COLUMN semantic_summary_json TEXT;
      ALTER TABLE memory_episodes ADD COLUMN episode_tags_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE memory_episodes ADD COLUMN candidate_types_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE memory_episodes ADD COLUMN importance_signals_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE memory_episodes ADD COLUMN importance_reason TEXT;
      ALTER TABLE memory_episodes ADD COLUMN linked_episode_id TEXT;
      ALTER TABLE memory_episodes ADD COLUMN dream_status TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE memory_episodes ADD COLUMN last_dream_run_id TEXT;
      ALTER TABLE memory_episodes ADD COLUMN last_dreamed_at INTEGER;
      ALTER TABLE memory_episodes ADD COLUMN dream_candidate_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE memory_episodes ADD COLUMN dream_error TEXT;

      ALTER TABLE episode_closure_receipts ADD COLUMN closure_reason_code TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE episode_closure_receipts ADD COLUMN closure_reason_detail TEXT;
      ALTER TABLE episode_closure_receipts ADD COLUMN requires_review INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE episode_closure_receipts ADD COLUMN ignored_nearby_event_ids_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE episode_closure_receipts ADD COLUMN unassigned_nearby_event_ids_json TEXT NOT NULL DEFAULT '[]';

      ALTER TABLE episode_dream_jobs ADD COLUMN retry_after INTEGER;
      ALTER TABLE episode_dream_jobs ADD COLUMN failure_category TEXT;

      UPDATE episode_dream_jobs SET state = 'failed_retryable', retry_after = updated_at
      WHERE state = 'failed';

      UPDATE memory_episodes SET
        dream_status = COALESCE((
          SELECT CASE j.state
            WHEN 'pending' THEN 'queued'
            WHEN 'retry_scheduled' THEN 'queued'
            WHEN 'processing' THEN 'processing'
            WHEN 'processed' THEN 'processed'
            WHEN 'failed_retryable' THEN 'failed'
            WHEN 'failed_terminal' THEN 'failed'
            ELSE 'none'
          END
          FROM episode_dream_jobs j WHERE j.episode_id = memory_episodes.episode_id
        ), 'none'),
        last_dreamed_at = (
          SELECT CASE WHEN j.state = 'processed' THEN j.updated_at ELSE NULL END
          FROM episode_dream_jobs j WHERE j.episode_id = memory_episodes.episode_id
        ),
        dream_candidate_count = COALESCE((
          SELECT CASE WHEN json_valid(j.candidate_ids_json) THEN json_array_length(j.candidate_ids_json) ELSE 0 END
          FROM episode_dream_jobs j WHERE j.episode_id = memory_episodes.episode_id
        ), 0),
        dream_error = (
          SELECT j.last_error FROM episode_dream_jobs j WHERE j.episode_id = memory_episodes.episode_id
        );

      CREATE INDEX IF NOT EXISTS idx_memory_episodes_active_scope
        ON memory_episodes(project_id, session_id, source_agent, conversation_thread_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_episode_dream_retry
        ON episode_dream_jobs(state, retry_after, priority DESC, created_at);
    `);
  },
  down() {
    // SQLite cannot safely drop these columns across supported versions. The migration is additive.
  },
};
