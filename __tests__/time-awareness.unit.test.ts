import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { computeTemporalContext, evaluateDreamWindow, type TemporalAnchor } from '../src/temporal/index.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The time-context block and the dream-window evaluation (F2 of #156).
 *
 * Every instant here is a constant handed to the kernel; nothing sleeps and nothing reads the wall
 * clock. The pure-function half is checked field by field at its boundaries, and the kernel half
 * builds a real ledger distribution and reconciles the numbers against it.
 */

const T0 = Date.UTC(2026, 10, 10, 9, 0, 0); // 2026-11-10T09:00:00Z, a Tuesday.
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function context(overrides: Partial<Parameters<typeof computeTemporalContext>[0]> = {}) {
  return computeTemporalContext({
    now: T0,
    timeZone: 'UTC',
    occurrences: [],
    ...overrides,
  });
}

describe('the context block renders the local instant', () => {
  test('date, time, weekday and phases at a fixed instant', () => {
    const block = context();
    expect(block.now).toBe(T0);
    expect(block.localDate).toBe('2026-11-10');
    expect(block.localTime).toBe('09:00');
    expect(block.weekday).toBe(2);
    expect(block.hourOfDay).toBe(9);
    expect(block.dayPhase).toBe('morning');
    expect(block.weekPhase).toBe('weekday');
  });

  test('the timezone moves the local rendering, not the instant', () => {
    const tokyo = context({ timeZone: 'Asia/Tokyo' });
    expect(tokyo.localDate).toBe('2026-11-10');
    expect(tokyo.localTime).toBe('18:00');
    expect(tokyo.hourOfDay).toBe(18);
    expect(tokyo.dayPhase).toBe('evening');
  });

  test('day-phase boundaries', () => {
    const hour = (h: number) => context({ now: T0 - 9 * HOUR + h * HOUR }).dayPhase;
    expect(hour(0)).toBe('night');
    expect(hour(5)).toBe('night');
    expect(hour(6)).toBe('morning');
    expect(hour(11)).toBe('morning');
    expect(hour(12)).toBe('afternoon');
    expect(hour(17)).toBe('afternoon');
    expect(hour(18)).toBe('evening');
    expect(hour(23)).toBe('evening');
  });

  test('weekend starts on Saturday', () => {
    expect(context({ now: T0 + 4 * DAY }).weekday).toBe(6);
    expect(context({ now: T0 + 4 * DAY }).weekPhase).toBe('weekend');
    expect(context({ now: T0 + 5 * DAY }).weekday).toBe(7);
    expect(context({ now: T0 + 5 * DAY }).weekPhase).toBe('weekend');
    expect(context({ now: T0 + 6 * DAY }).weekday).toBe(1);
    expect(context({ now: T0 + 6 * DAY }).weekPhase).toBe('weekday');
  });
});

describe('the silence signals distinguish the owner from the conversation', () => {
  test('a reply into an old silence moves the conversation and not the owner silence', () => {
    const block = context({ lastInteractionAt: T0 - HOUR, lastUserTurnAt: T0 - 3 * DAY });
    expect(block.sinceLastInteractionMs).toBe(HOUR);
    expect(block.silenceMs).toBe(3 * DAY);
  });

  test('no turn at all leaves both null', () => {
    const block = context();
    expect(block.lastInteractionAt).toBeNull();
    expect(block.sinceLastInteractionMs).toBeNull();
    expect(block.silenceMs).toBeNull();
  });
});

describe('the density signal labels the interval', () => {
  const at = (occurredAt: number) => ({ occurredAt });

  test('each label at its boundary', () => {
    const label = (count: number) => context({ occurrences: Array.from({ length: count }, (_, i) => at(T0 - i * 60_000)) }).density;
    expect(label(0).label).toBe('blank');
    expect(label(0).interactionCount).toBe(0);
    expect(label(1).label).toBe('quiet');
    expect(label(2).label).toBe('quiet');
    expect(label(3).label).toBe('steady');
    expect(label(9).label).toBe('steady');
    expect(label(10).label).toBe('busy');
  });

  test('span is first-to-last inside the window and 0 for one event', () => {
    const busyDay = context({ occurrences: [at(T0 - 2 * HOUR), at(T0 - HOUR), at(T0)] }).density;
    expect(busyDay.spanMs).toBe(2 * HOUR);
    expect(context({ occurrences: [at(T0 - HOUR)] }).density.spanMs).toBe(0);
  });

  test('a blank three days after a busy day reads blank, not busy', () => {
    const threeDaysAgo = [0, 1, 2, 3, 4].map((i) => at(T0 - 3 * DAY + i * 60_000));
    const block = context({ occurrences: threeDaysAgo });
    expect(block.density.label).toBe('blank');
    expect(block.density.interactionCount).toBe(0);
  });

  test('events older than the window are excluded', () => {
    const block = context({ occurrences: [at(T0 - 25 * HOUR), at(T0 - HOUR)] });
    expect(block.density.interactionCount).toBe(1);
  });
});

