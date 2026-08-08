import type { MemoryEvent } from '../types/index.js';

export type EpisodeBoundaryMode = 'off' | 'shadow' | 'enforce';
export type EpisodeBoundaryGuardCode =
  | 'max_events_exceeded'
  | 'max_duration_exceeded'
  | 'max_idle_gap_exceeded'
  | 'trusted_local_date_changed';

export interface EpisodeBoundaryWarning {
  code: string;
  message: string;
}

export interface EpisodeBoundaryConfig {
  enabled: boolean;
  mode: EpisodeBoundaryMode;
  maxEvents: number;
  maxDurationMs: number;
  maxIdleGapMs: number;
  splitOnTrustedLocalDateChange: boolean;
  auditDecisions: boolean;
  applyToLive: boolean;
  applyToImports: boolean;
  policyVersion: string;
  timezone?: string;
}

export interface EpisodeBoundaryMetrics {
  activeEventCount: number;
  activeStartedAt?: number;
  activeUpdatedAt?: number;
  elapsedMs?: number;
  idleGapMs?: number;
  trustedLocalDates: string[];
  lastTrustedLocalDate?: string;
  currentTrustedLocalDate?: string;
  outOfOrderTimestamp?: boolean;
}

export interface EpisodeBoundaryGuardResult {
  mode: EpisodeBoundaryMode;
  guardAction: 'none' | 'shadow_new_episode' | 'enforce_new_episode';
  guardCodes: EpisodeBoundaryGuardCode[];
  metrics: EpisodeBoundaryMetrics;
  warnings: EpisodeBoundaryWarning[];
  policyVersion: string;
}

export const DEFAULT_EPISODE_BOUNDARY_CONFIG: EpisodeBoundaryConfig = {
  enabled: true,
  mode: 'enforce',
  maxEvents: 100,
  maxDurationMs: 7_200_000,
  maxIdleGapMs: 1_800_000,
  splitOnTrustedLocalDateChange: true,
  auditDecisions: true,
  applyToLive: true,
  applyToImports: true,
  policyVersion: 'episode_boundary.v1',
};

export interface EpisodeBoundaryConfigDiagnostic {
  severity: 'warning' | 'error';
  code: string;
  message: string;
}

export function normalizeEpisodeBoundaryConfig(input: Partial<EpisodeBoundaryConfig> = {}): {
  config: EpisodeBoundaryConfig;
  diagnostics: EpisodeBoundaryConfigDiagnostic[];
} {
  const diagnostics: EpisodeBoundaryConfigDiagnostic[] = [];
  const config: EpisodeBoundaryConfig = { ...DEFAULT_EPISODE_BOUNDARY_CONFIG, ...input };
  config.enabled = boundedBoolean(input.enabled, DEFAULT_EPISODE_BOUNDARY_CONFIG.enabled, 'enabled', diagnostics);
  config.auditDecisions = boundedBoolean(input.auditDecisions, DEFAULT_EPISODE_BOUNDARY_CONFIG.auditDecisions, 'audit_decisions', diagnostics);
  config.applyToLive = boundedBoolean(input.applyToLive, DEFAULT_EPISODE_BOUNDARY_CONFIG.applyToLive, 'apply_to_live', diagnostics);
  config.applyToImports = boundedBoolean(input.applyToImports, DEFAULT_EPISODE_BOUNDARY_CONFIG.applyToImports, 'apply_to_imports', diagnostics);
  config.splitOnTrustedLocalDateChange = boundedBoolean(
    input.splitOnTrustedLocalDateChange,
    DEFAULT_EPISODE_BOUNDARY_CONFIG.splitOnTrustedLocalDateChange,
    'split_on_trusted_local_date_change',
    diagnostics,
  );
  if (input.mode === 'off' || input.mode === 'shadow' || input.mode === 'enforce' || input.mode === undefined) {
    config.mode = input.mode ?? DEFAULT_EPISODE_BOUNDARY_CONFIG.mode;
  } else {
    diagnostics.push({
      severity: 'warning',
      code: 'invalid_episode_boundary_mode',
      message: 'episode_boundary.mode must be off, shadow, or enforce. Falling back to shadow.',
    });
    config.mode = 'shadow';
  }
  config.maxEvents = boundedInt(input.maxEvents, 20, 500, DEFAULT_EPISODE_BOUNDARY_CONFIG.maxEvents, 'max_events', diagnostics);
  config.maxDurationMs = boundedInt(input.maxDurationMs, 300_000, 86_400_000, DEFAULT_EPISODE_BOUNDARY_CONFIG.maxDurationMs, 'max_duration_ms', diagnostics);
  config.maxIdleGapMs = boundedInt(input.maxIdleGapMs, 300_000, 86_400_000, DEFAULT_EPISODE_BOUNDARY_CONFIG.maxIdleGapMs, 'max_idle_gap_ms', diagnostics);
  if (input.policyVersion !== undefined && (typeof input.policyVersion !== 'string' || input.policyVersion.trim() === '')) {
    diagnostics.push({ severity: 'warning', code: 'invalid_episode_boundary_policy_version', message: 'episode_boundary.policy_version must be a non-empty string.' });
    config.policyVersion = DEFAULT_EPISODE_BOUNDARY_CONFIG.policyVersion;
  } else {
    config.policyVersion = input.policyVersion ?? DEFAULT_EPISODE_BOUNDARY_CONFIG.policyVersion;
  }
  if (input.timezone !== undefined && (typeof input.timezone !== 'string' || input.timezone.trim() === '')) {
    diagnostics.push({ severity: 'warning', code: 'invalid_episode_boundary_timezone', message: 'episode_boundary.timezone must be a non-empty valid IANA timezone.' });
    config.timezone = undefined;
  } else if (input.timezone !== undefined) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format(0); config.timezone = input.timezone; }
    catch {
      diagnostics.push({ severity: 'warning', code: 'invalid_episode_boundary_timezone', message: 'episode_boundary.timezone must be a valid IANA timezone.' });
      config.timezone = undefined;
    }
  }
  return { config, diagnostics };
}

