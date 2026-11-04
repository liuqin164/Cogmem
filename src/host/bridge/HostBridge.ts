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
import { countSecretFindings, redactSecretText } from '../../security/SecretPatterns.js';
import { serializeUntrustedMemory } from '../../agent/UntrustedMemorySerializer.js';
import {
  clampRecallContext,
  compactRecallItems,
  contextCandidateFromRecallItem,
  formatRecallContext,
} from '../RecallBlock.js';

/** Anything arriving from a host as JSON. */
type Payload = any;

/**
 * What a host calls itself. The adapter supplies these; the shared code never
 * invents a host name, because the fallback would silently label another host's
 * turns as OpenClaw's.
 */
export interface HostIdentity {
  /** Recorded as `agentId` on every write. */
  agentId: string;
  /** Project/workspace a turn belongs to when the host names none. */
  projectId: string;
  /** Session a turn belongs to when the host names none. */
  sessionId: string;
  /** `metadata.source`, so a stored turn says which adapter recorded it. */
  memorySource: string;
  /** `metadata.pluginId`, when the host has a plugin identity to record. */
  pluginId?: string;
}

export interface HostBridgeRuntime {
  /** Kernel instance; the orchestration below uses its cortex services. */
  kernel: Payload;
  /** `KernelAgentMemoryBackend`, or anything with the same recall/remember shape. */
  memory: Payload;
  /** Renders the strategy capsule that precedes the recall block. */
  formatStrategyContext: (capsule: Payload) => string;
}

