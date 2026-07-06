import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryKernel } from '../src/factory.js';

function createTestKernel(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec', episodeBoundary: { maxEvents: 500 } });
  return { dir, kernel };
}

function businessHash(kernel: ReturnType<typeof createMemoryKernel>): string {
  const db = kernel.factStore.getDatabase();
  const tables = [
    'memory_events', 'memory_episodes', 'memory_episode_events', 'episode_closure_receipts',
    'episode_dream_jobs', 'episode_dream_runs', 'episode_boundary_decisions',
    'deep_write_candidates', 'memory_atlas_documents', 'memory_atlas_projection_state', 'memory_edges',
  ].filter((table) => db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table));
  const hash = createHash('sha256');
  for (const table of tables) {
    hash.update(table);
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
    hash.update(JSON.stringify(rows));
  }
  return hash.digest('hex');
}

function seedEpisode(kernel: ReturnType<typeof createMemoryKernel>, input: {
  projectId: string; sessionId: string; eventCount: number; prefix: string; startAt?: number; gapMs?: number;
}) {
  let episodeId = '';
  for (let index = 0; index < input.eventCount; index += 1) {
    const role = index % 3 === 0 ? 'user' : index % 3 === 1 ? 'assistant' : 'tool';
    const event = kernel.recordRawEvent({
      projectId: input.projectId, workspaceId: input.projectId, threadId: input.sessionId, sessionId: input.sessionId,
      role, content: `${input.prefix} event ${index}`, sourceId: 'test', occurredAt: (input.startAt ?? 1_000) + index * (input.gapMs ?? 60_000),
      eventOrdinal: index, localDate: index < input.eventCount / 2 ? '2026-07-04' : '2026-07-05',
    });
    if (!episodeId) {
      episodeId = kernel.episodeStore.createEpisode({
        projectId: input.projectId, sessionId: input.sessionId, sourceAgent: 'test', conversationThreadId: input.sessionId,
        episodeType: 'discussion', importance: 0.4, eventId: event.eventId, occurredAt: event.occurredAt,
      }).episodeId;
    }
    kernel.episodeStore.appendEvent({
      episodeId, eventId: event.eventId,
      relation: role === 'user' && index === 75 ? 'ambiguous_shift' : role === 'tool' ? 'tool_result_context' : 'continues_previous',
      confidence: 1, occurredAt: event.occurredAt,
    });
  }
  return episodeId;
}

