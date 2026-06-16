import type { MemoryKernel, MemoryKernelNavigationResult } from '../factory.js';
import { type MemoryEventCharRange, type MemoryEventSourceRange, type SourceContextWindowMetadata } from '../recall/SourceContextMetadata.js';
import type { BeliefRecord, MemoryEvent } from '../types/index.js';
import { type AgentRecallIntent, type AgentRecallQueryPlan } from './AgentRecallQueryCompiler.js';
export type AgentTurnIngestMode = 'immediate_compile' | 'selective_compile' | 'raw_archive_only' | 'raw_then_dream';
export type AgentTurnCompileReason = 'immediate_compile' | 'durable_signal_detected' | 'low_signal_turn' | 'raw_archive_only' | 'raw_then_dream';
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
    label: string;
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
    charRange?: MemoryEventCharRange;
    sourceRange?: MemoryEventSourceRange;
    textLength: number;
    text: string;
}
export interface AgentRecallSourceContext {
    event: AgentRecallSourceContextEvent;
    before: AgentRecallSourceContextEvent[];
    after: AgentRecallSourceContextEvent[];
    parent?: AgentRecallSourceContextEvent;
    children: AgentRecallSourceContextEvent[];
    window: SourceContextWindowMetadata;
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
export declare class KernelAgentMemoryBackend {
    private readonly kernel;
    constructor(kernel: MemoryKernel);
    rememberTurn(turn: AgentTurnMemory): Promise<void>;
    rememberTurnWithResult(turn: AgentTurnMemory): Promise<AgentTurnMemoryResult>;
    ingestToolCall(call: AgentToolCallMemory): Promise<MemoryEvent>;
    ingestToolObservation(observation: AgentToolObservationMemory): Promise<MemoryEvent>;
    ingestTaskEvent(task: AgentTaskEventMemory): Promise<MemoryEvent>;
    recall(query: AgentRecallQuery): AgentRecallResult;
    recallPack(query: AgentRecallQuery): AgentRecallPackResult;
    private recallPreviousSession;
    private recallForensicQuote;
    private recallForensicAnchor;
    private searchRawEventsByQueryPlan;
    private rawLedgerFallbackItemsForQuery;
    private shouldPreferRawLedgerFallback;
    private itemsContainRecallCue;
    private recallCueTerms;
    private itemSearchableText;
    private mergeRecallItems;
    private dedupeRawEventsByTurnPreferUser;
    private expandRawSearchTexts;
    private findPreviousSessionId;
    private getSessionEvents;
    private dedupeRawEventsByTurnPreferCue;
    private rawEventCueScore;
    private rawEventTextLength;
    private rawEventText;
    private filterAgentEvidence;
    private toAgentRecallItem;
    private isAgentRawEvent;
    private isOperationalNoiseRawEvent;
    private isAllowedSession;
    private hasReadableEventText;
    private quoteEventPriority;
    private isQuoteSourceEvent;
    private toAgentRawRecallItem;
    private preferredRawSourceEventId;
    private toAgentSourceContext;
    private toAgentSourceContextEvent;
    private toAgentSourceAnchorFromContextEvent;
    private toAgentSourceAnchor;
    private toSourceRef;
    private eventText;
    private buildAssociativeItems;
    private buildEntityCards;
    private buildBeliefTouches;
    private entityLookupCandidates;
    private metadataWithCollection;
    private collectionTags;
    private normalizeCollection;
    private isAllowedRawEventCollection;
    private isAllowedCollectionTags;
    private shouldCompileTurn;
    private hasDurableTurnSignal;
}
//# sourceMappingURL=AgentMemoryBackend.d.ts.map