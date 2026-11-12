/**
 * The time-awareness contract's code half (F2 of #156): the block the kernel hands a shell at
 * wake/turn start, and the schedule evaluation a shell's timer reads instead of polling.
 *
 * The written contract is `docs/time-awareness.md`; `__tests__/time-awareness.contract.test.ts`
 * reads its tables and fails when the two disagree. Everything here is a pure function of an
 * injected `now` and a ledger slice — no `Date.now()`, no timer, no sleep — so the whole behaviour
 * is testable on a simulated clock, and a shell that ticks on its own clock gets the same answer.
 */

import { localDateFor, nextCivilDate, resolveTimeZone } from '../utils/LocalDateContext.js';

/** Bump when a frozen list below, or the context block's field set, changes incompatibly. */
export const TIME_AWARENESS_CONTRACT_VERSION = 1;

/** The one-day phases the context block names. Ordered as the clock meets them. */
export const DAY_PHASES = ['night', 'morning', 'afternoon', 'evening'] as const;
export type DayPhase = (typeof DAY_PHASES)[number];

/** The coarse labels the ledger-density signal produces. Ordered from emptiest to busiest. */
export const DENSITY_LABELS = ['blank', 'quiet', 'steady', 'busy'] as const;
export type DensityLabel = (typeof DENSITY_LABELS)[number];

/** The coarse owner-rhythm phases: an hour the ledger shows activity in, or one it does not. */
export const RHYTHM_PHASES = ['active', 'quiet'] as const;
export type RhythmPhase = (typeof RHYTHM_PHASES)[number];

/** The two kinds of anchor the ledger can supply today. An anniversary has no producer yet. */
export const ANCHOR_KINDS = ['wake-intention', 'prospective-memory'] as const;
export type AnchorKind = (typeof ANCHOR_KINDS)[number];

/**
 * The context block's top-level fields, frozen as a list. `docs/time-awareness.md`'s field table is
 * compared against this position by position, the way `docs/events.md`'s type table is.
 */
export const TEMPORAL_CONTEXT_FIELDS = [
  'now',
  'timeZone',
  'localDate',
  'localTime',
  'weekday',
  'hourOfDay',
  'dayPhase',
  'weekPhase',
  'lastInteractionAt',
  'sinceLastInteractionMs',
  'silenceMs',
  'density',
  'rhythm',
  'nearestAnchor',
] as const;

export const DEFAULT_DENSITY_WINDOW_MS = 24 * 60 * 60_000;
export const DEFAULT_RHYTHM_SAMPLE_DAYS = 14;
/** How many turns in one local hour, across the sample, mark that hour as an active hour. */
export const DEFAULT_RHYTHM_ACTIVE_HOUR_THRESHOLD = 2;

const DAY_MS = 24 * 60 * 60_000;

export interface TemporalAnchor {
  kind: AnchorKind;
  /** The instant the anchor names. */
  at: number;
  /** What the anchor is, in the words the record carried. Never ledger text. */
  label: string;
}

export interface NearestAnchor extends TemporalAnchor {
  /** Absolute distance from `now` to `at`, in ms. Direction is read off the two instants. */
  distanceMs: number;
}

/** One conversational ledger row, reduced to what the time signals read. No text, no id. */
export interface TemporalLedgerOccurrence {
  occurredAt: number;
  role?: string | null;
}

export interface TemporalDensity {
  windowMs: number;
  /** Interaction rows — `RAW_EVENT_RECORDED` — inside the window. */
  interactionCount: number;
  /** First-to-last interaction inside the window; 0 when fewer than two. */
  spanMs: number;
  label: DensityLabel;
}

export interface TemporalRhythm {
  sampleDays: number;
  /** Local hours (0-23) whose interaction count reached the threshold, ascending. */
  activeHours: number[];
  phase: RhythmPhase;
}

export interface TemporalContext {
  now: number;
  timeZone: string;
  localDate: string;
  /** HH:MM in the project timezone. */
  localTime: string;
  /** ISO weekday, 1 = Monday .. 7 = Sunday. */
  weekday: number;
  hourOfDay: number;
  dayPhase: DayPhase;
  weekPhase: 'weekday' | 'weekend';
  /** The most recent conversational turn at or before `now`, either side. `null` if none. */
  lastInteractionAt: number | null;
  sinceLastInteractionMs: number | null;
  /** Since the most recent `user` turn: how long the owner has been quiet. `null` if none. */
  silenceMs: number | null;
  density: TemporalDensity;
  rhythm: TemporalRhythm;
  nearestAnchor: NearestAnchor | null;
}

