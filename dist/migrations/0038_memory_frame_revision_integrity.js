export const migration_0038 = {
    version: '0038',
    description: 'repair frame revision uniqueness and publication values',
    up(db) {
        const table = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_frames'`).get();
        if (!table)
            return;
        const duplicate = db.prepare(`SELECT 1 FROM memory_frames GROUP BY episode_id, source_fingerprint, processor_prompt_version, revision_number HAVING COUNT(*) > 1 LIMIT 1`).get();
        if (!duplicate)
            db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_frames_revision_number ON memory_frames(episode_id, source_fingerprint, processor_prompt_version, revision_number);`);
        db.exec(`UPDATE memory_frames SET publish_status='needs_confirmation' WHERE publish_status NOT IN ('active','needs_confirmation') OR needs_review=1 OR status='needs_confirmation' OR source_authority='deterministic_fallback';`);
    },
    down() { },
};
