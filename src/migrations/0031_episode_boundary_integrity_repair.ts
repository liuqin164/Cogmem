import type { Migration } from '../types/Migration.js';
import { sealDuplicateOpenEpisodes } from '../episode/EpisodeActiveScopeGuard.js';

type LinkRow = { rowid: number; episode_id: string; event_id: string; position: number };

function tableExists(db: { prepare(sql: string): { get(...args: unknown[]): unknown } }, name: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));
}

function columns(db: { prepare(sql: string): { all(...args: unknown[]): unknown[] } }, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
}

/**
 * An immutable repair migration for databases which claimed 0030 through
 * `_meta` while only receiving a subset of its DDL/data work.
 */
export const migration_0031: Migration = {
  version: '0031',
  description: 'episode boundary integrity repair',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS _episode_integrity_markers (
        marker TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS import_source_anchors (
        project_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        import_anchor TEXT NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        content_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, source_id, import_anchor)
      );
    `);

    if (tableExists(db, 'memory_events')) {
      if (!columns(db, 'memory_events').has('local_date_source')) {
        db.exec(`ALTER TABLE memory_events ADD COLUMN local_date_source TEXT NOT NULL DEFAULT 'legacy_unknown';`);
      }
      if (columns(db, 'memory_events').has('payload_json')) {
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

    if (tableExists(db, 'memory_episode_events')) {
      const links = db.prepare(`
        SELECT rowid, episode_id, event_id, position
        FROM memory_episode_events
        ORDER BY episode_id, position, event_id, rowid
      `).all() as LinkRow[];
      const temporary = db.prepare(`UPDATE memory_episode_events SET position = ? WHERE rowid = ?`);
      const finalPosition = db.prepare(`UPDATE memory_episode_events SET position = ? WHERE rowid = ?`);
      const counters = new Map<string, number>();
      for (const link of links) temporary.run(-1_000_000_000 - link.rowid, link.rowid);
      for (const link of links) {
        const next = (counters.get(link.episode_id) ?? 0) + 1;
        counters.set(link.episode_id, next);
        finalPosition.run(next, link.rowid);
      }

      if (tableExists(db, 'memory_episodes')) {
        const eventColumns = tableExists(db, 'memory_events') ? columns(db, 'memory_events') : new Set<string>();
        const hasGlobalSeq = eventColumns.has('global_seq');
        const episodes = db.prepare(`SELECT episode_id FROM memory_episodes`).all() as Array<{ episode_id: string }>;
        const count = db.prepare(`SELECT COUNT(*) AS count FROM memory_episode_events WHERE episode_id = ?`);
        const first = db.prepare(`SELECT event_id FROM memory_episode_events WHERE episode_id = ? ORDER BY position, event_id LIMIT 1`);
        const last = db.prepare(`SELECT event_id FROM memory_episode_events WHERE episode_id = ? ORDER BY position DESC, event_id DESC LIMIT 1`);
        const rebuild = hasGlobalSeq ? db.prepare(`
          UPDATE memory_episodes SET event_count = ?, start_event_id = ?, end_event_id = ?,
            start_seq = (SELECT global_seq FROM memory_events WHERE event_id = ?),
            end_seq = (SELECT global_seq FROM memory_events WHERE event_id = ?)
          WHERE episode_id = ?
        `) : db.prepare(`
          UPDATE memory_episodes SET event_count = ?, start_event_id = ?, end_event_id = ? WHERE episode_id = ?
        `);
        const deleteDependents = (episodeId: string) => {
          if (tableExists(db, 'episode_closure_receipts')) db.prepare(`DELETE FROM episode_closure_receipts WHERE episode_id = ?`).run(episodeId);
          if (tableExists(db, 'episode_dream_jobs')) db.prepare(`DELETE FROM episode_dream_jobs WHERE episode_id = ?`).run(episodeId);
          if (tableExists(db, 'episode_cross_refs')) db.prepare(`DELETE FROM episode_cross_refs WHERE episode_id = ? OR referenced_episode_id = ?`).run(episodeId, episodeId);
          if (tableExists(db, 'episode_boundary_decisions')) {
            db.prepare(`DELETE FROM episode_boundary_decisions WHERE previous_episode_id = ? OR resulting_episode_id = ?`).run(episodeId, episodeId);
          }
          db.prepare(`DELETE FROM memory_episodes WHERE episode_id = ?`).run(episodeId);
        };
        for (const episode of episodes) {
          const actual = Number((count.get(episode.episode_id) as { count?: number }).count ?? 0);
          if (actual === 0) {
            // The public schema has non-null pointers. An empty episode cannot
            // represent correct pointer state, so remove it atomically.
            deleteDependents(episode.episode_id);
            continue;
          }
          const firstEventId = (first.get(episode.episode_id) as { event_id?: string } | null)?.event_id;
          const lastEventId = (last.get(episode.episode_id) as { event_id?: string } | null)?.event_id;
          if (!firstEventId || !lastEventId) continue;
          if (hasGlobalSeq) rebuild.run(actual, firstEventId, lastEventId, firstEventId, lastEventId, episode.episode_id);
          else rebuild.run(actual, firstEventId, lastEventId, episode.episode_id);
        }
      }
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_episode_events_episode_position_unique ON memory_episode_events(episode_id, position);`);
    }

    if (tableExists(db, 'memory_episodes')) {
      sealDuplicateOpenEpisodes(db);
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_episodes_one_active_scope
          ON memory_episodes(project_id, session_id, COALESCE(source_agent, ''), COALESCE(conversation_thread_id, ''))
          WHERE status = 'open';
      `);
    }
    db.prepare(`INSERT OR REPLACE INTO _episode_integrity_markers (marker, applied_at) VALUES ('episode_boundary_integrity_0031', ?)`)
      .run(Date.now());
  },
  down() {
    // Integrity repairs are deliberately forward-only.
  },
};
