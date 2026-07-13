export const migration_0034 = {
    version: '0034',
    description: 'Atlas V2 projection provenance metadata',
    up(db) {
        const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_atlas_projection_state'`).get();
        if (!exists)
            return;
        addColumn(db, 'memory_atlas_projection_state', 'projection_version', `TEXT NOT NULL DEFAULT 'v1'`);
        addColumn(db, 'memory_atlas_projection_state', 'processor_prompt_version', `TEXT`);
        addColumn(db, 'memory_atlas_projection_state', 'frame_schema_version', `TEXT`);
        addColumn(db, 'memory_atlas_projection_state', 'source_fingerprint', `TEXT`);
        addColumn(db, 'memory_atlas_projection_state', 'last_backfill_cursor', `TEXT`);
    },
    down() { },
};
function addColumn(db, table, column, declaration) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((item) => item.name === column))
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}
