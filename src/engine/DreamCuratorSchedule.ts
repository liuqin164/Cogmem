export type DreamCuratorScheduleMode = 'manual' | 'interval' | 'daily' | 'continuous';

export interface DreamCuratorScheduleConfig {
  mode: DreamCuratorScheduleMode;
  intervalMs?: number;
  dailyTimes?: string[];
  timezone?: string;
  continuousIdleMs?: number;
  lastRunAt?: number;
}

export interface DreamCuratorWorkflowDescription {
  mode: DreamCuratorScheduleMode;
  trigger: string;
  hostResponsibility: string;
  coreResponsibility: string;
}

export function describeDreamCuratorWorkflow(config: DreamCuratorScheduleConfig): DreamCuratorWorkflowDescription {
  if (config.mode === 'interval') {
    const intervalMs = positive(config.intervalMs, 6 * 60 * 60 * 1000);
    return baseDescription(config.mode, `host runs dream worker every ${intervalMs}ms`);
  }
  if (config.mode === 'daily') {
    const times = normalizeDailyTimes(config.dailyTimes);
    const timezone = config.timezone || 'local';
    return baseDescription(config.mode, `host runs dream worker at ${times.join(', ')} ${timezone}`);
  }
  if (config.mode === 'continuous') {
    const idleMs = positive(config.continuousIdleMs, 5 * 60 * 1000);
    return baseDescription(config.mode, `host runs dream worker when raw backlog is idle for ${idleMs}ms`);
  }
  return baseDescription(config.mode, 'operator_runs_cogmem_memory_dream');
}

export function nextDreamCuratorRunAt(config: DreamCuratorScheduleConfig, now: number = Date.now()): number | undefined {
  if (config.mode === 'manual') return undefined;
  if (config.mode === 'continuous') return now + positive(config.continuousIdleMs, 5 * 60 * 1000);
  if (config.mode === 'interval') {
    const intervalMs = positive(config.intervalMs, 6 * 60 * 60 * 1000);
    const lastRunAt = Number.isFinite(config.lastRunAt) ? Number(config.lastRunAt) : undefined;
    return lastRunAt === undefined ? now : Math.max(now, lastRunAt + intervalMs);
  }
  const times = normalizeDailyTimes(config.dailyTimes);
  const timezone = config.timezone || 'UTC';
  const parts = zonedParts(now, timezone);
  const candidates: number[] = [];
  for (const dayOffset of [0, 1]) {
    for (const time of times) {
      const [hour, minute] = time.split(':').map(Number);
      candidates.push(zonedTimeToUtc(parts.year, parts.month, parts.day + dayOffset, hour, minute, timezone));
    }
  }
  return candidates.filter((candidate) => candidate > now).sort((a, b) => a - b)[0];
}

function baseDescription(mode: DreamCuratorScheduleMode, trigger: string): DreamCuratorWorkflowDescription {
  return {
    mode,
    trigger,
    hostResponsibility: 'cron/systemd/agent adapter decides when to call cogmem memory dream; core does not run a hidden daemon',
    coreResponsibility: 'conditionally process sealed episodes and write candidate-only governance records',
  };
}

function positive(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeDailyTimes(times: string[] | undefined): string[] {
  const normalized = (times || ['03:30'])
    .map((time) => String(time).trim())
    .filter((time) => /^\d{2}:\d{2}$/.test(time))
    .filter((time) => {
      const [hour, minute] = time.split(':').map(Number);
      return hour >= 0 && hour < 24 && minute >= 0 && minute < 60;
    });
  return normalized.length > 0 ? [...new Set(normalized)].sort() : ['03:30'];
}

function zonedParts(ms: number, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  let candidate = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let index = 0; index < 2; index += 1) {
    const offset = timeZoneOffsetMs(candidate, timeZone);
    candidate = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - offset;
  }
  return candidate;
}

function timeZoneOffsetMs(ms: number, timeZone: string): number {
  if (timeZone === 'UTC') return 0;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
  return asUtc - ms;
}
