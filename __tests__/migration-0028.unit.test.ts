import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';

import { EpisodeStore } from '../src/episode/EpisodeStore.js';
import { migration_0022, migration_0023, migration_0024, migration_0028 } from '../src/migrations/index.js';

function columns(db: Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((item) => item.name).sort();
}

function tableCount(db: Database, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

test('migration 0028 creates only boundary decision audit metadata and is idempotent', () => {
  const db = new Database(':memory:');
  try {
    migration_0022.up(db);
    migration_0023.up(db);
    migration_0024.up(db);
    const store = new EpisodeStore(db, (eventId) => ({ eventId, projectId: 'brain' } as never), { initializeSchemaForTests: false });
    const episode = store.createEpisode({
      projectId: 'brain', sessionId: 's1', episodeType: 'discussion', importance: 0.4,
      eventId: 'evt-before', occurredAt: 1,
    });
    store.appendEvent({ episodeId: episode.episodeId, eventId: 'evt-before', relation: 'continues_previous', confidence: 1, occurredAt: 1 });

    migration_0028.up(db);
    migration_0028.up(db);

    expect(columns(db, 'episode_boundary_decisions')).toEqual([
      'cpu_decision_json', 'created_at', 'decision_id', 'final_decision_json', 'guard_action',
      'guard_codes_json', 'metrics_json', 'mode', 'policy_version', 'previous_episode_id',
      'primary_event_id', 'project_id', 'resulting_episode_id', 'reviewer_decision_json',
      'reviewer_invoked', 'session_id', 'source_agent', 'thread_id', 'warnings_json',
    ].sort());
    expect(tableCount(db, 'memory_episodes')).toBe(1);
    expect(tableCount(db, 'memory_episode_events')).toBe(1);
    expect(tableCount(db, 'episode_boundary_decisions')).toBe(0);

    db.prepare(`
      INSERT INTO episode_boundary_decisions (
        decision_id, project_id, session_id, source_agent, thread_id, primary_event_id,
        previous_episode_id, resulting_episode_id, policy_version, mode, guard_action,
        guard_codes_json, metrics_json, cpu_decision_json, reviewer_invoked,
        reviewer_decision_json, final_decision_json, warnings_json, created_at
      ) VALUES ('d1', 'brain', 's1', NULL, NULL, 'evt-before', NULL, NULL,
        'episode_boundary.v1', 'enforce', 'none', '[]', '{}', '{}', 0, NULL, '{}', '[]', 2)
    `).run();
    expect(() => db.prepare(`
      INSERT INTO episode_boundary_decisions (
        decision_id, project_id, session_id, source_agent, thread_id, primary_event_id,
        previous_episode_id, resulting_episode_id, policy_version, mode, guard_action,
        guard_codes_json, metrics_json, cpu_decision_json, reviewer_invoked,
        reviewer_decision_json, final_decision_json, warnings_json, created_at
      ) VALUES ('d2', 'brain', 's1', NULL, NULL, 'evt-before', NULL, NULL,
        'episode_boundary.v1', 'enforce', 'none', '[]', '{}', '{}', 0, NULL, '{}', '[]', 3)
    `).run()).toThrow();
  } finally {
    db.close();
  }
});

test('migration 0028 down removes only boundary decision objects and store bootstrap stays compatible', () => {
  const migrated = new Database(':memory:');
  const bootstrapped = new Database(':memory:');
  try {
    migration_0022.up(migrated);
    migration_0023.up(migrated);
    migration_0024.up(migrated);
    migration_0028.up(migrated);
    new EpisodeStore(bootstrapped);
    expect(columns(bootstrapped, 'episode_boundary_decisions')).toEqual(columns(migrated, 'episode_boundary_decisions'));

    migration_0028.down(migrated);
    expect(migrated.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'episode_boundary_decisions'`).get()).toBeFalsy();
    expect(migrated.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_episodes'`).get()).toBeTruthy();
    expect(migrated.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_episode_events'`).get()).toBeTruthy();
  } finally {
    migrated.close();
    bootstrapped.close();
  }
});
