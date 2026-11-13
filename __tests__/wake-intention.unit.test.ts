import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel, type RawMemoryEventInput } from '../src/factory.js';
import type { KernelEvent } from '../src/events/index.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * Self-set wake intentions, the wake tick and the `prospective-due` producer (F2 of #156).
 *
 * Every instant is a constant; nothing sleeps. The acceptance runs here: an intention fires on time
 * through a three-day silence, fires once and only once, compensates a missed window exactly once,
 * is cancellable, and a companion with no intention registered wakes zero times where a heartbeat
 * would have woken 48.
 */

const T0 = Date.UTC(2026, 10, 10, 9, 0, 0); // 2026-11-10T09:00:00Z
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const AGENT = 'cog';

const scratch = makeTempDir('cogmem-wake-intention-');
let kernel: MemoryKernel;

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath: join(scratch, 'memory.db'), projectTimeZone: 'UTC' });
});

afterAll(() => {
  kernel.close();
});

let seq = 0;
function writeTurn(projectId: string, role: 'user' | 'assistant', occurredAt: number, content = 'a turn'): string {
  seq += 1;
  return kernel.recordRawEvent({
    projectId, threadId: `thread-${seq}`, sessionId: `session-${seq}`, role, content, occurredAt,
  } satisfies RawMemoryEventInput).eventId;
}

describe('registering a wake intention', () => {
  test('a registered intention is pending, listed, audited and on the F1 stream', () => {
    const projectId = 'register';
    const seen: KernelEvent[] = [];
    const subscription = kernel.events.subscribe({ agent: AGENT, types: ['ledger-append'] }, (event) => seen.push(event));

    const intention = kernel.wakeIntentions.register({
      projectId, agentId: AGENT, at: T0 + 2 * HOUR, reason: 'check the deploy',
      sourceRefs: [{ sourceType: 'test', sourceId: 'deploy-run' }], now: T0,
    });
    subscription.unsubscribe();

    expect(intention.intentionId.startsWith('wake-')).toBe(true);
    expect(intention.status).toBe('pending');
    expect(intention.at).toBe(T0 + 2 * HOUR);
    expect(kernel.wakeIntentions.list({ projectId })).toHaveLength(1);
    const audit = kernel.wakeIntentions.audit({ projectId, intentionId: intention.intentionId });
    expect(audit.map((entry) => entry.eventType)).toEqual(['WAKE_INTENTION_SET']);
    expect(audit[0]!.payload.sourceRefs).toEqual([{ sourceType: 'test', sourceId: 'deploy-run' }]);
    // The F1 stream scopes the ledger row to the agent that set it.
    expect(seen.some((event) => (event.payload as { eventType?: string }).eventType === 'WAKE_INTENTION_SET')).toBe(true);
    expect(seen.some((event) => (event.agentIds ?? []).includes(AGENT))).toBe(true);
  });

  test('malformed registrations are refused', () => {
    const base = { projectId: 'register', agentId: AGENT, at: T0 + HOUR, reason: 'why', sourceRefs: [{ sourceType: 'test' }], now: T0 };
    expect(() => kernel.wakeIntentions.register({ ...base, at: Number.NaN })).toThrow('invalid_wake_intention_at');
    expect(() => kernel.wakeIntentions.register({ ...base, reason: '  ' })).toThrow('wake_intention_reason_required');
    expect(() => kernel.wakeIntentions.register({ ...base, sourceRefs: [] })).toThrow('wake_intention_source_refs_required');
    expect(() => kernel.wakeIntentions.register({ ...base, agentId: '' })).toThrow('agent_id_required');
  });
});

