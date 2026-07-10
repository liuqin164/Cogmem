export const migration_0030 = {
    version: '0030',
    description: 'memory event local date source provenance',
    up(db) {
        if (db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_events'`).get()) {
            const columns = new Set(db.prepare(`PRAGMA table_info(memory_events)`).all().map((row) => row.name));
            if (!columns.has('local_date_source')) {
                db.exec(`ALTER TABLE memory_events ADD COLUMN local_date_source TEXT NOT NULL DEFAULT 'legacy_unknown';`);
            }
            // 0030 is also responsible for recovering provenance that was already
            // present in the legacy payload before the column existed.
            const eventColumns = new Set(db.prepare(`PRAGMA table_info(memory_events)`).all().map((row) => row.name));
            if (eventColumns.has('payload_json')) {
                db.exec(`
          UPDATE memory_events
          SET local_date_source = CASE
            WHEN json_valid(payload_json) AND json_extract(payload_json, '$.metadata.localDateSource') IN ('event_store_utc_default', 'generated_utc') THEN 'generated_utc'
            WHEN json_valid(payload_json) AND json_extract(payload_json, '$.metadata.localDateSource') = 'explicit' THEN 'explicit'
            WHEN local_date_source IN ('explicit', 'generated_utc') THEN local_date_source
            ELSE 'legacy_unknown'
          END;
        `);
            }
        }
        if (db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_episode_events'`).get()) {
            const links = db.prepare(`
        SELECT episode_id, event_id, position
        FROM memory_episode_events
        ORDER BY episode_id, position, event_id
      `).all();
            const positions = new Map();
            let episodeId;
            let nextPosition = 0;
            for (const link of links) {
                if (link.episode_id !== episodeId) {
                    episodeId = link.episode_id;
                    nextPosition = 0;
                }
                nextPosition += 1;
                positions.set(`${link.episode_id}\u0000${link.event_id}`, nextPosition);
            }
            // Move through a disjoint temporary range so an existing unique index
            // cannot observe an intermediate duplicate while positions are compacted.
            const temporary = db.prepare(`UPDATE memory_episode_events SET position = ? WHERE episode_id = ? AND event_id = ?`);
            for (const link of links)
                temporary.run(-link.position - 1, link.episode_id, link.event_id);
            for (const link of links)
                temporary.run(positions.get(`${link.episode_id}\u0000${link.event_id}`) ?? 0, link.episode_id, link.event_id);
            const hasEpisodes = Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_episodes'`).get());
            const hasEvents = Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_events'`).get());
            const eventColumns = hasEvents
                ? new Set(db.prepare(`PRAGMA table_info(memory_events)`).all().map((row) => row.name))
                : new Set();
            const hasGlobalSeq = eventColumns.has('global_seq');
            if (hasEpisodes) {
                const episodes = db.prepare(`SELECT episode_id FROM memory_episodes`).all();
                const first = db.prepare(`
          SELECT event_id FROM memory_episode_events WHERE episode_id = ? ORDER BY position, event_id LIMIT 1
        `);
                const last = db.prepare(`
          SELECT event_id FROM memory_episode_events WHERE episode_id = ? ORDER BY position DESC, event_id DESC LIMIT 1
        `);
                const count = db.prepare(`SELECT COUNT(*) AS count FROM memory_episode_events WHERE episode_id = ?`);
                const rebuild = hasEvents && hasGlobalSeq ? db.prepare(`
          UPDATE memory_episodes SET event_count = ?, start_event_id = COALESCE(?, start_event_id), end_event_id = COALESCE(?, end_event_id),
            start_seq = COALESCE((SELECT global_seq FROM memory_events WHERE event_id = ?), start_seq),
            end_seq = COALESCE((SELECT global_seq FROM memory_events WHERE event_id = ?), end_seq)
          WHERE episode_id = ?
        `) : db.prepare(`
          UPDATE memory_episodes SET event_count = ?, start_event_id = COALESCE(?, start_event_id), end_event_id = COALESCE(?, end_event_id)
          WHERE episode_id = ?
        `);
                for (const episode of episodes) {
                    const actualCount = Number(count.get(episode.episode_id).count ?? 0);
                    const firstEventId = first.get(episode.episode_id)?.event_id ?? null;
                    const lastEventId = last.get(episode.episode_id)?.event_id ?? null;
                    if (hasEvents && hasGlobalSeq)
                        rebuild.run(actualCount, firstEventId, lastEventId, firstEventId, lastEventId, episode.episode_id);
                    else
                        rebuild.run(actualCount, firstEventId, lastEventId, episode.episode_id);
                }
            }
            const receiptTable = Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'episode_closure_receipts'`).get());
            if (receiptTable) {
                const receipts = db.prepare(`SELECT receipt_id, episode_id, source_event_ids_json FROM episode_closure_receipts`).all();
                const selectPosition = db.prepare(`SELECT event_id, position FROM memory_episode_events WHERE episode_id = ?`);
                const updateReceipt = db.prepare(`UPDATE episode_closure_receipts SET source_event_ids_json = ? WHERE receipt_id = ?`);
                for (const receipt of receipts) {
                    let eventIds;
                    try {
                        const parsed = JSON.parse(receipt.source_event_ids_json);
                        eventIds = Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
                    }
                    catch {
                        eventIds = [];
                    }
                    const positions = new Map(selectPosition.all(receipt.episode_id).map((row) => [row.event_id, row.position]));
                    eventIds.sort((left, right) => (positions.get(left) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right) ?? Number.MAX_SAFE_INTEGER));
                    updateReceipt.run(JSON.stringify(eventIds), receipt.receipt_id);
                }
            }
            db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_episode_events_episode_position_unique
          ON memory_episode_events(episode_id, position);
      `);
        }
    },
    down() {
        // SQLite cannot drop a column without rebuilding the table; keep the compatible additive column.
    },
};
