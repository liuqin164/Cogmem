export const migration_0030 = {
    version: '0030',
    description: 'memory event local date source provenance',
    up(db) {
        if (db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_events'`).get()) {
            const columns = new Set(db.prepare(`PRAGMA table_info(memory_events)`).all().map((row) => row.name));
            if (!columns.has('local_date_source')) {
                db.exec(`ALTER TABLE memory_events ADD COLUMN local_date_source TEXT NOT NULL DEFAULT 'legacy_unknown';`);
            }
        }
        if (db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_episode_events'`).get()) {
            db.exec(`
        WITH ordered AS (
          SELECT episode_id, event_id,
            ROW_NUMBER() OVER (PARTITION BY episode_id ORDER BY position, event_id) AS next_position
          FROM memory_episode_events
        )
        UPDATE memory_episode_events
        SET position = (
          SELECT next_position FROM ordered
          WHERE ordered.episode_id = memory_episode_events.episode_id
            AND ordered.event_id = memory_episode_events.event_id
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_episode_events_episode_position_unique
          ON memory_episode_events(episode_id, position);
      `);
        }
    },
    down() {
        // SQLite cannot drop a column without rebuilding the table; keep the compatible additive column.
    },
};
