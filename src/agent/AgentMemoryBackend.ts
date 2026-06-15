import type { MemoryKernel, MemoryKernelNavigationResult } from '../factory.js';
import { isOperationalNoiseText, isRecallableMemoryEvidence } from '../recall/RecallGovernance.js';
import type { BeliefRecord, MemoryEvent, MemorySourceRef } from '../types/index.js';
import {
  compileAgentRecallQuery,
  type AgentRecallIntent,
  type AgentRecallQueryPlan,
} from './AgentRecallQueryCompiler.js';

export type AgentTurnIngestMode =
  | 'immediate_compile'
  | 'selective_compile'
  | 'raw_archive_only'
  | 'raw_then_dream';

export type AgentTurnCompileReason =
  | 'immediate_compile'
  | 'durable_signal_detected'
  | 'low_signal_turn'
  | 'raw_archive_only'
  | 'raw_then_dream';

export interface AgentTurnMemory {
  agentId: string;
  projectId: string;
  collection?: string;
  workspaceId?: string;
  sessionId: string;
  threadId?: string;
  turnId?: string;
  turnSeq?: number;
  userText: string;
  assistantText?: string;
  timestamp?: number;
  ingestMode?: AgentTurnIngestMode;
  metadata?: Record<string, unknown>;
}

export interface AgentTurnMemoryResult {
  mode: AgentTurnIngestMode;
  reason: AgentTurnCompileReason;
  compiled: boolean;
  rawEventIds: string[];
  compiledNeuronId?: string;
}

export interface AgentRecallQuery {
  agentId: string;
  projectId: string;
  collection?: string;
  query: string;
  workspaceId?: string;
  sessionId?: string;
  threadId?: string;
  excludeSessionId?: string;
  intent?: AgentRecallIntent;
  anchorEventId?: string;
  anchorText?: string;
  limit?: number;
  startTime?: number;
  endTime?: number;
}

export interface AgentRecallSourceAnchor {
  eventId?: string;
  threadId?: string;
  sessionId?: string;
  turnId?: string;
  role?: MemoryEvent['role'];
  threadSeq?: number;
  turnSeq?: number;
  eventOrdinal?: number;
  parentEventId?: string;
  prevEventId?: string;
  nextEventId?: string;
  causalityType?: MemoryEvent['causalityType'];
  orderingConfidence?: MemoryEvent['orderingConfidence'];
}

export interface AgentRecallSourceContextEvent {
  eventId: string;
  role?: MemoryEvent['role'];
  rawEventType?: MemoryEvent['rawEventType'];
  eventType?: MemoryEvent['eventType'];
  projectId?: string;
  workspaceId?: string;
  threadId?: string;
  sessionId?: string;
  turnId?: string;
  threadSeq?: number;
  turnSeq?: number;
  eventOrdinal?: number;
  occurredAt: number;
  localDate?: string;
  text: string;
}

export interface AgentRecallSourceContext {
  event: AgentRecallSourceContextEvent;
  before: AgentRecallSourceContextEvent[];
  after: AgentRecallSourceContextEvent[];
  parent?: AgentRecallSourceContextEvent;
  children: AgentRecallSourceContextEvent[];
  locator: {
    eventId: string;
    command: string;
    threadId?: string;
    sessionId?: string;
    localDate?: string;
  };
}