export interface TemporalContextInput {
  now: number;
  timeZone: string;
  /** Most recent conversational turn at or before `now`. The kernel queries it without a window. */
  lastInteractionAt?: number | null;
  /** Most recent `user` turn at or before `now`. */
  lastUserTurnAt?: number | null;
  /** `RAW_EVENT_RECORDED` rows inside the rhythm sample, used for density and rhythm only. */
  occurrences: TemporalLedgerOccurrence[];
  anchors?: TemporalAnchor[];
  densityWindowMs?: number;
  rhythmSampleDays?: number;
  rhythmActiveHourThreshold?: number;
}

export interface DreamWindow {
  /** Local hour the window opens at, 0-23. */
  startHour: number;
  /** Local hour the window closes at, 0-23. Equal to `startHour` means open all day. */
  endHour: number;
}

export interface DreamWindowEvaluation {
  open: boolean;
  timeZone: string;
  window: DreamWindow;
  /** Start of the window containing `now`, or the most recent one that closed before it. */
  windowStartAt: number;
  windowEndAt: number;
  /** The next instant at or after `now` at which the window opens. */
  nextOpenAt: number;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

/**
 * One formatter per timezone, reused. The rhythm signal renders one local hour per ledger row, and
 * building an `Intl.DateTimeFormat` per row made a 5,000-row sample pay 5,000 formatter builds.
 */
const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = zonedFormatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  zonedFormatters.set(timeZone, created);
  return created;
}

function zonedParts(ms: number, timeZone: string): ZonedParts {
  const parts = zonedFormatter(timeZone).formatToParts(new Date(ms));
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const weekdayName = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
  const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    weekday: Math.max(1, weekdayNames.indexOf(weekdayName) + 1),
  };
}

/**
 * The instant at local hour `hour` on the civil date `localDate`.
 *
 * The guess/correct loop resolves the timezone offset instead of adding a fixed number of hours, so
 * a DST switch does not move the window. A skipped or doubled local hour has no single instant; the
 * loop settles on the nearest one after three passes rather than throwing, because a coarse window
 * boundary an hour off is not worth failing a wake-up over.
 */
function localHourInstant(localDate: string, hour: number, timeZone: string): number {
  const [year, month, day] = localDate.split('-').map(Number);
  const target = Date.UTC(year!, month! - 1, day!, hour, 0, 0);
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(guess, timeZone);
    const displayed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    if (displayed === target) break;
    guess += target - displayed;
  }
  return guess;
}

function dayPhaseOf(hour: number): DayPhase {
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function densityLabelOf(interactionCount: number): DensityLabel {
  if (interactionCount === 0) return 'blank';
  if (interactionCount <= 2) return 'quiet';
  if (interactionCount <= 9) return 'steady';
  return 'busy';
}

function requireFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`invalid_time_awareness_${name}`);
  return value;
}

function assertHour(hour: number, name: string): number {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error(`invalid_dream_window_${name}:${hour}`);
  return hour;
}

/**
 * The context block, computed from an injected clock and a ledger slice.
 *
 * `sinceLastInteractionMs` is the time since the conversation last moved either way;
 * `silenceMs` is the time since the *owner* last spoke. They differ exactly when the agent has
 * spoken into the silence, which is the case a resident companion needs to see.
 */
