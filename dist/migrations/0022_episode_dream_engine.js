export const migration_0022 = {
    version: '0022',
    description: 'episode assembly and conditional dream scheduling',
    up(db) {
        db.exec(`
      CREATE TABLE IF NOT EXISTS memory_episodes (
        episode_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT NOT NULL,
        source_agent TEXT, topic_path TEXT, episode_type TEXT NOT NULL, status TEXT NOT NULL,
        importance REAL NOT NULL, summary TEXT, start_event_id TEXT NOT NULL, end_event_id TEXT NOT NULL,
        start_seq INTEGER, end_seq INTEGER, event_count INTEGER NOT NULL,
        started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, sealed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_memory_episodes_scope
        ON memory_episodes(project_id, session_id, status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS memory_episode_events (
        episode_id TEXT NOT NULL, event_id TEXT NOT NULL UNIQUE, position INTEGER NOT NULL,
        relation TEXT NOT NULL, confidence REAL NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (episode_id, event_id),
        FOREIGN KEY (episode_id) REFERENCES memory_episodes(episode_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_episode_events_episode
        ON memory_episode_events(episode_id, position);
      CREATE TABLE IF NOT EXISTS episode_closure_receipts (
        receipt_id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, project_id TEXT NOT NULL,
        closure_mode TEXT NOT NULL, closure_reason TEXT NOT NULL, source_event_ids_json TEXT NOT NULL,
        start_seq INTEGER, end_seq INTEGER, topic_path TEXT, episode_type TEXT NOT NULL,
        importance REAL NOT NULL, dream_recommended INTEGER NOT NULL, dream_mode TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_episode_closure_episode
        ON episode_closure_receipts(episode_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS episode_dream_jobs (
        episode_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, state TEXT NOT NULL,
        priority INTEGER NOT NULL, mode_hint TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        lease_id TEXT, lease_until INTEGER, last_error TEXT, candidate_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_episode_dream_jobs_queue
        ON episode_dream_jobs(project_id, state, priority DESC, created_at);
      CREATE TABLE IF NOT EXISTS episode_dream_runs (
        run_id TEXT PRIMARY KEY, project_id TEXT, requested_mode TEXT NOT NULL,
        selected_mode TEXT NOT NULL, reason TEXT NOT NULL, episode_ids_json TEXT NOT NULL,
        candidate_ids_json TEXT NOT NULL, status TEXT NOT NULL, duration_ms INTEGER NOT NULL,
        error TEXT, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_episode_dream_runs_project
        ON episode_dream_runs(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS episode_ingest_keys (
        ingest_key TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_agent TEXT NOT NULL,
        source_session_id TEXT NOT NULL, external_message_id TEXT NOT NULL,
        event_id TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_episode_ingest_identity
        ON episode_ingest_keys(project_id, source_agent, source_session_id, external_message_id);
      CREATE TABLE IF NOT EXISTS episode_event_dispositions (
        event_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, disposition TEXT NOT NULL,
        reason TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_episode_event_dispositions_project
        ON episode_event_dispositions(project_id, disposition, created_at);
    `);
    },
    down(db) {
        db.exec(`
      DROP TABLE IF EXISTS episode_ingest_keys;
      DROP TABLE IF EXISTS episode_event_dispositions;
      DROP TABLE IF EXISTS episode_dream_runs;
      DROP TABLE IF EXISTS episode_dream_jobs;
      DROP TABLE IF EXISTS episode_closure_receipts;
      DROP TABLE IF EXISTS memory_episode_events;
      DROP TABLE IF EXISTS memory_episodes;
    `);
    },
};
