import { classifyTurnRelation } from './TurnRelationClassifier.js';
export class EpisodeAssembler {
    store;
    softReopenWindowMs;
    constructor(store, softReopenWindowMs = 30 * 60_000) {
        this.store = store;
        this.softReopenWindowMs = softReopenWindowMs;
    }
    appendTurn(events, input) {
        const ordered = [...events].sort((a, b) => (a.eventOrdinal || 0) - (b.eventOrdinal || 0));
        if (!ordered.length)
            return { assignedEventIds: [], unassignedEventIds: [], ignoredEventIds: [], reopened: false };
        const mismatched = ordered.find((event) => event.projectId && event.projectId !== input.projectId);
        if (mismatched)
            throw new Error(`episode_project_mismatch:${mismatched.eventId}`);
        const primary = ordered.find((event) => event.role === 'user') || ordered[0];
        const decision = classifyTurnRelation(eventText(primary));
        let episode = this.store.findActiveEpisode(input.projectId, input.sessionId);
        let reopened = false;
        let closureReceipt;
        const now = input.now ?? Math.max(...ordered.map((event) => event.occurredAt || Date.now()));
        if (decision.relation === 'noise') {
            for (const event of ordered) {
                this.store.markEventDisposition({
                    eventId: event.eventId, projectId: input.projectId, disposition: 'ignored', reason: 'deterministic_noise', now,
                });
            }
            return { assignedEventIds: [], unassignedEventIds: [], ignoredEventIds: ordered.map((event) => event.eventId), reopened: false };
        }
        if (episode?.status === 'open' && (decision.relation === 'switches_topic' || decision.relation === 'starts_new_topic')) {
            closureReceipt = this.store.sealEpisode(episode.episodeId, {
                mode: 'hard', reason: decision.relation === 'switches_topic' ? 'explicit_topic_switch' : 'explicit_new_topic', now,
            });
            episode = undefined;
        }
        if (episode?.status === 'soft_sealed') {
            const mayReopen = decision.relation !== 'starts_new_topic'
                && decision.relation !== 'switches_topic'
                && now - (episode.sealedAt || episode.updatedAt) <= this.softReopenWindowMs;
            if (mayReopen) {
                episode = this.store.reopenSoftEpisode(episode.episodeId, now);
                reopened = true;
            }
            else {
                episode = undefined;
            }
        }
        if (!episode) {
            episode = this.store.createEpisode({
                projectId: input.projectId, sessionId: input.sessionId, sourceAgent: input.sourceAgent,
                episodeType: decision.episodeType, importance: decision.importance,
                eventId: primary.eventId, globalSeq: primary.globalSeq, occurredAt: primary.occurredAt || now,
            });
        }
        const assignedEventIds = [];
        for (const event of ordered) {
            const existing = this.store.getEventLink(event.eventId);
            if (existing) {
                assignedEventIds.push(event.eventId);
                continue;
            }
            const relation = event.eventId === primary.eventId
                ? decision.relation
                : event.role === 'assistant'
                    ? 'answers_assistant_question'
                    : decision.relation;
            this.store.appendEvent({
                episodeId: episode.episodeId, eventId: event.eventId, relation,
                confidence: event.eventId === primary.eventId ? decision.confidence : 0.9,
                globalSeq: event.globalSeq, occurredAt: event.occurredAt || now,
                episodeType: decision.episodeType, importance: decision.importance,
                summaryText: summaryLine(event),
            });
            assignedEventIds.push(event.eventId);
        }
        if (input.batchSeal) {
            closureReceipt = this.store.sealEpisode(episode.episodeId, { mode: 'batch', reason: 'batch_boundary', now });
        }
        else if (decision.relation === 'closes_episode') {
            closureReceipt = this.store.sealEpisode(episode.episodeId, { mode: 'hard', reason: 'explicit_user_closure', now });
        }
        return { episode: this.store.getEpisode(episode.episodeId), assignedEventIds, unassignedEventIds: [], ignoredEventIds: [], closureReceipt, reopened };
    }
    appendEvent(event, input) {
        const active = this.store.findActiveEpisode(input.projectId, input.sessionId);
        if (!active && event.role !== 'user') {
            return { assignedEventIds: [], unassignedEventIds: [event.eventId], ignoredEventIds: [], reopened: false };
        }
        return this.appendTurn([event], input);
    }
}
function eventText(event) {
    const payload = event.payload;
    return typeof payload?.text === 'string'
        ? payload.text
            .replace(/<(COGMEM_RECALL_CONTEXT|COGMEM_TURN_BRIDGE|COGMEM_SESSION_STATE|COGMEM_STRATEGY_CONTEXT)\b[\s\S]*?<\/\1>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : '';
}
function summaryLine(event) {
    const text = eventText(event).replace(/\s+/g, ' ').trim().slice(0, 240);
    return `${event.role || event.rawEventType || 'event'}: ${text}`;
}