export function computeTemporalContext(input: TemporalContextInput): TemporalContext {
  const now = requireFinite(input.now, 'now');
  const timeZone = resolveTimeZone(input.timeZone);
  const densityWindowMs = Math.max(1, Math.trunc(input.densityWindowMs ?? DEFAULT_DENSITY_WINDOW_MS));
  const rhythmSampleDays = Math.max(1, Math.trunc(input.rhythmSampleDays ?? DEFAULT_RHYTHM_SAMPLE_DAYS));
  const rhythmActiveHourThreshold = Math.max(1, Math.trunc(input.rhythmActiveHourThreshold ?? DEFAULT_RHYTHM_ACTIVE_HOUR_THRESHOLD));

  const local = zonedParts(now, timeZone);
  const localDate = localDateFor(now, timeZone);
  const localTime = `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`;

  const occurrences = input.occurrences
    .filter((item) => Number.isFinite(item.occurredAt) && item.occurredAt <= now)
    .slice()
    .sort((a, b) => a.occurredAt - b.occurredAt);

  const densityFrom = now - densityWindowMs;
  const densityRows = occurrences.filter((item) => item.occurredAt >= densityFrom);
  const spanMs = densityRows.length >= 2
    ? Math.max(0, densityRows[densityRows.length - 1]!.occurredAt - densityRows[0]!.occurredAt)
    : 0;

  const rhythmFrom = now - rhythmSampleDays * DAY_MS;
  const hourCounts = new Array<number>(24).fill(0);
  for (const item of occurrences) {
    if (item.occurredAt < rhythmFrom) continue;
    hourCounts[zonedParts(item.occurredAt, timeZone).hour] += 1;
  }
  const activeHours = hourCounts
    .map((count, hour) => ({ count, hour }))
    .filter((entry) => entry.count >= rhythmActiveHourThreshold)
    .map((entry) => entry.hour);

  const lastInteractionAt = input.lastInteractionAt ?? null;
  const lastUserTurnAt = input.lastUserTurnAt ?? null;

  const anchors = (input.anchors ?? []).filter((anchor) => Number.isFinite(anchor.at));
  const nearest = anchors.length === 0 ? null : anchors
    .map((anchor) => ({ ...anchor, distanceMs: Math.abs(now - anchor.at) }))
    .sort((a, b) => a.distanceMs - b.distanceMs || a.at - b.at || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label))[0]!;

  return {
    now,
    timeZone,
    localDate,
    localTime,
    weekday: local.weekday,
    hourOfDay: local.hour,
    dayPhase: dayPhaseOf(local.hour),
    weekPhase: local.weekday >= 6 ? 'weekend' : 'weekday',
    lastInteractionAt,
    sinceLastInteractionMs: lastInteractionAt === null ? null : Math.max(0, now - lastInteractionAt),
    silenceMs: lastUserTurnAt === null ? null : Math.max(0, now - lastUserTurnAt),
    density: {
      windowMs: densityWindowMs,
      interactionCount: densityRows.length,
      spanMs,
      label: densityLabelOf(densityRows.length),
    },
    rhythm: {
      sampleDays: rhythmSampleDays,
      activeHours,
      phase: activeHours.includes(local.hour) ? 'active' : 'quiet',
    },
    nearestAnchor: nearest,
  };
}

/**
 * Whether a coarse dream window is open at `now`, and when it next opens.
 *
 * This is the whole of the kernel's dream scheduling: a pure evaluation the shell's timer reads
 * before it calls `runDreamTick`. The kernel does not read the shell's own rhythm config, does not
 * hold a timer, and does not decide to run a Dream — it answers "is the window open" for the clock
 * it was handed. `startHour === endHour` means open all day rather than a zero-length window.
 */
export function evaluateDreamWindow(input: { now: number; timeZone: string; window: DreamWindow }): DreamWindowEvaluation {
  const now = requireFinite(input.now, 'now');
  const timeZone = resolveTimeZone(input.timeZone);
  const window: DreamWindow = {
    startHour: assertHour(input.window.startHour, 'start_hour'),
    endHour: assertHour(input.window.endHour, 'end_hour'),
  };
  const today = localDateFor(now, timeZone);
  const [year, month, day] = today.split('-').map(Number);
  const tomorrowDate = civilDate(nextCivilDate(year!, month!, day!, 1, timeZone));
  const yesterdayDate = civilDate(nextCivilDate(year!, month!, day!, -1, timeZone));

  if (window.startHour === window.endHour) {
    const windowStartAt = localHourInstant(today, window.startHour, timeZone);
    return { open: true, timeZone, window, windowStartAt, windowEndAt: windowStartAt + DAY_MS, nextOpenAt: windowStartAt + DAY_MS };
  }

  // The window that either contains `now` or is the most recent one that closed: today's, unless it
  // has not opened yet — then yesterday's, which is what keeps a wrap-past-midnight window open in
  // the small hours after it started the night before.
  const startingAt = (date: string): { date: string; startAt: number; endAt: number } => {
    const startAt = localHourInstant(date, window.startHour, timeZone);
    const endOfSameDay = localHourInstant(date, window.endHour, timeZone);
    const endAt = endOfSameDay > startAt
      ? endOfSameDay
      : localHourInstant(civilDate(nextCivilDate(
        Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10)), 1, timeZone,
      )), window.endHour, timeZone);
    return { date, startAt, endAt };
  };
  let current = startingAt(today);
  if (current.startAt > now) current = startingAt(yesterdayDate);

  if (now < current.startAt) {
    return { open: false, timeZone, window, windowStartAt: current.startAt, windowEndAt: current.endAt, nextOpenAt: current.startAt };
  }
  if (now < current.endAt) {
    return {
      open: true, timeZone, window, windowStartAt: current.startAt, windowEndAt: current.endAt,
      nextOpenAt: startingAt(tomorrowDate).startAt,
    };
  }
  const next = startingAt(civilDate(nextCivilDate(
    Number(current.date.slice(0, 4)), Number(current.date.slice(5, 7)), Number(current.date.slice(8, 10)), 1, timeZone,
  )));
  return { open: false, timeZone, window, windowStartAt: current.startAt, windowEndAt: current.endAt, nextOpenAt: next.startAt };
}

function civilDate(parts: readonly [number, number, number]): string {
  return `${String(parts[0]).padStart(4, '0')}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
}
