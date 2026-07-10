import { createHash } from 'node:crypto';
import { normalizeEpisodeBoundaryConfig, resolveTrustedLocalDate } from './EpisodeBoundaryPolicy.js';
import { replayEpisodeBoundaries } from './EpisodeBoundaryReplayEngine.js';
import { validateEpisodeInvariants } from './EpisodeInvariantValidator.js';
export const EPISODE_SPLIT_PLANNER_VERSION = 'episode_split_preview.v1';
export class EpisodeSplitPlanner {
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
    plan(options) {
        const episode = this.store.getEpisode(options.episodeId);
        if (!episode || episode.projectId !== options.projectId)
            throw new Error(`episode_project_mismatch:${options.episodeId}`);
        const links = this.store.listEventLinks(options.episodeId);
        const pairs = links.map((link) => ({ link, event: this.resolveEvent?.(link.eventId) || undefined }));
        const events = pairs.map((item) => item.event).filter((event) => Boolean(event));
        const missingRawEventIds = pairs.filter((item) => !item.event).map((item) => item.link.eventId);
        const overrideWarnings = boundaryOverrideWarnings(options);
        const normalized = normalizeEpisodeBoundaryConfig(configWithDefinedOverrides(this.liveBoundaryConfig, options));
        const policy = {
            enabled: normalized.config.enabled,
            maxEvents: normalized.config.maxEvents,
            maxDurationMs: normalized.config.maxDurationMs,
            maxIdleGapMs: normalized.config.maxIdleGapMs,
            splitOnTrustedLocalDateChange: normalized.config.splitOnTrustedLocalDateChange,
            mode: normalized.config.mode,
            applyToLive: normalized.config.applyToLive,
            applyToImports: normalized.config.applyToImports,
            policyVersion: normalized.config.policyVersion,
            timezone: normalized.config.timezone,
        };
        const warnings = [...this.liveConfigDiagnostics.map((item) => item.code), ...overrideWarnings, ...normalized.diagnostics.map((item) => item.code)];
        if (missingRawEventIds.length)
            warnings.push('unresolved_raw_events');
        if (events[0] && events[0].role !== 'user')
            warnings.push('leading_non_user_event');
        const userCount = events.filter((event) => event.role === 'user').length;
        if (userCount === 0)
            warnings.push('no_user_event_episode');
        const replay = replayEpisodeBoundaries({ episode, pairs, config: normalized.config });
        warnings.push(...replay.warnings, ...replay.structuralAnomalies);
        const invariantViolations = validateEpisodeInvariants({
            episode, pairs, timezone: normalized.config.timezone,
            closureReceipts: this.store.listClosureReceipts({ episodeId: episode.episodeId, limit: 1 }),
            dreamJobState: this.store.getDreamJobState(episode.episodeId),
        });
        warnings.push(...invariantViolations.map((violation) => violation.reason));
        const proposedBoundaries = replay.detectedBoundaries.map((boundary) => ({
            boundaryIndex: boundary.boundaryIndex,
            beforeEventId: boundary.beforeEventId,
            afterEventId: boundary.afterEventId,
            primaryUserEventId: boundary.primaryUserEventId,
            reason: boundary.reason,
            relation: boundary.relation,
            effective: boundary.effective,
            disposition: boundary.disposition,
        }));
        const segments = segmentsFromBoundaries(pairs, replay.effectiveBoundaries, options.includeEventIds === true);
        const fingerprint = sourceFingerprint(pairs, episode.startedAt, episode.status, policy);
        const canonicalSegments = segments.map((item) => ({
            segmentIndex: item.segmentIndex,
            eventIdsHash: item.eventIdsHash,
            startEventId: item.startEventId,
            endEventId: item.endEventId,
            eventCount: item.eventCount,
            reason: item.reason,
        }));
        const hash = createHash('sha256').update(JSON.stringify([
            options.projectId,
            options.episodeId,
            fingerprint,
            policy,
            canonicalSegments,
            proposedBoundaries,
        ])).digest('hex');
        return {
            planId: `episode-split-plan-${hash.slice(0, 24)}`,
            plannerVersion: EPISODE_SPLIT_PLANNER_VERSION,
            projectId: options.projectId,
            episodeId: options.episodeId,
            sourceFingerprint: fingerprint,
            normalizedPolicy: policy,
            proposedBoundaries,
            impactInventory: impactInventory(pairs, policy.timezone),
            segments,
            warnings: [...new Set(warnings)].sort(),
            unresolvedEventCount: missingRawEventIds.length,
            missingRawEventIds: missingRawEventIds.slice(0, 50),
            evidenceIntegrityStatus: missingRawEventIds.length ? 'missing_raw_events' : 'ok',
            requiresManualReview: userCount === 0 || missingRawEventIds.length > 0 || replay.structuralAnomalies.length > 0 || replay.warnings.includes('invalid_trusted_local_date') || invariantViolations.some((violation) => violation.requiresManualReview),
            applyableInCurrentVersion: false,
            applyCommand: null,
        };
    }
}
const MAX_RETURNED_EVENT_IDS = 500;
function segment(index, pairs, reason, includeEventIds) {
    const eventIds = pairs.map((item) => item.link.eventId);
    const returned = includeEventIds && eventIds.length <= MAX_RETURNED_EVENT_IDS ? eventIds : undefined;
    const times = pairs.map((item) => item.event?.occurredAt).filter((value) => typeof value === 'number' && Number.isFinite(value));
    const counts = roleCounts(pairs);
    return {
        segmentIndex: index,
        eventIds: returned,
        eventIdsHash: createHash('sha256').update(JSON.stringify(eventIds)).digest('hex'),
        eventIdsOmitted: returned ? 0 : eventIds.length,
        startEventId: eventIds[0],
        endEventId: eventIds.at(-1),
        eventCount: eventIds.length,
        reason,
        startedAt: times.length ? Math.min(...times) : undefined,
        endedAt: times.length ? Math.max(...times) : undefined,
        ...counts,
    };
}
function sourceFingerprint(pairs, startedAt, status, policy) {
    const hash = createHash('sha256');
    hash.update(JSON.stringify([startedAt, status, policy]));
    for (const { link, event } of pairs) {
        hash.update(JSON.stringify([
            link.eventId,
            link.position,
            link.relation,
            event?.role,
            event?.turnId,
            event?.turnSeq,
            event?.eventOrdinal,
            event?.occurredAt,
            event?.localDate,
            event?.localDateSource,
            isImportedEvent(event),
            event?.contentHash,
        ]));
    }
    return hash.digest('hex');
}
function trustedLocalDate(event, timezone) {
    return resolveTrustedLocalDate(event, timezone).date;
}
function roleCounts(pairs) {
    return {
        userEventCount: pairs.filter((item) => item.event?.role === 'user').length,
        assistantEventCount: pairs.filter((item) => item.event?.role === 'assistant' || item.event?.role === 'agent').length,
        toolEventCount: pairs.filter((item) => item.event?.role === 'tool').length,
        systemEventCount: pairs.filter((item) => item.event?.role === 'system').length,
    };
}
function segmentsFromBoundaries(pairs, boundaries, includeEventIds) {
    const segments = [];
    let start = 0;
    for (const boundary of boundaries) {
        const nextIndex = boundary.afterEventId ? pairs.findIndex((pair) => pair.link.eventId === boundary.afterEventId) : -1;
        if (nextIndex <= start)
            continue;
        segments.push(segment(segments.length, pairs.slice(start, nextIndex), boundary.reason, includeEventIds));
        start = nextIndex;
    }
    if (start < pairs.length)
        segments.push(segment(segments.length, pairs.slice(start), segments.length ? 'tail' : 'single_segment', includeEventIds));
    return segments;
}
function isImportedEvent(event) {
    const payload = event?.payload;
    return payload?.metadata?.imported === true || payload?.metadata?.sourceRef !== undefined;
}
function impactInventory(pairs, timezone) {
    const counts = roleCounts(pairs);
    const dates = pairs
        .filter((item) => item.event?.role === 'user')
        .map((item) => trustedLocalDate(item.event, timezone))
        .filter((value) => Boolean(value));
    return {
        eventCount: pairs.length,
        ...counts,
        hardShiftCount: pairs.filter((item) => ['hard_topic_switch', 'starts_new_topic', 'switches_topic'].includes(item.link.relation)).length,
        trustedLocalDates: [...new Set(dates)],
    };
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
    if (!validThreshold(overrides.maxEvents, 20, 500))
        warnings.push('invalid_episode_boundary_max_events');
    if (!validThreshold(overrides.maxDurationMs, 300_000, 86_400_000))
        warnings.push('invalid_episode_boundary_max_duration_ms');
    if (!validThreshold(overrides.maxIdleGapMs, 300_000, 86_400_000))
        warnings.push('invalid_episode_boundary_max_idle_gap_ms');
    if (overrides.timezone !== undefined && !overrides.timezone.trim())
        warnings.push('invalid_episode_boundary_timezone');
    return warnings;
}
