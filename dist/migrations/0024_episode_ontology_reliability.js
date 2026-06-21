export const migration_0024 = {
    version: '0024',
    description: 'user-shaped topic ontology and episode reliability diagnostics',
    up(db) {
        db.exec(`
      CREATE TABLE IF NOT EXISTS topic_nodes (
        topic_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, topic_path TEXT NOT NULL, canonical_name TEXT NOT NULL,
        parent_topic_id TEXT, ontology_class TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL,
        confidence REAL NOT NULL, evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
        evidence_episode_ids_json TEXT NOT NULL DEFAULT '[]', last_used_at INTEGER NOT NULL,
        merge_candidates_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(project_id, topic_path)
      );
      CREATE INDEX IF NOT EXISTS idx_topic_nodes_project_status ON topic_nodes(project_id, status, last_used_at DESC);
      CREATE TABLE IF NOT EXISTS topic_aliases (
        alias_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, normalized_alias TEXT NOT NULL, alias TEXT NOT NULL,
        topic_id TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, confidence REAL NOT NULL,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(project_id, normalized_alias, topic_id),
        FOREIGN KEY(topic_id) REFERENCES topic_nodes(topic_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_topic_alias_lookup ON topic_aliases(project_id, normalized_alias, status);
      CREATE TABLE IF NOT EXISTS topic_relations (
        relation_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_topic_id TEXT NOT NULL, relation TEXT NOT NULL,
        target_topic_id TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, confidence REAL NOT NULL,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]', evidence_episode_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_topic_relations_project ON topic_relations(project_id, source_topic_id, status);
      CREATE TABLE IF NOT EXISTS topic_operations (
        operation_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, operation_type TEXT NOT NULL, actor TEXT NOT NULL,
        target_topic_id TEXT, payload_json TEXT NOT NULL, before_json TEXT, after_json TEXT, inverse_operation_json TEXT,
        status TEXT NOT NULL, evidence_event_ids_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, reverted_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_topic_operations_project ON topic_operations(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS episode_cross_refs (
        cross_ref_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, episode_id TEXT NOT NULL, referenced_episode_id TEXT,
        event_id TEXT, relation TEXT NOT NULL, created_by TEXT NOT NULL, confidence REAL NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_episode_cross_refs_episode ON episode_cross_refs(project_id, episode_id, created_at);
      CREATE TABLE IF NOT EXISTS episode_repair_audit (
        repair_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, operation TEXT NOT NULL, payload_json TEXT NOT NULL,
        before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at INTEGER NOT NULL
      );
    `);
        addColumn(db, 'episode_ingest_keys', 'state', `TEXT NOT NULL DEFAULT 'committed'`);
        addColumn(db, 'episode_ingest_keys', 'updated_at', `INTEGER`);
        addColumn(db, 'episode_ingest_keys', 'last_error', `TEXT`);
        addColumn(db, 'episode_dream_runs', 'failed_episode_ids_json', `TEXT NOT NULL DEFAULT '[]'`);
        addColumn(db, 'episode_dream_runs', 'failure_details_json', `TEXT NOT NULL DEFAULT '[]'`);
    },
    down(db) {
        db.exec(`
      DROP TABLE IF EXISTS episode_repair_audit;
      DROP TABLE IF EXISTS episode_cross_refs;
      DROP TABLE IF EXISTS topic_operations;
      DROP TABLE IF EXISTS topic_relations;
      DROP TABLE IF EXISTS topic_aliases;
      DROP TABLE IF EXISTS topic_nodes;
    `);
    },
};
function addColumn(db, table, column, declaration) {
    const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
    if (!exists)
        return;
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((item) => item.name === column))
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}