describe('the rhythm signal is an hour histogram over the sample', () => {
  test('hours at the threshold are active and below it are quiet', () => {
    const now = T0; // hour 9
    const occurrences = [
      // Three turns in local hour 9 across three days: at the default threshold of 2.
      { occurredAt: now - DAY },
      { occurredAt: now - 2 * DAY },
      { occurredAt: now - 3 * DAY },
      // One turn in local hour 20 on the previous day: below the threshold.
      { occurredAt: now - 13 * HOUR },
    ];
    const block = context({ now, occurrences });
    expect(block.rhythm.sampleDays).toBe(14);
    expect(block.rhythm.activeHours).toEqual([9]);
    expect(block.rhythm.phase).toBe('active');
    // Same ledger, current hour 20: the histogram is unchanged and the phase flips to quiet.
    const evening = context({ now: now + 11 * HOUR, occurrences });
    expect(evening.rhythm.activeHours).toEqual([9]);
    expect(evening.rhythm.phase).toBe('quiet');
  });

  test('events outside the sample do not count', () => {
    const block = context({ occurrences: [{ occurredAt: T0 - 20 * DAY }, { occurredAt: T0 - 21 * DAY }] });
    expect(block.rhythm.activeHours).toEqual([]);
    expect(block.rhythm.phase).toBe('quiet');
  });
});

describe('the nearest anchor is the closest in time', () => {
  const anchor = (at: number, label: string): TemporalAnchor => ({ kind: 'wake-intention', at, label });

  test('picks the smaller distance', () => {
    const block = context({ anchors: [anchor(T0 + HOUR, 'later'), anchor(T0 - 30 * 60_000, 'sooner')] });
    expect(block.nearestAnchor?.label).toBe('sooner');
    expect(block.nearestAnchor?.distanceMs).toBe(30 * 60_000);
  });

  test('a tie picks the earlier instant', () => {
    const block = context({ anchors: [anchor(T0 + HOUR, 'later'), anchor(T0 - HOUR, 'earlier')] });
    expect(block.nearestAnchor?.label).toBe('earlier');
    expect(block.nearestAnchor?.at).toBe(T0 - HOUR);
  });

  test('no anchors reads null', () => {
    expect(context().nearestAnchor).toBeNull();
  });
});

describe('the dream window evaluates open, closed and wrap-around', () => {
  const window = { startHour: 2, endHour: 5 };

  test('inside the window', () => {
    const result = evaluateDreamWindow({ now: Date.UTC(2026, 10, 10, 3), timeZone: 'UTC', window });
    expect(result.open).toBe(true);
    expect(result.windowStartAt).toBe(Date.UTC(2026, 10, 10, 2));
    expect(result.windowEndAt).toBe(Date.UTC(2026, 10, 10, 5));
    expect(result.nextOpenAt).toBe(Date.UTC(2026, 10, 11, 2));
  });

  test('before and after the window point at the next opening', () => {
    const before = evaluateDreamWindow({ now: Date.UTC(2026, 10, 10, 1), timeZone: 'UTC', window });
    expect(before.open).toBe(false);
    expect(before.nextOpenAt).toBe(Date.UTC(2026, 10, 10, 2));
    const after = evaluateDreamWindow({ now: Date.UTC(2026, 10, 10, 6), timeZone: 'UTC', window });
    expect(after.open).toBe(false);
    expect(after.nextOpenAt).toBe(Date.UTC(2026, 10, 11, 2));
    expect(after.windowEndAt).toBe(Date.UTC(2026, 10, 10, 5));
  });

  test('a window that wraps past midnight', () => {
    const wrap = { startHour: 23, endHour: 7 };
    const lateNight = evaluateDreamWindow({ now: Date.UTC(2026, 10, 10, 23, 30), timeZone: 'UTC', window: wrap });
    expect(lateNight.open).toBe(true);
    expect(lateNight.windowStartAt).toBe(Date.UTC(2026, 10, 10, 23));
    expect(lateNight.windowEndAt).toBe(Date.UTC(2026, 10, 11, 7));
    const earlyMorning = evaluateDreamWindow({ now: Date.UTC(2026, 10, 11, 6), timeZone: 'UTC', window: wrap });
    expect(earlyMorning.open).toBe(true);
    expect(earlyMorning.windowStartAt).toBe(Date.UTC(2026, 10, 10, 23));
    const afterClose = evaluateDreamWindow({ now: Date.UTC(2026, 10, 11, 8), timeZone: 'UTC', window: wrap });
    expect(afterClose.open).toBe(false);
    expect(afterClose.nextOpenAt).toBe(Date.UTC(2026, 10, 11, 23));
  });

  test('start equal to end means open all day', () => {
    const result = evaluateDreamWindow({ now: Date.UTC(2026, 10, 10, 12), timeZone: 'UTC', window: { startHour: 4, endHour: 4 } });
    expect(result.open).toBe(true);
  });

  test('an out-of-range hour is refused', () => {
    expect(() => evaluateDreamWindow({ now: T0, timeZone: 'UTC', window: { startHour: 24, endHour: 5 } })).toThrow('invalid_dream_window_start_hour');
  });
});

