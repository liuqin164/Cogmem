import { createHash } from 'node:crypto';
import { isTrustedLocalDate, normalizeEpisodeBoundaryConfig } from './EpisodeBoundaryPolicy.js';
export const EPISODE_SPLIT_PLANNER_VERSION = 'episode_split_preview.v1';
export class EpisodeSplitPlanner {
    store;
    resolveEvent;
    constructor(store, resolveEvent) {
        this.store = store;
        this.resolveEvent = resolveEvent;
    }
    plan(options) {
        const episode = this.store.getEpisode(options.episodeId);
        if (!episode || episode.projectId !== options.projectId)
            throw new Error(`episode_project_mismatch:${options.episodeId}`);
        const links = this.store.listEventLinks(options.episodeId);
        const pairs = links.map((link) => ({ link, event: this.resolveEvent?.(link.eventId) || undefined }));
        const events = pairs.map((item) => item.event).filter((event) => Boolean(event));
        const missingRawEventIds = pairs.filter((item) => !item.event).map((item) => item.link.eventId);
        const normalized = normalizeEpisodeBoundaryConfig(options);
        const policy = {
            maxEvents: normalized.config.maxEvents,
            maxDurationMs: normalized.config.maxDurationMs,
            maxIdleGapMs: normalized.config.maxIdleGapMs,
            timezone: normalized.config.timezone,
        };
        const warnings = normalized.diagnostics.map((item) => item.code);
        if (missingRawEventIds.length)
            warnings.push('unresolved_raw_events');
        if (events[0] && events[0].role !== 'user')
            warnings.push('leading_non_user_event');
        const userCount = events.filter((event) => event.role === 'user').length;
        if (userCount === 0)
            warnings.push('no_user_event_episode');
        const groups = logicalTurns(pairs);
        const segments = [];
        const proposedBoundaries = [];
        let current = [];
        for (const group of groups) {
            const boundary = current.length ? boundaryReason(current, group, policy) : undefined;
            if (boundary) {
                proposedBoundaries.push({
                    boundaryIndex: proposedBoundaries.length,
                    beforeEventId: current.at(-1)?.link.eventId,
                    afterEventId: group[0]?.link.eventId,
                    reason: boundary,
                    relation: group[0]?.link.relation,
                });
                segments.push(segment(segments.length, current, boundary, options.includeEventIds === true));
                current = [];
            }
            current.push(...group);
        }
        if (current.length > 0)
            segments.push(segment(segments.length, current, segments.length ? 'tail' : 'single_segment', options.includeEventIds === true));
        const fingerprint = sourceFingerprint(pairs);
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
            warnings,
            unresolvedEventCount: missingRawEventIds.length,
            missingRawEventIds: missingRawEventIds.slice(0, 50),
            evidenceIntegrityStatus: missingRawEventIds.length ? 'missing_raw_events' : 'ok',
            requiresManualReview: userCount === 0 || missingRawEventIds.length > 0,
            applyableInCurrentVersion: false,
            applyCommand: null,
        };
    }
}
function logicalTurns(pairs) {
    const groups = [];
    let current = [];
    let currentTurnKey;
    let currentHasUser = false;
    for (const pair of pairs) {
        const event = pair.event;
        const turnKey = event ? turnKeyFor(event) : undefined;
        const explicitTurnChange = Boolean(currentTurnKey && turnKey && currentTurnKey !== turnKey);
        const roleBoundary = event?.role === 'user' && currentHasUser && !explicitTurnChange;
        if (current.length > 0 && (explicitTurnChange || roleBoundary)) {
            groups.push(current);
            current = [];
            currentTurnKey = undefined;
            currentHasUser = false;
        }
        current.push(pair);
        if (turnKey && !currentTurnKey)
            currentTurnKey = turnKey;
        if (event?.role === 'user')
            currentHasUser = true;
    }
    if (current.length > 0)
        groups.push(current);
    return groups;
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
        eventIdsCursor: returned ? undefined : `segment:${index}:eventIds`,
        startEventId: eventIds[0],
        endEventId: eventIds.at(-1),
        eventCount: eventIds.length,
        reason,
        startedAt: times.length ? Math.min(...times) : undefined,
        endedAt: times.length ? Math.max(...times) : undefined,
        ...counts,
    };
}
function sourceFingerprint(pairs) {
    const hash = createHash('sha256');
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
            event?.contentHash,
        ]));
    }
    return hash.digest('hex');
}
function boundaryReason(current, next, policy) {
    const nextRelation = next[0]?.link.relation;
    if (nextRelation === 'closes_episode')
        return undefined;
    if (nextRelation === 'hard_topic_switch' || nextRelation === 'starts_new_topic' || nextRelation === 'switches_topic')
        return 'hard_topic_switch_boundary';
    const currentLastDate = lastTrustedUserDate(current, policy.timezone);
    const nextFirstDate = firstTrustedUserDate(next, policy.timezone);
    if (currentLastDate && nextFirstDate && currentLastDate !== nextFirstDate)
        return 'trusted_local_date_boundary';
    const currentStart = firstTime(current);
    const nextEnd = lastTime(next);
    if (currentStart !== undefined && nextEnd !== undefined && nextEnd - currentStart > policy.maxDurationMs)
        return 'max_duration_boundary';
    const currentLast = lastTime(current);
    const nextFirst = firstTime(next);
    if (currentLast !== undefined && nextFirst !== undefined && nextFirst - currentLast > policy.maxIdleGapMs)
        return 'max_idle_gap_boundary';
    if (current.length + next.length > policy.maxEvents)
        return 'max_events_boundary';
    return undefined;
}
function firstTime(pairs) {
    return pairs.find((item) => typeof item.event?.occurredAt === 'number')?.event?.occurredAt;
}
function lastTime(pairs) {
    return [...pairs].reverse().find((item) => typeof item.event?.occurredAt === 'number')?.event?.occurredAt;
}
function firstTrustedUserDate(pairs, timezone) {
    for (const pair of pairs) {
        if (pair.event?.role !== 'user')
            continue;
        const date = trustedLocalDate(pair.event, timezone);
        if (date)
            return date;
    }
    return undefined;
}
function lastTrustedUserDate(pairs, timezone) {
    for (const pair of [...pairs].reverse()) {
        if (pair.event?.role !== 'user')
            continue;
        const date = trustedLocalDate(pair.event, timezone);
        if (date)
            return date;
    }
    return undefined;
}
function trustedLocalDate(event, timezone) {
    if (!event)
        return undefined;
    if (isTrustedLocalDate(event.localDate))
        return event.localDate;
    if (!timezone || !event.occurredAt)
        return undefined;
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(event.occurredAt);
}
function turnKeyFor(event) {
    if (event.turnId)
        return `id:${event.turnId}`;
    if (typeof event.turnSeq === 'number')
        return `seq:${event.turnSeq}`;
    return undefined;
}
function roleCounts(pairs) {
    return {
        userEventCount: pairs.filter((item) => item.event?.role === 'user').length,
        assistantEventCount: pairs.filter((item) => item.event?.role === 'assistant' || item.event?.role === 'agent').length,
        toolEventCount: pairs.filter((item) => item.event?.role === 'tool').length,
        systemEventCount: pairs.filter((item) => item.event?.role === 'system').length,
    };
}
function impactInventory(pairs, timezone) {
    const counts = roleCounts(pairs);
    const dates = pairs.map((item) => trustedLocalDate(item.event, timezone)).filter((value) => Boolean(value));
    return {
        eventCount: pairs.length,
        ...counts,
        hardShiftCount: pairs.filter((item) => ['hard_topic_switch', 'starts_new_topic', 'switches_topic'].includes(item.link.relation)).length,
        trustedLocalDates: [...new Set(dates)],
    };
}
