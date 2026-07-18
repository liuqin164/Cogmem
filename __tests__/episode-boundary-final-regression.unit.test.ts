import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EpisodeStore } from '../src/episode/EpisodeStore.js';
import { EpisodeBoundaryPolicy, normalizeEpisodeBoundaryConfig } from '../src/episode/EpisodeBoundaryPolicy.js';
import { SchemaMigrationRunner, migration_0022, migration_0023, migration_0028, migration_0029, migration_0030, migration_0031 } from '../src/migrations/index.js';
import { EventStore } from '../src/store/EventStore.js';
import { DeepWriteCandidateStore } from '../src/store/DeepWriteCandidateStore.js';
import { classifyTurnRelation } from '../src/episode/TurnRelationClassifier.js';
import { createMemoryKernel } from '../src/factory.js';

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

test('createMemoryKernel upgrades the runtime schema through the current migration', () => {
  const { dir, kernel } = createKernel('cogmem-final-schema-');
  try {
    const db = kernel.factStore.getDatabase();
    expect((db.prepare(`SELECT value FROM _meta WHERE key = 'schema_version'`).get() as { value: string }).value).toBe('54');
    expect((db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_memory_episode_events_episode_position_unique'`).get())).toBeTruthy();
    expect((db.prepare(`PRAGMA table_info(memory_events)`).all() as Array<{ name: string }>).some((row) => row.name === 'local_date_source')).toBe(true);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('effective replay boundaries reset segment state instead of cascading every turn', () => {
  const { dir, kernel } = createKernel('cogmem-final-replay-reset-', { episodeBoundary: { maxEvents: 20 } });
  try {
    const episodeIds = new Set<string>();
    for (let index = 0; index < 45; index += 1) {
      const result = kernel.appendEpisodeMessage({
        projectId: 'brain', sessionId: 'reset', sourceAgent: 'test', role: 'user',
        text: '继续讨论同一个方案', externalMessageId: `reset-${index}`, timestamp: index + 1,
      });
      if (result.episodeId) episodeIds.add(result.episodeId);
    }
    expect(episodeIds.size).toBe(3);
    expect([...episodeIds].map((id) => kernel.getEpisode(id)?.eventCount)).toEqual([20, 20, 5]);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('contextual short accept and negated closure are classified before noise/closure', () => {
  expect(classifyTurnRelation({ currentUserText: '好的', previousAssistantText: '建议采用这个方案吗？' }).relation)
    .toBe('accepts_assistant_proposal');
  expect(classifyTurnRelation('不要按这个方案做').relation).toBe('corrects_previous');
  expect(classifyTurnRelation('not done').relation).toBe('corrects_previous');
});

test('no-active closure is sealed and direct old EpisodeStore schema construction adds compatibility columns', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_episodes (
      episode_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT NOT NULL, source_agent TEXT,
      topic_path TEXT, episode_type TEXT NOT NULL, status TEXT NOT NULL, importance REAL NOT NULL,
      summary TEXT, start_event_id TEXT NOT NULL, end_event_id TEXT NOT NULL, start_seq INTEGER, end_seq INTEGER,
      event_count INTEGER NOT NULL, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, sealed_at INTEGER
    );
    CREATE TABLE memory_episode_events (
      episode_id TEXT NOT NULL, event_id TEXT NOT NULL UNIQUE, position INTEGER NOT NULL,
      relation TEXT NOT NULL, confidence REAL NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (episode_id, event_id)
    );
  `);
  const store = new EpisodeStore(db);
  expect(store.getEpisode('missing')).toBeUndefined();
  expect((db.prepare(`PRAGMA table_info(memory_episodes)`).all() as Array<{ name: string }>).some((row) => row.name === 'dream_status')).toBe(true);
  db.close();

  const { dir, kernel } = createKernel('cogmem-final-closure-');
  try {
    const result = kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'closure-only', sourceAgent: 'test', role: 'user',
      text: '按这个方案做，就这样', externalMessageId: 'closure-only-1', timestamp: 0,
    });
    expect(kernel.getEpisode(result.episodeId!)?.status).toBe('sealed');
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
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
      timestamp: Date.UTC(2026, 6, 6, 14, 30), localDate: '2026-07-06',
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
    expect(kernel.eventStore.getEvent(generated.eventId)!.localDateSource).toBe('generated_project_timezone');
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

test('legacy metadata cannot suppress the 0031 integrity repair', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO _meta VALUES ('schema_version', '31');`);
    const runner = new SchemaMigrationRunner(db, [migration_0031]);
    expect(runner.plan().map((migration) => migration.version)).toEqual(['0031']);
    runner.run();
    expect(db.prepare(`SELECT marker FROM _episode_integrity_markers WHERE marker = 'episode_boundary_integrity_0031'`).get()).toBeTruthy();
  } finally {
    db.close();
  }
});

test('late user events do not trigger clock or trusted-date boundaries or poison snapshot date state', () => {
  const { dir, kernel } = createKernel('cogmem-final-late-event-', {
    episodeBoundary: { timezone: 'UTC', maxDurationMs: 300_000, maxIdleGapMs: 300_000 },
  });
  try {
    const first = kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'late', sourceAgent: 'test', role: 'user', text: 'current day',
      externalMessageId: 'late-1', timestamp: Date.UTC(2026, 6, 10, 10), localDate: '2026-07-10',
    });
    const late = kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'late', sourceAgent: 'test', role: 'user', text: 'late arrival',
      externalMessageId: 'late-2', timestamp: Date.UTC(2026, 6, 9, 10), localDate: '2026-07-09',
    });
    expect(late.boundaryGuardCodes).not.toContain('max_duration_exceeded');
    expect(late.boundaryGuardCodes).not.toContain('max_idle_gap_exceeded');
    expect(late.boundaryGuardCodes).not.toContain('trusted_local_date_changed');
    expect(kernel.episodeStore.getBoundarySnapshot(first.episodeId!, 'UTC').lastTrustedUserLocalDate).toBe('2026-07-10');
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('out-of-order policy retains max-event enforcement but suppresses temporal guards', () => {
  const policy = new EpisodeBoundaryPolicy({ maxEvents: 20, maxDurationMs: 300_000, maxIdleGapMs: 300_000 });
  const result = policy.evaluate({
    active: { eventCount: 20, startedAt: 1_000_000, updatedAt: 2_000_000, lastTrustedLocalDate: '2026-07-10' },
    primaryEvent: { role: 'user', occurredAt: 1, localDate: '2026-07-09', payload: {} },
  });
  expect(result.guardCodes).toEqual(['max_events_exceeded']);
  expect(result.warnings.map((warning) => warning.code)).toContain('out_of_order_timestamp');
});

test('Dream enqueue cannot relabel a processed job as queued and Store enables foreign keys', () => {
  const db = new Database(':memory:');
  try {
    const store = new EpisodeStore(db);
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    const episode = store.createEpisode({ projectId: 'brain', sessionId: 'dream', episodeType: 'discussion', importance: 0.4, eventId: 'dream-1', occurredAt: 1 });
    store.appendEvent({ episodeId: episode.episodeId, eventId: 'dream-1', relation: 'continues_previous', confidence: 1, occurredAt: 1 });
    store.sealEpisode(episode.episodeId, { mode: 'hard', reason: 'test', now: 2 });
    const job = store.claimDreamJobs({ projectId: 'brain', limit: 1, now: 3, leaseMs: 1000, maxAttempts: 3 })[0]!;
    store.completeDreamJob(job.episodeId, job.leaseId, [], 4);
    (store as unknown as { enqueueDreamJob(value: unknown, mode: 'normal', now: number): void }).enqueueDreamJob(store.getEpisode(episode.episodeId)!, 'normal', 5);
    expect(store.getDreamJobState(episode.episodeId)).toBe('processed');
    expect(store.getEpisode(episode.episodeId)?.dreamStatus).toBe('processed');
  } finally {
    db.close();
  }
});

test('0031 removes an empty episode and each dependent table without invalid cross-ref SQL', () => {
  const db = new Database(':memory:');
  try {
    migration_0022.up(db);
    migration_0023.up(db);
    migration_0028.up(db);
    db.exec(`CREATE TABLE episode_cross_refs (cross_ref_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, episode_id TEXT NOT NULL, referenced_episode_id TEXT, relation TEXT NOT NULL, created_by TEXT NOT NULL, confidence REAL NOT NULL, created_at INTEGER NOT NULL);`);
    db.prepare(`INSERT INTO memory_episodes (episode_id, project_id, session_id, episode_type, status, importance, start_event_id, end_event_id, event_count, started_at, updated_at) VALUES ('empty', 'brain', 's', 'discussion', 'open', 0.2, 'x', 'x', 0, 1, 1)`).run();
    db.prepare(`INSERT INTO episode_closure_receipts (receipt_id, episode_id, project_id, closure_mode, closure_reason, source_event_ids_json, episode_type, importance, dream_recommended, dream_mode, created_at) VALUES ('receipt', 'empty', 'brain', 'manual', 'test', '[]', 'discussion', 0.2, 0, 'normal', 1)`).run();
    db.prepare(`INSERT INTO episode_dream_jobs (episode_id, project_id, state, priority, mode_hint, created_at, updated_at) VALUES ('empty', 'brain', 'pending', 1, 'normal', 1, 1)`).run();
    db.prepare(`INSERT INTO episode_cross_refs (cross_ref_id, project_id, episode_id, referenced_episode_id, relation, created_by, confidence, created_at) VALUES ('out', 'brain', 'empty', 'other', 'x', 'test', 1, 1), ('in', 'brain', 'other', 'empty', 'x', 'test', 1, 1)`).run();
    migration_0031.up(db);
    expect(db.prepare(`SELECT 1 FROM memory_episodes WHERE episode_id = 'empty'`).get()).toBeNull();
    expect(db.prepare(`SELECT COUNT(*) AS count FROM episode_closure_receipts WHERE episode_id = 'empty'`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM episode_dream_jobs WHERE episode_id = 'empty'`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM episode_cross_refs WHERE episode_id = 'empty' OR referenced_episode_id = 'empty'`).get()).toEqual({ count: 0 });
  } finally { db.close(); }
});

test('import anchors return the existing event and reject changed content without duplicate raw evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-anchor-'));
  const store = new EventStore(join(dir, 'memory.db'));
  try {
    const input = { streamId: 't', streamType: 'thread' as const, eventType: 'MESSAGE' as const, projectId: 'brain', sourceId: 'importer', threadId: 't', sessionId: 't', role: 'user' as const, occurredAt: 1, payload: { text: 'same', metadata: { importAnchor: 'anchor-1' } } };
    const first = store.append(input);
    const retry = store.append({ ...input, eventId: 'retry' });
    expect(retry.eventId).toBe(first.eventId);
    expect(store.findImportedEventAnchor('brain', 'importer', 'anchor-1')?.eventId).toBe(first.eventId);
    expect(() => store.append({ ...input, eventId: 'changed', payload: { text: 'changed', metadata: { importAnchor: 'anchor-1' } } })).toThrow('import_anchor_content_conflict:anchor-1');
    expect(store.getEventCount()).toBe(1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('staged candidate publication is compare-and-set and public listings hide staged rows', () => {
  const db = new Database(':memory:');
  try {
    const store = new DeepWriteCandidateStore(db);
    const run = store.insertRun({ sourceNeuronIds: [], mode: 'deep', promptHash: 'p', outputHash: 'o', status: 'staged' });
    const candidate = store.insertCandidates([{
      runId: run.runId, candidateType: 'fact', status: 'staged', confidence: 0.9,
      content: { text: 'pending' }, evidence: [],
    }])[0]!;
    expect(store.listCandidates()).toHaveLength(0);
    store.updateCandidateStatus(candidate.candidateId, 'superseded', { reason: 'repair' });
    expect(() => store.publishStagedCandidates(run.runId, [candidate.candidateId], 2))
      .toThrow(`staged_candidate_publish_conflict:${candidate.candidateId}`);
    expect(store.getCandidate(candidate.candidateId)?.status).toBe('superseded');
    expect(() => store.updateRunStatus(run.runId, 'staged', 'succeeded')).not.toThrow();

    const mixedRun = store.insertRun({ sourceNeuronIds: [], mode: 'deep', promptHash: 'mixed-p', outputHash: 'mixed-o', status: 'staged' });
    const mixed = store.insertCandidates([
      { runId: mixedRun.runId, candidateType: 'fact', status: 'candidate', confidence: 0.9, content: {}, evidence: [] },
      { runId: mixedRun.runId, candidateType: 'correction', status: 'needs_confirmation', confidence: 0.7, content: {}, evidence: [] },
      { runId: mixedRun.runId, candidateType: 'diagnostic', status: 'rejected', confidence: 0.1, content: {}, evidence: [] },
      { runId: mixedRun.runId, candidateType: 'shadow', status: 'shadow', confidence: 0.5, content: {}, evidence: [] },
    ]);
    const mixedIds = mixed.map((item) => item.candidateId);
    for (const item of mixed.slice(0, 3)) {
      store.updateCandidateStatus(item.candidateId, 'staged', {
        updatedAt: 3,
      });
      db.prepare(`UPDATE deep_write_candidates SET publish_status = ? WHERE candidate_id = ?`).run(item.status, item.candidateId);
    }
    db.prepare(`UPDATE deep_write_candidates SET publish_status = 'shadow' WHERE candidate_id = ?`).run(mixed[3]!.candidateId);
    store.publishStagedCandidates(mixedRun.runId, mixedIds, 4);
    expect(mixedIds.map((id) => store.getCandidate(id)?.status)).toEqual(['candidate', 'needs_confirmation', 'rejected', 'shadow']);
  } finally {
    db.close();
  }
});

test('promotion claim is single-owner and explicit event ordering never auto-renumbers', () => {
  const db = new Database(':memory:');
  try {
    const candidates = new DeepWriteCandidateStore(db);
    const run = candidates.insertRun({ sourceNeuronIds: [], mode: 'deep', promptHash: 'claim-p', outputHash: 'claim-o', status: 'succeeded' });
    const candidate = candidates.insertCandidates([{
      runId: run.runId, candidateType: 'fact', status: 'candidate', confidence: 0.9, content: {}, evidence: [],
    }])[0]!;
    expect(candidates.claimCandidate(candidate.candidateId, 1)).toBe(true);
    expect(candidates.claimCandidate(candidate.candidateId, 2)).toBe(false);
    expect(candidates.listCandidates()).toHaveLength(0);
    expect(candidates.recoverStalePromoting(2, 3)).toBe(1);
    expect(candidates.getCandidate(candidate.candidateId)?.status).toBe('candidate');
  } finally {
    db.close();
  }

  const dir = mkdtempSync(join(tmpdir(), 'cogmem-explicit-order-'));
  const events = new EventStore(join(dir, 'memory.db'));
  try {
    events.append({ streamId: 'stream', streamType: 'thread', eventType: 'MESSAGE', eventVersion: 5, threadSeq: 10, occurredAt: 1, payload: { text: 'first' } });
    expect(() => events.append({ streamId: 'stream', streamType: 'thread', eventType: 'MESSAGE', eventVersion: 5, threadSeq: 11, occurredAt: 2, payload: { text: 'conflict' } })).toThrow();
  } finally {
    events.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
