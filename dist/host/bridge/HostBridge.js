/**
 * The host-neutral half of a host adapter: turn a query into the block a host
 * injects, and turn a finished turn into memory.
 *
 * Both used to live only inside the OpenClaw plugin's generated bridge, which is
 * why a second host could not reuse them: the orchestration — strategy cortex,
 * context cortex, the strict-facet retention rule — was tangled with one host's
 * names. The names are the only thing that was ever host-specific, so they are a
 * parameter (`HostIdentity`) and the rest is shared. See ADR-0004.
 *
 * Nothing here opens a database or knows which runtime called. A caller supplies
 * an already-built kernel and memory backend, which is what lets one adapter be
 * a daemon, another a one-shot CLI, and a third an in-process plugin.
 */
import { stripCogmemRecallBlocks } from '../../agent/ContextHygiene.js';
import { serializeUntrustedMemory } from '../../agent/UntrustedMemorySerializer.js';
import { clampRecallContext, compactRecallItems, contextCandidateFromRecallItem, formatRecallContext, } from '../RecallBlock.js';
/**
 * Recall for a host: decide the retrieval policy, recall, let the context cortex
 * choose what fits the budget, then render one block.
 *
 * The order matters and is deliberate. The strategy cortex plans before the
 * first recall; if its replan says the evidence was too thin, the recall runs
 * again with the new policy rather than the caller seeing a thin first attempt.
 * The context cortex then decides what actually reaches the model, and a strict
 * facet match is re-inserted if the planner dropped it — a memory the query
 * matched exactly must not disappear because a budget planner did not like it.
 */
