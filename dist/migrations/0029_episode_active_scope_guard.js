export const migration_0029 = {
    version: '0029',
    description: 'episode active scope uniqueness guard',
    up(db) {
        sealDuplicateOpenEpisodes(db);
        db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_episodes_one_active_scope
        ON memory_episodes(project_id, session_id, COALESCE(source_agent, ''), COALESCE(conversation_thread_id, ''))
        WHERE status = 'open';
    `);
    },
    down(db) {
        db.exec(`DROP INDEX IF EXISTS idx_memory_episodes_one_active_scope;`);
    },
};
function sealDuplicateOpenEpisodes(db) {
    const duplicates = db.prepare(`
    SELECT project_id, session_id, COALESCE(source_agent, '') AS source_agent_key,
      COALESCE(conversation_thread_id, '') AS thread_key
    FROM memory_episodes
    WHERE status = 'open'
    GROUP BY project_id, session_id, COALESCE(source_agent, ''), COALESCE(conversation_thread_id, '')
    HAVING COUNT(*) > 1
  `).all();
    if (!duplicates.length)
        return;
    const selectEpisodes = db.prepare(`
    SELECT * FROM memory_episodes
    WHERE status = 'open'
      AND project_id = ?
      AND session_id = ?
      AND COALESCE(source_agent, '') = ?
      AND COALESCE(conversation_thread_id, '') = ?
    ORDER BY updated_at DESC, episode_id DESC
  `);
    const selectEventIds = db.prepare(`
    SELECT event_id FROM memory_episode_events WHERE episode_id = ? ORDER BY position
  `);
    const sealEpisode = db.prepare(`
    UPDATE memory_episodes SET status = 'sealed', sealed_at = ?, updated_at = MAX(updated_at, ?)
    WHERE episode_id = ?
  `);
    const insertReceipt = db.prepare(`
    INSERT OR IGNORE INTO episode_closure_receipts (
      receipt_id, episode_id, project_id, closure_mode, closure_reason, source_event_ids_json,
      start_seq, end_seq, topic_path, episode_type, importance, dream_recommended, dream_mode,
      created_at, closure_reason_code, closure_reason_detail, requires_review,
      ignored_nearby_event_ids_json, unassigned_nearby_event_ids_json
    ) VALUES (?, ?, ?, 'migration', 'migration_duplicate_open_scope', ?, ?, ?, ?, ?, ?, 0, 'none', ?,
      'migration_duplicate_open_scope', ?, 1, '[]', '[]')
  `);
    for (const scope of duplicates) {
        const rows = selectEpisodes.all(scope.project_id, scope.session_id, scope.source_agent_key, scope.thread_key);
        for (const episode of rows.slice(1)) {
            const eventIds = selectEventIds.all(episode.episode_id).map((row) => row.event_id);
            const now = episode.updated_at;
            sealEpisode.run(now, now, episode.episode_id);
            insertReceipt.run(`migration-0029-${episode.episode_id}`, episode.episode_id, episode.project_id, JSON.stringify(eventIds), episode.start_seq ?? null, episode.end_seq ?? null, episode.topic_path ?? null, episode.episode_type, episode.importance, now, JSON.stringify({ keptOpenEpisodeId: rows[0].episode_id, duplicateScope: scope }));
        }
    }
}
