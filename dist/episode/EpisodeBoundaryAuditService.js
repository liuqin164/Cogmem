import { createHash } from 'node:crypto';
import { DEFAULT_EPISODE_BOUNDARY_CONFIG } from './EpisodeBoundaryPolicy.js';
export class EpisodeBoundaryAuditService {
    store;
    resolveEvent;
    constructor(store, resolveEvent) {
        this.store = store;
        this.resolveEvent = resolveEvent;
    }
    audit(options) {
        const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 1000));
        const episodes = options.episodeId
            ? [this.store.getEpisode(options.episodeId)].filter(Boolean)
            : this.store.listEpisodes({ projectId: options.projectId, statuses: options.status ? [options.status] : undefined, limit: limit + 1 });
        const bounded = options.cursor ? episodes.filter((episode) => episode.episodeId < options.cursor) : episodes;
        const selected = bounded.slice(0, limit);
        const config = { ...DEFAULT_EPISODE_BOUNDARY_CONFIG, ...options };
        const items = selected.map((episode) => this.auditEpisode(episode, config));
        const extra = bounded.length > limit ? bounded[limit] : undefined;
        return { items, nextCursor: extra?.episodeId };
    }
    auditEpisode(episode, config) {
        const links = this.store.listEventLinks(episode.episodeId);
        const events = links.map((link) => this.resolveEvent?.(link.eventId)).filter((event) => Boolean(event));
        const times = events.map((event) => event.occurredAt).filter((value) => typeof value === 'number');
        const dates = [...new Set(events.map((event) => event.localDate).filter((value) => Boolean(value)))];
        const relationCounts = {};
        for (const link of links)
            relationCounts[link.relation] = (relationCounts[link.relation] || 0) + 1;
        const userTimes = events.filter((event) => event.role === 'user').map((event) => event.occurredAt || 0);
        const reasons = [];
        const warnings = [];
        const durationMs = times.length ? Math.max(...times) - Math.min(...times) : 0;
        const maxEventGapMs = maxGap(times);
        const maxUserTurnGapMs = maxGap(userTimes);
        const outOfOrderEventCount = events.filter((event, index) => index > 0 && (event.occurredAt || 0) < (events[index - 1].occurredAt || 0)).length;
        if (episode.eventCount !== links.length)
            reasons.push('stored_actual_event_count_mismatch');
        if (links.length > config.maxEvents)
            reasons.push('event_count_exceeds_max');
        if (durationMs > config.maxDurationMs)
            reasons.push('duration_exceeds_max');
        if (maxUserTurnGapMs > config.maxIdleGapMs)
            reasons.push('user_turn_idle_gap_exceeds_max');
        if (dates.length > 1)
            reasons.push('multiple_trusted_local_dates');
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
        const critical = reasons.some((reason) => [
            'stored_actual_event_count_mismatch', 'event_count_exceeds_max', 'duration_exceeds_max',
            'user_turn_idle_gap_exceeds_max', 'multiple_trusted_local_dates',
        ].includes(reason));
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
            sourceFingerprint: sourceFingerprint(links.map((link, index) => ({ ...link, event: events[index] }))),
            severity: critical ? 'critical' : reasons.length ? 'warning' : 'info',
            reasons,
            warnings,
            recommendedAction: critical ? 'split-plan' : reasons.length ? 'inspect' : 'none',
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
function hardShiftCount(counts) {
    return (counts.hard_topic_switch || 0) + (counts.starts_new_topic || 0) + (counts.switches_topic || 0);
}
function sourceFingerprint(items) {
    const hash = createHash('sha256');
    for (const item of items)
        hash.update(JSON.stringify([item.eventId, item.relation, item.event?.occurredAt, item.event?.localDate, item.event?.contentHash]));
    return hash.digest('hex');
}
