import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EpisodeStore } from '../src/episode/EpisodeStore.js';
import { normalizeEpisodeBoundaryConfig } from '../src/episode/EpisodeBoundaryPolicy.js';
import { createMemoryKernel } from '../src/factory.js';
import { migration_0022, migration_0023, migration_0028, migration_0029, migration_0030 } from '../src/migrations/index.js';

function createKernel(prefix: string, options: Parameters<typeof createMemoryKernel>[0] = {}) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec', ...options });
  return { dir, kernel };
}

test('boundary config rejects boolean strings and empty policy version', () => {
  const normalized = normalizeEpisodeBoundaryConfig({
    enabled: 'false' as never,
    auditDecisions: 'true' as never,
    applyToLive: 'false' as never,
    applyToImports: 'false' as never,
    splitOnTrustedLocalDateChange: 'false' as never,
    policyVersion: '',
  });
  expect(normalized.diagnostics.map((item) => item.code).sort()).toEqual([
    'invalid_episode_boundary_apply_to_imports',
    'invalid_episode_boundary_apply_to_live',
    'invalid_episode_boundary_audit_decisions',
    'invalid_episode_boundary_enabled',
    'invalid_episode_boundary_policy_version',
    'invalid_episode_boundary_split_on_trusted_local_date_change',
  ]);
  expect(normalized.config.enabled).toBe(true);
  expect(normalized.config.policyVersion).toBe('episode_boundary.v1');
});

test('timestamp 0 participates in live, audit, and split planner boundary replay', () => {
  const { dir, kernel } = createKernel('cogmem-final-timestamp-zero-', {
    episodeBoundary: { maxDurationMs: 300_000, maxIdleGapMs: 86_400_000 },
  });
  try {
    const first = kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'zero', sourceAgent: 'test',
      role: 'user', text: 'starts at unix zero', externalMessageId: 'z1', timestamp: 0,
    });
    const second = kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'zero', sourceAgent: 'test',
      role: 'user', text: 'duration boundary after zero', externalMessageId: 'z2', timestamp: 300_001,
    });
    expect(second.boundaryApplied).toBe(true);
    expect(second.boundaryGuardCodes).toContain('max_duration_exceeded');

    const audit = kernel.auditEpisodeBoundaries({ projectId: 'brain', episodeId: first.episodeId! }).items[0];
    expect(audit.startedAt).toBe(0);

    const plan = kernel.planEpisodeSplit({ projectId: 'brain', episodeId: second.episodeId! });
    expect(plan.normalizedPolicy.maxDurationMs).toBe(300_000);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('active scope lookup is exact for source and thread, with open plus soft sidecar allowed', () => {
  const db = new Database(':memory:');
  try {
    const store = new EpisodeStore(db);
    const a = store.createEpisode({
      projectId: 'brain', sessionId: 's1', sourceAgent: 'openclaw', conversationThreadId: 'thread-a',
      episodeType: 'discussion', importance: 0.4, eventId: 'a-start', occurredAt: 1,
    });
    const b = store.createEpisode({
      projectId: 'brain', sessionId: 's1', sourceAgent: 'hermes', conversationThreadId: 'thread-a',
      episodeType: 'discussion', importance: 0.4, eventId: 'b-start', occurredAt: 2,
    });
    const c = store.createEpisode({
      projectId: 'brain', sessionId: 's1', sourceAgent: 'openclaw', conversationThreadId: 'thread-b',
      episodeType: 'discussion', importance: 0.4, eventId: 'c-start', occurredAt: 3,
    });
    store.sealEpisode(a.episodeId, { mode: 'soft', reason: 'ambiguous_topic_shift', now: 4 });
    const next = store.createEpisode({
      projectId: 'brain', sessionId: 's1', sourceAgent: 'openclaw', conversationThreadId: 'thread-a',
      episodeType: 'discussion', importance: 0.4, eventId: 'next-start', occurredAt: 5,
    });

    expect(store.findActiveEpisode('brain', 's1', 'openclaw', 'thread-a')?.episodeId).toBe(next.episodeId);
    expect(store.findActiveEpisode('brain', 's1', 'hermes', 'thread-a')?.episodeId).toBe(b.episodeId);
    expect(store.findActiveEpisode('brain', 's1', 'openclaw', 'thread-b')?.episodeId).toBe(c.episodeId);
    expect(store.findActiveEpisode('brain', 's1', undefined, 'thread-a')).toBeUndefined();
  } finally {
    db.close();
  }
});