describe('cancelling a wake intention', () => {
  test('cancel is idempotent, audited, and a fired intention cannot be cancelled', () => {
    const projectId = 'cancel';
    const intention = kernel.wakeIntentions.register({
      projectId, agentId: AGENT, at: T0 + HOUR, reason: 'cancel me', sourceRefs: [{ sourceType: 'test' }], now: T0,
    });
    const cancelled = kernel.wakeIntentions.cancel(intention.intentionId, { projectId, now: T0 + MINUTE });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelledAt).toBe(T0 + MINUTE);
    // Cancelling twice appends nothing.
    expect(kernel.wakeIntentions.cancel(intention.intentionId, { projectId, now: T0 + 2 * MINUTE }).status).toBe('cancelled');
    expect(kernel.wakeIntentions.audit({ projectId, intentionId: intention.intentionId }).map((entry) => entry.eventType))
      .toEqual(['WAKE_INTENTION_SET', 'WAKE_INTENTION_CANCELLED']);
    expect(kernel.runWakeTick({ projectId, now: T0 + 2 * HOUR }).emitted).toBe(0);

    const fired = kernel.wakeIntentions.register({
      projectId, agentId: AGENT, at: T0 + HOUR, reason: 'let me fire', sourceRefs: [{ sourceType: 'test' }], now: T0,
    });
    expect(kernel.runWakeTick({ projectId, now: T0 + HOUR }).firedWakeIntentions.map((item) => item.intentionId)).toEqual([fired.intentionId]);
    expect(() => kernel.wakeIntentions.cancel(fired.intentionId, { projectId, now: T0 + 2 * HOUR })).toThrow('wake_intention_already_fired');
  });

  test('an unknown or cross-project id is refused', () => {
    expect(() => kernel.wakeIntentions.cancel('wake-nope', { projectId: 'cancel', now: T0 })).toThrow('wake_intention_not_found');
    const intention = kernel.wakeIntentions.register({
      projectId: 'cancel', agentId: AGENT, at: T0 + HOUR, reason: 'scoped', sourceRefs: [{ sourceType: 'test' }], now: T0,
    });
    expect(() => kernel.wakeIntentions.cancel(intention.intentionId, { projectId: 'elsewhere', now: T0 })).toThrow('wake_intention_not_found');
    kernel.wakeIntentions.cancel(intention.intentionId, { projectId: 'cancel', now: T0 });
  });
});

describe('once, and caught up once', () => {
  test('the tick fires exactly at the instant, once', () => {
    const projectId = 'once';
    const intention = kernel.wakeIntentions.register({
      projectId, agentId: AGENT, at: T0 + HOUR, reason: 'fire at the hour', sourceRefs: [{ sourceType: 'test' }], now: T0,
    });
    expect(kernel.runWakeTick({ projectId, now: T0 + HOUR - 1 }).emitted).toBe(0);
    const onTime = kernel.runWakeTick({ projectId, now: T0 + HOUR });
    expect(onTime.firedWakeIntentions).toHaveLength(1);
    expect(onTime.firedWakeIntentions[0]!.missedByMs).toBe(0);
    expect(onTime.emitted).toBe(1);
    expect(kernel.runWakeTick({ projectId, now: T0 + HOUR + 1 }).emitted).toBe(0);
    expect(kernel.runWakeTick({ projectId, now: T0 + 5 * HOUR }).emitted).toBe(0);
    expect(kernel.wakeIntentions.audit({ projectId, intentionId: intention.intentionId }).map((entry) => entry.eventType))
      .toEqual(['WAKE_INTENTION_SET', 'WAKE_INTENTION_FIRED']);
  });

  test('an instant missed while down compensates once, not repeatedly', () => {
    const projectId = 'compensate';
    const intention = kernel.wakeIntentions.register({
      projectId, agentId: AGENT, at: T0 + 2 * HOUR, reason: 'missed while down', sourceRefs: [{ sourceType: 'test' }], now: T0,
    });
    // The process comes back three hours late and ticks once.
    const late = kernel.runWakeTick({ projectId, now: T0 + 5 * HOUR });
    expect(late.firedWakeIntentions).toHaveLength(1);
    expect(late.firedWakeIntentions[0]!.intentionId).toBe(intention.intentionId);
    expect(late.firedWakeIntentions[0]!.missedByMs).toBe(3 * HOUR);
    expect(kernel.runWakeTick({ projectId, now: T0 + 6 * HOUR }).emitted).toBe(0);
    expect(kernel.wakeIntentions.get(intention.intentionId, projectId)?.status).toBe('fired');
  });
});

