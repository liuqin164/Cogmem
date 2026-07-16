export type ProjectClockSource = 'explicit' | 'project_config' | 'host_environment' | 'utc_fallback';

export interface ProjectClockContext {
  now: number;
  timeZone: string;
  localDateNow: string;
  source: ProjectClockSource;
}

function assertTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return timeZone;
  } catch {
    throw new Error(`invalid_time_zone:${timeZone}`);
  }
}

export function resolveTimeZone(timeZone?: string): string {
  if (timeZone) return assertTimeZone(timeZone);
  const host = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return host ? assertTimeZone(host) : 'UTC';
}

export function resolveProjectClockContext(input: {
  now?: number;
  localDateNow?: string;
  timeZone?: string;
  projectTimeZone?: string;
} = {}): ProjectClockContext {
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now)) throw new Error('invalid_clock_now');
  const explicitZone = input.timeZone;
  const configuredZone = input.projectTimeZone;
  const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeZone = explicitZone
    ? assertTimeZone(explicitZone)
    : configuredZone
      ? assertTimeZone(configuredZone)
      : hostZone
        ? assertTimeZone(hostZone)
        : 'UTC';
  const source: ProjectClockSource = explicitZone || input.localDateNow ? 'explicit' : configuredZone ? 'project_config' : hostZone ? 'host_environment' : 'utc_fallback';
  const localDateNow = input.localDateNow ?? localDateFor(now, timeZone);
  assertLocalDate(localDateNow, timeZone);
  return { now, timeZone, localDateNow, source };
}

export function assertLocalDate(value: string, timeZone?: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`invalid_local_date:${value}`);
  const [year, month, day] = value.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) throw new Error(`invalid_local_date:${value}`);
  const zone = resolveTimeZone(timeZone);
  const midnight = zonedMidnight(year, month, day, zone);
  if (localDateFor(midnight, zone) !== value) throw new Error(`invalid_civil_date:${value}:${zone}`);
  return value;
}

export function localDateFor(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: resolveTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '01';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function localDateRange(year: number, month: number, day: number, endYear: number, endMonth: number, endDay: number, timeZone?: string): { from: number; to: number } {
  const zone = resolveTimeZone(timeZone);
  assertLocalDate(formatCivilDate(year, month, day), zone);
  assertLocalDate(formatCivilDate(endYear, endMonth, endDay), zone);
  return { from: zonedMidnight(year, month, day, timeZone), to: zonedMidnight(endYear, endMonth, endDay, timeZone) };
}

/** Advance an already-valid civil date without treating the result as user input. */
export function nextCivilDate(year: number, month: number, day: number, days = 1): readonly [number, number, number] {
  assertLocalDate(formatCivilDate(year, month, day));
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()];
}

function formatCivilDate(year: number, month: number, day: number): string {
  if (![year, month, day].every((value) => Number.isInteger(value))) throw new Error('invalid_local_date');
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function zonedMidnight(year: number, month: number, day: number, timeZone?: string): number {
  const zone = resolveTimeZone(timeZone);
  let guess = Date.UTC(year, month - 1, day);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const displayed = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
    guess += Date.UTC(year, month - 1, day) - displayed;
  }
  return guess;
}