test('appendEvent is idempotent only for the same target episode', () => {
  const db = new Database(':memory:');
  try {
    const store = new EpisodeStore(db);
    const one = store.createEpisode({ projectId: 'brain', sessionId: 'one', episodeType: 'discussion', importance: 0.4, eventId: 'one-start', occurredAt: 1 });
    const two = store.createEpisode({ projectId: 'brain', sessionId: 'two', episodeType: 'discussion', importance: 0.4, eventId: 'two-start', occurredAt: 1 });
    const first = store.appendEvent({ episodeId: one.episodeId, eventId: 'evt-shared', relation: 'continues_previous', confidence: 1, occurredAt: 0 });
    const same = store.appendEvent({ episodeId: one.episodeId, eventId: 'evt-shared', relation: 'continues_previous', confidence: 1, occurredAt: 0 });
    expect(same).toEqual(first);
    expect(() => store.appendEvent({ episodeId: two.episodeId, eventId: 'evt-shared', relation: 'continues_previous', confidence: 1, occurredAt: 0 }))
      .toThrow('episode_event_link_conflict:evt-shared');
  } finally {
    db.close();
  }
});

test('turn batch validation rejects duplicate event ids and mixed thread before writing links', () => {
  const { dir, kernel } = createKernel('cogmem-final-turn-validation-');
  try {
    const event = kernel.recordRawEvent({
      projectId: 'brain', workspaceId: 'brain', sessionId: 's1', threadId: 't1',
      role: 'user', content: 'duplicate', sourceId: 'test', occurredAt: 1,
    });
    expect(() => kernel.assembleEpisodeTurn([event, event], { projectId: 'brain', sessionId: 's1', conversationThreadId: 't1' }))
      .toThrow('episode_duplicate_event_id');
    expect(kernel.episodeStore.getEventLink(event.eventId)).toBeUndefined();

    const other = kernel.recordRawEvent({
      projectId: 'brain', workspaceId: 'brain', sessionId: 's1', threadId: 't2',
      role: 'assistant', content: 'wrong thread', sourceId: 'test', occurredAt: 2,
    });
    expect(() => kernel.assembleEpisodeTurn([event, other], { projectId: 'brain', sessionId: 's1', conversationThreadId: 't1' }))
      .toThrow('episode_thread_mismatch');
    expect(kernel.episodeStore.getEventLink(other.eventId)).toBeUndefined();
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('localDateSource column drives timezone trust and legacy warnings', () => {
  const { dir, kernel } = createKernel('cogmem-final-local-date-source-', {
    episodeBoundary: { timezone: 'Asia/Tokyo', maxDurationMs: 86_400_000, maxIdleGapMs: 86_400_000 },
  });
  try {
    const explicit = kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'explicit', sourceAgent: 'test',
      role: 'user', text: 'explicit date', externalMessageId: 'e1',
      timestamp: Date.UTC(2026, 6, 6, 15, 30), localDate: '2026-07-06',
    });
    expect(kernel.eventStore.getEvent(explicit.eventId)!.localDateSource).toBe('explicit');

    const generated = kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'generated', sourceAgent: 'test',
      role: 'user', text: 'generated date one', externalMessageId: 'g1',
      timestamp: Date.UTC(2026, 6, 6, 14, 59),
    });
    const generatedNext = kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'generated', sourceAgent: 'test',
      role: 'user', text: 'generated date two', externalMessageId: 'g2',
      timestamp: Date.UTC(2026, 6, 6, 15, 30),
    });
    expect(kernel.eventStore.getEvent(generated.eventId)!.localDateSource).toBe('generated_utc');
    expect(generatedNext.boundaryGuardCodes).toContain('trusted_local_date_changed');

    const db = kernel.factStore.getDatabase();
    db.prepare(`UPDATE memory_events SET local_date_source = 'legacy_unknown' WHERE event_id = ?`).run(explicit.eventId);
    const audit = kernel.auditEpisodeBoundaries({ projectId: 'brain', episodeId: explicit.episodeId! }).items[0];
    expect(audit.reasons).toContain('legacy_unknown_local_date_source');
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration 0030 adds localDateSource and resequences duplicate positions before unique index', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE memory_events(event_id TEXT PRIMARY KEY, occurred_at INTEGER NOT NULL, local_date TEXT);
    `);
    migration_0022.up(db);
    migration_0023.up(db);
    migration_0028.up(db);
    migration_0029.up(db);
    db.prepare(`
      INSERT INTO memory_episodes (
        episode_id, project_id, session_id, episode_type, status, importance,
        start_event_id, end_event_id, event_count, started_at, updated_at
      ) VALUES ('ep', 'brain', 's1', 'discussion', 'open', 0.4, 'evt-1', 'evt-2', 2, 1, 2)
    `).run();
    db.prepare(`
      INSERT INTO memory_episode_events (episode_id, event_id, position, relation, confidence, created_at)
      VALUES ('ep', 'evt-1', 1, 'continues_previous', 1, 1),
        ('ep', 'evt-2', 1, 'continues_previous', 1, 2)
    `).run();

    migration_0030.up(db);

    expect((db.prepare(`PRAGMA table_info(memory_events)`).all() as Array<{ name: string }>).map((row) => row.name))
      .toContain('local_date_source');
    expect(db.prepare(`SELECT position FROM memory_episode_events WHERE event_id = 'evt-2'`).get()).toEqual({ position: 2 });
    expect(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_memory_episode_events_episode_position_unique'`).get()).toBeTruthy();
  } finally {
    db.close();
  }
});
