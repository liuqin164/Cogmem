import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernelOptions } from '../src/factory.js';

function createTestKernel(prefix: string, options: MemoryKernelOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const kernel = createMemoryKernel({
    dbPath: join(dir, 'memory.db'),
    vectorBackend: 'sqlite-vec',
    episodeBoundary: { maxEvents: 500, ...options.episodeBoundary },
    ...options,
  });
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
    const firstEpisodeId = seedEpisode(kernel, { projectId: 'brain', sessionId: 'audit', eventCount: 150, prefix: 'audit', gapMs: 600_000 });
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
    const audit = kernel.auditEpisodeBoundaries({ projectId: 'brain', maxEvents: 100, maxDurationMs: 300_000, maxIdleGapMs: 300_000, limit: 10 });
    const after = businessHash(kernel);

    expect(after).toBe(before);
    expect(audit.items.find((item) => item.episodeId === firstEpisodeId)).toEqual(expect.objectContaining({
      severity: 'critical',
      reasons: expect.arrayContaining(['stored_actual_event_count_mismatch', 'event_count_exceeds_max', 'duration_exceeds_max', 'boundary_idle_gap_exceeds_max']),
      recommendedAction: 'split-plan',
      evidenceIntegrityStatus: 'ok',
      unresolvedEventCount: 0,
      maxBoundaryIdleGapMs: 600_000,
    }));
    const defaultAuditReasons = kernel.auditEpisodeBoundaries({ projectId: 'brain', episodeId: firstEpisodeId }).items[0].reasons;
    expect(defaultAuditReasons).toContain('duration_exceeds_max');
    expect(defaultAuditReasons).not.toContain('event_count_exceeds_max');
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

test('audit idle gap uses online boundary semantics instead of user-to-user gap', () => {
  const { dir, kernel } = createTestKernel('cogmem-boundary-audit-idle-semantics-');
  try {
    const base = 1_000_000;
    const episode = kernel.episodeStore.createEpisode({
      projectId: 'brain', sessionId: 'idle', sourceAgent: 'test', conversationThreadId: 'idle',
      episodeType: 'discussion', importance: 0.4, eventId: 'idle-start', occurredAt: base,
    });
    const rows = [
      ['u0', 'user', base],
      ['a40', 'assistant', base + 40 * 60_000],
      ['u50', 'user', base + 50 * 60_000],
    ] as const;
    for (const [id, role, occurredAt] of rows) {
      const event = kernel.recordRawEvent({
        eventId: id, projectId: 'brain', workspaceId: 'brain', threadId: 'idle', sessionId: 'idle',
        role, content: id, sourceId: 'test', occurredAt, localDate: '2026-07-06',
      });
      kernel.episodeStore.appendEvent({
        episodeId: episode.episodeId, eventId: event.eventId,
        relation: role === 'assistant' ? 'assistant_response' : 'continues_previous',
        confidence: 1, occurredAt,
      });
    }

    const audit = kernel.auditEpisodeBoundaries({
      projectId: 'brain', episodeId: episode.episodeId,
      maxEvents: 20, maxDurationMs: 7_200_000, maxIdleGapMs: 30 * 60_000,
    }).items[0];
    expect(audit.maxUserTurnGapMs).toBe(50 * 60_000);
    expect(audit.maxBoundaryIdleGapMs).toBe(10 * 60_000);
    expect(audit.reasons).not.toContain('user_turn_idle_gap_exceeds_max');
    expect(audit.reasons).not.toContain('boundary_idle_gap_exceeds_max');
    expect(audit.recommendedAction).toBe('none');
    expect(kernel.planEpisodeSplit({
      projectId: 'brain', episodeId: episode.episodeId,
      maxEvents: 20, maxDurationMs: 7_200_000, maxIdleGapMs: 30 * 60_000, includeEventIds: true,
    }).segments).toHaveLength(1);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audit replays live boundary semantics for explicit closure overflow and diagnostics', () => {
  const { dir, kernel } = createTestKernel('cogmem-boundary-audit-closure-');
  try {
    const first = kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'closure-overflow', sourceAgent: 'hermes',
      role: 'user', text: '我们讨论一个明确方案。', externalMessageId: 'co-u1', timestamp: 1,
    });
    for (let index = 2; index <= 20; index += 1) {
      kernel.appendEpisodeMessage({
        projectId: 'brain', sessionId: 'closure-overflow', sourceAgent: 'hermes',
        role: 'assistant', text: `继续补充 ${index}。`, externalMessageId: `co-a${index}`, timestamp: index,
      });
    }
    kernel.appendEpisodeMessage({
      projectId: 'brain', sessionId: 'closure-overflow', sourceAgent: 'hermes',
      role: 'user', text: '按这个方案做，就这样。', externalMessageId: 'co-u21', timestamp: 21,
    });

    const audit = kernel.auditEpisodeBoundaries({
      projectId: 'brain', episodeId: first.episodeId!, maxEvents: 20,
      maxDurationMs: Number.NaN, maxIdleGapMs: 1,
    }).items[0];
    expect(audit.actualLinkedEventCount).toBe(21);
    expect(audit.reasons).not.toContain('event_count_exceeds_max');
    expect(audit.recommendedAction).toBe('none');
    expect(audit.warnings).toEqual(expect.arrayContaining([
      'invalid_episode_boundary_max_duration_ms',
      'invalid_episode_boundary_max_idle_gap_ms',
    ]));

    const plan = kernel.planEpisodeSplit({ projectId: 'brain', episodeId: first.episodeId!, maxEvents: 20, includeEventIds: true });
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].eventIds?.at(-1)).toBe(kernel.listEpisodeEventLinks(first.episodeId!).at(-1)?.eventId);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audit out-of-order detection uses running max rather than adjacent pair only', () => {
  const { dir, kernel } = createTestKernel('cogmem-boundary-audit-running-max-');
  try {
    const episode = kernel.episodeStore.createEpisode({
      projectId: 'brain', sessionId: 'ooo', sourceAgent: 'test', conversationThreadId: 'ooo',
      episodeType: 'discussion', importance: 0.4, eventId: 'ooo-start', occurredAt: 1_000,
    });
    const rows = [
      ['u0', 'user', 1_000],
      ['a100', 'assistant', 101_000],
      ['a50', 'assistant', 51_000],
      ['u75', 'user', 76_000],
    ] as const;
    for (const [id, role, occurredAt] of rows) {
      const event = kernel.recordRawEvent({
        eventId: id, projectId: 'brain', workspaceId: 'brain', threadId: 'ooo', sessionId: 'ooo',
        role, content: id, sourceId: 'test', occurredAt, localDate: '2026-07-06',
      });
      kernel.episodeStore.appendEvent({ episodeId: episode.episodeId, eventId: event.eventId, relation: role === 'user' ? 'continues_previous' : 'assistant_response', confidence: 1, occurredAt });
    }
    const audit = kernel.auditEpisodeBoundaries({ projectId: 'brain', episodeId: episode.episodeId }).items[0];
    expect(audit.outOfOrderEventCount).toBe(2);
    expect(audit.reasons).toContain('out_of_order_events');
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
      ['a-midnight', 'assistant', 'assistant after midnight', 5, 'turn-0', 0, 4, '2026-07-05', 'assistant_response'],
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
    expect(plan.segments[0].eventIds).toEqual(['a0', 't0', 'u1', 'a1', 'a-midnight']);
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

test('split-plan reads explicit boundary relation from the user event inside a logical turn', () => {
  const { dir, kernel } = createTestKernel('cogmem-split-user-boundary-relation-', {
    episodeBoundary: { maxEvents: 20, maxDurationMs: 300_000, maxIdleGapMs: 300_000 },
  });
  try {
    const episode = kernel.episodeStore.createEpisode({
      projectId: 'brain', sessionId: 'user-boundary', sourceAgent: 'test', conversationThreadId: 'user-boundary',
      episodeType: 'discussion', importance: 0.5, eventId: 'ub-start', occurredAt: 1,
    });
    const rows = [
      ['ub-u0', 'user', 1, 'turn-0', '2026-07-04', 'continues_previous'],
      ['ub-a1', 'assistant', 90_000_000, 'turn-1', '2026-07-05', 'assistant_response'],
      ['ub-t1', 'tool', 90_000_001, 'turn-1', '2026-07-05', 'tool_result_context'],
      ['ub-u1', 'user', 90_000_002, 'turn-1', '2026-07-05', 'closes_episode'],
      ['ub-a2', 'assistant', 180_000_000, 'turn-2', '2026-07-06', 'assistant_response'],
      ['ub-t2', 'tool', 180_000_001, 'turn-2', '2026-07-06', 'tool_result_context'],
      ['ub-u2', 'user', 180_000_002, 'turn-2', '2026-07-06', 'hard_topic_switch'],
    ] as const;
    for (const [eventId, role, occurredAt, turnId, localDate, relation] of rows) {
      const event = kernel.recordRawEvent({
        eventId, projectId: 'brain', workspaceId: 'brain', threadId: 'user-boundary', sessionId: 'user-boundary',
        role, content: eventId, sourceId: 'test', occurredAt, turnId, localDate,
      });
      kernel.episodeStore.appendEvent({ episodeId: episode.episodeId, eventId: event.eventId, relation, confidence: 1, occurredAt });
    }

    const plan = kernel.planEpisodeSplit({ projectId: 'brain', episodeId: episode.episodeId, includeEventIds: true });
    expect(plan.segments[0].eventIds).toEqual(['ub-u0', 'ub-a1', 'ub-t1', 'ub-u1']);
    expect(plan.proposedBoundaries).toEqual([
      expect.objectContaining({
        afterEventId: 'ub-u2',
        relation: 'hard_topic_switch',
        reason: 'hard_topic_switch_boundary',
      }),
    ]);
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

test('audit and split-plan default to live runtime boundary config', () => {
  const { dir, kernel } = createTestKernel('cogmem-boundary-runtime-config-', { episodeBoundary: { maxEvents: 20 } });
  try {
    const episode = kernel.episodeStore.createEpisode({
      projectId: 'brain', sessionId: 'runtime', sourceAgent: 'test', conversationThreadId: 'runtime',
      episodeType: 'discussion', importance: 0.4, eventId: 'runtime-start', occurredAt: 1,
    });
    for (let index = 0; index < 21; index += 1) {
      const role = index === 0 || index === 20 ? 'user' : 'assistant';
      const event = kernel.recordRawEvent({
        eventId: `runtime-${index}`, projectId: 'brain', workspaceId: 'brain', threadId: 'runtime', sessionId: 'runtime',
        role, content: `runtime ${index}`, sourceId: 'test', occurredAt: index + 1, localDate: '2026-07-06',
      });
      kernel.episodeStore.appendEvent({
        episodeId: episode.episodeId, eventId: event.eventId,
        relation: role === 'user' ? 'continues_previous' : 'assistant_response',
        confidence: 1, occurredAt: event.occurredAt,
      });
    }

    const audit = kernel.auditEpisodeBoundaries({ projectId: 'brain', episodeId: episode.episodeId }).items[0];
    expect(audit.reasons).toContain('event_count_exceeds_max');
    const plan = kernel.planEpisodeSplit({ projectId: 'brain', episodeId: episode.episodeId });
    expect(plan.normalizedPolicy.maxEvents).toBe(20);
    expect(plan.segments).toHaveLength(2);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audit replay honors applyToImports=false from live config', () => {
  const { dir, kernel } = createTestKernel('cogmem-boundary-import-config-', { episodeBoundary: { maxEvents: 20, applyToImports: false } });
  try {
    const episode = kernel.episodeStore.createEpisode({
      projectId: 'brain', sessionId: 'import-runtime', sourceAgent: 'test', conversationThreadId: 'import-runtime',
      episodeType: 'discussion', importance: 0.4, eventId: 'import-runtime-start', occurredAt: 1,
    });
    for (let index = 0; index < 21; index += 1) {
      const role = index === 0 || index === 20 ? 'user' : 'assistant';
      const event = kernel.recordRawEvent({
        eventId: `import-runtime-${index}`, projectId: 'brain', workspaceId: 'brain', threadId: 'import-runtime', sessionId: 'import-runtime',
        role, content: `import runtime ${index}`, sourceId: 'test', occurredAt: index + 1, localDate: '2026-07-06',
        metadata: { imported: true },
      });
      kernel.episodeStore.appendEvent({
        episodeId: episode.episodeId, eventId: event.eventId,
        relation: role === 'user' ? 'continues_previous' : 'assistant_response',
        confidence: 1, occurredAt: event.occurredAt,
      });
    }

    const audit = kernel.auditEpisodeBoundaries({ projectId: 'brain', episodeId: episode.episodeId }).items[0];
    expect(audit.reasons).not.toContain('event_count_exceeds_max');
    expect(audit.recommendedAction).toBe('none');
    const plan = kernel.planEpisodeSplit({ projectId: 'brain', episodeId: episode.episodeId, includeEventIds: true });
    expect(plan.normalizedPolicy.applyToImports).toBe(false);
    expect(plan.segments).toHaveLength(1);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audit and split-plan honor date boundary policy and surface invalid localDate warnings', () => {
  const { dir, kernel } = createTestKernel('cogmem-split-date-policy-', {
    episodeBoundary: { splitOnTrustedLocalDateChange: false, maxDurationMs: 86_400_000, maxIdleGapMs: 86_400_000 },
  });
  try {
    const episode = kernel.episodeStore.createEpisode({
      projectId: 'brain', sessionId: 'date-policy', sourceAgent: 'test', conversationThreadId: 'date-policy',
      episodeType: 'discussion', importance: 0.5, eventId: 'dp-start', occurredAt: 1,
    });
    const rows = [
      ['dp-u0', 'user', 1, 'turn-0', '2026-07-04'],
      ['dp-u1', 'user', 2, 'turn-1', '2026-07-05'],
      ['dp-u2', 'user', 3, 'turn-2', '2026-99-99'],
    ] as const;
    for (const [eventId, role, occurredAt, turnId, localDate] of rows) {
      const event = kernel.recordRawEvent({
        eventId, projectId: 'brain', workspaceId: 'brain', threadId: 'date-policy', sessionId: 'date-policy',
        role, content: eventId, sourceId: 'test', occurredAt, turnId, localDate,
      });
      kernel.episodeStore.appendEvent({ episodeId: episode.episodeId, eventId: event.eventId, relation: 'continues_previous', confidence: 1, occurredAt });
    }

    const plan = kernel.planEpisodeSplit({ projectId: 'brain', episodeId: episode.episodeId, includeEventIds: true });
    expect(plan.normalizedPolicy.splitOnTrustedLocalDateChange).toBe(false);
    expect(plan.proposedBoundaries.map((item) => item.reason)).not.toContain('trusted_local_date_boundary');
    expect(plan.warnings).toContain('invalid_trusted_local_date');
    expect(plan.impactInventory.trustedLocalDates).toEqual(['2026-07-04', '2026-07-05']);

    const audit = kernel.auditEpisodeBoundaries({ projectId: 'brain', episodeId: episode.episodeId }).items[0];
    expect(audit.warnings).toContain('invalid_trusted_local_date');
    expect(audit.reasons).not.toContain('multiple_trusted_local_dates');
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('split-plan bounds event id output even when includeEventIds is true', () => {
  const { dir, kernel } = createTestKernel('cogmem-split-bounded-ids-');
  try {
    let episodeId = '';
    for (let index = 0; index < 520; index += 1) {
      const event = kernel.recordRawEvent({
        projectId: 'brain', workspaceId: 'brain', threadId: 'big', sessionId: 'big',
        role: 'assistant', content: `big event ${index}`, sourceId: 'test',
        occurredAt: 1_000 + index, eventOrdinal: index, localDate: '2026-07-04',
      });
      if (!episodeId) {
        episodeId = kernel.episodeStore.createEpisode({
          projectId: 'brain', sessionId: 'big', sourceAgent: 'test', conversationThreadId: 'big',
          episodeType: 'discussion', importance: 0.2, eventId: event.eventId, occurredAt: event.occurredAt,
        }).episodeId;
      }
      kernel.episodeStore.appendEvent({ episodeId, eventId: event.eventId, relation: 'assistant_response', confidence: 1, occurredAt: event.occurredAt });
    }
    const plan = kernel.planEpisodeSplit({
      projectId: 'brain', episodeId, maxEvents: 500, maxDurationMs: 86_400_000, maxIdleGapMs: 86_400_000, includeEventIds: true,
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
