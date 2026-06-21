import { eventTextForMemory } from './CogmemBlockStripper.js';
import { classifyAssistantRelation, classifyTurnRelation, classifyTurnRelationHybrid } from './TurnRelationClassifier.js';
export class EpisodeAssembler {
    store;
    resolveEvent;
    softReopenWindowMs;
    reviewer;
    resolveTopicContext;
    constructor(store, resolveEvent, softReopenWindowMs = 30 * 60_000, reviewer, resolveTopicContext) {
        this.store = store;
        this.resolveEvent = resolveEvent;
        this.softReopenWindowMs = softReopenWindowMs;
        this.reviewer = reviewer;
        this.resolveTopicContext = resolveTopicContext;
    }
    appendTurn(events, input) {
        return this.appendTurnClassified(events, input);
    }
    async appendTurnAsync(events, input) {
        const ordered = [...events].sort((a, b) => (a.eventOrdinal || 0) - (b.eventOrdinal || 0));
        if (!ordered.length)
            return { assignedEventIds: [], unassignedEventIds: [], ignoredEventIds: [], reopened: false };
        const primary = ordered.find((event) => event.role === 'user') || ordered[0];
        const threadId = input.conversationThreadId || primary.threadId || input.sessionId;
        const episode = this.store.findActiveEpisode(input.projectId, input.sessionId, input.sourceAgent, threadId);
        const decision = primary.role === 'user'
            ? await classifyTurnRelationHybrid(this.classificationContext(primary, episode, ordered), this.reviewer)
            : this.classifyPrimary(primary, episode, ordered);
        return this.appendTurnClassified(ordered, input, decision);
    }
    appendTurnClassified(events, input, decisionOverride) {
        const ordered = [...events].sort((a, b) => (a.eventOrdinal || 0) - (b.eventOrdinal || 0));
        if (!ordered.length)
            return { assignedEventIds: [], unassignedEventIds: [], ignoredEventIds: [], reopened: false };
        const mismatched = ordered.find((event) => event.projectId && event.projectId !== input.projectId);
        if (mismatched)
            throw new Error(`episode_project_mismatch:${mismatched.eventId}`);
        const primary = ordered.find((event) => event.role === 'user') || ordered[0];
        const conversationThreadId = input.conversationThreadId || primary.threadId || input.sessionId;
        let episode = this.store.findActiveEpisode(input.projectId, input.sessionId, input.sourceAgent, conversationThreadId);
        let legacyLinkedEpisodeId;
        if (episode && !episode.sourceAgent && !episode.conversationThreadId) {
            const legacyEpisodeId = episode.episodeId;
            episode = this.store.claimLegacyEpisodeScope(legacyEpisodeId, input.sourceAgent, conversationThreadId);
            if (!episode)
                legacyLinkedEpisodeId = legacyEpisodeId;
        }
        const decision = decisionOverride ?? this.classifyPrimary(primary, episode, ordered);
        let reopened = false;
        let closureReceipt;
        let linkedEpisodeId = legacyLinkedEpisodeId;
        const now = input.now ?? Math.max(...ordered.map((event) => event.occurredAt || Date.now()));
        if (decision.relation === 'noise') {
            for (const event of ordered) {
                this.store.markEventDisposition({
                    eventId: event.eventId, projectId: input.projectId, disposition: 'ignored', reason: 'deterministic_noise', now,
                });
            }
            return { assignedEventIds: [], unassignedEventIds: [], ignoredEventIds: ordered.map((event) => event.eventId), reopened: false };
        }
        if (episode?.status === 'open' && ['hard_topic_switch', 'starts_new_topic', 'switches_topic'].includes(decision.relation)) {
            closureReceipt = this.store.sealEpisode(episode.episodeId, {
                mode: 'hard', reason: 'explicit_topic_switch', reasonCode: 'topic_switch', now,
            });
            episode = undefined;
        }
        if (episode?.status === 'open' && decision.relation === 'ambiguous_shift') {
            linkedEpisodeId = episode.episodeId;
            closureReceipt = this.store.sealEpisode(episode.episodeId, {
                mode: 'soft', reason: 'ambiguous_topic_shift', reasonCode: 'topic_switch', requiresReview: true, now,
            });
            episode = undefined;
        }
        if (episode?.status === 'soft_sealed') {
            const mayReopen = new Set([
                'continues_previous', 'clarifies_previous', 'corrects_previous', 'returns_to_old_topic',
                'answers_assistant_question', 'accepts_assistant_proposal', 'rejects_assistant_proposal', 'confirms_assistant_fact',
            ]).has(decision.relation)
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
                conversationThreadId,
                topicPath: decision.topicPath,
                episodeType: decision.episodeType, importance: decision.importance,
                eventId: primary.eventId, globalSeq: primary.globalSeq, occurredAt: primary.occurredAt || now,
                episodeTags: [decision.episodeType, ...decision.candidateTypes],
                candidateTypes: decision.candidateTypes,
                importanceSignals: decision.importanceSignals,
                importanceReason: decision.rationale,
                linkedEpisodeId,
            });
        }
        const assignedEventIds = [];
        for (const event of ordered) {
            const existing = this.store.getEventLink(event.eventId);
            if (existing) {
                assignedEventIds.push(event.eventId);
                continue;
            }
            const relation = event.role === 'assistant' || event.role === 'agent'
                ? classifyAssistantRelation(eventText(event), 'assistant')
                : event.role === 'tool'
                    ? 'tool_result_context'
                    : decision.relation;
            this.store.appendEvent({
                episodeId: episode.episodeId, eventId: event.eventId, relation,
                confidence: event.eventId === primary.eventId ? decision.confidence : 0.9,
                globalSeq: event.globalSeq, occurredAt: event.occurredAt || now,
                episodeType: decision.episodeType, importance: decision.importance,
                summaryText: summaryLine(event),
                candidateTypes: decision.candidateTypes,
                importanceSignals: decision.importanceSignals,
                importanceReason: decision.rationale,
            });
            assignedEventIds.push(event.eventId);
        }
        if (input.batchSeal) {
            const confidence = averageConfidence(this.store.listEventLinks(episode.episodeId));
            const requiresReview = !input.forceBatchSeal && confidence < 0.6;
            closureReceipt = this.store.sealEpisode(episode.episodeId, {
                mode: requiresReview ? 'soft' : 'batch', reason: requiresReview ? 'batch_low_confidence_review' : 'batch_boundary',
                reasonCode: 'batch_boundary', requiresReview, now,
            });
        }
        else if (decision.relation === 'closes_episode') {
            closureReceipt = this.store.sealEpisode(episode.episodeId, {
                mode: 'hard', reason: 'explicit_user_closure', reasonCode: 'explicit_user_closure', now,
            });
        }
        return { episode: this.store.getEpisode(episode.episodeId), assignedEventIds, unassignedEventIds: [], ignoredEventIds: [], closureReceipt, reopened };
    }
    appendEvent(event, input) {
        const active = this.store.findActiveEpisode(input.projectId, input.sessionId, input.sourceAgent, event.threadId || input.sessionId);
        if (!active && event.role !== 'user') {
            return { assignedEventIds: [], unassignedEventIds: [event.eventId], ignoredEventIds: [], reopened: false };
        }
        return this.appendTurn([event], input);
    }
    async appendEventAsync(event, input) {
        const active = this.store.findActiveEpisode(input.projectId, input.sessionId, input.sourceAgent, event.threadId || input.sessionId);
        if (!active && event.role !== 'user') {
            return { assignedEventIds: [], unassignedEventIds: [event.eventId], ignoredEventIds: [], reopened: false };
        }
        return this.appendTurnAsync([event], input);
    }
    classificationContext(primary, episode, currentEvents = []) {
        const context = {
            currentUserText: eventText(primary),
            activeEpisodeSummary: episode?.semanticSummary?.userPosition || episode?.summary,
            activeEpisodeTopicPath: episode?.topicPath,
            currentAssistantText: currentEvents.find((event) => event.role === 'assistant' || event.role === 'agent')
                ? eventText(currentEvents.find((event) => event.role === 'assistant' || event.role === 'agent'))
                : undefined,
        };
        Object.assign(context, this.resolveTopicContext?.(primary, episode) || {});
        if (!episode || !this.resolveEvent)
            return context;
        const prior = this.store.listEventLinks(episode.episodeId)
            .map((link) => this.resolveEvent(link.eventId))
            .filter((event) => Boolean(event));
        const previousUser = [...prior].reverse().find((event) => event.role === 'user');
        const previousAssistant = [...prior].reverse().find((event) => event.role === 'assistant' || event.role === 'agent');
        context.previousUserText = previousUser ? eventText(previousUser) : undefined;
        context.previousAssistantText = previousAssistant ? eventText(previousAssistant) : undefined;
        context.recentRelations = this.store.listEventLinks(episode.episodeId).slice(-5).map((link) => link.relation);
        return context;
    }
    classifyPrimary(primary, episode, currentEvents = []) {
        if (primary.role === 'user')
            return classifyTurnRelation(this.classificationContext(primary, episode, currentEvents));
        return {
            relation: classifyAssistantRelation(eventText(primary), primary.role || 'assistant'),
            confidence: 0.9,
            signals: ['non_user_context_only'],
            needsLlmReview: false,
            candidateTypes: [],
            closureCandidate: false,
            episodeType: 'discussion',
            importance: 0.3,
            importanceSignals: ['non_user_context_only'],
            rationale: 'non_user_event_requires_later_user_evidence',
        };
    }
}
function eventText(event) {
    return eventTextForMemory(event);
}
function summaryLine(event) {
    const text = eventText(event).replace(/\s+/g, ' ').trim().slice(0, 240);
    return `${event.role || event.rawEventType || 'event'}: ${text}`;
}
function averageConfidence(links) {
    return links.length ? links.reduce((total, link) => total + link.confidence, 0) / links.length : 0;
}
