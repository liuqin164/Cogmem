import { createHash } from 'node:crypto';
import { normalizeEpisodeBoundaryConfig, resolveTrustedLocalDate } from './EpisodeBoundaryPolicy.js';
import { replayEpisodeBoundaries } from './EpisodeBoundaryReplayEngine.js';
import { validateEpisodeInvariants } from './EpisodeInvariantValidator.js';
export class EpisodeBoundaryAuditService {
    store;
    resolveEvent;
    liveBoundaryConfig;
    constructor(store, resolveEvent, liveBoundaryConfig = {}) {
        this.store = store;
        this.resolveEvent = resolveEvent;
        this.liveBoundaryConfig = liveBoundaryConfig;
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
        const normalized = normalizeEpisodeBoundaryConfig(configWithDefinedOverrides(this.liveBoundaryConfig, options));
        const items = page.episodes.map((episode) => this.auditEpisode(episode, normalized.config, normalized.diagnostics.map((item) => item.code)));
        return { items, nextCursor: page.nextCursor };
    }
    requireProjectEpisode(projectId, episodeId) {
        const episode = this.store.getEpisode(episodeId);
        if (!episode || episode.projectId !== projectId)
            throw new Error(`episode_project_mismatch:${episodeId}`);
        return episode;
    }
    auditEpisode(episode, config, configWarnings = []) {
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
        const durationMs = times.length ? Math.max(...times) - Math.min(...times) : 0;
        const maxEventGapMs = maxGap(times);
        const maxUserTurnGapMs = maxGap(userTimes);
        const maxBoundaryIdleGapMs = maxBoundaryIdleGap(pairs);
        const outOfOrderEventCount = outOfOrderCount(events);
        const replay = replayEpisodeBoundaries({ episode, pairs, config });
        const violations = validateEpisodeInvariants({ episode, pairs, timezone: config.timezone });
        warnings.push(...replay.warnings, ...replay.structuralAnomalies);
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
            firstEventAt: times.length ? Math.min(...times) : undefined,
            lastEventAt: times.length ? Math.max(...times) : undefined,
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
            unresolvedEventCount: missingRawEventIds.length,
            missingRawEventIds: missingRawEventIds.slice(0, 50),
            evidenceIntegrityStatus: missingRawEventIds.length ? 'missing_raw_events' : 'ok',
            requiresManualReview: missingRawEventIds.length > 0 || replay.structuralAnomalies.length > 0 || violations.some((violation) => violation.requiresManualReview),
            severity: critical ? 'critical' : reasons.length ? 'warning' : 'info',
            reasons: stableReasons,
            warnings: stableWarnings,
            recommendedAction: critical ? 'split-plan' : stableReasons.length ? 'inspect' : 'none',
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
function maxBoundaryIdleGap(pairs) {
    let max = 0;
    for (let index = 1; index < pairs.length; index += 1) {
        const event = pairs[index].event;
        const previous = pairs[index - 1].event;
        if (event?.role !== 'user')
            continue;
        if (typeof event.occurredAt !== 'number' || typeof previous?.occurredAt !== 'number')
            continue;
        max = Math.max(max, event.occurredAt - previous.occurredAt);
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
            item.relation,
            item.event?.role,
            item.event?.turnId,
            item.event?.turnSeq,
            item.event?.eventOrdinal,
            item.event?.occurredAt,
            item.event?.localDate,
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
    if (overrides.maxEvents !== undefined)
        config.maxEvents = overrides.maxEvents;
    if (overrides.maxDurationMs !== undefined)
        config.maxDurationMs = overrides.maxDurationMs;
    if (overrides.maxIdleGapMs !== undefined)
        config.maxIdleGapMs = overrides.maxIdleGapMs;
    if (overrides.timezone !== undefined)
        config.timezone = overrides.timezone;
    return config;
}
