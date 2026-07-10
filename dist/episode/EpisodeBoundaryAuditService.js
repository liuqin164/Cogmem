import { createHash } from 'node:crypto';
import { DEFAULT_EPISODE_BOUNDARY_CONFIG } from './EpisodeBoundaryPolicy.js';
import { normalizeEpisodeBoundaryConfig, resolveTrustedLocalDate } from './EpisodeBoundaryPolicy.js';
import { replayEpisodeBoundaries } from './EpisodeBoundaryReplayEngine.js';
import { validateEpisodeInvariants } from './EpisodeInvariantValidator.js';
export class EpisodeBoundaryAuditService {
    store;
    resolveEvent;
    liveBoundaryConfig;
    liveConfigDiagnostics;
    constructor(store, resolveEvent, liveBoundaryConfig = {}, liveConfigDiagnostics = []) {
        this.store = store;
        this.resolveEvent = resolveEvent;
        this.liveBoundaryConfig = liveBoundaryConfig;
        this.liveConfigDiagnostics = liveConfigDiagnostics;
    }
    audit(options) {
        if (!options.projectId)
            throw new Error('projectId is required');
        const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 1000));
        const page = options.episodeId ? { episodes: [this.requireProjectEpisode(options.projectId, options.episodeId)], nextCursor: undefined } : this.store.listEpisodesForBoundaryAudit({
            projectId: options.projectId,
            statuses: options.status ? [options.status] : undefined,
            limit,
            cursor: options.cursor,
        });
        const overrideWarnings = boundaryOverrideWarnings(options);
        const normalized = normalizeEpisodeBoundaryConfig(configWithDefinedOverrides(this.liveBoundaryConfig, options));
        const aggregateCountCheck = options.maxEvents !== undefined || this.liveBoundaryConfig.maxEvents !== undefined || normalized.config.maxEvents !== DEFAULT_EPISODE_BOUNDARY_CONFIG.maxEvents;
        const boundaryDiagnostics = this.liveConfigDiagnostics
            .map((item) => item.code)
            .filter((code) => code.startsWith('invalid_episode_boundary_'));
        const items = page.episodes.map((episode) => this.auditEpisode(episode, normalized.config, [...boundaryDiagnostics, ...overrideWarnings, ...normalized.diagnostics.map((item) => item.code)], aggregateCountCheck));
        return { items, nextCursor: page.nextCursor };
    }
    requireProjectEpisode(projectId, episodeId) {
        const episode = this.store.getEpisode(episodeId);
        if (!episode || episode.projectId !== projectId)
            throw new Error(`episode_project_mismatch:${episodeId}`);
        return episode;
    }
    auditEpisode(episode, config, configWarnings = [], aggregateCountCheck = true) {
        const links = this.store.listEventLinks(episode.episodeId);
        const pairs = links.map((link) => ({ link, event: this.resolveEvent?.(link.eventId) || undefined }));
        const events = pairs.map((item) => item.event).filter((event) => Boolean(event));
        const missingRawEventIds = pairs.filter((item) => !item.event).map((item) => item.link.eventId);
        const times = events.map((event) => event.occurredAt).filter((value) => typeof value === 'number');
        const dates = [...new Set(events.filter((event) => event.role === 'user').map((event) => trustedLocalDate(event, config.timezone)).filter((value) => Boolean(value)))];
        const relationCounts = {};
        for (const link of links)
            relationCounts[link.relation] = (relationCounts[link.relation] || 0) + 1;
        const userTimes = events.filter((event) => event.role === 'user' && Number.isFinite(event.occurredAt)).map((event) => event.occurredAt);
        const reasons = [];
        const warnings = [...configWarnings];
        warnings.push(...dateWarningCodes(pairs, config.timezone));
        const range = timeRange(times);
        const durationMs = range ? range.max - range.min : 0;
        const maxEventGapMs = maxGap(times);
        const maxUserTurnGapMs = maxGap(userTimes);
        const maxBoundaryIdleGapMs = maxBoundaryIdleGap(pairs);
        const outOfOrderEventCount = outOfOrderCount(events);
        const replay = replayEpisodeBoundaries({ episode, pairs, config });
        const violations = validateEpisodeInvariants({
            episode, pairs, timezone: config.timezone,
            closureReceipts: this.store.listClosureReceipts({ episodeId: episode.episodeId, limit: 1 }),
            dreamJobState: this.store.getDreamJobState(episode.episodeId),
        });
        warnings.push(...replay.warnings, ...replay.structuralAnomalies);
        warnings.push(...replay.detectedBoundaries.filter((boundary) => !boundary.effective).map((boundary) => `detected_boundary:${boundary.reason}`));
        for (const boundary of replay.effectiveBoundaries)
            reasons.push(...auditReasonsForBoundary(boundary));
        reasons.push(...violations.map((violation) => violation.reason));
        if (episode.eventCount !== links.length)
            reasons.push('stored_actual_event_count_mismatch');
        if (missingRawEventIds.length > 0)
            reasons.push('unresolved_raw_events');
        if (outOfOrderEventCount > 0)
            reasons.push('out_of_order_events');
        if ((relationCounts.ambiguous_shift || 0) > 1)
            reasons.push('repeated_ambiguous_shifts');
        if (hardShiftCount(relationCounts) > 1)
            reasons.push('multiple_hard_topic_switch_relations');
        const hasClosureTurn = replay.logicalTurns.some((turn) => turn.some((pair) => pair.event?.role === 'user' && pair.link.relation === 'closes_episode'));
        const importedEpisode = replay.logicalTurns.some(isImportedTurn);
        if (aggregateCountCheck && config.maxEvents !== undefined && links.length > config.maxEvents && !hasClosureTurn && !(importedEpisode && config.applyToImports === false)) {
            reasons.push('event_count_exceeds_max');
        }
        if (config.splitOnTrustedLocalDateChange && dates.length > 1)
            reasons.push('multiple_trusted_local_dates');
        if (!events.some((event) => event.role === 'user'))
            reasons.push('zero_user_event_episode');
        if (!dates.length)
            warnings.push('trusted_local_date_unavailable');
        const stableReasons = [...new Set(reasons)].sort();
        const stableWarnings = [...new Set(warnings)].sort();
        const critical = stableReasons.some((reason) => [
            'stored_actual_event_count_mismatch', 'event_count_exceeds_max', 'duration_exceeds_max',
            'boundary_idle_gap_exceeds_max', 'multiple_trusted_local_dates', 'unresolved_raw_events',
        ].includes(reason)) || violations.some((violation) => violation.severity === 'critical');
        return {
            episodeId: episode.episodeId,
            projectId: episode.projectId,
            status: episode.status,
            sessionId: episode.sessionId,
            threadId: episode.conversationThreadId,
            sourceAgent: episode.sourceAgent,
            storedEventCount: episode.eventCount,
            actualLinkedEventCount: links.length,
            startedAt: episode.startedAt,
            firstEventAt: range?.min,
            lastEventAt: range?.max,
            durationMs,
            maxEventGapMs,
            maxUserTurnGapMs,
            maxBoundaryIdleGapMs,
            trustedLocalDates: dates,
            localDateConfidence: dates.length ? 'trusted' : 'unknown',
            crossesTrustedLocalDate: dates.length > 1,
            storedRelationCounts: relationCounts,
            strongShiftCount: hardShiftCount(relationCounts),
            ambiguousShiftCount: relationCounts.ambiguous_shift || 0,
            userEventCount: events.filter((event) => event.role === 'user').length,
            assistantEventCount: events.filter((event) => event.role === 'assistant' || event.role === 'agent').length,
            toolEventCount: events.filter((event) => event.role === 'tool').length,
            systemEventCount: events.filter((event) => event.role === 'system').length,
            outOfOrderEventCount,
            sourceFingerprint: sourceFingerprint(pairs.map((item) => ({ ...item.link, event: item.event }))),
            detectedBoundaryCount: replay.detectedBoundaries.length,
            effectiveBoundaryCount: replay.effectiveBoundaries.length,
            unresolvedEventCount: missingRawEventIds.length,
            missingRawEventIds: missingRawEventIds.slice(0, 50),
            evidenceIntegrityStatus: missingRawEventIds.length ? 'missing_raw_events' : 'ok',
            requiresManualReview: critical || missingRawEventIds.length > 0 || replay.structuralAnomalies.length > 0 || violations.some((violation) => violation.requiresManualReview),
            severity: critical ? 'critical' : reasons.length ? 'warning' : 'info',
            reasons: stableReasons,
            warnings: stableWarnings,
            recommendedAction: critical && !stableReasons.some((reason) => /raw_event|scope_mismatch|pointer_mismatch|dream.*mismatch|receipt.*mismatch|duplicate_or_gapped_positions|duplicate_active|empty_episode/u.test(reason))
                ? 'split-plan' : stableReasons.length ? 'inspect' : 'none',
        };
    }
}
function maxGap(values) {
    const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
    let max = 0;
    for (let index = 1; index < ordered.length; index += 1)
        max = Math.max(max, ordered[index] - ordered[index - 1]);
    return max;
}
function timeRange(values) {
    let min;
    let max;
    for (const value of values) {
        if (!Number.isFinite(value))
            continue;
        min = min === undefined ? value : Math.min(min, value);
        max = max === undefined ? value : Math.max(max, value);
    }
    return min === undefined || max === undefined ? undefined : { min, max };
}
function maxBoundaryIdleGap(pairs) {
    let max = 0;
    let runningMax;
    for (const pair of pairs) {
        const event = pair.event;
        if (event?.role === 'user' && typeof event.occurredAt === 'number' && Number.isFinite(event.occurredAt) && runningMax !== undefined) {
            max = Math.max(max, Math.max(0, event.occurredAt - runningMax));
        }
        if (typeof event?.occurredAt === 'number' && Number.isFinite(event.occurredAt)) {
            runningMax = Math.max(runningMax ?? event.occurredAt, event.occurredAt);
        }
    }
    return max;
}
function auditReasonsForBoundary(boundary) {
    if (boundary.guardCodes.length)
        return boundary.guardCodes.map(auditReasonForGuard);
    return [auditReasonForBoundary(boundary.reason)];
}
function auditReasonForGuard(code) {
    if (code === 'max_events_exceeded')
        return 'event_count_exceeds_max';
    if (code === 'max_duration_exceeded')
        return 'duration_exceeds_max';
    if (code === 'max_idle_gap_exceeded')
        return 'boundary_idle_gap_exceeds_max';
    if (code === 'trusted_local_date_changed')
        return 'multiple_trusted_local_dates';
    return code;
}
function auditReasonForBoundary(reason) {
    if (reason === 'max_events_boundary')
        return 'event_count_exceeds_max';
    if (reason === 'max_duration_boundary')
        return 'duration_exceeds_max';
    if (reason === 'max_idle_gap_boundary')
        return 'boundary_idle_gap_exceeds_max';
    if (reason === 'trusted_local_date_boundary')
        return 'multiple_trusted_local_dates';
    return reason;
}
function outOfOrderCount(events) {
    let runningMax;
    let count = 0;
    for (const event of events) {
        if (typeof event.occurredAt !== 'number')
            continue;
        if (runningMax !== undefined && event.occurredAt < runningMax)
            count += 1;
        runningMax = Math.max(runningMax ?? event.occurredAt, event.occurredAt);
    }
    return count;
}
function hardShiftCount(counts) {
    return (counts.hard_topic_switch || 0) + (counts.starts_new_topic || 0) + (counts.switches_topic || 0);
}
function sourceFingerprint(items) {
    const hash = createHash('sha256');
    for (const item of items) {
        hash.update(JSON.stringify([
            item.eventId,
            item.position,
            item.relation,
            item.event?.role,
            item.event?.turnId,
            item.event?.turnSeq,
            item.event?.eventOrdinal,
            item.event?.occurredAt,
            item.event?.localDate,
            item.event?.localDateSource,
            item.event?.contentHash,
        ]));
    }
    return hash.digest('hex');
}
function trustedLocalDate(event, timezone) {
    return resolveTrustedLocalDate(event, timezone).date;
}
function dateWarningCodes(pairs, timezone) {
    return [...new Set(pairs
            .filter((item) => item.event?.role === 'user')
            .map((item) => resolveTrustedLocalDate(item.event, timezone).warning?.code)
            .filter((code) => code === 'invalid_trusted_local_date'))];
}
function isImportedTurn(group) {
    return group.some((item) => {
        const payload = item.event?.payload;
        return payload?.metadata?.imported === true || payload?.metadata?.sourceRef !== undefined;
    });
}
function configWithDefinedOverrides(base, overrides) {
    const config = { ...base };
    if (overrides.maxEvents !== undefined && validThreshold(overrides.maxEvents, 20, 500))
        config.maxEvents = overrides.maxEvents;
    if (overrides.maxDurationMs !== undefined && validThreshold(overrides.maxDurationMs, 300_000, 86_400_000))
        config.maxDurationMs = overrides.maxDurationMs;
    if (overrides.maxIdleGapMs !== undefined && validThreshold(overrides.maxIdleGapMs, 300_000, 86_400_000))
        config.maxIdleGapMs = overrides.maxIdleGapMs;
    if (typeof overrides.timezone === 'string' && overrides.timezone.trim())
        config.timezone = overrides.timezone;
    return config;
}
function validThreshold(value, min, max) {
    return value !== undefined && Number.isFinite(value) && value >= min && value <= max;
}
function boundaryOverrideWarnings(overrides) {
    const warnings = [];
    if (overrides.maxEvents !== undefined && !validThreshold(overrides.maxEvents, 20, 500))
        warnings.push('invalid_episode_boundary_max_events');
    if (overrides.maxDurationMs !== undefined && !validThreshold(overrides.maxDurationMs, 300_000, 86_400_000))
        warnings.push('invalid_episode_boundary_max_duration_ms');
    if (overrides.maxIdleGapMs !== undefined && !validThreshold(overrides.maxIdleGapMs, 300_000, 86_400_000))
        warnings.push('invalid_episode_boundary_max_idle_gap_ms');
    if (overrides.timezone !== undefined && !overrides.timezone.trim())
        warnings.push('invalid_episode_boundary_timezone');
    return warnings;
}
