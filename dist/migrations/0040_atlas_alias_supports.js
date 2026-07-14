export const migration_0040 = {
    version: '0040',
    description: 'track alias provenance per frame',
    up(db) {
        db.exec(`
      CREATE TABLE IF NOT EXISTS memory_atlas_alias_supports (
        support_id TEXT PRIMARY KEY,
        alias_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        source_frame_id TEXT NOT NULL,
        source_episode_id TEXT,
        evidence_event_ids_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','invalidated')),
        created_at INTEGER NOT NULL,
        invalidated_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_atlas_alias_support_identity
        ON memory_atlas_alias_supports(alias_id, source_frame_id);
      CREATE INDEX IF NOT EXISTS idx_memory_atlas_alias_support_lookup
        ON memory_atlas_alias_supports(project_id, node_id, status);
    `);
    },
    down() { },
};