export interface RecallForHostResult {
  /** The text the host puts in front of the model. Empty when nothing surfaced. */
  context: string;
  items: Payload[];
  itemCount: number;
  recallMode?: unknown;
  fallbackUsed?: unknown;
  intent: unknown;
  anchorEventId?: unknown;
  anchorText?: unknown;
  queryPlan?: unknown;
  decisionTrace?: unknown;
  atlasCards?: unknown;
  selectedEpisodeCards: Payload[];
  relatedButNotSelected?: unknown;
  relaxationTrace?: unknown;
  activationReceipt: Payload;
  strategyCapsule?: unknown;
  strategyReplanned: boolean;
  strategyReplanReason?: unknown;
  recallLatencyMs: number;
}

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
export async function recallForHost(
  runtime: HostBridgeRuntime,
  input: Payload,
  config: Payload,
  identity: HostIdentity,
): Promise<RecallForHostResult> {
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
  const sourceRequirementSatisfied = result.items.some((item: Payload) => item && item.sourceType && String(item.sourceType).startsWith('raw_ledger'));
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
    ? { ...result, items: activationPlan.selected.map((candidate: Payload) => candidate.recallItem) }
    : result;
  let activationReceipt = activationPlan && activationPlan.receipt;
  if (activationPlan && Array.isArray(result.items)) {
    const selectedIds = new Set(plannedResult.items.map((item: Payload) => item && item.id).filter(Boolean));
    const strictFacetItem = (result.decisionTrace && result.decisionTrace.selectedLane === 'facet_graph_raw_ledger')
      ? result.items.find((item: Payload) => item && item.canonicalId && Array.isArray(item.matchedFacets) && item.matchedFacets.length > 0)
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
  const anchorItem = plannedResult.items.find((item: Payload) => item && item.sourceAnchor && item.sourceAnchor.eventId);
  const selectedCanonicalIds = new Set(plannedResult.items.map((item: Payload) => item && item.canonicalId).filter(Boolean));
  const selectedEpisodeCards = Array.isArray(result.atlasCards)
    ? result.atlasCards.filter((card: Payload) => card && selectedCanonicalIds.has(card.canonicalId))
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

export interface RememberForHostResult {
  hygiene: Payload;
  toolCallCount: number;
  toolResultCount: number;
  taskEventCount: number;
  contextOutcomeId?: string;
  [key: string]: unknown;
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
/** The text a tool call, tool result or task event carries, whatever the host called it. */
function toolCallText(call: Record<string, unknown>): string {
  return String(call.input ?? call.arguments ?? call.text ?? '');
}
function toolObservationText(observation: Record<string, unknown>): string {
  return String(observation.output ?? observation.text ?? observation.result ?? '');
}
function taskEventText(task: Record<string, unknown>): string {
  return String(task.detail ?? task.text ?? task.description ?? '');
}

/**
 * Scan one text on its way to the ledger, and mark the event only when it holds something.
 *
 * Detection only: the stored text is untouched, and a text with no findings adds no field at all, so
 * the ledger looks exactly as it did before for the ordinary case.
 */
function withSecretFindings(
  metadata: Record<string, unknown> | undefined,
  text: string,
  tally: { total: number; events: number },
): Record<string, unknown> | undefined {
  const found = countSecretFindings(text);
  if (found.total === 0) return metadata;
  tally.total += found.total;
  tally.events += 1;
  return { ...(metadata ?? {}), secretFindings: { total: found.total, byKind: found.byKind } };
}

export async function rememberForHost(
  runtime: Omit<HostBridgeRuntime, 'formatStrategyContext'>,
  payload: Payload,
  config: Payload,
  identity: HostIdentity,
): Promise<RememberForHostResult> {
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
  const secretTally = { total: 0, events: 0 };
  const hygiene = {
    ...(payload.hygiene || {}),
    strippedRecallBlocks: Boolean(payload.hygiene && payload.hygiene.strippedRecallBlocks) || cleanUser.stripped || cleanAssistant.stripped,
    strippedBlockCount: Number(payload.hygiene && payload.hygiene.strippedBlockCount || 0) + cleanUser.blockCount + cleanAssistant.blockCount,
    strippedChars: Number(payload.hygiene && payload.hygiene.strippedChars || 0) + cleanUser.strippedChars + cleanAssistant.strippedChars,
    get secretFindings() { return { total: secretTally.total, events: secretTally.events }; },
  };
  // One scan per conversation text: the user's mark is what the event carries, the assistant's rides
  // beside it because the turn metadata channel is shared by both events.
  const userSecretFindings = countSecretFindings(cleanUser.text);
  const assistantSecretFindings = countSecretFindings(cleanAssistant.text);
  if (userSecretFindings.total > 0) { secretTally.total += userSecretFindings.total; secretTally.events += 1; }
  // The assistant's marks are reported by the same summary, or the count would disagree with what
  // the events carry — the alignment the guard exists to hold.
  if (assistantSecretFindings.total > 0) { secretTally.total += assistantSecretFindings.total; secretTally.events += 1; }

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
      // The two conversation texts go through the turn's own metadata channel. They share it, so the
      // assistant's findings travel under their own key rather than overwriting the user's.
      ...(userSecretFindings.total > 0 ? { secretFindings: userSecretFindings } : {}),
      source: identity.memorySource,
      ...(identity.pluginId ? { pluginId: identity.pluginId } : {}),
      lifecycle: 'turn',
      hygiene,
    },
  });
  const assistantEventId = result.rawEventIds[1];
  const toolCallEventIds = new Map<string, string>();
  let toolCallCount = 0;
  let toolResultCount = 0;
  let taskEventCount = 0;

  // Both spellings are real: the host plugins send `toolCalls`/`toolResults`, and the snake_case
  // `tool_calls`/`tool_results` also arrive. Reading only the camel case skipped the snake-case ones
  // entirely — no event, and therefore no scan — and a tool result is where a secret usually arrives.
  const hostToolCalls = Array.isArray(payload.toolCalls)
    ? payload.toolCalls
    : Array.isArray((payload as { tool_calls?: unknown }).tool_calls)
      ? (payload as { tool_calls: unknown[] }).tool_calls
      : [];
  for (const call of hostToolCalls) {
    const event = await memory.ingestToolCall({
      agentId, projectId, workspaceId: projectId, sessionId,
      assistantEventId,
      // The call id travels under both spellings as well; the snake-case hosts pair by `tool_call_id`.
      toolCallId: call.toolCallId || (call as { tool_call_id?: unknown }).tool_call_id || undefined,
      toolName: call.toolName || 'unknown_tool',
      input: call.input,
      eventOrdinal: call.eventOrdinal,
      timestamp: call.timestamp,
      metadata: withSecretFindings(call.metadata, toolCallText(call), secretTally),
    });
    const callId = call.toolCallId ?? (call as { tool_call_id?: unknown }).tool_call_id;
    if (callId) toolCallEventIds.set(String(callId), event.eventId);
    toolCallCount += 1;
  }

  const hostToolResults = Array.isArray(payload.toolResults)
    ? payload.toolResults
    : Array.isArray((payload as { tool_results?: unknown }).tool_results)
      ? (payload as { tool_results: unknown[] }).tool_results
      : [];
  for (const observation of hostToolResults) {
    // The pairing id travels under both spellings too, for the same reason the payload keys do.
    const observationCallId = observation.toolCallId ?? (observation as { tool_call_id?: unknown }).tool_call_id;
    const toolCallEventId = observationCallId ? toolCallEventIds.get(String(observationCallId)) : undefined;
    if (toolCallEventId) {
      // Redacted before it reaches the ledger: a tool result is the main place a secret arrives from,
      // and the stored text is the only copy. Everything that is not a match goes through untouched.
      const observationText = toolObservationText(observation);
      const observationRedaction = redactSecretText(observationText);
      await memory.ingestToolObservation({
        agentId, projectId, workspaceId: projectId, sessionId,
        toolCallEventId,
        toolCallId: observation.toolCallId || undefined,
        toolName: observation.toolName || 'unknown_tool',
        output: observationRedaction.text,
        eventOrdinal: observation.eventOrdinal,
        timestamp: observation.timestamp,
        metadata: {
          ...withSecretFindings(observation.metadata, observationText, secretTally),
          ...(observationRedaction.count > 0
            ? { redaction: { count: observationRedaction.count, chars: observationRedaction.chars } }
            : {}),
        },
      });
      toolResultCount += 1;
    } else {
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
      ...(assistantSecretFindings.total > 0 ? { secretFindingsAssistant: assistantSecretFindings } : {}),
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
      metadata: withSecretFindings(task.metadata, taskEventText(task), secretTally),
    });
    taskEventCount += 1;
  }

  let contextOutcomeId: string | undefined;
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