test('auditEpisodeBoundaries reports oversized, duration, idle, date, mismatch, zero-user, and remains read-only', () => {
  const { dir, kernel } = createTestKernel('cogmem-boundary-audit-');
  try {
    const firstEpisodeId = seedEpisode(kernel, { projectId: 'brain', sessionId: 'audit', eventCount: 150, prefix: 'audit' });
    const event = kernel.recordRawEvent({
      projectId: 'brain', workspaceId: 'brain', threadId: 'zero', sessionId: 'zero',
      role: 'assistant', content: 'assistant-only legacy tail', sourceId: 'test', occurredAt: 20_000_000,
    });
    const zero = kernel.episodeStore.createEpisode({
      projectId: 'brain', sessionId: 'zero', sourceAgent: 'test', conversationThreadId: 'zero',
      episodeType: 'discussion', importance: 0.2, eventId: event.eventId, occurredAt: event.occurredAt,
    });
    kernel.episodeStore.appendEvent({ episodeId: zero.episodeId, eventId: event.eventId, relation: 'assistant_response', confidence: 1, occurredAt: event.occurredAt });
    kernel.factStore.getDatabase().prepare(`UPDATE memory_episodes SET event_count = event_count + 1 WHERE episode_id = ?`).run(firstEpisodeId);

    const before = businessHash(kernel);
    const audit = kernel.auditEpisodeBoundaries({ projectId: 'brain', maxEvents: 100, maxDurationMs: 1_000, maxIdleGapMs: 500, limit: 10 });
    const after = businessHash(kernel);

    expect(after).toBe(before);
    expect(audit.items.find((item) => item.episodeId === firstEpisodeId)).toEqual(expect.objectContaining({
      severity: 'critical',
      reasons: expect.arrayContaining(['stored_actual_event_count_mismatch', 'event_count_exceeds_max', 'duration_exceeds_max', 'user_turn_idle_gap_exceeds_max']),
      recommendedAction: 'split-plan',
      evidenceIntegrityStatus: 'ok',
      unresolvedEventCount: 0,
    }));
    expect(kernel.auditEpisodeBoundaries({ projectId: 'brain', episodeId: firstEpisodeId }).items[0].reasons)
      .toEqual(expect.arrayContaining(['event_count_exceeds_max', 'duration_exceeds_max']));
    expect(() => kernel.auditEpisodeBoundaries({ projectId: 'other', episodeId: firstEpisodeId })).toThrow('episode_project_mismatch');
    expect(audit.items.find((item) => item.episodeId === zero.episodeId)).toEqual(expect.objectContaining({
      reasons: expect.arrayContaining(['zero_user_event_episode']),
    }));
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = kernel.auditEpisodeBoundaries({ projectId: 'brain', limit: 1, cursor });
      for (const item of page.items) seen.add(item.episodeId);
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(new Set([firstEpisodeId, zero.episodeId]));
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('planEpisodeSplit is deterministic, turn-safe, complete, non-applyable, and read-only', () => {
  const { dir, kernel } = createTestKernel('cogmem-split-plan-');
  try {
    const episodeId = seedEpisode(kernel, { projectId: 'brain', sessionId: 'split', eventCount: 150, prefix: 'split' });

    const before = businessHash(kernel);
    const first = kernel.planEpisodeSplit({ projectId: 'brain', episodeId, maxEvents: 40 });
    const second = kernel.planEpisodeSplit({ projectId: 'brain', episodeId, maxEvents: 40 });
    const after = businessHash(kernel);

    expect(after).toBe(before);
    expect(second.planId).toBe(first.planId);
    expect(first.applyableInCurrentVersion).toBe(false);
    expect(first.applyCommand).toBeNull();
    expect(first.requiresManualReview).toBe(false);
    expect(first.segments.length).toBeGreaterThan(1);
    expect(first.segments.every((segment, index) => segment.segmentIndex === index)).toBe(true);
    expect(first.segments.every((segment) => segment.eventIds === undefined && segment.eventIdsHash)).toBe(true);
    const withIds = kernel.planEpisodeSplit({ projectId: 'brain', episodeId, maxEvents: 40, includeEventIds: true });
    expect(withIds.planId).toBe(first.planId);
    expect(withIds.sourceFingerprint).toBe(first.sourceFingerprint);
    const planned = withIds.segments.flatMap((segment) => segment.eventIds || []);
    expect(new Set(planned).size).toBe(planned.length);
    expect(planned).toEqual(kernel.listEpisodeEventLinks(episodeId).map((link) => link.eventId));

    expect(withIds.segments[0].eventIds.length).toBeGreaterThan(0);
    const event = kernel.recordRawEvent({
      projectId: 'brain', workspaceId: 'brain', threadId: 'split', sessionId: 'split',
      role: 'user', content: 'new fingerprint source', sourceId: 'test', occurredAt: 99_999_999,
    });
    kernel.episodeStore.appendEvent({ episodeId, eventId: event.eventId, relation: 'continues_previous', confidence: 1, occurredAt: event.occurredAt });
    const changed = kernel.planEpisodeSplit({ projectId: 'brain', episodeId, maxEvents: 40 });
    expect(changed.planId).not.toBe(first.planId);
    expect(first.plannerVersion).toBe('episode_split_preview.v1');
    expect(first.normalizedPolicy).toEqual(expect.objectContaining({ maxEvents: 40 }));
    expect(first.proposedBoundaries.length).toBe(first.segments.length - 1);
    expect(first.impactInventory.eventCount).toBe(150);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('split-plan uses turn metadata, boundary policies, and leading non-user tail safely', () => {
  const { dir, kernel } = createTestKernel('cogmem-split-policy-boundaries-');
  try {
    const episode = kernel.episodeStore.createEpisode({
      projectId: 'brain', sessionId: 'turns', sourceAgent: 'test', conversationThreadId: 'turns',
      episodeType: 'discussion', importance: 0.5, eventId: 'planned-start', occurredAt: 1,
    });
    const rows = [
      ['a0', 'assistant', 'leading assistant', 1, 'turn-0', 0, 0, '2026-07-04', 'assistant_response'],
      ['t0', 'tool', 'leading tool', 2, 'turn-0', 0, 1, '2026-07-04', 'tool_result_context'],
      ['u1', 'user', 'first user', 3, 'turn-0', 0, 2, '2026-07-04', 'continues_previous'],
      ['a1', 'assistant', 'answer', 4, 'turn-0', 0, 3, '2026-07-04', 'assistant_response'],
      ['u2', 'user', 'next day user', 90_000_000, 'turn-1', 1, 0, '2026-07-05', 'continues_previous'],
      ['u3', 'user', '换个话题，我们讨论 Atlas 结构。', 90_000_100, 'turn-2', 2, 0, '2026-07-05', 'hard_topic_switch'],
    ] as const;
    for (const [id, role, content, occurredAt, turnId, turnSeq, eventOrdinal, localDate, relation] of rows) {
      const event = kernel.recordRawEvent({
        eventId: id, projectId: 'brain', workspaceId: 'brain', threadId: 'turns', sessionId: 'turns',
        role, content, sourceId: 'test', occurredAt, turnId, turnSeq, eventOrdinal, localDate,
      });
      kernel.episodeStore.appendEvent({ episodeId: episode.episodeId, eventId: event.eventId, relation, confidence: 1, occurredAt });
    }
    const plan = kernel.planEpisodeSplit({
      projectId: 'brain', episodeId: episode.episodeId, maxEvents: 10, maxDurationMs: 86_400_000,
      maxIdleGapMs: 1_000, includeEventIds: true,
    });
    expect(plan.warnings).toContain('leading_non_user_event');
    expect(plan.segments[0].eventIds).toEqual(['a0', 't0', 'u1', 'a1']);
    expect(plan.proposedBoundaries.map((item) => item.reason)).toEqual(expect.arrayContaining([
      'trusted_local_date_boundary',
      'hard_topic_switch_boundary',
    ]));
    const beforeFingerprint = plan.sourceFingerprint;
    kernel.factStore.getDatabase().prepare(`UPDATE memory_events SET turn_id = ? WHERE event_id = ?`).run('turn-edited', 'u2');
    expect(kernel.planEpisodeSplit({ projectId: 'brain', episodeId: episode.episodeId }).sourceFingerprint).not.toBe(beforeFingerprint);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audit and split-plan preserve link/event pairing when raw events are missing', () => {
  const { dir, kernel } = createTestKernel('cogmem-split-missing-raw-');
  try {
    const episodeId = seedEpisode(kernel, { projectId: 'brain', sessionId: 'missing', eventCount: 9, prefix: 'missing' });
    const links = kernel.listEpisodeEventLinks(episodeId);
    kernel.factStore.getDatabase().prepare(`DELETE FROM memory_events WHERE event_id = ?`).run(links[1].eventId);

    const audit = kernel.auditEpisodeBoundaries({ projectId: 'brain', episodeId });
    expect(audit.items[0]).toEqual(expect.objectContaining({
      severity: 'critical',
      requiresManualReview: true,
      evidenceIntegrityStatus: 'missing_raw_events',
      unresolvedEventCount: 1,
      missingRawEventIds: [links[1].eventId],
      reasons: expect.arrayContaining(['unresolved_raw_events']),
    }));

    const plan = kernel.planEpisodeSplit({ projectId: 'brain', episodeId, maxEvents: 4, includeEventIds: true });
    expect(plan.requiresManualReview).toBe(true);
    expect(plan.evidenceIntegrityStatus).toBe('missing_raw_events');
    expect(plan.missingRawEventIds).toEqual([links[1].eventId]);
    expect(plan.segments.flatMap((segment) => segment.eventIds || [])).toEqual(links.map((link) => link.eventId));
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('split-plan bounds event id output even when includeEventIds is true', () => {
  const { dir, kernel } = createTestKernel('cogmem-split-bounded-ids-');
  try {
    const episodeId = seedEpisode(kernel, { projectId: 'brain', sessionId: 'big', eventCount: 520, prefix: 'big' });
    kernel.factStore.getDatabase().prepare(`UPDATE memory_events SET local_date = ? WHERE session_id = ?`).run('2026-07-04', 'big');
    const plan = kernel.planEpisodeSplit({
      projectId: 'brain', episodeId, maxEvents: 1000, maxDurationMs: 86_400_000, maxIdleGapMs: 86_400_000, includeEventIds: true,
    });
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].eventIds).toBeUndefined();
    expect(plan.segments[0].eventIdsOmitted).toBe(520);
    expect(plan.segments[0].eventIdsCursor).toBe('segment:0:eventIds');
    expect(plan.segments[0].eventIdsHash).toMatch(/^[a-f0-9]{64}$/);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
