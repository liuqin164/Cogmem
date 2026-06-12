import type { MemoryKernel, MemoryKernelNavigationResult } from '../factory.js';
import { isOperationalNoiseText, isRecallableMemoryEvidence } from '../recall/RecallGovernance.js';
import type { MemoryEvent, MemorySourceRef } from '../types/index.js';
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
      metadata: turn.metadata,
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
        metadata: turn.metadata,
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
    const scopedEvidence = this.filterAgentEvidence(result.rawEvidence, query.agentId).slice(0, limit);
    if (scopedEvidence.length > 0) {
      return {
        recallMode: result.recallMode,
        items: scopedEvidence.map((neuron) => this.toAgentRecallItem(neuron)),
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
    const fallbackItems = this.filterAgentEvidence(fallback.rawEvidence, query.agentId)
      .slice(0, limit)
      .map((neuron) => this.toAgentRecallItem(neuron));
    if (fallbackItems.length > 0) {
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

    const rawEvents = this.searchRawEventsByQueryPlan(queryPlan, query, Math.max(limit * 2, 10));
    const rawItems = rawEvents
      .filter((event) => this.isAgentRawEvent(event, query.agentId))
      .filter((event) => this.isAllowedSession(event, query))
      .filter((event) => !this.isOperationalNoiseRawEvent(event))
      .slice(0, limit)
      .map((event) => this.toAgentRawRecallItem(event, {
        sourceType: 'raw_ledger',
        whyMatched: 'raw_ledger_text_fallback',
        canAnswerExactQuote: true,
      }));

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

  private recallPreviousSession(query: AgentRecallQuery, queryPlan: AgentRecallQueryPlan): AgentRecallResult {
    const limit = query.limit ?? 5;
    const previousSessionId = this.findPreviousSessionId(query);
    const events = previousSessionId
      ? this.getSessionEvents(previousSessionId, query, Math.max(limit * 3, 24))
      : [];
    const items = events
      .filter((event) => this.isAgentRawEvent(event, query.agentId))
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
    for (const searchText of queryPlan.searchTexts) {
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

  private filterAgentEvidence(
    neurons: MemoryKernelNavigationResult['rawEvidence'],
    agentId: string
  ): MemoryKernelNavigationResult['rawEvidence'] {
    return neurons.filter((neuron) => {
      if (!isRecallableMemoryEvidence(neuron)) return false;
      const tags = neuron.metadata.tags || [];
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
    return event.sourceId === agentId
      || event.sourceId.startsWith(`${agentId}:`)
      || event.sourceId.startsWith(`${agentId}-`);
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
