export const migration_0036 = {
    version: '0036',
    description: 'repair memory frame publication intent and bind dream ownership',
    up(db) {
        const columns = db.prepare('PRAGMA table_info(memory_frames)').all();
        for (const [name, declaration] of [
            ['dream_job_lease_id', 'TEXT'],
            ['dream_lease_until', 'INTEGER'],
            ['attempt_generation', 'INTEGER'],
        ])
            if (!columns.some((column) => column.name === name))
                db.exec(`ALTER TABLE memory_frames ADD COLUMN ${name} ${declaration}`);
        db.exec(`UPDATE memory_frames SET publish_status='needs_confirmation' WHERE needs_review=1 OR status='needs_confirmation' OR source_authority='deterministic_fallback'`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_frames_dream_lease ON memory_frames(status, dream_lease_until)`);
        db.exec(`CREATE TABLE IF NOT EXISTS memory_frame_reviews (
      review_id TEXT PRIMARY KEY, frame_id TEXT NOT NULL, project_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('approve','reject')),
      actor TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY(frame_id) REFERENCES memory_frames(frame_id) ON DELETE CASCADE
    )`);
    },
    down() { },
};
