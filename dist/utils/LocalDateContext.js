function assertTimeZone(timeZone) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone }).format();
        return timeZone;
    }
    catch {
        throw new Error(`invalid_time_zone:${timeZone}`);
    }
}
export function resolveTimeZone(timeZone) {
    if (timeZone)
        return assertTimeZone(timeZone);
    const host = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return host ? assertTimeZone(host) : 'UTC';
}
export function resolveProjectClockContext(input = {}) {
    const now = input.now ?? Date.now();
    if (!Number.isFinite(now))
        throw new Error('invalid_clock_now');
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
    const source = explicitZone || input.localDateNow ? 'explicit' : configuredZone ? 'project_config' : hostZone ? 'host_environment' : 'utc_fallback';
    const localDateNow = input.localDateNow ?? localDateFor(now, timeZone);
    assertLocalDate(localDateNow, timeZone);
    return { now, timeZone, localDateNow, source };
}
export function assertLocalDate(value, timeZone) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new Error(`invalid_local_date:${value}`);
    const [year, month, day] = value.split('-').map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day)
        throw new Error(`invalid_local_date:${value}`);
    const zone = resolveTimeZone(timeZone);
    const midnight = zonedMidnight(year, month, day, zone);
    if (localDateFor(midnight, zone) !== value)
        throw new Error(`invalid_civil_date:${value}:${zone}`);
    return value;
}
export function localDateFor(ms, timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: resolveTimeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
    const value = (type) => parts.find((part) => part.type === type)?.value ?? '01';
    return `${value('year')}-${value('month')}-${value('day')}`;
}
export function localDateRange(year, month, day, endYear, endMonth, endDay, timeZone) {
    const zone = resolveTimeZone(timeZone);
    assertLocalDate(formatCivilDate(year, month, day), zone);
    assertLocalDate(formatCivilDate(endYear, endMonth, endDay), zone);
    return { from: zonedMidnight(year, month, day, timeZone), to: zonedMidnight(endYear, endMonth, endDay, timeZone) };
}
/** Advance an already-valid civil date without treating the result as user input. */
export function nextCivilDate(year, month, day, days = 1, timeZone) {
    const zone = resolveTimeZone(timeZone);
    assertLocalDate(formatCivilDate(year, month, day), zone);
    const direction = days < 0 ? -1 : 1;
    let value = new Date(Date.UTC(year, month - 1, day + days));
    while (true) {
        const result = [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()];
        try {
            assertLocalDate(formatCivilDate(...result), zone);
            return result;
        }
        catch (error) {
            if (!(error instanceof Error) || !error.message.startsWith('invalid_civil_date:'))
                throw error;
            value = new Date(Date.UTC(result[0], result[1] - 1, result[2] + direction));
        }
    }
}
function formatCivilDate(year, month, day) {
    if (![year, month, day].every((value) => Number.isInteger(value)))
        throw new Error('invalid_local_date');
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function zonedMidnight(year, month, day, timeZone) {
    const zone = resolveTimeZone(timeZone);
    let guess = Date.UTC(year, month - 1, day);
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
        const value = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
        const displayed = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
        guess += Date.UTC(year, month - 1, day) - displayed;
    }
    return guess;
}
