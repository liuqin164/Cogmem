export const migration_0016 = {
    version: '0016',
    description: 'reversible entity merge candidates and resolution audit',
    up(db) {
        db.exec(`
      CREATE TABLE IF NOT EXISTS entity_merge_candidates (
        candidate_id TEXT PRIMARY KEY,
        project_id TEXT,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        alias TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        review_reasons_json TEXT NOT NULL,
        evidence_event_ids_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_entity_merge_candidates_project
        ON entity_merge_candidates(project_id, status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS entity_resolution_log (
        log_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        previous_canonical_entity_id TEXT NOT NULL,
        previous_status TEXT NOT NULL,
        alias TEXT NOT NULL,
        action TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    },
    down(db) {
        db.exec(`DROP INDEX IF EXISTS idx_entity_merge_candidates_project;`);
        db.exec(`DROP TABLE IF EXISTS entity_resolution_log;`);
        db.exec(`DROP TABLE IF EXISTS entity_merge_candidates;`);
    },
};
