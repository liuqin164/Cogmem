import { memoryEventCharRange, memoryEventLabel, memoryEventSourceRange, normalizeSourceContextWindow, } from '../recall/SourceContextMetadata.js';
import { isOperationalNoiseText, isRecallableMemoryEvidence } from '../recall/RecallGovernance.js';
import { compileAgentRecallQuery, } from './AgentRecallQueryCompiler.js';
import { extractEntityCues } from '../utils/EntityCueExtractor.js';
import { inferActionKinds } from '../utils/ActionKindRegistry.js';
export class KernelAgentMemoryBackend {
    kernel;
    constructor(kernel) {
        this.kernel = kernel;
    }
    async rememberTurn(turn) {
        await this.rememberTurnWithResult(turn);
    }
    async rememberTurnWithResult(turn) {
        const occurredAt = turn.timestamp ?? Date.now();
        const threadId = turn.threadId || turn.sessionId;
        const turnSeq = turn.turnSeq ?? this.kernel.eventStore.getNextTurnSeq(threadId);
        const turnId = turn.turnId || `${turn.agentId}:${turn.sessionId}:${turnSeq}:${occurredAt}`;
        const sourceId = `${turn.agentId}:${turn.sessionId}`;
        const mode = turn.ingestMode ?? 'immediate_compile';
        const userEvent = this.kernel.recordRawEvent({
            projectId: turn.projectId,
            workspaceId: turn.workspaceId,
            threadId,
            sessionId: turn.sessionId,
            turnId,
            turnSeq,
            role: 'user',
            content: turn.userText,
            eventOrdinal: 1,
            occurredAt,
            sourceId,
            metadata: this.metadataWithCollection({ ...(turn.metadata || {}), sourceAgent: turn.agentId }, turn.collection),
        });
        const assistantEvent = turn.assistantText
            ? this.kernel.recordRawEvent({
                projectId: turn.projectId,
                workspaceId: turn.workspaceId,
                threadId,
                sessionId: turn.sessionId,
                turnId,
                turnSeq,
                role: 'assistant',
                content: turn.assistantText,
                eventOrdinal: 2,
                occurredAt,
                parentEventId: userEvent.eventId,
                prevEventId: userEvent.eventId,
                causalityType: 'replies_to',
                sourceId,
                metadata: this.metadataWithCollection({ ...(turn.metadata || {}), sourceAgent: turn.agentId }, turn.collection),
            })
            : undefined;
        if (assistantEvent) {
            this.kernel.eventStore.updateNextEventId(userEvent.eventId, assistantEvent.eventId);
        }
        try {
            this.kernel.bindMemoryEvent(userEvent);
        }
        catch (error) {
            // Binding is an organizational side index; raw ledger writes must remain authoritative.
            this.kernel.pipelineMetrics.recordNonFatal('memory_binding_failed', {
                projectId: turn.projectId,
                message: error instanceof Error ? error.message : String(error),
                details: {
                    eventId: userEvent.eventId,
                    sessionId: turn.sessionId,
                    agentId: turn.agentId,
                },
            });
        }
        try {
            this.kernel.assembleEpisodeTurn([userEvent, assistantEvent].filter((event) => Boolean(event)), {
                projectId: turn.projectId,
                sessionId: turn.sessionId,
                sourceAgent: turn.agentId,
                now: occurredAt,
            });
        }
        catch (error) {
            this.kernel.pipelineMetrics.recordNonFatal('episode_assembly_failed', {
                projectId: turn.projectId,
                message: error instanceof Error ? error.message : String(error),
                details: { eventIds: [userEvent.eventId, assistantEvent?.eventId].filter(Boolean), sessionId: turn.sessionId },
            });
        }
        const sourceRefs = [userEvent, assistantEvent].filter(Boolean).map((event) => ({
            eventId: event.eventId,
            eventType: 'message',
            sourceId,
            contentHash: event.contentHash,
            threadId,
            sessionId: turn.sessionId,
            turnId,
            role: event.role,
            threadSeq: event.threadSeq,
            turnSeq: event.turnSeq,
            eventOrdinal: event.eventOrdinal,
            parentEventId: event.parentEventId,
            prevEventId: event.prevEventId,
            nextEventId: event.nextEventId,
            causalityType: event.causalityType,
            orderingConfidence: event.orderingConfidence,
        }));
        const content = [
            `User: ${turn.userText}`,
            turn.assistantText ? `Agent: ${turn.assistantText}` : '',
        ].filter(Boolean).join('\n');
        const compileSignalText = `User: ${turn.userText}`;
        const decision = this.shouldCompileTurn(mode, compileSignalText);
        const rawEventIds = [userEvent, assistantEvent].filter(Boolean).map((event) => event.eventId);
        if (!decision.compile) {
            return {
                mode,
                reason: decision.reason,
                compiled: false,
                rawEventIds,
            };
        }
        const neuron = await this.kernel.ingest({
            content,
            projectId: turn.projectId,
            createdAt: occurredAt,
            source: sourceId,
            sourceRefs,
            tags: [
                `agent:${turn.agentId}`,
                `session:${turn.sessionId}`,
                ...this.collectionTags(turn.collection),
            ],
        });
        return {
            mode,
            reason: decision.reason,
            compiled: true,
            rawEventIds,
            compiledNeuronId: neuron.id,
        };
    }
    async ingestToolCall(call) {
        const threadId = call.threadId || call.sessionId;
        const event = this.kernel.recordToolCall({
            projectId: call.projectId,
            workspaceId: call.workspaceId,
            threadId,
            sessionId: call.sessionId,
            turnId: call.turnId,
            turnSeq: call.turnSeq,
            assistantEventId: call.assistantEventId,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: call.input,
            eventOrdinal: call.eventOrdinal,
            occurredAt: call.timestamp,
            sourceId: `${call.agentId}:${call.sessionId}`,
            metadata: call.metadata,
        });
        this.tryAppendAuxiliaryEvent(event, call.projectId, call.sessionId, call.agentId);
        return event;
    }
    async ingestToolObservation(observation) {
        const threadId = observation.threadId || observation.sessionId;
        const sourceId = `${observation.agentId}:${observation.sessionId}`;
        const event = this.kernel.recordToolResult({
            projectId: observation.projectId,
            workspaceId: observation.workspaceId,
            threadId,
            sessionId: observation.sessionId,
            turnId: observation.turnId,
            turnSeq: observation.turnSeq,
            toolCallEventId: observation.toolCallEventId,
            toolCallId: observation.toolCallId,
            toolName: observation.toolName,
            output: observation.output,
            eventOrdinal: observation.eventOrdinal,
            occurredAt: observation.timestamp,
            sourceId,
            metadata: observation.metadata,
        });
        this.tryAppendAuxiliaryEvent(event, observation.projectId, observation.sessionId, observation.agentId);
        await this.kernel.ingest({
            content: `Tool ${observation.toolName} result:\n${observation.output}`,
            projectId: observation.projectId,
            createdAt: observation.timestamp ?? event.occurredAt,
            source: sourceId,
            sourceType: 'external_tool',
            type: 'agent_observation',
            sourceRefs: [this.toSourceRef(event, sourceId)],
            tags: [
                `agent:${observation.agentId}`,
                `session:${observation.sessionId}`,
                `tool:${observation.toolName}`,
                'record:tool_result',
            ],
        });
        return event;
    }
    async ingestTaskEvent(task) {
        const threadId = task.threadId || task.sessionId;
        const sourceId = `${task.agentId}:${task.sessionId}`;
        const event = this.kernel.recordTaskEvent({
            projectId: task.projectId,
            workspaceId: task.workspaceId,
            threadId,
            sessionId: task.sessionId,
            turnId: task.turnId,
            turnSeq: task.turnSeq,
            parentEventId: task.parentEventId,
            taskId: task.taskId,
            title: task.title,
            content: task.content,
            eventOrdinal: task.eventOrdinal,
            occurredAt: task.timestamp,
            sourceId,
            metadata: task.metadata,
        });
        this.tryAppendAuxiliaryEvent(event, task.projectId, task.sessionId, task.agentId);
        await this.kernel.ingest({
            content: `Task event${task.title ? ` (${task.title})` : ''}:\n${task.content}`,
            projectId: task.projectId,
            createdAt: task.timestamp ?? event.occurredAt,
            source: sourceId,
            sourceType: 'llm_inference',
            type: 'agent_observation',
            sourceRefs: [this.toSourceRef(event, sourceId)],
            tags: [
                `agent:${task.agentId}`,
                `session:${task.sessionId}`,
                task.taskId ? `task:${task.taskId}` : 'task:event',
                'record:task_event',
            ],
        });
        return event;
    }
    tryAppendAuxiliaryEvent(event, projectId, sessionId, agentId) {
        try {
            this.kernel.appendRawEventToEpisode(event, { projectId, sessionId, sourceAgent: agentId, now: event.occurredAt });
        }
        catch (error) {
            this.kernel.pipelineMetrics.recordNonFatal('episode_assembly_failed', {
                projectId,
                message: error instanceof Error ? error.message : String(error),
                details: { eventId: event.eventId, sessionId, agentId },
            });
        }
    }
    recall(query) {
        const queryPlan = compileAgentRecallQuery({
            query: query.query,
            intent: query.intent,
            anchorText: query.anchorText,
        });
        const limit = query.limit ?? 5;
        const allowsGraph = laneAllowed(query.retrievalPolicy, 'graph');
        const allowsCompiled = laneAllowed(query.retrievalPolicy, 'compiled');
        const allowsRawSource = laneAllowed(query.retrievalPolicy, 'raw_source');
        const earlyAtlasItems = query.projectId && allowsGraph
            ? this.atlasItemsForAgentQuery(queryPlan.primarySearchText, query, allowsRawSource)
            : [];
        if (queryPlan.intent === 'previous_session_summary') {
            return this.withAtlasItems(this.recallPreviousSession(query, queryPlan), earlyAtlasItems, limit);
        }
        if (queryPlan.intent === 'forensic_quote') {
            return this.withAtlasItems(this.recallForensicQuote(query, queryPlan), earlyAtlasItems, limit);
        }
        if (queryPlan.intent === 'historical_discussion' || queryPlan.intent === 'action_history') {
            return this.withAtlasItems(this.recallHistoricalDiscussion(query, queryPlan), earlyAtlasItems, limit);
        }
        const retrievalLimit = Math.max(limit * 4, 24);
        const multidimensionalRecall = query.projectId && allowsGraph
            ? this.kernel.recall(queryPlan.primarySearchText, { projectId: query.projectId, limit: retrievalLimit, includeRawEvidence: true })
            : undefined;
        const atlasItems = allowsGraph
            ? [
                ...(multidimensionalRecall?.atlas?.cards ?? []).map((card) => this.toAgentRecallItemFromAtlasCard(card, query)),
                ...(multidimensionalRecall?.atlas?.nodes ?? [])
                    .filter((node) => ['actor', 'event', 'task', 'object', 'location', 'state'].includes(node.nodeType))
                    .map((node) => this.toAgentRecallItemFromAtlasNode(node, query)),
            ]
                .filter((item) => Boolean(item))
                .filter((item) => item.sourceType !== 'raw_ledger' || allowsRawSource)
                .filter((item) => this.isAllowedAtlasCollection(item, query.collection))
            : [];
        const graphItems = allowsGraph ? this.memoryBindingGraphItemsForQuery(query, queryPlan, limit) : [];
        const result = allowsCompiled
            ? this.kernel.navigateMemory(queryPlan.primarySearchText, {
                projectId: query.projectId,
                limit: retrievalLimit,
                startTime: query.startTime,
                endTime: query.endTime,
            })
            : {
                query: queryPlan.primarySearchText,
                projectId: query.projectId,
                recallMode: 'brain_recall_fallback',
                fallbackUsed: true,
                rawEvidence: [],
            };
        const scopedItems = this.filterAgentEvidence([...result.rawEvidence, ...(allowsCompiled ? (multidimensionalRecall?.rawEvidence ?? []) : [])], query.agentId, query.collection, query.excludeSessionId)
            .slice(0, limit)
            .map((neuron) => this.toAgentRecallItem(neuron));
        const rawFallbackItems = allowsRawSource ? this.rawLedgerFallbackItemsForQuery(queryPlan, query, limit) : [];
        const baseCounts = {
            graph: graphItems.length,
            navigation: result.rawEvidence.length,
            scopedNavigation: scopedItems.length,
            brainFallback: 0,
            rawLedger: rawFallbackItems.length,
        };
        if (scopedItems.length > 0) {
            if (this.shouldPreferRawLedgerFallback(scopedItems, rawFallbackItems, queryPlan)) {
                const items = this.mergeRecallItems(graphItems, this.mergeRecallItems(rawFallbackItems, this.mergeRecallItems(scopedItems, atlasItems, limit), limit), limit);
                return {
                    recallMode: 'raw_ledger_fallback',
                    items,
                    narrative: result.navigation?.narrative,
                    pulseTrace: result.navigation?.pulse.trace,
                    temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
                    runtime: result.navigation?.runtime,
                    fallbackUsed: true,
                    queryPlan,
                    decisionTrace: recallDecisionTraceForSelection(graphItems, items, 'raw_ledger', 'raw_cue_match_preferred', baseCounts),
                };
            }
            const items = this.mergeRecallItems(graphItems, this.mergeRecallItems(scopedItems, atlasItems, limit), limit);
            return {
                recallMode: result.recallMode,
                items,
                narrative: result.navigation?.narrative,
                pulseTrace: result.navigation?.pulse.trace,
                temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
                runtime: result.navigation?.runtime,
                fallbackUsed: result.fallbackUsed,
                queryPlan,
                decisionTrace: recallDecisionTraceForSelection(graphItems, items, 'compiled', 'compiled_cue_match', baseCounts),
            };
        }
        const fallbackItems = allowsCompiled
            ? this.filterAgentEvidence((multidimensionalRecall ?? this.kernel.recall(queryPlan.primarySearchText, {
                projectId: query.projectId,
                limit: retrievalLimit,
            })).rawEvidence, query.agentId, query.collection, query.excludeSessionId)
                .slice(0, limit)
                .map((neuron) => this.toAgentRecallItem(neuron))
            : [];
        const fallbackCounts = {
            ...baseCounts,
            brainFallback: fallbackItems.length,
        };
        if (fallbackItems.length > 0) {
            if (this.shouldPreferRawLedgerFallback(fallbackItems, rawFallbackItems, queryPlan)) {
                const items = this.mergeRecallItems(graphItems, this.mergeRecallItems(rawFallbackItems, this.mergeRecallItems(fallbackItems, atlasItems, limit), limit), limit);
                return {
                    recallMode: 'raw_ledger_fallback',
                    items,
                    narrative: result.navigation?.narrative,
                    pulseTrace: result.navigation?.pulse.trace,
                    temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
                    runtime: result.navigation?.runtime,
                    fallbackUsed: true,
                    queryPlan,
                    decisionTrace: recallDecisionTraceForSelection(graphItems, items, 'raw_ledger', 'raw_cue_match_preferred', fallbackCounts),
                };
            }
            const items = this.mergeRecallItems(graphItems, this.mergeRecallItems(fallbackItems, atlasItems, limit), limit);
            return {
                recallMode: 'brain_recall_fallback',
                items,
                narrative: result.navigation?.narrative,
                pulseTrace: result.navigation?.pulse.trace,
                temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
                runtime: result.navigation?.runtime,
                fallbackUsed: true,
                queryPlan,
                decisionTrace: recallDecisionTraceForSelection(graphItems, items, 'brain_fallback', 'brain_fallback_selected', fallbackCounts),
            };
        }
        const items = this.mergeRecallItems(graphItems, this.mergeRecallItems(rawFallbackItems, atlasItems, limit), limit);
        return {
            recallMode: 'raw_ledger_fallback',
            items,
            narrative: result.navigation?.narrative,
            pulseTrace: result.navigation?.pulse.trace,
            temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
            runtime: result.navigation?.runtime,
            fallbackUsed: true,
            queryPlan,
            decisionTrace: recallDecisionTraceForSelection(graphItems, items, rawFallbackItems.length > 0 ? 'raw_ledger' : 'none', rawFallbackItems.length > 0 ? 'raw_ledger_only' : 'no_recall_evidence', fallbackCounts),
        };
    }
    recallPack(query) {
        const generatedAt = Date.now();
        const result = this.recall(query);
        const direct = result.items.slice(0, query.limit ?? 5);
        const directNeuronIds = direct
            .filter((item) => item.sourceType === 'compiled_memory' || item.sourceType === 'imported_summary')
            .map((item) => item.id);
        for (const item of direct.filter((candidate) => directNeuronIds.includes(candidate.id))) {
            this.kernel.activationStore.touch({
                neuronId: item.id,
                projectId: item.projectId || query.projectId,
                delta: 1,
                source: 'recall_pack:direct',
                touchedAt: generatedAt,
            });
            const neuron = this.kernel.memoryGraph.getNeuron(item.id);
            if (neuron) {
                this.kernel.memoryGraph.updateNeuronMetadata(item.id, {
                    lastActivated: generatedAt,
                    activationCount: (neuron.metadata.activationCount || 0) + 1,
                });
            }
        }
        const associative = this.buildAssociativeItems(query, direct, generatedAt);
        const entityCards = this.buildEntityCards(query);
        const beliefTouches = this.buildBeliefTouches(query);
        const activationHotspots = this.kernel.activationStore.getTop({
            projectId: query.projectId,
            limit: 16,
            excludeNeuronIds: direct.map((item) => item.id),
        }).filter((hotspot) => {
            const neuron = this.kernel.memoryGraph.getNeuron(hotspot.neuronId);
            return neuron
                ? this.filterAgentEvidence([neuron], query.agentId, query.collection, query.excludeSessionId).length > 0
                : false;
        }).slice(0, 8);
        return {
            ...result,
            collection: query.collection ? this.normalizeCollection(query.collection) : undefined,
            generatedAt,
            slots: {
                direct,
                associative,
                entityCards,
                beliefTouches,
            },
            chargeVector: {
                direct: direct.length,
                associative: associative.length,
                entityCards: entityCards.length,
                beliefTouches: beliefTouches.length,
                activationHotspots: activationHotspots.length,
            },
        };
    }
    recallPreviousSession(query, queryPlan) {
        const limit = query.limit ?? 5;
        const previousSessionId = this.findPreviousSessionId(query);
        const events = previousSessionId
            ? this.getSessionEvents(previousSessionId, query, Math.max(limit * 3, 24))
            : [];
        const items = events
            .filter((event) => this.isRawEventInRecallScope(event, query, queryPlan.intent))
            .filter((event) => !this.isOperationalNoiseRawEvent(event))
            .filter((event) => this.hasReadableEventText(event))
            .slice(0, limit)
            .map((event) => this.toAgentRawRecallItem(event, {
            sourceType: 'raw_ledger_session',
            whyMatched: 'previous_session_summary',
            canAnswerExactQuote: true,
        }));
        return {
            recallMode: 'raw_ledger_fallback',
            items,
            fallbackUsed: true,
            queryPlan,
            decisionTrace: recallDecisionTrace(items.length > 0 ? 'raw_ledger' : 'none', 'previous_session', {
                graph: 0,
                navigation: 0,
                scopedNavigation: 0,
                brainFallback: 0,
                rawLedger: items.length,
            }, items.length),
        };
    }
    recallForensicQuote(query, queryPlan) {
        const limit = query.limit ?? 5;
        const anchorItems = this.recallForensicAnchor(query, queryPlan, limit);
        const rawEvents = anchorItems.length > 0 && (queryPlan.anchorUsed || !!query.anchorEventId)
            ? []
            : [
                ...this.rawEventsForLocalDateCue(query, Math.max(limit * 4, 20)),
                ...this.searchRawEventsByQueryPlan(queryPlan, query, Math.max(limit * 4, 20)),
            ];
        const facetQuoteItems = anchorItems.length === 0 ? this.facetGraphQuoteItemsForQuery(query, queryPlan, limit) : [];
        const items = [
            ...anchorItems,
            ...rawEvents
                .filter((event) => this.isAgentRawEvent(event, query.agentId))
                .filter((event) => this.isRawEventInRecallScope(event, query, queryPlan.intent))
                .filter((event) => this.isQuoteSourceEvent(event))
                .filter((event) => this.hasReadableEventText(event))
                .sort((a, b) => this.quoteEventPriority(a, queryPlan) - this.quoteEventPriority(b, queryPlan))
                .slice(0, limit)
                .map((event) => this.toAgentRawRecallItem(event, {
                sourceType: 'raw_ledger',
                whyMatched: 'forensic_quote_raw_event',
                canAnswerExactQuote: true,
            })),
            ...facetQuoteItems,
        ].filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index)
            .slice(0, limit);
        return {
            recallMode: 'raw_ledger_fallback',
            items,
            fallbackUsed: true,
            queryPlan,
            decisionTrace: recallDecisionTrace(items.length > 0 ? 'raw_ledger' : 'none', 'forensic_quote', {
                graph: 0,
                navigation: 0,
                scopedNavigation: 0,
                brainFallback: 0,
                rawLedger: items.length,
            }, items.length),
        };
    }
    recallHistoricalDiscussion(query, queryPlan) {
        const limit = query.limit ?? 5;
        const allowsGraph = laneAllowed(query.retrievalPolicy, 'graph');
        const allowsCompiled = laneAllowed(query.retrievalPolicy, 'compiled');
        const allowsRawSource = laneAllowed(query.retrievalPolicy, 'raw_source');
        const facetResult = allowsGraph ? this.facetGraphItemsForQuery(query, limit) : { items: [], cards: [], relatedButNotSelected: [], relaxationTrace: [] };
        const facetItems = allowsRawSource ? facetResult.items : [];
        const graphItems = allowsGraph ? this.memoryBindingGraphItemsForQuery(query, queryPlan, limit) : [];
        const rawItems = allowsRawSource ? this.rawLedgerFallbackItemsForQuery(queryPlan, query, Math.max(limit * 2, 10)) : [];
        const compiledItems = allowsCompiled
            ? this.compiledItemsForHistoricalQuery(queryPlan, query, limit)
            : [];
        const relevantCompiledItems = this.filterCompiledItemsByQueryCues(compiledItems, queryPlan);
        const items = this.mergeHistoricalRecallItems(facetItems, rawItems, graphItems, relevantCompiledItems, limit);
        const selectedLane = facetItems.length > 0
            ? 'facet_graph_raw_ledger'
            : rawItems.length > 0
                ? 'raw_ledger'
                : graphItems.length > 0
                    ? 'graph'
                    : relevantCompiledItems.length > 0
                        ? 'compiled'
                        : 'none';
        return {
            recallMode: facetItems.length > 0
                ? (rawItems.length > 0 ? 'atlas_raw_grounded_recall' : 'atlas_facet_recall')
                : rawItems.length > 0 ? 'raw_ledger_fallback' : 'brain_recall_fallback',
            items,
            fallbackUsed: facetItems.length === 0,
            queryPlan,
            atlasCards: facetResult.cards,
            relatedButNotSelected: facetResult.relatedButNotSelected,
            relaxationTrace: facetResult.relaxationTrace,
            decisionTrace: recallDecisionTrace(selectedLane, queryPlan.intent === 'action_history' ? 'action_history' : 'historical_discussion', {
                graph: graphItems.length + facetItems.length,
                navigation: relevantCompiledItems.length,
                scopedNavigation: relevantCompiledItems.length,
                brainFallback: 0,
                rawLedger: rawItems.length + facetItems.length,
            }, items.length),
        };
    }
    facetGraphQuoteItemsForQuery(query, queryPlan, limit) {
        try {
            const atlas = this.kernel.graphExplore(query.query, {
                projectId: query.projectId,
                limit: Math.max(limit * 2, 6),
                includeEvidence: true,
                evidenceLimit: 2,
                refresh: true,
                staleOk: true,
            });
            const cards = (atlas.cards ?? []).slice(0, Math.max(limit * 2, 6));
            const events = cards
                .map((card) => card.sourceLocator?.eventId ?? card.evidenceEventIds[0])
                .filter((eventId) => Boolean(eventId))
                .map((eventId) => this.kernel.getEventContext(eventId, { before: 0, after: 0 })?.event)
                .filter((event) => Boolean(event))
                .filter((event) => this.isRawEventInRecallScope(event, query, queryPlan.intent))
                .filter((event) => this.isQuoteSourceEvent(event))
                .filter((event) => this.hasReadableEventText(event));
            return this.dedupeRawEventsByTurnPreferUser(events)
                .slice(0, limit)
                .map((event) => this.toAgentRawRecallItem(event, {
                sourceType: 'raw_ledger',
                whyMatched: 'forensic_quote_atlas_source_locator',
                canAnswerExactQuote: true,
            }));
        }
        catch {
            return [];
        }
    }
    facetGraphItemsForQuery(query, limit) {
        try {
            const recall = this.kernel.recall(query.query, { projectId: query.projectId, limit, includeRawEvidence: true });
            const atlas = recall.atlas;
            const plannedCards = atlas?.cards ?? [];
            const legacyAtlas = this.kernel.graphExplore(query.query, {
                projectId: query.projectId,
                limit,
                includeEvidence: true,
                evidenceLimit: 2,
                refresh: true,
                staleOk: true,
            });
            const cards = [...plannedCards, ...(legacyAtlas.cards ?? [])]
                .filter((card, index, all) => all.findIndex((candidate) => candidate.canonicalId === card.canonicalId) === index)
                .slice(0, limit);
            if (cards.length === 0)
                return { items: [], cards: [], relatedButNotSelected: [], relaxationTrace: [] };
            const items = cards.map((card) => this.toAgentRecallItemFromAtlasCard(card, query)).filter((item) => Boolean(item));
            const relatedButNotSelected = cards.flatMap((card) => card.relatedButNotSelected ?? []).slice(0, 8);
            return { items, cards, relatedButNotSelected, relaxationTrace: [...(atlas?.relaxationTrace ?? []), ...(legacyAtlas.relaxationTrace ?? [])] };
        }
        catch {
            return { items: [], cards: [], relatedButNotSelected: [], relaxationTrace: [] };
        }
    }
    toAgentRecallItemFromAtlasCard(card, query) {
        const eventIds = [...new Set([card.sourceLocator?.eventId, ...card.evidenceEventIds].filter((id) => Boolean(id)))];
        const scopedAnchor = eventIds.map((id) => this.kernel.eventStore.getEvent(id)).find((event) => Boolean(event && this.isAgentRawEvent(event, query.agentId) && this.isRawEventInRecallScope(event, query, query.intent)));
        const eventId = scopedAnchor?.eventId;
        if (!eventId || !scopedAnchor)
            return null;
        const sourceContext = this.toAgentSourceContext(eventId, query);
        const anchorEvent = sourceContext?.event;
        if (!scopedAnchor || !this.isAgentRawEvent(scopedAnchor, query.agentId) || !this.isRawEventInRecallScope(scopedAnchor, query, query.intent))
            return null;
        const allowRaw = laneAllowed(query.retrievalPolicy, 'raw_source');
        return {
            id: `facet:${card.canonicalId}`,
            text: [card.displayTitle, card.oneLineSummary].filter(Boolean).join(': '),
            projectId: query.projectId,
            topicPath: card.parentTopics[0],
            canonicalId: card.canonicalId,
            displayTitle: card.displayTitle,
            matchedFacets: card.matchedFacets,
            matchedPaths: card.matchedPaths,
            tags: ['facet_graph', card.eventKind, card.issueType].filter((tag) => Boolean(tag)),
            source: 'memory_atlas',
            sourceType: card.origin === 'legacy_facet' ? 'raw_ledger' : 'compiled_memory',
            sourceAnchor: allowRaw ? (anchorEvent ? this.toAgentSourceAnchorFromContextEvent(anchorEvent) : eventId ? { eventId } : undefined) : undefined,
            sourceContext: allowRaw ? sourceContext : undefined,
            confidence: Math.min(1, 0.7 + card.matchedFacets.length * 0.08),
            whyMatched: card.whyMatched,
            canAnswerExactQuote: Boolean(sourceContext),
        };
    }
    toAgentRecallItemFromAtlasNode(node, query) {
        const scopedEvidence = (node.evidence ?? [])
            .map((evidence) => this.kernel.eventStore.getEvent(evidence.eventId))
            .filter((event) => Boolean(event))
            .filter((event) => this.isAgentRawEvent(event, query.agentId) && this.isRawEventInRecallScope(event, query, query.intent));
        const event = scopedEvidence[0];
        const eventId = event?.eventId;
        if (!event || !eventId)
            return null;
        const allowRaw = laneAllowed(query.retrievalPolicy, 'raw_source');
        return {
            id: `atlas-node:${node.id}`,
            text: [node.label, node.summary].filter(Boolean).join(': '),
            projectId: query.projectId,
            canonicalId: node.id,
            displayTitle: node.label,
            tags: ['atlas_node', node.nodeType],
            source: 'memory_atlas',
            sourceType: 'compiled_memory',
            sourceAnchor: allowRaw ? this.toAgentSourceAnchor(event) : undefined,
            sourceContext: allowRaw ? this.toAgentSourceContext(eventId, query) : undefined,
            confidence: node.confidence,
            whyMatched: `atlas_${node.nodeType}`,
            canAnswerExactQuote: false,
        };
    }
    isAllowedAtlasCollection(item, collection) {
        const eventId = item.sourceAnchor?.eventId;
        if (!eventId)
            return item.sourceType === 'compiled_memory' || item.sourceType === 'imported_summary' || !collection;
        const event = this.kernel.eventStore.getEvent(eventId);
        return event ? this.isAllowedRawEventCollection(event, collection) : !collection;
    }
    recallForensicAnchor(query, queryPlan, limit) {
        if (!query.anchorEventId)
            return [];
        const context = this.kernel.getEventContext(query.anchorEventId, { before: 4, after: 4 });
        if (!context)
            return [];
        const candidates = [context.event, ...context.before.slice().reverse(), ...context.after];
        return candidates
            .filter((event) => this.isAgentRawEvent(event, query.agentId))
            .filter((event) => this.isRawEventInRecallScope(event, query, queryPlan.intent))
            .filter((event) => !this.isOperationalNoiseRawEvent(event))
            .filter((event) => this.isQuoteSourceEvent(event))
            .filter((event) => this.hasReadableEventText(event))
            .sort((a, b) => {
            const anchorDelta = (a.eventId === query.anchorEventId ? 0 : 1) - (b.eventId === query.anchorEventId ? 0 : 1);
            if (anchorDelta !== 0)
                return anchorDelta;
            return this.quoteEventPriority(a, queryPlan) - this.quoteEventPriority(b, queryPlan);
        })
            .slice(0, limit)
            .map((event) => this.toAgentRawRecallItem(event, {
            sourceType: 'raw_ledger',
            whyMatched: 'forensic_quote_anchor_event',
            canAnswerExactQuote: true,
        }));
    }
    searchRawEventsByQueryPlan(queryPlan, query, limit) {
        const seen = new Set();
        const out = [];
        const searchTexts = this.expandRawSearchTexts(queryPlan);
        for (const searchText of searchTexts) {
            const events = this.kernel.searchRawEvents(searchText, {
                projectId: query.projectId,
                workspaceId: query.workspaceId,
                threadId: query.threadId,
                startTime: query.startTime,
                endTime: query.endTime,
                limit,
            });
            for (const event of events) {
                if (seen.has(event.eventId))
                    continue;
                seen.add(event.eventId);
                out.push(event);
                if (out.length >= limit)
                    return out;
            }
        }
        return out;
    }
    rawEventsForLocalDateCue(query, limit) {
        const localDate = localDateCue(query.query, query);
        if (!localDate)
            return [];
        const [year, month, day] = localDate.split('-').map(Number);
        const byLocalDate = this.kernel.eventStore.queryEvents(1, 1000, {
            projectId: query.projectId ? [query.projectId] : undefined,
            workspaceId: query.workspaceId ? [query.workspaceId] : undefined,
        }).records.filter((event) => event.localDate === localDate).slice(0, limit);
        if (byLocalDate.length)
            return byLocalDate;
        const startTime = Date.UTC(year, month - 1, day);
        const endTime = Date.UTC(year, month - 1, day + 1);
        const byTime = this.kernel.eventStore.queryEvents(1, Math.max(1, Math.min(limit, 200)), {
            projectId: query.projectId ? [query.projectId] : undefined,
            workspaceId: query.workspaceId ? [query.workspaceId] : undefined,
            startTime,
            endTime,
        }).records;
        if (byTime.length)
            return byTime;
        return this.kernel.eventStore.queryEvents(1, 1000, {
            projectId: query.projectId ? [query.projectId] : undefined,
            workspaceId: query.workspaceId ? [query.workspaceId] : undefined,
        }).records.filter((event) => event.localDate === localDate).slice(0, limit);
    }
    rawLedgerFallbackItemsForQuery(queryPlan, query, limit) {
        const searchedEvents = this.searchRawEventsByQueryPlan(queryPlan, query, Math.max(limit * 2, 10));
        const rawEvents = queryPlan.intent === 'forensic_quote'
            ? this.dedupeRawEventsByTurnPreferUser(searchedEvents)
            : this.dedupeRawEventsByTurnPreferCue(searchedEvents, queryPlan);
        return rawEvents
            .filter((event) => this.isRawEventInRecallScope(event, query, queryPlan.intent))
            .filter((event) => !this.isOperationalNoiseRawEvent(event))
            .slice(0, limit)
            .map((event) => this.toAgentRawRecallItem(event, {
            sourceType: 'raw_ledger',
            whyMatched: 'raw_ledger_text_fallback',
            canAnswerExactQuote: true,
        }));
    }
    memoryBindingGraphItemsForQuery(query, queryPlan, limit) {
        const anchors = this.kernel.recallMemoryBindingGraph([query.query, queryPlan.primarySearchText, ...queryPlan.searchTexts].join('\n'), {
            projectId: query.projectId,
            limit: Math.max(limit * 2, 8),
        });
        const items = [];
        const seen = new Set();
        for (const anchor of anchors) {
            if (seen.has(anchor.eventId))
                continue;
            const event = this.kernel.getEventContext(anchor.eventId, { before: 0, after: 0 })?.event;
            if (!event)
                continue;
            if (!this.isRawEventInRecallScope(event, query, queryPlan.intent))
                continue;
            if (this.isOperationalNoiseRawEvent(event))
                continue;
            if (!this.hasReadableEventText(event))
                continue;
            const item = this.toAgentRawRecallItem(event, {
                sourceType: 'raw_ledger',
                whyMatched: 'memory_binding_graph',
                canAnswerExactQuote: true,
            });
            items.push({
                ...item,
                topicPath: anchor.topicPath,
                confidence: anchor.confidence,
                tags: [
                    ...item.tags,
                    `topic:${anchor.topicPath}`,
                    anchor.clusterId ? `cluster:${anchor.clusterId}` : '',
                ].filter(Boolean),
            });
            seen.add(anchor.eventId);
        }
        return items
            .sort((a, b) => this.graphRecallTextScore(b, query) - this.graphRecallTextScore(a, query))
            .slice(0, limit);
    }
    graphRecallTextScore(item, query) {
        const queryTerms = uniqueNonEmpty(query.query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff_-]+/))
            .filter((term) => term.length >= 2 && !/^(cogmem|memory|project|之前|什么|问题|why|did|say)$/i.test(term));
        const haystack = this.itemSearchableText(item).toLowerCase();
        const overlap = queryTerms.filter((term) => haystack.includes(term)).length;
        return overlap + (item.confidence || 0);
    }
    shouldPreferRawLedgerFallback(candidateItems, rawFallbackItems, queryPlan) {
        if (rawFallbackItems.length === 0)
            return false;
        const rawHasCue = this.itemsContainRecallCue(rawFallbackItems, queryPlan);
        if (!rawHasCue)
            return false;
        if (!this.itemsContainRecallCue(candidateItems, queryPlan))
            return true;
        if (queryPlan.temporalHints.includes('past')) {
            const rawLead = rawFallbackItems.find((item) => this.itemsContainRecallCue([item], queryPlan));
            const candidateLead = candidateItems.find((item) => this.itemsContainRecallCue([item], queryPlan));
            if (rawLead?.sourceAnchor?.role === 'user' && candidateLead?.sourceAnchor?.role !== 'user') {
                return true;
            }
        }
        return false;
    }
    itemsContainRecallCue(items, queryPlan) {
        const cues = this.recallCueTerms(queryPlan);
        if (cues.length === 0)
            return true;
        return items.some((item) => {
            const haystack = this.itemSearchableText(item).toLowerCase();
            return cues.some((cue) => haystack.includes(cue.toLowerCase()));
        });
    }
    recallCueTerms(queryPlan) {
        const terms = [
            ...queryPlan.keywords,
            ...queryPlan.semanticCuePhrases.flatMap((phrase) => phrase.split(/\s+/)),
        ]
            .map((term) => term.trim())
            .filter((term) => term.length >= 2 && !/^(hermes|openclaw|cogmem)$/i.test(term));
        return uniqueNonEmpty(terms);
    }
    queryHasStructuredCue(queryPlan) {
        return /hermes|openclaw|cogmem|启动|安装|配置|重启|停止|操作|处理|执行|start|launch|install|configure|restart|stop|run/i.test(queryPlan.originalQuery)
            || queryPlan.intent === 'action_history';
    }
    structuredCueTerms(queryPlan) {
        const terms = [
            ...queryPlan.keywords,
            ...queryPlan.semanticCuePhrases.flatMap((phrase) => phrase.split(/\s+/)),
        ]
            .map((term) => term.trim())
            .filter((term) => term.length >= 2)
            .filter((term) => !/^(之前|什么|做过|做了|让你|我的|原话|精确|完整|the|what|did|you|to)$/i.test(term));
        if (/启动|start|launch/i.test(queryPlan.originalQuery))
            terms.push('启动', 'start', 'launch');
        if (/安装|install|setup/i.test(queryPlan.originalQuery))
            terms.push('安装', 'install', 'setup');
        if (/配置|修改|config/i.test(queryPlan.originalQuery))
            terms.push('配置', '修改', 'config');
        if (/操作|处理|执行|run|ran/i.test(queryPlan.originalQuery))
            terms.push('操作', '执行', 'run');
        return uniqueNonEmpty(terms);
    }
    itemSearchableText(item) {
        return [
            item.text,
            item.source || '',
            item.tags.join(' '),
        ].join('\n');
    }
    mergeRecallItems(primary, secondary, limit) {
        const semanticAtlas = secondary.find((item) => item.source === 'memory_atlas' && (item.tags.includes('atlas_node') || item.tags.includes('facet_graph') || item.tags.includes('atlas_path')));
        const hasSemanticAtlas = primary.some((item) => item.source === 'memory_atlas' && (item.tags.includes('atlas_node') || item.tags.includes('facet_graph') || item.tags.includes('atlas_path')));
        const hasScopedPrimary = primary.some((item) => item.tags.some((tag) => tag.startsWith('agent:')));
        const prioritizedPrimary = semanticAtlas && !hasSemanticAtlas && !hasScopedPrimary && primary.length >= limit
            ? [...primary.slice(0, Math.max(0, limit - 1)), semanticAtlas]
            : primary;
        const out = [];
        const seen = new Set();
        for (const item of [...prioritizedPrimary, ...secondary.filter((candidate) => candidate !== semanticAtlas)]) {
            const keys = [item.canonicalId, item.sourceAnchor?.eventId, item.id].filter((value) => Boolean(value));
            if (keys.some((key) => seen.has(key)))
                continue;
            for (const key of keys)
                seen.add(key);
            out.push(item);
            if (out.length >= limit)
                break;
        }
        return out;
    }
    withAtlasItems(result, atlasItems, limit) {
        if (!atlasItems.length)
            return result;
        return { ...result, items: this.mergeRecallItems(result.items, atlasItems, limit) };
    }
    atlasItemsForAgentQuery(searchText, query, allowsRawSource) {
        const recall = this.kernel.recall(searchText, { projectId: query.projectId, limit: Math.max((query.limit ?? 5) * 4, 24), includeRawEvidence: true });
        const cards = (recall.atlas?.cards ?? []).map((card) => this.toAgentRecallItemFromAtlasCard(card, query));
        const nodes = (recall.atlas?.nodes ?? [])
            .filter((node) => ['actor', 'event', 'task', 'object', 'location', 'state', 'project'].includes(node.nodeType))
            .map((node) => this.toAgentRecallItemFromAtlasNode(node, query));
        return [...cards, ...nodes]
            .filter((item) => Boolean(item))
            .filter((item) => item.sourceType !== 'raw_ledger' || allowsRawSource)
            .filter((item) => this.isAllowedAtlasCollection(item, query.collection));
    }
    mergeHistoricalRecallItems(facetItems, rawItems, graphItems, compiledItems, limit) {
        const merged = this.mergeRecallItems(facetItems, this.mergeRecallItems(rawItems, this.mergeRecallItems(graphItems, compiledItems, limit), limit), limit);
        if (merged.some((item) => item.sourceType === 'imported_summary'))
            return merged;
        const importedSupport = compiledItems.find((item) => item.sourceType === 'imported_summary');
        if (!importedSupport)
            return merged;
        const withoutDuplicate = merged.filter((item) => item.id !== importedSupport.id && item.sourceAnchor?.eventId !== importedSupport.sourceAnchor?.eventId);
        if (withoutDuplicate.length < limit)
            return [...withoutDuplicate, importedSupport];
        return [...withoutDuplicate.slice(0, Math.max(0, limit - 1)), importedSupport];
    }
    compiledItemsForHistoricalQuery(queryPlan, query, limit) {
        const retrievalLimit = Math.max(limit * 4, 24);
        const out = [];
        const seen = new Set();
        for (const searchText of uniqueNonEmpty([queryPlan.primarySearchText, ...queryPlan.searchTexts, queryPlan.originalQuery])) {
            const rawEvidence = this.kernel.navigateMemory(searchText, {
                projectId: query.projectId,
                limit: retrievalLimit,
                startTime: query.startTime,
                endTime: query.endTime,
            }).rawEvidence;
            const items = this.filterAgentEvidence(rawEvidence, query.agentId, query.collection, query.excludeSessionId)
                .map((neuron) => this.toAgentRecallItem(neuron));
            for (const item of items) {
                const key = item.id || item.sourceAnchor?.eventId;
                if (key && seen.has(key))
                    continue;
                if (key)
                    seen.add(key);
                out.push(item);
                if (out.length >= limit)
                    return out;
            }
        }
        return out;
    }
    filterCompiledItemsByQueryCues(items, queryPlan) {
        if (!this.queryHasStructuredCue(queryPlan))
            return items;
        const cues = this.structuredCueTerms(queryPlan);
        if (!cues.length)
            return items;
        return items.filter((item) => {
            const haystack = this.itemSearchableText(item).toLowerCase();
            if (queryPlan.intent === 'action_history') {
                const entityTerms = extractEntityCues(queryPlan.originalQuery).map((entity) => entity.label.toLowerCase());
                const entityMatched = entityTerms.length === 0 || entityTerms.some((term) => haystack.includes(term));
                const queryKinds = inferActionKinds(queryPlan.originalQuery);
                const allowedKinds = queryKinds.length ? queryKinds : ['started', 'installed', 'configured', 'restarted', 'stopped', 'operated', 'implemented'];
                const itemKinds = inferActionKinds(haystack);
                const actionMatched = itemKinds.some((kind) => allowedKinds.includes(kind));
                return entityMatched && actionMatched;
            }
            return cues.some((cue) => haystack.includes(cue.toLowerCase()));
        });
    }
    dedupeRawEventsByTurnPreferUser(events) {
        const byTurn = new Map();
        for (const event of events) {
            const key = event.turnId || event.eventId;
            const existing = byTurn.get(key);
            if (!existing) {
                byTurn.set(key, event);
                continue;
            }
            if (event.role === 'user' && existing.role !== 'user') {
                byTurn.set(key, event);
            }
        }
        return [...byTurn.values()].sort((a, b) => ((a.globalSeq || 0) - (b.globalSeq || 0)
            || this.quoteEventPriority(a) - this.quoteEventPriority(b)
            || a.eventId.localeCompare(b.eventId)));
    }
    expandRawSearchTexts(queryPlan) {
        const hostNeutralKeywords = queryPlan.keywords.filter((keyword) => !/^(hermes|openclaw|cogmem)$/i.test(keyword));
        return uniqueNonEmpty([
            queryPlan.originalQuery,
            queryPlan.keywords.join(' '),
            ...queryPlan.searchTexts,
            hostNeutralKeywords.join(' '),
            ...hostNeutralKeywords.filter((keyword) => keyword.length >= 2),
        ]);
    }
    findPreviousSessionId(query) {
        const page = this.kernel.eventStore.queryEvents(1, 1000, {
            projectId: query.projectId ? [query.projectId] : undefined,
            workspaceId: query.workspaceId ? [query.workspaceId] : undefined,
            startTime: query.startTime,
            endTime: query.endTime,
        });
        const currentSessionIds = new Set([query.sessionId, query.excludeSessionId].filter((value) => !!value));
        const sessionIds = new Set();
        for (const event of page.records) {
            if (!event.sessionId || currentSessionIds.has(event.sessionId))
                continue;
            if (!this.isAgentRawEvent(event, query.agentId))
                continue;
            if (this.isOperationalNoiseRawEvent(event))
                continue;
            sessionIds.add(event.sessionId);
        }
        return sessionIds.values().next().value;
    }
    getSessionEvents(sessionId, query, limit) {
        const page = this.kernel.eventStore.queryEvents(1, Math.max(limit, 1), {
            projectId: query.projectId ? [query.projectId] : undefined,
            workspaceId: query.workspaceId ? [query.workspaceId] : undefined,
            sessionId: [sessionId],
            startTime: query.startTime,
            endTime: query.endTime,
        });
        return page.records
            .slice()
            .sort((a, b) => ((a.globalSeq || 0) - (b.globalSeq || 0)
            || (a.threadSeq || 0) - (b.threadSeq || 0)
            || (a.eventOrdinal || 0) - (b.eventOrdinal || 0)
            || a.eventId.localeCompare(b.eventId)));
    }
    dedupeRawEventsByTurnPreferCue(events, queryPlan) {
        const byTurn = new Map();
        for (const event of events) {
            const key = event.turnId || event.eventId;
            const existing = byTurn.get(key);
            if (!existing) {
                byTurn.set(key, event);
                continue;
            }
            const eventScore = this.rawEventCueScore(event, queryPlan);
            const existingScore = this.rawEventCueScore(existing, queryPlan);
            const rolePriority = this.quoteEventPriority(event) - this.quoteEventPriority(existing);
            if (eventScore > existingScore || (eventScore === existingScore
                && (rolePriority < 0
                    || (rolePriority === 0 && this.rawEventTextLength(event) > this.rawEventTextLength(existing))))) {
                byTurn.set(key, event);
            }
        }
        return [...byTurn.values()].sort((a, b) => (this.rawEventCueScore(b, queryPlan) - this.rawEventCueScore(a, queryPlan)
            || (a.globalSeq || 0) - (b.globalSeq || 0)
            || (a.threadSeq || 0) - (b.threadSeq || 0)
            || (a.eventOrdinal || 0) - (b.eventOrdinal || 0)
            || a.eventId.localeCompare(b.eventId)));
    }
    rawEventCueScore(event, queryPlan) {
        const haystack = this.rawEventText(event).toLowerCase();
        return this.recallCueTerms(queryPlan)
            .reduce((score, cue) => score + (haystack.includes(cue.toLowerCase()) ? 1 : 0), 0);
    }
    rawEventTextLength(event) {
        return this.rawEventText(event).length;
    }
    rawEventText(event) {
        const payload = event.payload;
        if (typeof payload.text === 'string')
            return payload.text;
        if (typeof payload.output === 'string')
            return payload.output;
        if (typeof payload.title === 'string')
            return payload.title;
        return JSON.stringify(event.payload);
    }
    filterAgentEvidence(neurons, agentId, collection, excludeSessionId) {
        return neurons.filter((neuron) => {
            if (!isRecallableMemoryEvidence(neuron))
                return false;
            const tags = neuron.metadata.tags || [];
            if (excludeSessionId && tags.includes(`session:${excludeSessionId}`))
                return false;
            if (!this.isAllowedCollectionTags(tags, collection))
                return false;
            const explicitAgentTags = tags.filter((tag) => tag.startsWith('agent:'));
            if (explicitAgentTags.length === 0)
                return true;
            return explicitAgentTags.includes(`agent:${agentId}`) || tags.includes(agentId);
        });
    }
    toAgentRecallItem(neuron) {
        const tags = neuron.metadata.tags || [];
        const importedSummary = tags.includes('reliability:imported_summary')
            || tags.includes('provenance:imported_summary')
            || tags.includes('memory_layer:summary_seed');
        const sourceEventId = this.preferredRawSourceEventId(neuron) || neuron.metadata.sourceEventId;
        const sourceContext = sourceEventId ? this.toAgentSourceContext(sourceEventId) : undefined;
        const sourceAnchor = sourceContext?.event
            ? this.toAgentSourceAnchorFromContextEvent(sourceContext.event)
            : neuron.metadata.sourceEventId ? { eventId: neuron.metadata.sourceEventId } : undefined;
        return {
            id: neuron.id,
            text: neuron.content,
            projectId: neuron.metadata.projectId,
            topicPath: neuron.metadata.topicPath,
            tags,
            source: neuron.metadata.filePath || sourceEventId || neuron.metadata.sourceEventId,
            sourceType: importedSummary ? 'imported_summary' : 'compiled_memory',
            sourceAnchor,
            sourceContext,
            confidence: importedSummary ? 0.35 : 0.75,
            whyMatched: importedSummary ? 'imported_summary_support_only' : 'governed_compiled_memory',
            canAnswerExactQuote: false,
        };
    }
    isAgentRawEvent(event, agentId) {
        if (!event.sourceId)
            return true;
        if (event.sourceId === agentId
            || event.sourceId.startsWith(`${agentId}:`)
            || event.sourceId.startsWith(`${agentId}-`)) {
            return true;
        }
        const payload = event.payload;
        const metadata = payload.metadata || {};
        const tags = Array.isArray(metadata.tags) ? metadata.tags.filter((tag) => typeof tag === 'string') : [];
        const explicitAgentTags = tags.filter((tag) => tag.startsWith('agent:'));
        if (explicitAgentTags.length > 0) {
            return explicitAgentTags.includes(`agent:${agentId}`);
        }
        if (metadata.imported === true)
            return true;
        const sourceType = typeof metadata.sourceType === 'string' ? metadata.sourceType : '';
        if (/^(hermes_state_db|conversation_markdown|openclaw_|soul_markdown)/.test(sourceType))
            return true;
        if (/^(hermes_state_db|conversation_markdown|openclaw_|soul_markdown)/.test(event.sourceId))
            return true;
        return false;
    }
    isRawEventInRecallScope(event, query, effectiveIntent) {
        if (query.projectId && event.projectId !== query.projectId)
            return false;
        if (query.workspaceId && event.workspaceId !== query.workspaceId)
            return false;
        if (query.threadId && event.threadId !== query.threadId)
            return false;
        if (!this.isAgentRawEvent(event, query.agentId))
            return false;
        if (!this.isAllowedSession(event, query, effectiveIntent))
            return false;
        if (!this.isAllowedRawEventCollection(event, query.collection))
            return false;
        return true;
    }
    isOperationalNoiseRawEvent(event) {
        const payload = event.payload;
        const tags = Array.isArray(payload.metadata?.tags) ? payload.metadata.tags : [];
        if (tags.some((tag) => (tag === 'operational_noise'
            || tag === 'record:heartbeat'
            || tag === 'system:heartbeat'
            || tag === 'routine:heartbeat'))) {
            return true;
        }
        return isOperationalNoiseText(typeof payload.text === 'string' ? payload.text : JSON.stringify(event.payload));
    }
    isAllowedSession(event, query, effectiveIntent = query.intent) {
        if (query.excludeSessionId && event.sessionId === query.excludeSessionId)
            return false;
        if (query.sessionId && effectiveIntent && effectiveIntent !== 'memory_recall' && event.sessionId === query.sessionId)
            return false;
        return true;
    }
    hasReadableEventText(event) {
        const payload = event.payload;
        return typeof payload.text === 'string'
            || typeof payload.output === 'string'
            || typeof payload.title === 'string';
    }
    quoteEventPriority(event, queryPlan) {
        const cuePenalty = queryPlan && this.rawEventCueScore(event, queryPlan) > 0 ? 0 : queryPlan ? 10 : 0;
        if (event.role === 'user')
            return cuePenalty;
        if (event.role === 'assistant')
            return cuePenalty + 1;
        return cuePenalty + 2;
    }
    isQuoteSourceEvent(event) {
        return event.role === 'user' || (!event.role && event.rawEventType === 'message');
    }
    toAgentRawRecallItem(event, options) {
        const payload = event.payload;
        const metadata = payload.metadata || {};
        const metadataTags = Array.isArray(metadata.tags) ? metadata.tags.filter((tag) => typeof tag === 'string') : [];
        const importedSummary = metadataTags.includes('governance:imported_summary_support')
            || metadataTags.includes('provenance:imported_summary')
            || metadataTags.includes('memory_layer:summary_seed')
            || metadata.reliabilityClass === 'imported_summary'
            || metadata.importedSummarySupport === true;
        const tags = [
            'raw_ledger',
            event.rawEventType ? `raw:${event.rawEventType}` : '',
            event.role ? `role:${event.role}` : '',
            event.sessionId ? `session:${event.sessionId}` : '',
            ...metadataTags,
        ].filter(Boolean);
        const sourceRef = metadata.sourceRef && typeof metadata.sourceRef === 'object'
            ? metadata.sourceRef
            : undefined;
        return {
            id: event.eventId,
            text: typeof payload.text === 'string' ? payload.text : JSON.stringify(event.payload),
            projectId: event.projectId,
            tags,
            source: importedSummary ? (sourceRef?.sourcePath || event.sourceId || event.eventId) : event.eventId,
            sourceType: importedSummary ? 'imported_summary' : options.sourceType,
            sourceAnchor: this.toAgentSourceAnchor(event),
            sourceContext: this.toAgentSourceContext(event.eventId),
            confidence: importedSummary ? 0.45 : 1,
            whyMatched: importedSummary ? 'imported_summary_raw_source_fallback' : options.whyMatched,
            canAnswerExactQuote: importedSummary ? false : options.canAnswerExactQuote,
        };
    }
    preferredRawSourceEventId(neuron) {
        if (!neuron.metadata.sourceEventId)
            return undefined;
        const context = this.kernel.getEventContext(neuron.metadata.sourceEventId, { before: 0, after: 0 });
        const payload = context?.event.payload;
        if (!payload || !Array.isArray(payload.sourceRefs))
            return undefined;
        const refs = payload.sourceRefs.filter((item) => Boolean(item && typeof item === 'object'));
        const userRef = refs.find((ref) => ref.eventId && ref.role === 'user');
        return userRef?.eventId || refs.find((ref) => ref.eventId)?.eventId;
    }
    toAgentSourceContext(eventId, scope) {
        const beforeCount = 2;
        const afterCount = 2;
        const context = this.kernel.getEventContext(eventId, { before: beforeCount, after: afterCount });
        if (!context)
            return undefined;
        const normalized = normalizeSourceContextWindow(context.event, context.before, context.after, {
            before: beforeCount,
            after: afterCount,
        });
        const event = this.toAgentSourceContextEvent(context.event);
        const inScope = (event) => !scope || (this.isAgentRawEvent(event, scope.agentId) && this.isRawEventInRecallScope(event, scope, scope.intent));
        return {
            event,
            before: normalized.before.filter(inScope).map((item) => this.toAgentSourceContextEvent(item)),
            after: normalized.after.filter(inScope).map((item) => this.toAgentSourceContextEvent(item)),
            parent: context.parent && inScope(context.parent) ? this.toAgentSourceContextEvent(context.parent) : undefined,
            children: context.children.filter(inScope).map((item) => this.toAgentSourceContextEvent(item)),
            window: normalized.window,
            locator: {
                eventId: event.eventId,
                globalSeq: event.globalSeq,
                projectId: event.projectId,
                command: `cogmem memory show --event ${cliArg(event.eventId)}${event.projectId ? ` --project ${cliArg(event.projectId)}` : ''} --before 2 --after 2 --json`,
                contextCommand: `cogmem memory show --event ${cliArg(event.eventId)}${event.projectId ? ` --project ${cliArg(event.projectId)}` : ''} --before 3 --after 3 --json`,
                threadId: event.threadId,
                sessionId: event.sessionId,
                localDate: event.localDate,
            },
        };
    }
    toAgentSourceContextEvent(event) {
        const text = this.eventText(event);
        return {
            eventId: event.eventId,
            globalSeq: event.globalSeq,
            label: memoryEventLabel(event),
            role: event.role,
            rawEventType: event.rawEventType,
            eventType: event.eventType,
            projectId: event.projectId,
            workspaceId: event.workspaceId,
            threadId: event.threadId,
            sessionId: event.sessionId,
            turnId: event.turnId,
            threadSeq: event.threadSeq,
            turnSeq: event.turnSeq,
            eventOrdinal: event.eventOrdinal,
            occurredAt: event.occurredAt,
            localDate: event.localDate,
            charRange: memoryEventCharRange(event),
            sourceRange: memoryEventSourceRange(event),
            textLength: text.length,
            text,
        };
    }
    toAgentSourceAnchorFromContextEvent(event) {
        return {
            eventId: event.eventId,
            threadId: event.threadId,
            sessionId: event.sessionId,
            turnId: event.turnId,
            role: event.role,
            threadSeq: event.threadSeq,
            turnSeq: event.turnSeq,
            eventOrdinal: event.eventOrdinal,
        };
    }
    toAgentSourceAnchor(event) {
        return {
            eventId: event.eventId,
            threadId: event.threadId,
            sessionId: event.sessionId,
            turnId: event.turnId,
            role: event.role,
            threadSeq: event.threadSeq,
            turnSeq: event.turnSeq,
            eventOrdinal: event.eventOrdinal,
            parentEventId: event.parentEventId,
            prevEventId: event.prevEventId,
            nextEventId: event.nextEventId,
            causalityType: event.causalityType,
            orderingConfidence: event.orderingConfidence,
        };
    }
    toSourceRef(event, sourceId) {
        return {
            eventId: event.eventId,
            eventType: event.rawEventType || event.eventType,
            sourceId,
            contentHash: event.contentHash,
            threadId: event.threadId,
            sessionId: event.sessionId,
            turnId: event.turnId,
            role: event.role,
            threadSeq: event.threadSeq,
            turnSeq: event.turnSeq,
            eventOrdinal: event.eventOrdinal,
            parentEventId: event.parentEventId,
            prevEventId: event.prevEventId,
            nextEventId: event.nextEventId,
            causalityType: event.causalityType,
            orderingConfidence: event.orderingConfidence,
        };
    }
    eventText(event) {
        const payload = event.payload;
        if (typeof payload.text === 'string')
            return payload.text;
        if (typeof payload.output === 'string')
            return payload.output;
        if (typeof payload.title === 'string')
            return payload.title;
        return JSON.stringify(event.payload);
    }
    buildAssociativeItems(query, direct, touchedAt) {
        const seen = new Set();
        const out = [];
        const directNeuronIds = direct
            .filter((item) => item.sourceType === 'compiled_memory' || item.sourceType === 'imported_summary')
            .map((item) => item.id);
        for (const neuronId of directNeuronIds) {
            const synapses = this.kernel.memoryGraph.getSynapses(neuronId).sort((a, b) => b.weight - a.weight);
            for (const synapse of synapses) {
                if (synapse.targetId === neuronId)
                    continue;
                if (seen.has(synapse.targetId))
                    continue;
                const neuron = this.kernel.memoryGraph.getNeuron(synapse.targetId);
                if (!neuron)
                    continue;
                if (this.filterAgentEvidence([neuron], query.agentId, query.collection, query.excludeSessionId).length === 0)
                    continue;
                this.kernel.activationStore.touch({
                    neuronId: neuron.id,
                    projectId: neuron.metadata.projectId || query.projectId,
                    delta: Math.max(0.1, synapse.weight * 0.5),
                    source: `recall_pack:${synapse.type}`,
                    touchedAt,
                });
                out.push(this.toAgentRecallItem(neuron));
                seen.add(neuron.id);
                if (out.length >= 4)
                    return out;
            }
        }
        const hotspots = this.kernel.activationStore.getTop({
            projectId: query.projectId,
            limit: 8,
            excludeNeuronIds: uniqueNonEmpty([...direct.map((item) => item.id), ...seen]),
        });
        for (const hotspot of hotspots) {
            const neuron = this.kernel.memoryGraph.getNeuron(hotspot.neuronId);
            if (!neuron)
                continue;
            if (this.filterAgentEvidence([neuron], query.agentId, query.collection, query.excludeSessionId).length === 0)
                continue;
            out.push(this.toAgentRecallItem(neuron));
            seen.add(neuron.id);
            if (out.length >= 4)
                return out;
        }
        return out;
    }
    buildEntityCards(query) {
        const cards = new Map();
        for (const candidate of this.entityLookupCandidates(query.query)) {
            const entity = this.kernel.entityStore.findByAlias(candidate);
            if (!entity || cards.has(entity.entityId))
                continue;
            const mentions = this.kernel.entityStore.listTimeline({
                entityId: entity.entityId,
                projectId: query.projectId,
                limit: 6,
            });
            const attributes = this.kernel.entityStore.listAttributes(entity.entityId).slice(0, 8);
            cards.set(entity.entityId, {
                entityId: entity.entityId,
                canonicalName: entity.canonicalName,
                type: entity.type,
                aliases: entity.aliases,
                attributes: attributes.map((attribute) => ({
                    key: attribute.attributeKey,
                    value: attribute.attributeValue,
                    updatedAt: attribute.updatedAt,
                })),
                recentMentions: mentions.map((mention) => ({
                    neuronId: mention.neuronId,
                    projectId: mention.projectId,
                    mentionType: mention.mentionType,
                    createdAt: mention.createdAt,
                })),
            });
            if (cards.size >= 4)
                break;
        }
        return Array.from(cards.values());
    }
    buildBeliefTouches(query) {
        const beliefs = this.kernel.beliefStore.getActiveBeliefsForQuery({
            query: query.query,
            projectId: query.projectId,
            limit: 6,
            intent: 'recall',
        });
        const history = this.kernel.beliefStore.getBeliefHistoryForCanonicalKeys(beliefs.map((belief) => belief.canonicalKey), { limitPerCanonical: 8 });
        return beliefs.map((belief) => {
            const alternatives = history.get(belief.canonicalKey) || [];
            return {
                beliefId: belief.id,
                subject: belief.subject,
                predicate: belief.predicate,
                objectValue: belief.objectValue.normalized || belief.objectValue.raw,
                confidence: belief.confidence,
                trustScore: belief.trustScore,
                status: belief.status,
                supportCount: alternatives.filter((item) => item.status === 'active' || item.status === 'superseded').length,
                conflictCount: alternatives.filter((item) => item.status === 'suspect' || item.contradictionGroup).length,
                explanation: belief.explanation,
            };
        });
    }
    entityLookupCandidates(query) {
        const tokens = query
            .split(/[\s,，。！？、:：?？!！/]+/)
            .map((token) => token.trim())
            .filter((token) => token.length >= 2);
        return uniqueNonEmpty([
            query.trim(),
            ...tokens,
            ...tokens.flatMap((token, index) => {
                const next = tokens[index + 1];
                return next ? [`${token} ${next}`] : [];
            }),
        ]);
    }
    metadataWithCollection(metadata, collection) {
        const collectionTags = this.collectionTags(collection);
        if (collectionTags.length === 0)
            return metadata;
        const existingTags = Array.isArray(metadata?.tags)
            ? metadata.tags.filter((tag) => typeof tag === 'string')
            : [];
        return {
            ...(metadata || {}),
            collection: this.normalizeCollection(collection),
            tags: uniqueNonEmpty([...existingTags, ...collectionTags]),
        };
    }
    collectionTags(collection) {
        const normalized = this.normalizeCollection(collection);
        return normalized ? [`collection:${normalized}`] : [];
    }
    normalizeCollection(collection) {
        const normalized = String(collection || '').trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');
        return normalized || undefined;
    }
    isAllowedRawEventCollection(event, collection) {
        const payload = event.payload && typeof event.payload === 'object'
            ? event.payload
            : {};
        const tags = Array.isArray(payload.metadata?.tags)
            ? payload.metadata.tags.filter((tag) => typeof tag === 'string')
            : [];
        return this.isAllowedCollectionTags(tags, collection);
    }
    isAllowedCollectionTags(tags, collection) {
        const collectionTags = tags.filter((tag) => tag.startsWith('collection:'));
        const requested = this.normalizeCollection(collection);
        if (requested) {
            if (requested === 'anchor' && collectionTags.length === 0)
                return true;
            return collectionTags.includes(`collection:${requested}`);
        }
        return collectionTags.length === 0 || collectionTags.includes('collection:anchor');
    }
    shouldCompileTurn(mode, content) {
        if (mode === 'immediate_compile')
            return { compile: true, reason: 'immediate_compile' };
        if (mode === 'raw_archive_only')
            return { compile: false, reason: 'raw_archive_only' };
        if (mode === 'raw_then_dream')
            return { compile: false, reason: 'raw_then_dream' };
        if (this.hasDurableTurnSignal(content))
            return { compile: true, reason: 'durable_signal_detected' };
        return { compile: false, reason: 'low_signal_turn' };
    }
    hasDurableTurnSignal(content) {
        const normalized = content.toLowerCase();
        const durableSignals = [
            /重要/,
            /记住/,
            /以后/,
            /长期/,
            /偏好/,
            /不要/,
            /禁止/,
            /必须/,
            /约束/,
            /边界/,
            /目标/,
            /纠正/,
            /更正/,
            /推翻/,
            /失败/,
            /成功/,
            /教训/,
            /流程/,
            /决定/,
            /架构/,
            /原则/,
            /preference/,
            /remember/,
            /important/,
            /always/,
            /never/,
            /must/,
            /do not/,
            /constraint/,
            /goal/,
            /correction/,
            /supersede/,
            /failure/,
            /lesson/,
            /decision/,
            /architecture/,
            /boundary/,
        ];
        return durableSignals.some((signal) => signal.test(normalized));
    }
}
function recallDecisionTrace(selectedLane, reason, candidateCounts, selectedCount) {
    return {
        version: 'agent_recall_decision.v1',
        selectedLane,
        reason,
        candidateCounts,
        selectedCount,
    };
}
function recallDecisionTraceForSelection(graphItems, selectedItems, nonGraphLane, nonGraphReason, candidateCounts) {
    const graphIds = new Set(graphItems.map((item) => item.id));
    const graphSelected = selectedItems.filter((item) => graphIds.has(item.id)).length;
    if (graphSelected > 0 && graphSelected === selectedItems.length) {
        return recallDecisionTrace('graph', 'graph_selected', candidateCounts, selectedItems.length);
    }
    if (graphSelected > 0) {
        return recallDecisionTrace('mixed', nonGraphReason, candidateCounts, selectedItems.length);
    }
    return recallDecisionTrace(nonGraphLane, nonGraphReason, candidateCounts, selectedItems.length);
}
function uniqueNonEmpty(values) {
    const out = [];
    const seen = new Set();
    for (const value of values) {
        const normalized = String(value || '').replace(/\s+/g, ' ').trim();
        if (!normalized)
            continue;
        const key = normalized.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(normalized);
    }
    return out;
}
function laneAllowed(policy, lane) {
    return !policy || policy.allowedLanes.includes(lane);
}
function localDateCue(query, options = {}) {
    const currentYear = localYear(options);
    const iso = query.match(/(20\d{2})[-年\/.](\d{1,2})[-月\/.](\d{1,2})日?/);
    if (iso)
        return `${iso[1]}-${padDatePart(Number(iso[2]))}-${padDatePart(Number(iso[3]))}`;
    const cn = query.match(/(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})(?:号|日)?/);
    if (cn)
        return `${cn[1] || currentYear}-${padDatePart(Number(cn[2]))}-${padDatePart(Number(cn[3]))}`;
    return undefined;
}
function localYear(options) {
    const explicit = options.localDateNow?.match(/^(20\d{2})-\d{2}-\d{2}$/u)?.[1];
    if (explicit)
        return Number(explicit);
    const now = options.now ?? Date.now();
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: options.timeZone || 'Asia/Tokyo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(new Date(now));
        const year = parts.find((part) => part.type === 'year')?.value;
        if (year)
            return Number(year);
    }
    catch { /* fall back below */ }
    return new Date(now).getUTCFullYear();
}
function padDatePart(value) {
    return String(value).padStart(2, '0');
}
function cliArg(value) {
    return /^[A-Za-z0-9._:/=@+-]+$/u.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