describe('a daily user silent for three days', () => {
  test('the intention set against the silence fires on time and the block reads the silence', () => {
    const projectId = 'silent';
    writeTurn(projectId, 'user', T0 - 3 * DAY, 'good morning');
    const intention = kernel.wakeIntentions.register({
      projectId, agentId: AGENT, at: T0 - DAY, reason: 'check in if I have not heard',
      sourceRefs: [{ sourceType: 'test', sourceId: 'last-turn' }], now: T0 - 3 * DAY,
    });
    const seen: KernelEvent[] = [];
    const subscription = kernel.events.subscribe({ projectId, types: ['prospective-due'] }, (event) => seen.push(event));

    expect(kernel.runWakeTick({ projectId, now: T0 - DAY - HOUR }).emitted).toBe(0);
    expect(kernel.nextWakeAt({ projectId, now: T0 - DAY - HOUR })).toBe(T0 - DAY);
    const due = kernel.runWakeTick({ projectId, now: T0 - DAY });
    subscription.unsubscribe();

    expect(due.firedWakeIntentions.map((item) => item.intentionId)).toEqual([intention.intentionId]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.payload).toMatchObject({
      kind: 'wake-intention', intentionId: intention.intentionId, agentId: AGENT, dueAt: T0 - DAY, missedByMs: 0,
    });
    // Three days on, the block reads the owner's silence, not just a number difference.
    const block = kernel.temporalContext({ projectId, now: T0 });
    expect(block.silenceMs).toBe(3 * DAY);
    expect(block.sinceLastInteractionMs).toBe(3 * DAY);
    expect(block.density.label).toBe('blank');
  });
});

describe('a companion with nothing to wake for', () => {
  test('zero wakes over a day where a heartbeat would wake 48 times', () => {
    const projectId = 'idle';
    let wakes = 0;
    let heartbeats = 0;
    for (let at = T0; at < T0 + DAY; at += 30 * MINUTE) {
      heartbeats += 1;
      wakes += kernel.runWakeTick({ projectId, now: at }).emitted;
      expect(kernel.nextWakeAt({ projectId, now: at })).toBeNull();
    }
    expect(heartbeats).toBe(48);
    expect(wakes).toBe(0);
  });

  test('nextWakeAt answers the pending instant, then now once it is overdue, then null', () => {
    const projectId = 'next-wake';
    expect(kernel.nextWakeAt({ projectId, now: T0 })).toBeNull();
    const intention = kernel.wakeIntentions.register({
      projectId, agentId: AGENT, at: T0 + 5 * HOUR, reason: 'later', sourceRefs: [{ sourceType: 'test' }], now: T0,
    });
    expect(kernel.nextWakeAt({ projectId, now: T0 })).toBe(T0 + 5 * HOUR);
    expect(kernel.nextWakeAt({ projectId, now: T0 + 6 * HOUR })).toBe(T0 + 6 * HOUR);
    kernel.wakeIntentions.cancel(intention.intentionId, { projectId, now: T0 + 6 * HOUR });
    expect(kernel.nextWakeAt({ projectId, now: T0 + 6 * HOUR })).toBeNull();
  });
});

describe('the dream window runs nothing outside itself', () => {
  test('a window of 02:00-05:00 is open for exactly those hours over two days', () => {
    const projectId = 'dream-window';
    const openHours: number[] = [];
    for (let at = T0; at < T0 + 2 * DAY; at += HOUR) {
      const tick = kernel.runWakeTick({ projectId, now: at, dreamWindow: { startHour: 2, endHour: 5 } });
      if (tick.dreamWindow?.open) openHours.push(new Date(at).getUTCHours());
      // The kernel emits nothing for a window; the caller decides whether to Dream.
      expect(tick.dreamWindow!.nextOpenAt).toBeGreaterThan(at);
    }
    expect(openHours).toEqual([2, 3, 4, 2, 3, 4]);
  });
});

