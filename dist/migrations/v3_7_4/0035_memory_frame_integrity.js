export const migration_0035 = {
    version: '0035',
    description: 'persist complete memory frame fields and publication intent',
    up(db) {
        for (const [name, declaration] of [
            ['primary_language', 'TEXT'],
            ['temporal_references_json', "TEXT NOT NULL DEFAULT '[]'"],
            ['state_transitions_json', "TEXT NOT NULL DEFAULT '[]'"],
            ['publish_status', "TEXT NOT NULL DEFAULT 'active' CHECK(publish_status IN ('active','needs_confirmation'))"],
        ]) {
            const columns = db.prepare('PRAGMA table_info(memory_frames)').all();
            if (!columns.some((column) => column.name === name))
                db.exec(`ALTER TABLE memory_frames ADD COLUMN ${name} ${declaration}`);
        }
        db.exec(`UPDATE memory_frames SET publish_status='needs_confirmation' WHERE needs_review=1 OR status='needs_confirmation' OR source_authority='deterministic_fallback'`);
    },
    down() { },
};
