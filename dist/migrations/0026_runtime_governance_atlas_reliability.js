export const migration_0026 = {
    version: '0026',
    description: 'audited candidate review and Atlas reliability metadata',
    up(db) {
        ensureColumn(db, 'memory_atlas_documents', 'memory_kind', 'TEXT');
        ensureColumn(db, 'deep_write_candidates', 'review_after', 'INTEGER');
        db.exec(`
      CREATE TABLE IF NOT EXISTS deep_write_candidate_reviews (
        review_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        project_id TEXT,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        confirmation_event_id TEXT,
        target_belief_id TEXT,
        replacement_candidate_id TEXT,
        review_after INTEGER,
        decision_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        FOREIGN KEY(candidate_id) REFERENCES deep_write_candidates(candidate_id)
      );
      CREATE INDEX IF NOT EXISTS idx_candidate_reviews_project_created
        ON deep_write_candidate_reviews(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_candidate_reviews_candidate_created
        ON deep_write_candidate_reviews(candidate_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_atlas_documents_project_occurred
        ON memory_atlas_documents(project_id, occurred_at DESC, node_type);
      CREATE INDEX IF NOT EXISTS idx_atlas_documents_project_kind
        ON memory_atlas_documents(project_id, memory_kind, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_atlas_access_project_time
        ON memory_atlas_access(project_id, accessed_at DESC);
    `);
        db.exec(`
      UPDATE memory_atlas_documents SET memory_kind = CASE
        WHEN node_type IN ('action','project','event','time') THEN node_type
        WHEN lower(json_extract(metadata_json, '$.clusterType')) IN ('decision','correction','goal','preference','plan','event','evidence')
          THEN lower(json_extract(metadata_json, '$.clusterType'))
        WHEN lower(json_extract(metadata_json, '$.episodeType')) IN ('decision','correction','goal','preference','plan','event','evidence')
          THEN lower(json_extract(metadata_json, '$.episodeType'))
        WHEN lower(json_extract(metadata_json, '$.ontologyClass')) IN ('person','place','project','object','decision','correction','goal','preference','plan','event','evidence')
          THEN lower(json_extract(metadata_json, '$.ontologyClass'))
        WHEN lower(json_extract(metadata_json, '$.entityType')) IN ('person','place','project','object')
          THEN lower(json_extract(metadata_json, '$.entityType'))
        ELSE NULL END
      WHERE memory_kind IS NULL;
      INSERT INTO memory_atlas_projection_state(project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json)
      SELECT DISTINCT project_id,'memory_atlas.v1',CAST(strftime('%s','now') AS TEXT),'dirty',NULL,NULL,'{"migration":"0026","reason":"requires_rebuild_after_schema_migration"}'
      FROM memory_atlas_documents WHERE project_id<>''
      ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',last_error=NULL,metadata_json='{"migration":"0026","reason":"requires_rebuild_after_schema_migration"}';
    `);
    },
    down(db) {
        db.exec(`
      DROP INDEX IF EXISTS idx_atlas_access_project_time;
      DROP INDEX IF EXISTS idx_atlas_documents_project_occurred;
      DROP INDEX IF EXISTS idx_atlas_documents_project_kind;
      DROP INDEX IF EXISTS idx_candidate_reviews_candidate_created;
      DROP INDEX IF EXISTS idx_candidate_reviews_project_created;
      DROP TABLE IF EXISTS deep_write_candidate_reviews;
    `);
    },
};
function ensureColumn(db, table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.length === 0)
        return;
    if (!columns.some((item) => item.name === column))
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