describe('the prospective-due producer', () => {
  test('a confirmed due memory becomes an event, once', () => {
    const projectId = 'prospective';
    const request = writeTurn(projectId, 'user', T0 - 10 * MINUTE, 'Remind me to check CI.');
    const confirmation = writeTurn(projectId, 'user', T0 - 9 * MINUTE, 'Yes, confirm that reminder.');
    const candidate = kernel.prospectiveMemoryService.propose({
      projectId, candidateType: 'reminder', canonicalKey: 'check-ci', title: 'Check CI',
      evidenceEventIds: [request], proposedBy: 'operator', dueAt: T0 - MINUTE,
    });
    // A pending candidate is not yet the owner's: no wake, no anchor.
    expect(kernel.nextWakeAt({ projectId, now: T0 - 2 * MINUTE })).toBeNull();
    expect(kernel.temporalContext({ projectId, now: T0 }).nearestAnchor).toBeNull();
    kernel.prospectiveMemoryService.resolve(candidate.candidateId, { action: 'confirm', confirmationEvidenceEventId: confirmation }, projectId);

    expect(kernel.nextWakeAt({ projectId, now: T0 - 2 * MINUTE })).toBe(T0 - MINUTE);
    const seen: KernelEvent[] = [];
    const subscription = kernel.events.subscribe({ projectId, types: ['prospective-due'] }, (event) => seen.push(event));
    const first = kernel.runWakeTick({ projectId, now: T0 });
    const second = kernel.runWakeTick({ projectId, now: T0 });
    subscription.unsubscribe();

    expect(first.prospectiveDue).toEqual([{ candidateId: candidate.candidateId, candidateType: 'reminder', status: 'confirmed', dueAt: T0 - MINUTE }]);
    expect(first.emitted).toBe(1);
    expect(second.emitted).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.payload).toMatchObject({ kind: 'prospective-memory', candidateId: candidate.candidateId });
    // The due memory is an anchor in the context block, too.
    expect(kernel.temporalContext({ projectId, now: T0 }).nearestAnchor)
      .toMatchObject({ kind: 'prospective-memory', at: T0 - MINUTE, label: 'Check CI', distanceMs: MINUTE });
  });

  test('a wake intention nearer than the due memory wins the anchor', () => {
    const projectId = 'prospective';
    kernel.wakeIntentions.register({
      projectId, agentId: AGENT, at: T0 + 10_000, reason: 'soon', sourceRefs: [{ sourceType: 'test' }], now: T0,
    });
    expect(kernel.temporalContext({ projectId, now: T0 }).nearestAnchor).toMatchObject({ kind: 'wake-intention', label: 'soon' });
  });
});

/**
 * #213: the "already announced" marker is a ledger row, not a process-local Set, so a restart
 * re-announces nothing. Same intent-once gate as the wake-intention FIRED row.
 */
