import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';

import { migration_0022, migration_0023, migration_0029 } from '../src/migrations/index.js';

function setupDb(): Database {
  const db = new Database(':memory:');
  migration_0022.up(db);
  migration_0023.up(db);
  return db;
}

function insertEpisode(db: Database, input: {
  episodeId: string; projectId?: string; sessionId?: string; sourceAgent?: string | null; threadId?: string | null;
  status: 'open' | 'soft_sealed' | 'sealed'; updatedAt: number;
}) {
  db.prepare(`
    INSERT INTO memory_episodes (
      episode_id, project_id, session_id, source_agent, conversation_thread_id,
      episode_type, status, importance, start_event_id, end_event_id, event_count,
      started_at, updated_at, sealed_at
    ) VALUES (?, ?, ?, ?, ?, 'discussion', ?, 0.4, ?, ?, 0, ?, ?, NULL)
  `).run(
    input.episodeId,
    input.projectId ?? 'brain',
    input.sessionId ?? 's1',
    'sourceAgent' in input ? input.sourceAgent : 'test',
    'threadId' in input ? input.threadId : 's1',
    input.status,
    `${input.episodeId}-start`,
    `${input.episodeId}-end`,
    input.updatedAt,
    input.updatedAt,
  );
}

test('migration 0029 seals duplicate open episodes before creating open-only active scope index', () => {
  const db = setupDb();
  try {
    insertEpisode(db, { episodeId: 'older-open', status: 'open', updatedAt: 100 });
    insertEpisode(db, { episodeId: 'newer-open', status: 'open', updatedAt: 200 });
    insertEpisode(db, { episodeId: 'soft-sidecar', status: 'soft_sealed', updatedAt: 300 });
    insertEpisode(db, { episodeId: 'legacy-null-older', sourceAgent: null, threadId: null, status: 'open', updatedAt: 100 });
    insertEpisode(db, { episodeId: 'legacy-null-newer', sourceAgent: null, threadId: null, status: 'open', updatedAt: 400 });

    migration_0029.up(db);

    expect(db.prepare(`SELECT status FROM memory_episodes WHERE episode_id = 'newer-open'`).get()).toEqual({ status: 'open' });
    expect(db.prepare(`SELECT status FROM memory_episodes WHERE episode_id = 'older-open'`).get()).toEqual({ status: 'sealed' });
    expect(db.prepare(`SELECT status FROM memory_episodes WHERE episode_id = 'soft-sidecar'`).get()).toEqual({ status: 'soft_sealed' });
    expect(db.prepare(`SELECT status FROM memory_episodes WHERE episode_id = 'legacy-null-newer'`).get()).toEqual({ status: 'open' });
    expect(db.prepare(`SELECT status FROM memory_episodes WHERE episode_id = 'legacy-null-older'`).get()).toEqual({ status: 'sealed' });
    expect(db.prepare(`
      SELECT requires_review AS requiresReview, closure_reason_code AS reasonCode
      FROM episode_closure_receipts WHERE episode_id = 'older-open'
    `).get()).toEqual({ requiresReview: 1, reasonCode: 'migration_duplicate_open_scope' });
    const indexSql = db.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_memory_episodes_one_active_scope'
    `).get() as { sql: string };
    expect(indexSql.sql).toContain(`WHERE status = 'open'`);
  } finally {
    db.close();
  }
});
