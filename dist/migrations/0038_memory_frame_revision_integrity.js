export const migration_0038 = {
    version: '0038',
    description: 'repair frame revision uniqueness and publication values',
    up(db) {
        const table = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_frames'`).get();
        if (!table)
            return;
        db.exec(`UPDATE memory_frames SET revision_number=-rowid WHERE 1=1;`);
        db.exec(`UPDATE memory_frames AS current SET revision_number=(
      SELECT COUNT(*) FROM memory_frames AS prior
      WHERE prior.episode_id=current.episode_id
        AND prior.source_fingerprint=current.source_fingerprint
        AND prior.processor_prompt_version=current.processor_prompt_version
        AND (prior.updated_at < current.updated_at OR (prior.updated_at = current.updated_at AND prior.frame_id <= current.frame_id))
    );`);
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_frames_revision_number ON memory_frames(episode_id, source_fingerprint, processor_prompt_version, revision_number);`);
        db.exec(`UPDATE memory_frames
      SET publish_status='needs_confirmation',
          status=CASE WHEN status='active' THEN 'needs_confirmation' ELSE status END
      WHERE publish_status <> 'active'
         OR publish_status NOT IN ('active','needs_confirmation')
         OR needs_review=1
         OR status='needs_confirmation'
         OR source_authority='deterministic_fallback';`);
    },
    down() { },
};
