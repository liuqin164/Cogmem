import { createHash } from 'node:crypto';
import { DEFAULT_EPISODE_BOUNDARY_CONFIG } from './EpisodeBoundaryPolicy.js';
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
        const maxEvents = Math.max(1, Math.trunc(options.maxEvents ?? DEFAULT_EPISODE_BOUNDARY_CONFIG.maxEvents));
        const warnings = [];
        if (missingRawEventIds.length)
            warnings.push('unresolved_raw_events');
        if (events[0] && events[0].role !== 'user')
            warnings.push('leading_non_user_event');
        const userCount = events.filter((event) => event.role === 'user').length;
        if (userCount === 0)
            warnings.push('no_user_event_episode');
        const groups = logicalTurns(pairs);
        const segments = [];
        let current = [];
        for (const group of groups) {
            if (current.length > 0 && current.length + group.length > maxEvents) {
                segments.push(segment(segments.length, current, 'max_events_boundary', options.includeEventIds === true));
                current = [];
            }
            current.push(...group.map((item) => item.eventId));
        }
        if (current.length > 0)
            segments.push(segment(segments.length, current, segments.length ? 'tail' : 'single_segment', options.includeEventIds === true));
        const fingerprint = sourceFingerprint(pairs);
        const hash = createHash('sha256').update(JSON.stringify([options.projectId, options.episodeId, fingerprint, maxEvents, segments])).digest('hex');
        return {
            planId: `episode-split-plan-${hash.slice(0, 24)}`,
            projectId: options.projectId,
            episodeId: options.episodeId,
            sourceFingerprint: fingerprint,
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
    for (const { link, event } of pairs) {
        if (event?.role === 'user' && current.length > 0) {
            groups.push(current);
            current = [];
        }
        current.push(link);
    }
    if (current.length > 0)
        groups.push(current);
    return groups;
}
const MAX_RETURNED_EVENT_IDS = 500;
function segment(index, eventIds, reason, includeEventIds) {
    const returned = includeEventIds && eventIds.length <= MAX_RETURNED_EVENT_IDS ? eventIds : undefined;
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
    };
}
function sourceFingerprint(pairs) {
    const hash = createHash('sha256');
    for (const { link, event } of pairs) {
        hash.update(JSON.stringify([link.eventId, link.position, link.relation, event?.occurredAt, event?.localDate, event?.contentHash]));
    }
    return hash.digest('hex');
}
