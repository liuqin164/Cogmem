export const migration_0048 = {
    version: '0048',
    description: 'version project-local civil time topology for resumable rebuilds',
    up(db) {
        db.exec(`
      CREATE TABLE IF NOT EXISTS topology_projection_state (
        project_id TEXT PRIMARY KEY,
        projection_version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL CHECK(status IN ('dirty','building','clean','failed')),
        time_zone TEXT,
        updated_at INTEGER NOT NULL,
        error TEXT
      );

    `);
        if (db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='neurons'`).get()) {
            db.exec(`
        INSERT INTO topology_projection_state(project_id,projection_version,status,updated_at)
        SELECT DISTINCT project_id,1,'dirty',unixepoch()*1000
        FROM neurons
        WHERE project_id IS NOT NULL AND project_id<>'' AND is_deleted=0
        ON CONFLICT(project_id) DO UPDATE SET
          projection_version=MIN(topology_projection_state.projection_version,1),
          status='dirty', updated_at=excluded.updated_at, error=NULL;
      `);
        }
    },
    down() { },
};
