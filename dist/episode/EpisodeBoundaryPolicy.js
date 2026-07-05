export const DEFAULT_EPISODE_BOUNDARY_CONFIG = {
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
export function normalizeEpisodeBoundaryConfig(input = {}) {
    const diagnostics = [];
    const config = { ...DEFAULT_EPISODE_BOUNDARY_CONFIG, ...input };
    config.enabled = input.enabled ?? DEFAULT_EPISODE_BOUNDARY_CONFIG.enabled;
    config.auditDecisions = input.auditDecisions ?? DEFAULT_EPISODE_BOUNDARY_CONFIG.auditDecisions;
    config.applyToLive = input.applyToLive ?? DEFAULT_EPISODE_BOUNDARY_CONFIG.applyToLive;
    config.applyToImports = input.applyToImports ?? DEFAULT_EPISODE_BOUNDARY_CONFIG.applyToImports;
    config.splitOnTrustedLocalDateChange = input.splitOnTrustedLocalDateChange ?? DEFAULT_EPISODE_BOUNDARY_CONFIG.splitOnTrustedLocalDateChange;
    config.mode = input.mode === 'off' || input.mode === 'shadow' || input.mode === 'enforce'
        ? input.mode
        : DEFAULT_EPISODE_BOUNDARY_CONFIG.mode;
    config.maxEvents = boundedInt(input.maxEvents, 20, 500, DEFAULT_EPISODE_BOUNDARY_CONFIG.maxEvents, 'max_events', diagnostics);
    config.maxDurationMs = boundedInt(input.maxDurationMs, 300_000, 86_400_000, DEFAULT_EPISODE_BOUNDARY_CONFIG.maxDurationMs, 'max_duration_ms', diagnostics);
    config.maxIdleGapMs = boundedInt(input.maxIdleGapMs, 300_000, 86_400_000, DEFAULT_EPISODE_BOUNDARY_CONFIG.maxIdleGapMs, 'max_idle_gap_ms', diagnostics);
    if (input.timezone) {
        try {
            new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format(0);
            config.timezone = input.timezone;
        }
        catch {
            diagnostics.push({ severity: 'warning', code: 'invalid_episode_boundary_timezone', message: 'episode_boundary.timezone must be a valid IANA timezone.' });
            config.timezone = undefined;
        }
    }
    return { config, diagnostics };
}
export class EpisodeBoundaryPolicy {
    config;
    constructor(config = {}) {
        this.config = normalizeEpisodeBoundaryConfig(config).config;
    }
    evaluate(input) {
        const warnings = [];
        const localDate = trustedLocalDate(input.primaryEvent, this.config, warnings);
        const localDates = [...new Set(input.active?.localDates || [])];
        const metrics = {
            activeEventCount: input.active?.eventCount || 0,
            activeStartedAt: input.active?.startedAt,
            activeUpdatedAt: input.active?.updatedAt,
            elapsedMs: input.active?.startedAt !== undefined && input.primaryEvent.occurredAt
                ? input.primaryEvent.occurredAt - input.active.startedAt : undefined,
            idleGapMs: input.active?.updatedAt !== undefined && input.primaryEvent.occurredAt
                ? input.primaryEvent.occurredAt - input.active.updatedAt : undefined,
            trustedLocalDates: localDates,
            currentTrustedLocalDate: localDate,
        };
        const disabled = !this.config.enabled || this.config.mode === 'off'
            || (input.imported ? !this.config.applyToImports : !this.config.applyToLive);
        const guardCodes = [];
        if (!disabled && input.active && input.primaryEvent.role === 'user') {
            if (input.active.eventCount >= this.config.maxEvents)
                guardCodes.push('max_events_exceeded');
            if ((metrics.elapsedMs ?? 0) > this.config.maxDurationMs)
                guardCodes.push('max_duration_exceeded');
            if ((metrics.idleGapMs ?? 0) > this.config.maxIdleGapMs)
                guardCodes.push('max_idle_gap_exceeded');
            if (this.config.splitOnTrustedLocalDateChange && localDate && localDates.length > 0 && !localDates.includes(localDate)) {
                guardCodes.push('trusted_local_date_changed');
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
function boundedInt(value, min, max, fallback, name, diagnostics) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        if (value !== undefined)
            diagnostics.push({
                severity: 'warning',
                code: `invalid_episode_boundary_${name}`,
                message: `episode_boundary.${name} must be between ${min} and ${max}.`,
            });
        return fallback;
    }
    return Math.trunc(value);
}
function trustedLocalDate(event, config, warnings) {
    if (event.localDate)
        return event.localDate;
    if (config.timezone && event.occurredAt) {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(event.occurredAt);
    }
    warnings.push({ code: 'trusted_local_date_unavailable', message: 'No trusted local date source was available.' });
    return undefined;
}