export async function recallForHost(runtime, input, config, identity) {
    const { kernel, memory, formatStrategyContext } = runtime;
    const recallStartedAt = Date.now();
    const projectId = config.projectId || identity.projectId;
    const agentId = config.agentId || identity.agentId;
    const limit = Number(config.limit || 3);
    const query = input.query || '';
    const contextIntent = kernel.contextCortex.classifyIntent(query);
    let strategyCapsule = config.strategyCortexEnabled === false ? undefined : kernel.strategyCortex.plan({
        query, intent: contextIntent, projectId,
    });
    let result = await memory.recall({
        agentId, projectId,
        query, sessionId: input.sessionId, threadId: input.threadId,
        excludeSessionId: input.excludeSessionId, intent: input.intent || undefined,
        anchorEventId: input.anchorEventId, anchorText: input.anchorText,
        limit, retrievalPolicy: strategyCapsule && strategyCapsule.retrievalPolicy,
    });
    const sourceRequirementSatisfied = result.items.some((item) => item && item.sourceType && String(item.sourceType).startsWith('raw_ledger'));
    const replan = strategyCapsule ? kernel.strategyCortex.replan(strategyCapsule, {
        intent: contextIntent, projectId, sourceRequirementSatisfied,
    }) : { replanned: false, capsule: undefined };
    if (replan.replanned) {
        strategyCapsule = replan.capsule;
        result = await memory.recall({
            agentId, projectId,
            query, sessionId: input.sessionId, threadId: input.threadId,
            excludeSessionId: input.excludeSessionId, intent: input.intent || undefined,
            anchorEventId: input.anchorEventId, anchorText: input.anchorText,
            limit, retrievalPolicy: strategyCapsule && strategyCapsule.retrievalPolicy,
        });
    }
    const activationPlan = config.contextCortexEnabled === false ? undefined : kernel.contextCortex.plan({
        query, projectId, currentSessionId: input.sessionId,
        availableTokens: Number(config.contextAvailableTokens || 16000),
        maxMemoryRatio: Number(config.contextMemoryMaxRatio || 0.25), strategy: strategyCapsule,
        candidates: result.items.map(contextCandidateFromRecallItem),
    });
    let plannedResult = activationPlan
        ? { ...result, items: activationPlan.selected.map((candidate) => candidate.recallItem) }
        : result;
    let activationReceipt = activationPlan && activationPlan.receipt;
    if (activationPlan && Array.isArray(result.items)) {
        const selectedIds = new Set(plannedResult.items.map((item) => item && item.id).filter(Boolean));
        const strictFacetItem = (result.decisionTrace && result.decisionTrace.selectedLane === 'facet_graph_raw_ledger')
            ? result.items.find((item) => item && item.canonicalId && Array.isArray(item.matchedFacets) && item.matchedFacets.length > 0)
            : undefined;
        if (strictFacetItem && !selectedIds.has(strictFacetItem.id)) {
            // A budget planner may prefer other candidates; it may not drop a strict
            // facet match, because that is the memory the query named.
            plannedResult = { ...plannedResult, items: [strictFacetItem, ...plannedResult.items].slice(0, limit) };
            activationReceipt = {
                ...(activationReceipt || {}),
                facetGraphRetained: true,
                retainedCanonicalId: strictFacetItem.canonicalId,
                matchedFacets: strictFacetItem.matchedFacets,
                reason: 'strict_facet_match_must_not_be_silently_dropped',
            };
        }
    }
    const anchorItem = plannedResult.items.find((item) => item && item.sourceAnchor && item.sourceAnchor.eventId);
    const selectedCanonicalIds = new Set(plannedResult.items.map((item) => item && item.canonicalId).filter(Boolean));
    const selectedEpisodeCards = Array.isArray(result.atlasCards)
        ? result.atlasCards.filter((card) => card && selectedCanonicalIds.has(card.canonicalId))
        : [];
    plannedResult = { ...plannedResult, atlasCards: selectedEpisodeCards };
    const recallContext = formatRecallContext(plannedResult, config);
    return {
        context: recallContext ? (strategyCapsule ? formatStrategyContext(strategyCapsule) + '\n\n' : '') + recallContext : '',
        items: compactRecallItems(plannedResult.items, config), itemCount: plannedResult.items.length,
        recallMode: result.recallMode, fallbackUsed: result.fallbackUsed,
        intent: (result.queryPlan && result.queryPlan.intent) || input.intent || 'memory_recall',
        anchorEventId: anchorItem && anchorItem.sourceAnchor && anchorItem.sourceAnchor.eventId,
        anchorText: anchorItem && anchorItem.text, queryPlan: result.queryPlan, decisionTrace: result.decisionTrace,
        atlasCards: result.atlasCards, selectedEpisodeCards,
        relatedButNotSelected: result.relatedButNotSelected, relaxationTrace: result.relaxationTrace,
        activationReceipt, strategyCapsule,
        strategyReplanned: replan.replanned, strategyReplanReason: replan.reason,
        recallLatencyMs: Date.now() - recallStartedAt,
    };
}
/**
 * Record one finished turn, plus the tool traffic and task events around it.
 *
 * The order of writes is the causality the store needs: the assistant event
 * first, then tool calls against it, then observations against their call, and a
 * tool result with no matching call becomes a task event rather than being lost.
 * Any Cogmem block the host echoed back is stripped here, because re-ingesting a
 * recall block as new memory would launder injected context into evidence.
 */