describe('a due prospective memory is announced once across restarts', () => {
  function seed(dbPath: string): string {
    const seeded = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
    try {
      const projectId = 'restart';
      const request = seeded.recordRawEvent({
        projectId, threadId: 'thread-restart', sessionId: 'session-restart', role: 'user', content: 'Remind me to check CI.',
      }).eventId;
      const confirmation = seeded.recordRawEvent({
        projectId, threadId: 'thread-restart', sessionId: 'session-restart', role: 'user', content: 'Yes, confirm that reminder.',
      }).eventId;
      const candidate = seeded.prospectiveMemoryService.propose({
        projectId, candidateType: 'reminder', canonicalKey: 'restart:check-ci', title: 'Check CI',
        evidenceEventIds: [request], proposedBy: 'operator', dueAt: T0 - MINUTE,
      });
      seeded.prospectiveMemoryService.resolve(
        candidate.candidateId, { action: 'confirm', confirmationEvidenceEventId: confirmation }, projectId,
      );
      const first = seeded.runWakeTick({ projectId, now: T0 });
      expect(first.prospectiveDue.map((item) => item.candidateId)).toEqual([candidate.candidateId]);
      return candidate.candidateId;
    } finally {
      seeded.close();
    }
  }

  test('a new kernel on the same database does not replay it', () => {
    const dbPath = join(scratch, 'restart.db');
    const candidateId = seed(dbPath);

    const restarted = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
    try {
      const tick = restarted.runWakeTick({ projectId: 'restart', now: T0 + HOUR });
      expect(tick.prospectiveDue).toEqual([]);
      expect(tick.emitted).toBe(0);
      // Nothing left to wake for: a notified-but-overdue memory must not spin the base timer.
      expect(restarted.nextWakeAt({ projectId: 'restart', now: T0 + HOUR })).toBeNull();
      expect(restarted.prospectiveMemoryService.get(candidateId, 'restart')?.status).toBe('confirmed');
    } finally {
      restarted.close();
    }
  });

  test('deferring after the announcement makes it due again', () => {
    const dbPath = join(scratch, 'redefer.db');
    seed(dbPath);

    const restarted = createMemoryKernel({ dbPath, projectTimeZone: 'UTC' });
    try {
      const candidate = restarted.prospectiveMemoryService.list({ projectId: 'restart', statuses: ['confirmed'] })[0]!;
      const deferredUntil = Date.now() + HOUR;
      restarted.prospectiveMemoryService.resolve(candidate.candidateId, { action: 'defer', deferredUntil }, 'restart');
      expect(restarted.prospectiveMemoryService.listDue({ projectId: 'restart', atTime: deferredUntil })).toHaveLength(1);
      expect(restarted.prospectiveMemoryService.listDue({ projectId: 'restart', atTime: deferredUntil, excludeNotified: true }))
        .toHaveLength(1);
      expect(restarted.runWakeTick({ projectId: 'restart', now: deferredUntil }).prospectiveDue).toHaveLength(1);
      expect(restarted.runWakeTick({ projectId: 'restart', now: deferredUntil + 1 }).prospectiveDue).toEqual([]);
    } finally {
      restarted.close();
    }
  });

  test('a completed or expired memory is never due, marker or no marker', () => {
    const projectId = 'terminal-due';
    const request = writeTurn(projectId, 'user', T0 - 10 * MINUTE, 'Remind me to close the loop.');
    // One user confirmation activates one candidate (the governance rule), so each needs its own.
    const confirmations = [
      writeTurn(projectId, 'user', T0 - 9 * MINUTE, 'Yes, confirm that reminder.'),
      writeTurn(projectId, 'user', T0 - 8 * MINUTE, 'Yes, confirm it too.'),
    ];
    for (const [action, key, confirmation] of [
      ['complete', 'terminal:done', confirmations[0]!],
      ['expire', 'terminal:expired', confirmations[1]!],
    ] as const) {
      const candidate = kernel.prospectiveMemoryService.propose({
        projectId, candidateType: 'reminder', canonicalKey: key, title: key,
        evidenceEventIds: [request], proposedBy: 'operator', dueAt: T0 - MINUTE,
      });
      kernel.prospectiveMemoryService.resolve(candidate.candidateId, { action: 'confirm', confirmationEvidenceEventId: confirmation }, projectId);
      // Announced while it was due, then closed: the due set is a business-status predicate, so the
      // marker is not what keeps it out.
      const announced = kernel.prospectiveMemoryService.listDue({ projectId, atTime: T0 });
      expect(announced.map((memory) => memory.candidateId)).toContain(candidate.candidateId);
      kernel.prospectiveMemoryService.resolve(candidate.candidateId, { action }, projectId);
      expect(kernel.prospectiveMemoryService.listDue({ projectId, atTime: T0, excludeNotified: true })
        .map((memory) => memory.candidateId)).not.toContain(candidate.candidateId);
    }
    expect(kernel.runWakeTick({ projectId, now: T0 }).prospectiveDue).toEqual([]);
  });
});
