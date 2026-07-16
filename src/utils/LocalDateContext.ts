export function resolveTimeZone(timeZone?: string): string {
  const candidate = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(); return candidate; } catch { return 'UTC'; }
}

export function localDateFor(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: resolveTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '01';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function localDateRange(year: number, month: number, day: number, endYear: number, endMonth: number, endDay: number, timeZone?: string): { from: number; to: number } {
  return { from: zonedMidnight(year, month, day, timeZone), to: zonedMidnight(endYear, endMonth, endDay, timeZone) };
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