export async function rememberForHost(runtime, payload, config, identity) {
    const { kernel, memory } = runtime;
    const agentId = config.agentId || identity.agentId;
    const projectId = config.projectId || identity.projectId;
    const sessionId = payload.sessionId || identity.sessionId;
    const cleanUser = config.stripRecallBlocksBeforeRemember === false
        ? { text: payload.userText || '', stripped: false, strippedChars: 0, blockCount: 0 }
        : stripCogmemRecallBlocks(payload.userText || '');
    const cleanAssistant = config.stripRecallBlocksBeforeRemember === false
        ? { text: payload.assistantText || '', stripped: false, strippedChars: 0, blockCount: 0 }
        : stripCogmemRecallBlocks(payload.assistantText || '');
    const hygiene = {
        ...(payload.hygiene || {}),
        strippedRecallBlocks: Boolean(payload.hygiene && payload.hygiene.strippedRecallBlocks) || cleanUser.stripped || cleanAssistant.stripped,
        strippedBlockCount: Number(payload.hygiene && payload.hygiene.strippedBlockCount || 0) + cleanUser.blockCount + cleanAssistant.blockCount,
        strippedChars: Number(payload.hygiene && payload.hygiene.strippedChars || 0) + cleanUser.strippedChars + cleanAssistant.strippedChars,
    };
    const result = await memory.rememberTurnWithResult({
        agentId,
        projectId,
        workspaceId: projectId,
        sessionId,
        userText: cleanUser.text,
        assistantText: cleanAssistant.text,
        ingestMode: config.ingestMode || 'selective_compile',
        timestamp: Date.now(),
        metadata: {
            source: identity.memorySource,
            ...(identity.pluginId ? { pluginId: identity.pluginId } : {}),
            lifecycle: 'turn',
            hygiene,
        },
    });
    const assistantEventId = result.rawEventIds[1];
    const toolCallEventIds = new Map();
    let toolCallCount = 0;
    let toolResultCount = 0;
    let taskEventCount = 0;
    for (const call of Array.isArray(payload.toolCalls) ? payload.toolCalls : []) {
        const event = await memory.ingestToolCall({
            agentId, projectId, workspaceId: projectId, sessionId,
            assistantEventId,
            toolCallId: call.toolCallId || undefined,
            toolName: call.toolName || 'unknown_tool',
            input: call.input,
            eventOrdinal: call.eventOrdinal,
            timestamp: call.timestamp,
            metadata: call.metadata,
        });
        if (call.toolCallId)
            toolCallEventIds.set(call.toolCallId, event.eventId);
        toolCallCount += 1;
    }
    for (const observation of Array.isArray(payload.toolResults) ? payload.toolResults : []) {
        const toolCallEventId = observation.toolCallId ? toolCallEventIds.get(observation.toolCallId) : undefined;
        if (toolCallEventId) {
            await memory.ingestToolObservation({
                agentId, projectId, workspaceId: projectId, sessionId,
                toolCallEventId,
                toolCallId: observation.toolCallId || undefined,
                toolName: observation.toolName || 'unknown_tool',
                output: observation.output || '',
                eventOrdinal: observation.eventOrdinal,
                timestamp: observation.timestamp,
                metadata: observation.metadata,
            });
            toolResultCount += 1;
        }
        else {
            // A result whose call was never recorded still happened; keep it as a task
            // event with the causality marked partial instead of dropping it.
            await memory.ingestTaskEvent({
                agentId, projectId, workspaceId: projectId, sessionId,
                parentEventId: assistantEventId,
                title: 'Tool result without matching tool call',
                content: observation.output || '',
                eventOrdinal: observation.eventOrdinal,
                timestamp: observation.timestamp,
                metadata: {
                    ...(observation.metadata || {}),
                    toolCallId: observation.toolCallId,
                    toolName: observation.toolName,
                    causality: 'partial',
                    reason: 'missing_tool_call_event',
                },
            });
            taskEventCount += 1;
        }
    }
    for (const task of Array.isArray(payload.taskEvents) ? payload.taskEvents : []) {
        await memory.ingestTaskEvent({
            agentId, projectId, workspaceId: projectId, sessionId,
            parentEventId: assistantEventId,
            taskId: task.taskId,
            title: task.title,
            content: task.content || '',
            eventOrdinal: task.eventOrdinal,
            timestamp: task.timestamp,
            metadata: task.metadata,
        });
        taskEventCount += 1;
    }
    let contextOutcomeId;
    if (payload.contextOutcome) {
        const outcome = kernel.memoryUseJudge.judge(payload.contextOutcome);
        kernel.contextOutcomeStore.record(outcome);
        contextOutcomeId = outcome.outcomeId;
    }
    return {
        ...result,
        hygiene,
        toolCallCount,
        toolResultCount,
        taskEventCount,
        contextOutcomeId,
    };
}
/** Re-exported so an adapter can clamp without importing two modules. */
export { clampRecallContext, serializeUntrustedMemory };
