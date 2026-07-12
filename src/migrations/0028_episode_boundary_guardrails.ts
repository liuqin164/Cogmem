import type { Migration } from '../types/Migration.js';

export const migration_0028: Migration = {
  version: '0028',
  description: 'episode boundary guardrail decision audit',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS episode_boundary_decisions (
        decision_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        source_agent TEXT,
        thread_id TEXT,
        primary_event_id TEXT NOT NULL,
        previous_episode_id TEXT,
        resulting_episode_id TEXT,
        policy_version TEXT NOT NULL,
        mode TEXT NOT NULL,
        guard_action TEXT NOT NULL,
        guard_codes_json TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        cpu_decision_json TEXT NOT NULL,
        reviewer_invoked INTEGER NOT NULL,
        reviewer_decision_json TEXT,
        final_decision_json TEXT NOT NULL,
        warnings_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(project_id, primary_event_id, policy_version)
      );
      CREATE INDEX IF NOT EXISTS idx_episode_boundary_project_created
        ON episode_boundary_decisions(project_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_episode_boundary_previous
        ON episode_boundary_decisions(previous_episode_id);
      CREATE INDEX IF NOT EXISTS idx_episode_boundary_resulting
        ON episode_boundary_decisions(resulting_episode_id);
      CREATE INDEX IF NOT EXISTS idx_episode_boundary_primary
        ON episode_boundary_decisions(primary_event_id);
    `);
  },
  down(db) {
    db.exec(`
      DROP INDEX IF EXISTS idx_episode_boundary_primary;
      DROP INDEX IF EXISTS idx_episode_boundary_resulting;
      DROP INDEX IF EXISTS idx_episode_boundary_previous;
      DROP INDEX IF EXISTS idx_episode_boundary_project_created;
      DROP TABLE IF EXISTS episode_boundary_decisions;
    `);
  },
};