describe('the kernel reads a ledger distribution into the block', () => {
  const scratch = makeTempDir('cogmem-time-awareness-');
  let kernel: MemoryKernel;

  beforeAll(() => {
    kernel = createMemoryKernel({ dbPath: join(scratch, 'memory.db'), projectTimeZone: 'UTC' });
  });

  afterAll(() => {
    kernel.close();
  });

  test('a daily user silent for three days reconciles field by field', () => {
    const projectId = 'daily-user';
    kernel.recordRawEvent({ projectId, threadId: 't1', role: 'user', content: 'a daily turn', occurredAt: T0 - 3 * DAY });
    kernel.recordRawEvent({ projectId, threadId: 't1', role: 'assistant', content: 'a reply', occurredAt: T0 - 3 * DAY + 60_000 });

    const block = kernel.temporalContext({ projectId, now: T0 });
    expect(block.localDate).toBe('2026-11-10');
    expect(block.weekday).toBe(2);
    expect(block.lastInteractionAt).toBe(T0 - 3 * DAY + 60_000);
    expect(block.sinceLastInteractionMs).toBe(3 * DAY - 60_000);
    expect(block.silenceMs).toBe(3 * DAY);
    expect(block.density.label).toBe('blank');
    expect(block.density.interactionCount).toBe(0);
    // The habit still shows in the rhythm signal even though the last 24 h are empty: two turns in
    // local hour 9 is the threshold.
    expect(block.rhythm.activeHours).toEqual([9]);
    expect(block.rhythm.phase).toBe('active');
  });

  test('a busy morning reads busy and marks the hour active', () => {
    const projectId = 'busy-morning';
    for (let i = 0; i < 10; i += 1) {
      kernel.recordRawEvent({ projectId, threadId: 't2', role: 'user', content: `turn ${i}`, occurredAt: T0 - 2 * HOUR + i * 60_000 });
    }
    const block = kernel.temporalContext({ projectId, now: T0 });
    expect(block.density.label).toBe('busy');
    expect(block.density.interactionCount).toBe(10);
    expect(block.density.spanMs).toBe(9 * 60_000);
    expect(block.rhythm.activeHours).toEqual([7]);
    expect(block.silenceMs).toBe(111 * 60_000);
  });

  test('an assistant reply into an old silence moves one signal only', () => {
    const projectId = 'mixed';
    kernel.recordRawEvent({ projectId, threadId: 't3', role: 'user', content: 'old question', occurredAt: T0 - 3 * DAY });
    kernel.recordRawEvent({ projectId, threadId: 't3', role: 'assistant', content: 'unprompted later', occurredAt: T0 - HOUR });
    const block = kernel.temporalContext({ projectId, now: T0 });
    expect(block.sinceLastInteractionMs).toBe(HOUR);
    expect(block.silenceMs).toBe(3 * DAY);
    expect(block.density.interactionCount).toBe(1);
    expect(block.density.label).toBe('quiet');
  });

  test('another project and a later row do not leak in', () => {
    const block = kernel.temporalContext({ projectId: 'daily-user', now: T0 });
    expect(block.density.interactionCount).toBe(0);
    expect(block.silenceMs).toBe(3 * DAY);
  });
});