export interface AgentToolCallMemory {
  agentId: string;
  projectId: string;
  workspaceId?: string;
  sessionId: string;
  threadId?: string;
  turnId?: string;
  turnSeq?: number;
  assistantEventId?: string;
  toolCallId?: string;
  toolName: string;
  input?: unknown;
  eventOrdinal?: number;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentToolObservationMemory {
  agentId: string;
  projectId: string;
  workspaceId?: string;
  sessionId: string;
  threadId?: string;
  turnId?: string;
  turnSeq?: number;
  toolCallEventId: string;
  toolCallId?: string;
  toolName: string;
  output: string;
  eventOrdinal?: number;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentTaskEventMemory {
  agentId: string;
  projectId: string;
  workspaceId?: string;
  sessionId: string;
  threadId?: string;
  turnId?: string;
  turnSeq?: number;
  parentEventId?: string;
  taskId?: string;
  title?: string;
  content: string;
  eventOrdinal?: number;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentRecallItem {
  id: string;
  text: string;
  projectId?: string;
  topicPath?: string;
  tags: string[];
  source?: string;
  sourceType?: 'compiled_memory' | 'imported_summary' | 'raw_ledger' | 'raw_ledger_session';
  sourceAnchor?: AgentRecallSourceAnchor;
  sourceContext?: AgentRecallSourceContext;
  confidence?: number;
  whyMatched?: string;
  canAnswerExactQuote?: boolean;
}

export interface AgentRecallResult {
  recallMode: MemoryKernelNavigationResult['recallMode'] | 'raw_ledger_fallback';
  items: AgentRecallItem[];
  narrative?: NonNullable<MemoryKernelNavigationResult['navigation']>['narrative'];
  pulseTrace?: NonNullable<MemoryKernelNavigationResult['navigation']>['pulse']['trace'];
  temporalTraversal?: NonNullable<MemoryKernelNavigationResult['navigation']>['branchSearch']['temporalTraversal'];
  runtime?: NonNullable<MemoryKernelNavigationResult['navigation']>['runtime'];
  fallbackUsed: boolean;
  queryPlan?: AgentRecallQueryPlan;
}

export interface AgentRecallEntityCard {
  entityId: string;
  canonicalName: string;
  type: string;
  aliases: string[];
  attributes: Array<{
    key: string;
    value: string;
    updatedAt: number;
  }>;
  recentMentions: Array<{
    neuronId?: string;
    projectId?: string;
    mentionType: string;
    createdAt: number;
  }>;
}

export interface AgentRecallBeliefTouch {
  beliefId: string;
  subject: string;
  predicate: string;
  objectValue: string;
  confidence: number;
  trustScore: number;
  status: BeliefRecord['status'];
  supportCount: number;
  conflictCount: number;
  explanation?: string;
}

export interface AgentRecallPackSlots {
  direct: AgentRecallItem[];
  associative: AgentRecallItem[];
  entityCards: AgentRecallEntityCard[];
  beliefTouches: AgentRecallBeliefTouch[];
}

export interface AgentRecallPackResult extends AgentRecallResult {
  collection?: string;
  generatedAt: number;
  slots: AgentRecallPackSlots;
  chargeVector: {
    direct: number;
    associative: number;
    entityCards: number;
    beliefTouches: number;
    activationHotspots: number;
  };
}

export class KernelAgentMemoryBackend {
  constructor(private readonly kernel: MemoryKernel) {}

  async rememberTurn(turn: AgentTurnMemory): Promise<void> {
    await this.rememberTurnWithResult(turn);
  }

  async rememberTurnWithResult(turn: AgentTurnMemory): Promise<AgentTurnMemoryResult> {
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
      metadata: this.metadataWithCollection(turn.metadata, turn.collection),
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
        metadata: this.metadataWithCollection(turn.metadata, turn.collection),
      })
      : undefined;
    if (assistantEvent) {
      this.kernel.eventStore.updateNextEventId(userEvent.eventId, assistantEvent.eventId);
    }

    const sourceRefs = [userEvent, assistantEvent].filter(Boolean).map((event) => ({
      eventId: event!.eventId,
      eventType: 'message',
      sourceId,
      contentHash: event!.contentHash,
      threadId,
      sessionId: turn.sessionId,
      turnId,
      role: event!.role,
      threadSeq: event!.threadSeq,
      turnSeq: event!.turnSeq,
      eventOrdinal: event!.eventOrdinal,
      parentEventId: event!.parentEventId,
      prevEventId: event!.prevEventId,
      nextEventId: event!.nextEventId,
      causalityType: event!.causalityType,
      orderingConfidence: event!.orderingConfidence,
    }));
    const content = [
      `User: ${turn.userText}`,
      turn.assistantText ? `Agent: ${turn.assistantText}` : '',
    ].filter(Boolean).join('\n');

    const decision = this.shouldCompileTurn(mode, content);
    const rawEventIds = [userEvent, assistantEvent].filter(Boolean).map((event) => event!.eventId);
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

  async ingestToolCall(call: AgentToolCallMemory): Promise<MemoryEvent> {
    const threadId = call.threadId || call.sessionId;
    return this.kernel.recordToolCall({
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
  }

  async ingestToolObservation(observation: AgentToolObservationMemory): Promise<MemoryEvent> {
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

  async ingestTaskEvent(task: AgentTaskEventMemory): Promise<MemoryEvent> {
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

  recall(query: AgentRecallQuery): AgentRecallResult {
    const queryPlan = compileAgentRecallQuery({
      query: query.query,
      intent: query.intent,
      anchorText: query.anchorText,
    });
    if (query.intent === 'previous_session_summary') {
      return this.recallPreviousSession(query, queryPlan);
    }
    if (query.intent === 'forensic_quote') {
      return this.recallForensicQuote(query, queryPlan);
    }

    const limit = query.limit ?? 5;
    const retrievalLimit = Math.max(limit * 4, 24);
    const result = this.kernel.navigateMemory(queryPlan.primarySearchText, {
      projectId: query.projectId,
      limit: retrievalLimit,
      startTime: query.startTime,
      endTime: query.endTime,
    });
    const scopedItems = this.filterAgentEvidence(result.rawEvidence, query.agentId, query.collection)
      .slice(0, limit)
      .map((neuron) => this.toAgentRecallItem(neuron));
    if (scopedItems.length > 0) {
      const rawFallbackItems = this.rawLedgerFallbackItemsForQuery(queryPlan, query, limit);
      if (this.shouldPreferRawLedgerFallback(scopedItems, rawFallbackItems, queryPlan)) {
        return {
          recallMode: 'raw_ledger_fallback',
          items: this.mergeRecallItems(rawFallbackItems, scopedItems, limit),
          narrative: result.navigation?.narrative,
          pulseTrace: result.navigation?.pulse.trace,
          temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
          runtime: result.navigation?.runtime,
          fallbackUsed: true,
          queryPlan,
        };
      }
      return {
        recallMode: result.recallMode,
        items: scopedItems,
        narrative: result.navigation?.narrative,
        pulseTrace: result.navigation?.pulse.trace,
        temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
        runtime: result.navigation?.runtime,
        fallbackUsed: result.fallbackUsed,
        queryPlan,
      };
    }

    const fallback = this.kernel.recall(queryPlan.primarySearchText, {
      projectId: query.projectId,
      limit: retrievalLimit,
    });
    const fallbackItems = this.filterAgentEvidence(fallback.rawEvidence, query.agentId, query.collection)
      .slice(0, limit)
      .map((neuron) => this.toAgentRecallItem(neuron));
    if (fallbackItems.length > 0) {
      const rawFallbackItems = this.rawLedgerFallbackItemsForQuery(queryPlan, query, limit);
      if (this.shouldPreferRawLedgerFallback(fallbackItems, rawFallbackItems, queryPlan)) {
        return {
          recallMode: 'raw_ledger_fallback',
          items: this.mergeRecallItems(rawFallbackItems, fallbackItems, limit),
          narrative: result.navigation?.narrative,
          pulseTrace: result.navigation?.pulse.trace,
          temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
          runtime: result.navigation?.runtime,
          fallbackUsed: true,
          queryPlan,
        };
      }
      return {
        recallMode: 'brain_recall_fallback',
        items: fallbackItems,
        narrative: result.navigation?.narrative,
        pulseTrace: result.navigation?.pulse.trace,
        temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
        runtime: result.navigation?.runtime,
        fallbackUsed: true,
        queryPlan,
      };
    }

    const rawItems = this.rawLedgerFallbackItemsForQuery(queryPlan, query, limit);

    return {
      recallMode: 'raw_ledger_fallback',
      items: rawItems,
      narrative: result.navigation?.narrative,
      pulseTrace: result.navigation?.pulse.trace,
      temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
      runtime: result.navigation?.runtime,
      fallbackUsed: true,
      queryPlan,
    };
  }

  recallPack(query: AgentRecallQuery): AgentRecallPackResult {
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
      limit: 8,
      excludeNeuronIds: direct.map((item) => item.id),
    });

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

  private recallPreviousSession(query: AgentRecallQuery, queryPlan: AgentRecallQueryPlan): AgentRecallResult {
    const limit = query.limit ?? 5;
    const previousSessionId = this.findPreviousSessionId(query);
    const events = previousSessionId
      ? this.getSessionEvents(previousSessionId, query, Math.max(limit * 3, 24))
      : [];
    const items = events
      .filter((event) => this.isAgentRawEvent(event, query.agentId))
      .filter((event) => this.isAllowedRawEventCollection(event, query.collection))
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
    };
  }

  private recallForensicQuote(query: AgentRecallQuery, queryPlan: AgentRecallQueryPlan): AgentRecallResult {
    const limit = query.limit ?? 5;
    const anchorItems = this.recallForensicAnchor(query, limit);
    const rawEvents = anchorItems.length > 0 && (queryPlan.anchorUsed || !!query.anchorEventId)
      ? []
      : this.searchRawEventsByQueryPlan(queryPlan, query, Math.max(limit * 4, 20));
    const items = [
      ...anchorItems,
      ...rawEvents
      .filter((event) => this.isAgentRawEvent(event, query.agentId))
      .filter((event) => this.isAllowedSession(event, query))
      .filter((event) => this.isAllowedRawEventCollection(event, query.collection))
      .filter((event) => !this.isOperationalNoiseRawEvent(event))
      .filter((event) => this.isQuoteSourceEvent(event))
      .filter((event) => this.hasReadableEventText(event))
      .sort((a, b) => this.quoteEventPriority(a) - this.quoteEventPriority(b))
      .slice(0, limit)
      .map((event) => this.toAgentRawRecallItem(event, {
        sourceType: 'raw_ledger',
        whyMatched: 'forensic_quote_raw_event',
        canAnswerExactQuote: true,
      })),
    ].filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index)
      .slice(0, limit);

    return {
      recallMode: 'raw_ledger_fallback',
      items,
      fallbackUsed: true,
      queryPlan,
    };
  }

  private recallForensicAnchor(query: AgentRecallQuery, limit: number): AgentRecallItem[] {
    if (!query.anchorEventId) return [];
    const context = this.kernel.getEventContext(query.anchorEventId, { before: 4, after: 4 });
    if (!context) return [];
    const candidates = [context.event, ...context.before.slice().reverse(), ...context.after];
    return candidates
      .filter((event) => this.isAgentRawEvent(event, query.agentId))
      .filter((event) => this.isAllowedSession(event, query))
      .filter((event) => this.isAllowedRawEventCollection(event, query.collection))
      .filter((event) => !this.isOperationalNoiseRawEvent(event))
      .filter((event) => this.isQuoteSourceEvent(event))
      .filter((event) => this.hasReadableEventText(event))
      .sort((a, b) => {
        const anchorDelta = (a.eventId === query.anchorEventId ? 0 : 1) - (b.eventId === query.anchorEventId ? 0 : 1);
        if (anchorDelta !== 0) return anchorDelta;
        return this.quoteEventPriority(a) - this.quoteEventPriority(b);
      })
      .slice(0, limit)
      .map((event) => this.toAgentRawRecallItem(event, {
        sourceType: 'raw_ledger',
        whyMatched: 'forensic_quote_anchor_event',
        canAnswerExactQuote: true,
      }));
  }

  private searchRawEventsByQueryPlan(
    queryPlan: AgentRecallQueryPlan,
    query: AgentRecallQuery,
    limit: number,
  ): MemoryEvent[] {
    const seen = new Set<string>();
    const out: MemoryEvent[] = [];
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
        if (seen.has(event.eventId)) continue;
        seen.add(event.eventId);
        out.push(event);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  private rawLedgerFallbackItemsForQuery(
    queryPlan: AgentRecallQueryPlan,
    query: AgentRecallQuery,
    limit: number
  ): AgentRecallItem[] {
    const searchedEvents = this.searchRawEventsByQueryPlan(queryPlan, query, Math.max(limit * 2, 10));
    const rawEvents = queryPlan.intent === 'forensic_quote'
      ? this.dedupeRawEventsByTurnPreferUser(searchedEvents)
      : this.dedupeRawEventsByTurnPreferCue(searchedEvents, queryPlan);
    return rawEvents
      .filter((event) => this.isAgentRawEvent(event, query.agentId))
      .filter((event) => this.isAllowedSession(event, query))
      .filter((event) => this.isAllowedRawEventCollection(event, query.collection))
      .filter((event) => !this.isOperationalNoiseRawEvent(event))
      .slice(0, limit)
      .map((event) => this.toAgentRawRecallItem(event, {
        sourceType: 'raw_ledger',
        whyMatched: 'raw_ledger_text_fallback',
        canAnswerExactQuote: true,
      }));
  }

  private shouldPreferRawLedgerFallback(
    candidateItems: AgentRecallItem[],
    rawFallbackItems: AgentRecallItem[],
    queryPlan: AgentRecallQueryPlan
  ): boolean {
    if (rawFallbackItems.length === 0) return false;
    return !this.itemsContainRecallCue(candidateItems, queryPlan)
      && this.itemsContainRecallCue(rawFallbackItems, queryPlan);
  }

  private itemsContainRecallCue(items: AgentRecallItem[], queryPlan: AgentRecallQueryPlan): boolean {
    const cues = this.recallCueTerms(queryPlan);
    if (cues.length === 0) return true;
    return items.some((item) => {
      const haystack = this.itemSearchableText(item).toLowerCase();
      return cues.some((cue) => haystack.includes(cue.toLowerCase()));
    });
  }

  private recallCueTerms(queryPlan: AgentRecallQueryPlan): string[] {
    const terms = [
      ...queryPlan.keywords,
      ...queryPlan.semanticCuePhrases.flatMap((phrase) => phrase.split(/\s+/)),
    ]
      .map((term) => term.trim())
      .filter((term) => term.length >= 2 && !/^(hermes|openclaw|cogmem)$/i.test(term));
    return uniqueNonEmpty(terms);
  }

  private itemSearchableText(item: AgentRecallItem): string {
    return [
      item.text,
      item.source || '',
      item.tags.join(' '),
    ].join('\n');
  }

  private mergeRecallItems(primary: AgentRecallItem[], secondary: AgentRecallItem[], limit: number): AgentRecallItem[] {
    const out: AgentRecallItem[] = [];
    const seen = new Set<string>();
    for (const item of [...primary, ...secondary]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
      if (out.length >= limit) break;
    }
    return out;
  }

  private dedupeRawEventsByTurnPreferUser(events: MemoryEvent[]): MemoryEvent[] {
    const byTurn = new Map<string, MemoryEvent>();
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
    return [...byTurn.values()].sort((a, b) => (
      (a.globalSeq || 0) - (b.globalSeq || 0)
      || this.quoteEventPriority(a) - this.quoteEventPriority(b)
      || a.eventId.localeCompare(b.eventId)
    ));
  }

  private expandRawSearchTexts(queryPlan: AgentRecallQueryPlan): string[] {
    const hostNeutralKeywords = queryPlan.keywords.filter((keyword) => !/^(hermes|openclaw|cogmem)$/i.test(keyword));
    return uniqueNonEmpty([
      ...queryPlan.searchTexts,
      hostNeutralKeywords.join(' '),
      ...hostNeutralKeywords.filter((keyword) => keyword.length >= 2),
    ]);
  }

  private findPreviousSessionId(query: AgentRecallQuery): string | undefined {
    const page = this.kernel.eventStore.queryEvents(1, 1000, {
      projectId: query.projectId ? [query.projectId] : undefined,
      workspaceId: query.workspaceId ? [query.workspaceId] : undefined,
      startTime: query.startTime,
      endTime: query.endTime,
    });
    const currentSessionIds = new Set([query.sessionId, query.excludeSessionId].filter((value): value is string => !!value));
    const sessionIds = new Set<string>();
    for (const event of page.records) {
      if (!event.sessionId || currentSessionIds.has(event.sessionId)) continue;
      if (!this.isAgentRawEvent(event, query.agentId)) continue;
      if (this.isOperationalNoiseRawEvent(event)) continue;
      sessionIds.add(event.sessionId);
    }
    return sessionIds.values().next().value;
  }

  private getSessionEvents(sessionId: string, query: AgentRecallQuery, limit: number): MemoryEvent[] {
    const page = this.kernel.eventStore.queryEvents(1, Math.max(limit, 1), {
      projectId: query.projectId ? [query.projectId] : undefined,
      workspaceId: query.workspaceId ? [query.workspaceId] : undefined,
      sessionId: [sessionId],
      startTime: query.startTime,
      endTime: query.endTime,
    });
    return page.records
      .slice()
      .sort((a, b) => (
        (a.globalSeq || 0) - (b.globalSeq || 0)
        || (a.threadSeq || 0) - (b.threadSeq || 0)
        || (a.eventOrdinal || 0) - (b.eventOrdinal || 0)
      || a.eventId.localeCompare(b.eventId)
    ));
  }

  private dedupeRawEventsByTurnPreferCue(events: MemoryEvent[], queryPlan: AgentRecallQueryPlan): MemoryEvent[] {
    const byTurn = new Map<string, MemoryEvent>();
    for (const event of events) {
      const key = event.turnId || event.eventId;
      const existing = byTurn.get(key);
      if (!existing) {
        byTurn.set(key, event);
        continue;
      }
      const eventScore = this.rawEventCueScore(event, queryPlan);
      const existingScore = this.rawEventCueScore(existing, queryPlan);
      if (eventScore > existingScore || (
        eventScore === existingScore
        && this.rawEventTextLength(event) > this.rawEventTextLength(existing)
      )) {
        byTurn.set(key, event);
      }
    }
    return [...byTurn.values()].sort((a, b) => (
      this.rawEventCueScore(b, queryPlan) - this.rawEventCueScore(a, queryPlan)
      || (a.globalSeq || 0) - (b.globalSeq || 0)
      || (a.threadSeq || 0) - (b.threadSeq || 0)
      || (a.eventOrdinal || 0) - (b.eventOrdinal || 0)
      || a.eventId.localeCompare(b.eventId)
    ));
  }

  private rawEventCueScore(event: MemoryEvent, queryPlan: AgentRecallQueryPlan): number {
    const haystack = this.rawEventText(event).toLowerCase();
    return this.recallCueTerms(queryPlan)
      .reduce((score, cue) => score + (haystack.includes(cue.toLowerCase()) ? 1 : 0), 0);
  }

  private rawEventTextLength(event: MemoryEvent): number {
    return this.rawEventText(event).length;
  }

  private rawEventText(event: MemoryEvent): string {
    const payload = event.payload as { text?: unknown; output?: unknown; title?: unknown };
    if (typeof payload.text === 'string') return payload.text;
    if (typeof payload.output === 'string') return payload.output;
    if (typeof payload.title === 'string') return payload.title;
    return JSON.stringify(event.payload);
  }

  private filterAgentEvidence(
    neurons: MemoryKernelNavigationResult['rawEvidence'],
    agentId: string,
    collection?: string
  ): MemoryKernelNavigationResult['rawEvidence'] {
    return neurons.filter((neuron) => {
      if (!isRecallableMemoryEvidence(neuron)) return false;
      const tags = neuron.metadata.tags || [];
      if (!this.isAllowedCollectionTags(tags, collection)) return false;
      const explicitAgentTags = tags.filter((tag) => tag.startsWith('agent:'));
      if (explicitAgentTags.length === 0) return true;
      return explicitAgentTags.includes(`agent:${agentId}`) || tags.includes(agentId);
    });
  }

  private toAgentRecallItem(neuron: MemoryKernelNavigationResult['rawEvidence'][number]): AgentRecallItem {
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

  private isAgentRawEvent(event: MemoryEvent, agentId: string): boolean {
    if (!event.sourceId) return true;
    if (
      event.sourceId === agentId
      || event.sourceId.startsWith(`${agentId}:`)
      || event.sourceId.startsWith(`${agentId}-`)
    ) {
      return true;
    }
    const payload = event.payload as { metadata?: Record<string, unknown> };
    const metadata = payload.metadata || {};
    const tags = Array.isArray(metadata.tags) ? metadata.tags.filter((tag): tag is string => typeof tag === 'string') : [];
    const explicitAgentTags = tags.filter((tag) => tag.startsWith('agent:'));
    if (explicitAgentTags.length > 0) {
      return explicitAgentTags.includes(`agent:${agentId}`);
    }
    if (metadata.imported === true) return true;
    const sourceType = typeof metadata.sourceType === 'string' ? metadata.sourceType : '';
    if (/^(hermes_state_db|conversation_markdown|openclaw_|soul_markdown)/.test(sourceType)) return true;
    if (/^(hermes_state_db|conversation_markdown|openclaw_|soul_markdown)/.test(event.sourceId)) return true;
    return false;
  }

  private isOperationalNoiseRawEvent(event: MemoryEvent): boolean {
    const payload = event.payload as { text?: unknown; metadata?: Record<string, unknown> };
    const tags = Array.isArray(payload.metadata?.tags) ? payload.metadata.tags : [];
    if (tags.some((tag) => (
      tag === 'operational_noise'
      || tag === 'record:heartbeat'
      || tag === 'system:heartbeat'
      || tag === 'routine:heartbeat'
    ))) {
      return true;
    }
    return isOperationalNoiseText(typeof payload.text === 'string' ? payload.text : JSON.stringify(event.payload));
  }

  private isAllowedSession(event: MemoryEvent, query: AgentRecallQuery): boolean {
    if (query.excludeSessionId && event.sessionId === query.excludeSessionId) return false;
    if (query.sessionId && query.intent && query.intent !== 'memory_recall' && event.sessionId === query.sessionId) return false;
    return true;
  }

  private hasReadableEventText(event: MemoryEvent): boolean {
    const payload = event.payload as { text?: unknown; output?: unknown; title?: unknown };
    return typeof payload.text === 'string'
      || typeof payload.output === 'string'
      || typeof payload.title === 'string';
  }

  private quoteEventPriority(event: MemoryEvent): number {
    if (event.role === 'user') return 0;
    if (event.role === 'assistant') return 1;
    return 2;
  }

  private isQuoteSourceEvent(event: MemoryEvent): boolean {
    return event.role === 'user' || (!event.role && event.rawEventType === 'message');
  }

  private toAgentRawRecallItem(
    event: MemoryEvent,
    options: {
      sourceType: NonNullable<AgentRecallItem['sourceType']>;
      whyMatched: string;
      canAnswerExactQuote: boolean;
    }
  ): AgentRecallItem {
    const payload = event.payload as { text?: unknown; metadata?: Record<string, unknown> };
    const metadata = payload.metadata || {};
    const metadataTags = Array.isArray(metadata.tags) ? metadata.tags.filter((tag): tag is string => typeof tag === 'string') : [];
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
      ? metadata.sourceRef as { sourcePath?: string }
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

  private preferredRawSourceEventId(neuron: MemoryKernelNavigationResult['rawEvidence'][number]): string | undefined {
    if (!neuron.metadata.sourceEventId) return undefined;
    const context = this.kernel.getEventContext(neuron.metadata.sourceEventId, { before: 0, after: 0 });
    const payload = context?.event.payload as { sourceRefs?: unknown } | undefined;
    if (!payload || !Array.isArray(payload.sourceRefs)) return undefined;
    const refs = payload.sourceRefs.filter((item): item is MemorySourceRef => Boolean(item && typeof item === 'object'));
    const userRef = refs.find((ref) => ref.eventId && ref.role === 'user');
    return userRef?.eventId || refs.find((ref) => ref.eventId)?.eventId;
  }

  private toAgentSourceContext(eventId: string): AgentRecallSourceContext | undefined {
    const context = this.kernel.getEventContext(eventId, { before: 2, after: 2 });
    if (!context) return undefined;
    const event = this.toAgentSourceContextEvent(context.event);
    return {
      event,
      before: context.before.map((item) => this.toAgentSourceContextEvent(item)),
      after: context.after.map((item) => this.toAgentSourceContextEvent(item)),
      parent: context.parent ? this.toAgentSourceContextEvent(context.parent) : undefined,
      children: context.children.map((item) => this.toAgentSourceContextEvent(item)),
      locator: {
        eventId: event.eventId,
        command: `cogmem memory show --event ${event.eventId} --before 2 --after 2`,
        threadId: event.threadId,
        sessionId: event.sessionId,
        localDate: event.localDate,
      },
    };
  }

  private toAgentSourceContextEvent(event: MemoryEvent): AgentRecallSourceContextEvent {
    return {
      eventId: event.eventId,
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
      text: this.eventText(event),
    };
  }

  private toAgentSourceAnchorFromContextEvent(event: AgentRecallSourceContextEvent): AgentRecallSourceAnchor {
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

  private toAgentSourceAnchor(event: MemoryEvent): AgentRecallSourceAnchor {
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

  private toSourceRef(event: MemoryEvent, sourceId: string): MemorySourceRef {
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

  private eventText(event: MemoryEvent): string {
    const payload = event.payload as { text?: unknown; output?: unknown; title?: unknown };
    if (typeof payload.text === 'string') return payload.text;
    if (typeof payload.output === 'string') return payload.output;
    if (typeof payload.title === 'string') return payload.title;
    return JSON.stringify(event.payload);
  }

  private buildAssociativeItems(query: AgentRecallQuery, direct: AgentRecallItem[], touchedAt: number): AgentRecallItem[] {
    const seen = new Set<string>();
    const out: AgentRecallItem[] = [];
    const directNeuronIds = direct
      .filter((item) => item.sourceType === 'compiled_memory' || item.sourceType === 'imported_summary')
      .map((item) => item.id);

    for (const neuronId of directNeuronIds) {
      const synapses = this.kernel.memoryGraph.getSynapses(neuronId).sort((a, b) => b.weight - a.weight);
      for (const synapse of synapses) {
        if (synapse.targetId === neuronId) continue;
        if (seen.has(synapse.targetId)) continue;
        const neuron = this.kernel.memoryGraph.getNeuron(synapse.targetId);
        if (!neuron) continue;
        if (this.filterAgentEvidence([neuron], query.agentId, query.collection).length === 0) continue;
        this.kernel.activationStore.touch({
          neuronId: neuron.id,
          projectId: neuron.metadata.projectId || query.projectId,
          delta: Math.max(0.1, synapse.weight * 0.5),
          source: `recall_pack:${synapse.type}`,
          touchedAt,
        });
        out.push(this.toAgentRecallItem(neuron));
        seen.add(neuron.id);
        if (out.length >= 4) return out;
      }
    }

    const hotspots = this.kernel.activationStore.getTop({
      projectId: query.projectId,
      limit: 8,
      excludeNeuronIds: uniqueNonEmpty([...direct.map((item) => item.id), ...seen]),
    });
    for (const hotspot of hotspots) {
      const neuron = this.kernel.memoryGraph.getNeuron(hotspot.neuronId);
      if (!neuron) continue;
      if (this.filterAgentEvidence([neuron], query.agentId, query.collection).length === 0) continue;
      out.push(this.toAgentRecallItem(neuron));
      seen.add(neuron.id);
      if (out.length >= 4) return out;
    }

    return out;
  }

  private buildEntityCards(query: AgentRecallQuery): AgentRecallEntityCard[] {
    const cards = new Map<string, AgentRecallEntityCard>();
    for (const candidate of this.entityLookupCandidates(query.query)) {
      const entity = this.kernel.entityStore.findByAlias(candidate);
      if (!entity || cards.has(entity.entityId)) continue;
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
      if (cards.size >= 4) break;
    }
    return Array.from(cards.values());
  }

  private buildBeliefTouches(query: AgentRecallQuery): AgentRecallBeliefTouch[] {
    const beliefs = this.kernel.beliefStore.getActiveBeliefsForQuery({
      query: query.query,
      projectId: query.projectId,
      limit: 6,
      intent: 'recall',
    });
    const history = this.kernel.beliefStore.getBeliefHistoryForCanonicalKeys(
      beliefs.map((belief) => belief.canonicalKey),
      { limitPerCanonical: 8 },
    );
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

  private entityLookupCandidates(query: string): string[] {
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

  private metadataWithCollection(
    metadata: Record<string, unknown> | undefined,
    collection: string | undefined
  ): Record<string, unknown> | undefined {
    const collectionTags = this.collectionTags(collection);
    if (collectionTags.length === 0) return metadata;
    const existingTags = Array.isArray(metadata?.tags)
      ? metadata!.tags.filter((tag): tag is string => typeof tag === 'string')
      : [];
    return {
      ...(metadata || {}),
      collection: this.normalizeCollection(collection),
      tags: uniqueNonEmpty([...existingTags, ...collectionTags]),
    };
  }

  private collectionTags(collection: string | undefined): string[] {
    const normalized = this.normalizeCollection(collection);
    return normalized ? [`collection:${normalized}`] : [];
  }

  private normalizeCollection(collection: string | undefined): string | undefined {
    const normalized = String(collection || '').trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');
    return normalized || undefined;
  }

  private isAllowedRawEventCollection(event: MemoryEvent, collection: string | undefined): boolean {
    const payload = event.payload as { metadata?: Record<string, unknown> };
    const tags = Array.isArray(payload.metadata?.tags)
      ? payload.metadata.tags.filter((tag): tag is string => typeof tag === 'string')
      : [];
    return this.isAllowedCollectionTags(tags, collection);
  }

  private isAllowedCollectionTags(tags: string[], collection: string | undefined): boolean {
    const collectionTags = tags.filter((tag) => tag.startsWith('collection:'));
    const requested = this.normalizeCollection(collection);
    if (requested) {
      if (requested === 'anchor' && collectionTags.length === 0) return true;
      return collectionTags.includes(`collection:${requested}`);
    }
    return collectionTags.length === 0 || collectionTags.includes('collection:anchor');
  }

  private shouldCompileTurn(
    mode: AgentTurnIngestMode,
    content: string,
  ): { compile: boolean; reason: AgentTurnCompileReason } {
    if (mode === 'immediate_compile') return { compile: true, reason: 'immediate_compile' };
    if (mode === 'raw_archive_only') return { compile: false, reason: 'raw_archive_only' };
    if (mode === 'raw_then_dream') return { compile: false, reason: 'raw_then_dream' };
    if (this.hasDurableTurnSignal(content)) return { compile: true, reason: 'durable_signal_detected' };
    return { compile: false, reason: 'low_signal_turn' };
  }

  private hasDurableTurnSignal(content: string): boolean {
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

function uniqueNonEmpty(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}