export class EpisodeBoundaryPolicy {
  readonly config: EpisodeBoundaryConfig;

  constructor(config: Partial<EpisodeBoundaryConfig> = {}) {
    this.config = normalizeEpisodeBoundaryConfig(config).config;
  }

  evaluate(input: {
    active?: { eventCount: number; startedAt?: number; updatedAt?: number; localDates?: string[]; lastTrustedLocalDate?: string };
    primaryEvent: Pick<MemoryEvent, 'role' | 'occurredAt' | 'localDate' | 'localDateSource' | 'payload'>;
    imported?: boolean;
  }): EpisodeBoundaryGuardResult {
    const warnings: EpisodeBoundaryWarning[] = [];
    const localDates = [...new Set(input.active?.localDates || [])];
    const shouldEvaluate = Boolean(
      input.active
      && input.primaryEvent.role === 'user'
      && this.config.enabled
      && this.config.mode !== 'off'
      && (input.imported ? this.config.applyToImports : this.config.applyToLive),
    );
    const localDate = shouldEvaluate && this.config.splitOnTrustedLocalDateChange
      ? trustedLocalDate(input.primaryEvent, this.config.timezone, warnings)
      : undefined;
    const currentTime = input.primaryEvent.occurredAt;
    const outOfOrderTimestamp = shouldEvaluate && input.active?.updatedAt !== undefined
      && currentTime !== undefined && currentTime < input.active.updatedAt;
    if (outOfOrderTimestamp) warnings.push({ code: 'out_of_order_timestamp', message: 'Event timestamp is earlier than the active episode update time.' });
    const metrics: EpisodeBoundaryMetrics = {
      activeEventCount: input.active?.eventCount ?? 0,
      activeStartedAt: input.active?.startedAt,
      activeUpdatedAt: input.active?.updatedAt,
      elapsedMs: input.active?.startedAt !== undefined && input.primaryEvent.occurredAt !== undefined
        ? input.primaryEvent.occurredAt - input.active.startedAt : undefined,
      idleGapMs: input.active?.updatedAt !== undefined && input.primaryEvent.occurredAt !== undefined
        ? input.primaryEvent.occurredAt - input.active.updatedAt : undefined,
      trustedLocalDates: localDates,
      lastTrustedLocalDate: input.active?.lastTrustedLocalDate,
      currentTrustedLocalDate: localDate,
      outOfOrderTimestamp,
    };
    const guardCodes: EpisodeBoundaryGuardCode[] = [];
    if (shouldEvaluate && input.active) {
      if (input.active.eventCount >= this.config.maxEvents) guardCodes.push('max_events_exceeded');
      // A late arrival belongs to historical/review handling. It must not
      // retroactively seal the current segment through clock/date guards.
      if (!outOfOrderTimestamp) {
        if ((metrics.elapsedMs ?? 0) > this.config.maxDurationMs) guardCodes.push('max_duration_exceeded');
        if ((metrics.idleGapMs ?? 0) > this.config.maxIdleGapMs) guardCodes.push('max_idle_gap_exceeded');
        if (this.config.splitOnTrustedLocalDateChange && localDate && input.active.lastTrustedLocalDate && input.active.lastTrustedLocalDate !== localDate) {
          guardCodes.push('trusted_local_date_changed');
        }
      }
    }
    return {
      mode: this.config.mode,
      guardAction: guardCodes.length ? (this.config.mode === 'shadow' ? 'shadow_new_episode' : 'enforce_new_episode') : 'none',
      guardCodes,
      metrics,
      warnings,
      policyVersion: this.config.policyVersion,
    };
  }
}

function boundedInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  name: string,
  diagnostics: EpisodeBoundaryConfigDiagnostic[],
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    if (value !== undefined) diagnostics.push({
      severity: 'warning',
      code: `invalid_episode_boundary_${name}`,
      message: `episode_boundary.${name} must be between ${min} and ${max}.`,
    });
    return fallback;
  }
  return Math.trunc(value);
}

function boundedBoolean(
  value: unknown,
  fallback: boolean,
  name: string,
  diagnostics: EpisodeBoundaryConfigDiagnostic[],
): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  diagnostics.push({
    severity: 'warning',
    code: `invalid_episode_boundary_${name}`,
    message: `episode_boundary.${name} must be a boolean.`,
  });
  return fallback;
}

export function isTrustedLocalDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function resolveTrustedLocalDate(
  event: { occurredAt?: number; localDate?: string; localDateSource?: 'explicit' | 'generated_explicit_timezone' | 'generated_project_timezone' | 'generated_host_timezone' | 'generated_utc_fallback' | 'generated_utc' | 'legacy_unknown'; payload?: unknown } | undefined,
  timezone?: string,
): { date?: string; warning?: EpisodeBoundaryWarning } {
  if (!event) return { warning: { code: 'trusted_local_date_unavailable', message: 'No trusted local date source was available.' } };
  if (event.localDate && !isTrustedLocalDate(event.localDate)) {
    return { warning: { code: 'invalid_trusted_local_date', message: 'Trusted local date must use YYYY-MM-DD.' } };
  }
  const metadata = (event.payload as { metadata?: Record<string, unknown> } | undefined)?.metadata;
  const legacyMetadataSource = metadata?.localDateSource === 'event_store_utc_default' ? 'generated_utc' : metadata?.localDateSource;
  const localDateSource = event.localDateSource ?? legacyMetadataSource ?? (event.localDate ? 'explicit' : undefined);
  if (event.localDate && (localDateSource === 'explicit' || localDateSource === 'generated_explicit_timezone' || localDateSource === 'generated_project_timezone' || localDateSource === 'generated_host_timezone')) return { date: event.localDate };
  if (event.localDate && localDateSource === 'legacy_unknown') {
    return { warning: { code: 'legacy_unknown_local_date_source', message: 'Legacy local date source is not trusted for boundary decisions.' } };
  }
  if (timezone && typeof event.occurredAt === 'number' && Number.isFinite(event.occurredAt)) {
    const utcDate = new Date(event.occurredAt).toISOString().slice(0, 10);
    if (!event.localDate || localDateSource === 'generated_utc' || localDateSource === 'generated_utc_fallback') return { date: localDateInTimezone(event.occurredAt, timezone) };
  }
  if (event.localDate && (localDateSource === 'generated_utc' || localDateSource === 'generated_utc_fallback') && isTrustedLocalDate(event.localDate)) return { date: event.localDate };
  return { warning: { code: 'trusted_local_date_unavailable', message: 'No trusted local date source was available.' } };
}

function localDateInTimezone(occurredAt: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(occurredAt);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : new Date(occurredAt).toISOString().slice(0, 10);
}

function trustedLocalDate(
  event: Pick<MemoryEvent, 'occurredAt' | 'localDate' | 'localDateSource'>,
  timezone: string | undefined,
  warnings: EpisodeBoundaryWarning[],
): string | undefined {
  const resolved = resolveTrustedLocalDate(event, timezone);
  if (resolved.warning) warnings.push(resolved.warning);
  return resolved.date;
}
