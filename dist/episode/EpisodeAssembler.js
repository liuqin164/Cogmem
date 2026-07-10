import { createHash } from 'node:crypto';
import { eventTextForMemory } from './CogmemBlockStripper.js';
import { classifyAssistantRelation, classifyTurnRelation, classifyTurnRelationHybridTrace } from './TurnRelationClassifier.js';
import { EpisodeBoundaryPolicy } from './EpisodeBoundaryPolicy.js';
import { logicalTurnsFromPairs, replayPendingTurnBoundary } from './EpisodeBoundaryReplayEngine.js';
export class EpisodeAssembler {
    store;
    resolveEvent;
    softReopenWindowMs;
    reviewer;
    resolveTopicContext;
    boundaryPolicy;
    constructor(store, resolveEvent, softReopenWindowMs = 30 * 60_000, reviewer, resolveTopicContext, boundaryPolicy = new EpisodeBoundaryPolicy()) {
        this.store = store;
        this.resolveEvent = resolveEvent;
        this.softReopenWindowMs = softReopenWindowMs;
        this.reviewer = reviewer;
        this.resolveTopicContext = resolveTopicContext;
        this.boundaryPolicy = boundaryPolicy;
    }
    appendTurn(events, input) {
        return this.appendTurnClassified(events, input);
    }
    async appendTurnAsync(events, input) {
        const ordered = [...events].sort((a, b) => (a.eventOrdinal || 0) - (b.eventOrdinal || 0));
        validateTurnBatch(ordered, input);
        const primary = ordered.find((event) => event.role === 'user') || ordered[0];
        const threadId = input.conversationThreadId || primary.threadId || input.sessionId;
        const episode = this.store.findActiveEpisode(input.projectId, input.sessionId, input.sourceAgent, threadId);
        const cpuDecision = this.classifyPrimary(primary, episode, ordered);
        const guardResult = this.evaluateBoundary(episode, primary, ordered);
        const reviewed = guardResult.guardAction === 'enforce_new_episode' || primary.role !== 'user'
            ? {
                cpuDecision,
                reviewerInvoked: false,
                reviewerRawResultStatus: 'not_invoked',
                finalDecision: cpuDecision,
            }
            : await classifyTurnRelationHybridTrace(this.classificationContext(primary, episode, ordered), this.reviewer);
        return this.appendTurnClassified(ordered, input, reviewed.finalDecision, {
            cpuDecision: reviewed.cpuDecision,
            guardResult,
            reviewerInvoked: reviewed.reviewerInvoked,
            reviewerRawResultStatus: reviewed.reviewerRawResultStatus,
            reviewerDecision: reviewed.reviewerDecision,
            finalDecision: reviewed.finalDecision,
            observedEpisodeId: episode?.episodeId,
            observedEpisodeEventCount: episode?.eventCount,
            observedEpisodeFingerprint: episodeBoundaryFingerprint(episode),
        });
    }
    appendTurnClassified(events, input, decisionOverride, trace) {
        const ordered = [...events].sort((a, b) => (a.eventOrdinal || 0) - (b.eventOrdinal || 0));
        validateTurnBatch(ordered, input);
        const primary = ordered.find((event) => event.role === 'user') || ordered[0];
        const conversationThreadId = input.conversationThreadId || primary.threadId || input.sessionId;
        let episode = this.store.findActiveEpisode(input.projectId, input.sessionId, input.sourceAgent, conversationThreadId);
        let legacyLinkedEpisodeId;
        if (episode && !episode.sourceAgent && !episode.conversationThreadId) {
            legacyLinkedEpisodeId = episode.episodeId;
        }
        const freshGuardResult = this.evaluateBoundary(episode, primary, ordered);
        const currentEpisodeFingerprint = episodeBoundaryFingerprint(episode);
        const staleTrace = Boolean(trace && (trace.observedEpisodeFingerprint !== undefined
            ? trace.observedEpisodeFingerprint !== currentEpisodeFingerprint
            : trace.observedEpisodeId !== episode?.episodeId || trace.observedEpisodeEventCount !== episode?.eventCount));
        let cpuDecision = staleTrace ? this.classifyPrimary(primary, episode, ordered) : trace?.cpuDecision ?? this.classifyPrimary(primary, episode, ordered);
        let guardResult = freshGuardResult;
        let decision = staleTrace ? cpuDecision : decisionOverride ?? trace?.finalDecision ?? cpuDecision;
        let reviewerRawResultStatus = trace?.reviewerRawResultStatus || 'not_invoked';
        let reviewerDecision = trace?.reviewerDecision;
        if (staleTrace && trace?.reviewerInvoked) {
            reviewerRawResultStatus = 'stale_ignored';
            reviewerDecision = undefined;
            decision = cpuDecision;
        }
        let reopened = false;
        let closureReceipt;
        let linkedEpisodeId = legacyLinkedEpisodeId;
        let now = Math.max(input.now ?? 0, ...ordered.map((event) => Number.isFinite(event.occurredAt) ? event.occurredAt : Date.now()), episode?.updatedAt ?? 0);
        let previousEpisodeId = episode?.episodeId;
        const shouldAuditBoundary = primary.role === 'user' && this.boundaryPolicy.config.auditDecisions;
        let guardWarnings = guardResult.warnings.map((warning) => warning.code);
        if (decision.relation === 'noise') {
            let audit = { status: 'not_applicable', warnings: [] };
            try {
                this.store.transaction(() => {
                    audit = this.recordBoundaryDecisionSafe(shouldAuditBoundary, {
                        projectId: input.projectId,
                        sessionId: input.sessionId,
                        sourceAgent: input.sourceAgent,
                        threadId: conversationThreadId,
                        primaryEventId: primary.eventId,
                        previousEpisodeId,
                        policyVersion: guardResult.policyVersion,
                        mode: guardResult.mode,
                        guardAction: guardResult.guardAction,
                        guardCodes: guardResult.guardCodes,
                        metrics: guardResult.metrics,
                        cpuDecision,
                        reviewerInvoked: trace?.reviewerInvoked || false,
                        reviewerDecision,
                        finalDecision: decision,
                        warnings: guardResult.warnings,
                        createdAt: now,
                    });
                    if (audit.status === 'failed')
                        throw new Error(audit.warnings[0] || 'boundary_audit_write_failed');
                    for (const event of ordered) {
                        this.store.markEventDisposition({
                            eventId: event.eventId, projectId: input.projectId, disposition: 'ignored', reason: 'deterministic_noise', now,
                        });
                    }
                });
            }
            catch (error) {
                const warning = error instanceof Error ? error.message : 'boundary_audit_write_failed';
                audit = { status: 'failed', warnings: [warning] };
            }
            return {
                assignedEventIds: [],
                unassignedEventIds: audit.status === 'failed' ? ordered.map((event) => event.eventId) : [],
                ignoredEventIds: audit.status === 'failed' ? [] : ordered.map((event) => event.eventId),
                reopened: false,
                boundaryTriggered: false,
                boundaryDetected: guardResult.guardCodes.length > 0,
                boundaryApplied: false,
                boundaryMode: guardResult.mode,
                boundaryDecisionId: audit.decisionId,
                boundaryGuardCodes: guardResult.guardCodes,
                boundaryAuditRecorded: audit.status === 'inserted',
                boundaryAuditStatus: audit.status,
                previousEpisodeId,
                reviewerRawResultStatus,
                warnings: [...guardWarnings, ...audit.warnings],
            };
        }
        return this.store.transaction(() => {
            let lockedEpisode = this.store.findActiveEpisode(input.projectId, input.sessionId, input.sourceAgent, conversationThreadId);
            let lockedLegacyLinkedEpisodeId;
            if (lockedEpisode && !lockedEpisode.sourceAgent && !lockedEpisode.conversationThreadId) {
                const legacyEpisodeId = lockedEpisode.episodeId;
                lockedEpisode = this.store.claimLegacyEpisodeScope(legacyEpisodeId, input.sourceAgent, conversationThreadId);
                if (!lockedEpisode)
                    lockedLegacyLinkedEpisodeId = legacyEpisodeId;
            }
            const lockedSnapshot = lockedEpisode ? this.store.getBoundarySnapshot(lockedEpisode.episodeId, this.boundaryPolicy.config.timezone) : undefined;
            now = Math.max(now, lockedEpisode?.updatedAt ?? 0, lockedSnapshot?.lastEventAt ?? 0);
            if (episodeBoundaryFingerprint(lockedEpisode) !== currentEpisodeFingerprint) {
                episode = lockedEpisode;
                linkedEpisodeId = lockedLegacyLinkedEpisodeId;
                previousEpisodeId = episode?.episodeId;
                guardResult = this.evaluateBoundary(episode, primary, ordered);
                guardWarnings = guardResult.warnings.map((warning) => warning.code);
                cpuDecision = this.classifyPrimary(primary, episode, ordered);
                decision = cpuDecision;
                if (trace?.reviewerInvoked) {
                    reviewerRawResultStatus = 'stale_ignored';
                    reviewerDecision = undefined;
                }
            }
            let boundaryApplied = false;
            let resultingEpisodeId;
            const closureEpisode = primary.role === 'user' && decision.relation === 'closes_episode' ? episode : undefined;
            const switchEpisode = primary.role === 'user' && isHardTopicSwitch(decision.relation) ? episode : undefined;
            if (closureEpisode) {
                let targetEpisode = closureEpisode;
                if (targetEpisode.status === 'soft_sealed') {
                    targetEpisode = this.store.reopenSoftEpisode(targetEpisode.episodeId, now);
                    episode = targetEpisode;
                    reopened = true;
                }
                const assignedEventIds = this.appendOrderedEvents(targetEpisode, ordered, primary, decision, now);
                closureReceipt = this.store.sealEpisode(targetEpisode.episodeId, {
                    mode: 'hard', reason: 'explicit_user_closure', reasonCode: 'explicit_user_closure', now,
                });
                resultingEpisodeId = targetEpisode.episodeId;
                const audit = this.recordBoundaryDecisionSafe(shouldAuditBoundary, {
                    projectId: input.projectId,
                    sessionId: input.sessionId,
                    sourceAgent: input.sourceAgent,
                    threadId: conversationThreadId,
                    primaryEventId: primary.eventId,
                    previousEpisodeId,
                    resultingEpisodeId,
                    policyVersion: guardResult.policyVersion,
                    mode: guardResult.mode,
                    guardAction: guardResult.guardAction === 'shadow_new_episode' ? 'shadow_new_episode' : 'none',
                    guardCodes: guardResult.guardCodes,
                    metrics: guardResult.metrics,
                    cpuDecision,
                    reviewerInvoked: trace?.reviewerInvoked || false,
                    reviewerDecision,
                    finalDecision: decision,
                    warnings: guardResult.warnings,
                    createdAt: now,
                });
                return {
                    episode: this.store.getEpisode(targetEpisode.episodeId), assignedEventIds, unassignedEventIds: [], ignoredEventIds: [], closureReceipt, reopened,
                    boundaryTriggered: false,
                    boundaryDetected: guardResult.guardCodes.length > 0,
                    boundaryApplied: false,
                    boundaryMode: guardResult.mode,
                    boundaryDecisionId: audit.decisionId,
                    boundaryGuardCodes: guardResult.guardCodes,
                    boundaryAuditRecorded: audit.status === 'inserted',
                    boundaryAuditStatus: audit.status,
                    previousEpisodeId,
                    reviewerRawResultStatus,
                    warnings: [...guardWarnings, ...audit.warnings],
                };
            }
            if (switchEpisode) {
                const previous = switchEpisode;
                linkedEpisodeId = previous.episodeId;
                closureReceipt = this.store.sealEpisode(previous.episodeId, {
                    mode: 'hard', reason: 'explicit_topic_switch', reasonCode: 'topic_switch', now,
                });
                episode = undefined;
            }
            else if (episode && guardResult.guardAction === 'enforce_new_episode') {
                linkedEpisodeId = episode.episodeId;
                closureReceipt = this.store.sealEpisode(episode.episodeId, {
                    mode: 'hard',
                    reason: 'episode_boundary_guardrail',
                    reasonCode: boundaryReasonCode(guardResult),
                    reasonDetail: guardResult.guardCodes.join(','),
                    now,
                });
                episode = undefined;
                boundaryApplied = true;
            }
            else if (episode?.status === 'open' && decision.relation === 'ambiguous_shift') {
                linkedEpisodeId = episode.episodeId;
                closureReceipt = this.store.sealEpisode(episode.episodeId, {
                    mode: 'soft', reason: 'ambiguous_topic_shift', reasonCode: 'topic_switch', requiresReview: true, now,
                });
                episode = undefined;
            }
            if (episode?.status === 'soft_sealed') {
                const mayReopen = primary.role === 'user'
                    && new Set([
                        'continues_previous', 'clarifies_previous', 'corrects_previous', 'returns_to_old_topic',
                        'answers_assistant_question', 'accepts_assistant_proposal', 'rejects_assistant_proposal', 'confirms_assistant_fact',
                    ]).has(decision.relation)
                    && now - (episode.sealedAt ?? episode.updatedAt) <= this.softReopenWindowMs;
                if (mayReopen) {
                    episode = this.store.reopenSoftEpisode(episode.episodeId, now);
                    reopened = true;
                }
                else {
                    if (primary.role === 'user') {
                        linkedEpisodeId = episode.episodeId;
                        closureReceipt = this.store.sealEpisode(episode.episodeId, {
                            mode: 'hard', reason: 'soft_seal_stabilized', reasonCode: 'soft_seal_stabilized', now,
                        });
                    }
                    episode = undefined;
                }
            }
            if (!episode) {
                if (primary.role !== 'user' && input.allowNonUserEpisodeStart !== true) {
                    return {
                        assignedEventIds: [], unassignedEventIds: ordered.map((event) => event.eventId), ignoredEventIds: [], closureReceipt, reopened,
                        boundaryTriggered: boundaryApplied,
                        boundaryDetected: guardResult.guardCodes.length > 0,
                        boundaryApplied,
                        boundaryMode: guardResult.mode,
                        boundaryGuardCodes: guardResult.guardCodes,
                        boundaryAuditRecorded: false,
                        boundaryAuditStatus: 'not_applicable',
                        previousEpisodeId,
                        reviewerRawResultStatus,
                        warnings: guardWarnings,
                    };
                }
                const episodeStart = ordered[0];
                episode = this.store.createEpisode({
                    projectId: input.projectId, sessionId: input.sessionId, sourceAgent: input.sourceAgent,
                    conversationThreadId,
                    topicPath: decision.topicPath,
                    episodeType: decision.episodeType, importance: decision.importance,
                    eventId: episodeStart.eventId, globalSeq: episodeStart.globalSeq, occurredAt: Number.isFinite(episodeStart.occurredAt) ? episodeStart.occurredAt : now,
                    episodeTags: [decision.episodeType, ...decision.candidateTypes],
                    candidateTypes: decision.candidateTypes,
                    importanceSignals: decision.importanceSignals,
                    importanceReason: decision.rationale,
                    linkedEpisodeId,
                });
            }
            const assignedEventIds = this.appendOrderedEvents(episode, ordered, primary, decision, now);
            resultingEpisodeId = episode.episodeId;
            if (primary.role === 'user' && decision.relation === 'closes_episode') {
                closureReceipt = this.store.sealEpisode(episode.episodeId, {
                    mode: 'hard', reason: 'explicit_user_closure', reasonCode: 'explicit_user_closure', now,
                });
            }
            if (input.batchSeal && !closureReceipt) {
                const confidence = averageConfidence(this.store.listEventLinks(episode.episodeId));
                const requiresReview = !input.forceBatchSeal && confidence < 0.6;
                closureReceipt = this.store.sealEpisode(episode.episodeId, {
                    mode: requiresReview ? 'soft' : 'batch', reason: requiresReview ? 'batch_low_confidence_review' : 'batch_boundary',
                    reasonCode: 'batch_boundary', requiresReview, now,
                });
            }
            const auditGuardAction = boundaryApplied
                ? guardResult.guardAction
                : guardResult.guardAction === 'shadow_new_episode'
                    ? 'shadow_new_episode'
                    : 'none';
            const audit = this.recordBoundaryDecisionSafe(shouldAuditBoundary, {
                projectId: input.projectId,
                sessionId: input.sessionId,
                sourceAgent: input.sourceAgent,
                threadId: conversationThreadId,
                primaryEventId: primary.eventId,
                previousEpisodeId,
                resultingEpisodeId,
                policyVersion: guardResult.policyVersion,
                mode: guardResult.mode,
                guardAction: auditGuardAction,
                guardCodes: guardResult.guardCodes,
                metrics: guardResult.metrics,
                cpuDecision,
                reviewerInvoked: trace?.reviewerInvoked || false,
                reviewerDecision,
                finalDecision: decision,
                warnings: guardResult.warnings,
                createdAt: now,
            });
            return {
                episode: this.store.getEpisode(episode.episodeId), assignedEventIds, unassignedEventIds: [], ignoredEventIds: [], closureReceipt, reopened,
                boundaryTriggered: boundaryApplied,
                boundaryDetected: guardResult.guardCodes.length > 0,
                boundaryApplied,
                boundaryMode: guardResult.mode,
                boundaryDecisionId: audit.decisionId,
                boundaryGuardCodes: guardResult.guardCodes,
                boundaryAuditRecorded: audit.status === 'inserted',
                boundaryAuditStatus: audit.status,
                previousEpisodeId,
                reviewerRawResultStatus,
                warnings: [...guardWarnings, ...audit.warnings],
            };
        });
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
    appendOrderedEvents(episode, ordered, primary, decision, now) {
        const assignedEventIds = [];
        for (const event of ordered) {
            const existing = this.store.getEventLink(event.eventId);
            if (existing) {
                if (existing.episodeId !== episode.episodeId)
                    throw new Error(`episode_event_link_conflict:${event.eventId}`);
                assignedEventIds.push(event.eventId);
                continue;
            }
            const relation = eventRelation(event, primary, decision);
            this.store.appendEvent({
                episodeId: episode.episodeId, eventId: event.eventId, relation,
                confidence: event.eventId === primary.eventId ? decision.confidence : 0.9,
                globalSeq: event.globalSeq, occurredAt: Number.isFinite(event.occurredAt) ? event.occurredAt : now,
                episodeType: decision.episodeType, importance: decision.importance,
                summaryText: summaryLine(event),
                candidateTypes: decision.candidateTypes,
                importanceSignals: decision.importanceSignals,
                importanceReason: decision.rationale,
            });
            assignedEventIds.push(event.eventId);
        }
        return assignedEventIds;
    }
    evaluateBoundary(episode, primary, currentEvents) {
        const imported = currentEvents.some((event) => {
            const payload = event.payload;
            return payload?.metadata?.imported === true || payload?.metadata?.sourceRef !== undefined;
        });
        const snapshot = episode ? this.store.getBoundarySnapshot(episode.episodeId, this.boundaryPolicy.config.timezone) : undefined;
        const active = snapshot ? {
            eventCount: snapshot.eventCount,
            startedAt: snapshot.startedAt,
            lastEventAt: snapshot.lastEventAt ?? snapshot.updatedAt,
            trustedLocalDates: snapshot.trustedLocalDates,
            lastTrustedUserLocalDate: snapshot.lastTrustedLocalDate,
        } : undefined;
        return replayPendingTurnBoundary({
            config: this.boundaryPolicy.config,
            active,
            pendingPairs: currentEvents.map((event, index) => ({
                link: {
                    episodeId: episode?.episodeId ?? 'pending',
                    eventId: event.eventId,
                    position: snapshot ? snapshot.eventCount + index + 1 : index + 1,
                    relation: event.eventId === primary.eventId ? 'continues_previous' : eventRelation(event, primary, fallbackDecision()),
                    confidence: 1,
                    createdAt: Number.isFinite(event.occurredAt) ? event.occurredAt : Date.now(),
                },
                event,
            })),
            primaryEvent: primary,
            imported,
        });
    }
    recordBoundaryDecisionSafe(enabled, input) {
        if (!enabled)
            return { status: this.boundaryPolicy.config.auditDecisions ? 'not_applicable' : 'disabled', warnings: [] };
        try {
            const result = this.store.recordBoundaryDecision(input);
            return { status: result.status, decisionId: result.decisionId, warnings: [] };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { status: 'failed', warnings: [message.startsWith('episode_boundary_decision_conflict:') ? 'boundary_audit_conflict' : 'boundary_audit_write_failed'] };
        }
    }
}
function isHardTopicSwitch(relation) {
    return relation === 'hard_topic_switch' || relation === 'starts_new_topic' || relation === 'switches_topic';
}
function boundaryReasonCode(result) {
    if (result.guardCodes.includes('max_events_exceeded'))
        return 'event_limit';
    if (result.guardCodes.includes('max_duration_exceeded'))
        return 'duration_limit';
    if (result.guardCodes.includes('max_idle_gap_exceeded'))
        return 'idle_gap';
    if (result.guardCodes.includes('trusted_local_date_changed'))
        return 'local_date_boundary';
    return 'manual';
}
function episodeBoundaryFingerprint(episode) {
    if (!episode)
        return undefined;
    return createHash('sha256').update(JSON.stringify([
        episode.episodeId,
        episode.status,
        episode.eventCount,
        episode.endEventId,
        episode.updatedAt,
        episode.sealedAt,
    ])).digest('hex');
}
function eventRelation(event, primary, decision) {
    if (event.role === 'assistant' || event.role === 'agent')
        return classifyAssistantRelation(eventText(event), 'assistant');
    if (event.role === 'tool')
        return 'tool_result_context';
    return event.eventId === primary.eventId ? decision.relation : decision.relation;
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
function validateTurnBatch(events, input) {
    if (!events.length)
        throw new Error('episode_turn_empty');
    const ids = new Set();
    const expectedThread = input.conversationThreadId || events.find((event) => event.threadId)?.threadId || input.sessionId;
    for (const event of events) {
        if (ids.has(event.eventId))
            throw new Error(`episode_duplicate_event_id:${event.eventId}`);
        ids.add(event.eventId);
        if (event.projectId !== input.projectId)
            throw new Error(`episode_project_mismatch:${event.eventId}`);
        if (event.sessionId !== input.sessionId)
            throw new Error(`episode_session_mismatch:${event.eventId}`);
        if (event.threadId !== expectedThread)
            throw new Error(`episode_thread_mismatch:${event.eventId}`);
        const metadata = event.payload?.metadata;
        if (input.sourceAgent) {
            const eventSourceAgent = typeof metadata?.sourceAgent === 'string' ? metadata.sourceAgent : undefined;
            // Old raw ledgers without a source id are an explicit legacy-unscoped
            // compatibility lane. Modern scoped evidence must carry exact source
            // metadata and cannot silently join another agent's episode.
            if (!eventSourceAgent && event.sourceId)
                throw new Error(`episode_source_scope_missing:${event.eventId}`);
            if (eventSourceAgent && eventSourceAgent !== input.sourceAgent)
                throw new Error(`episode_source_scope_mismatch:${event.eventId}`);
        }
    }
    const logicalTurns = logicalTurnsFromPairs(events.map((event, index) => ({
        link: {
            episodeId: 'pending', eventId: event.eventId, position: index + 1,
            relation: 'continues_previous', confidence: 1, createdAt: event.occurredAt,
        },
        event,
    })));
    if (logicalTurns.length > 1)
        throw new Error('episode_multiple_logical_turns_in_batch');
    if (events.filter((event) => event.role === 'user').length > 1)
        throw new Error('episode_multiple_primary_users_in_batch');
}
function fallbackDecision() {
    return {
        relation: 'continues_previous',
        confidence: 1,
        signals: [],
        needsLlmReview: false,
        candidateTypes: [],
        closureCandidate: false,
        episodeType: 'discussion',
        importance: 0,
        importanceSignals: [],
        rationale: '',
    };
}
