import type { MemoryKernel, MemoryKernelNavigationResult } from '../factory.js';
import type { MemoryEvent } from '../types/index.js';
import { type AgentRecallIntent, type AgentRecallQueryPlan } from './AgentRecallQueryCompiler.js';
export type AgentTurnIngestMode = 'immediate_compile' | 'selective_compile' | 'raw_archive_only' | 'raw_then_dream';
export type AgentTurnCompileReason = 'immediate_compile' | 'durable_signal_detected' | 'low_signal_turn' | 'raw_archive_only' | 'raw_then_dream';
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
export declare class KernelAgentMemoryBackend {
    private readonly kernel;
    constructor(kernel: MemoryKernel);
    rememberTurn(turn: AgentTurnMemory): Promise<void>;
    rememberTurnWithResult(turn: AgentTurnMemory): Promise<AgentTurnMemoryResult>;
    ingestToolCall(call: AgentToolCallMemory): Promise<MemoryEvent>;
    ingestToolObservation(observation: AgentToolObservationMemory): Promise<MemoryEvent>;
    ingestTaskEvent(task: AgentTaskEventMemory): Promise<MemoryEvent>;
    recall(query: AgentRecallQuery): AgentRecallResult;
    private recallPreviousSession;
    private recallForensicQuote;
    private recallForensicAnchor;
    private searchRawEventsByQueryPlan;
    private findPreviousSessionId;
    private getSessionEvents;
    private filterAgentEvidence;
    private toAgentRecallItem;
    private isAgentRawEvent;
    private isOperationalNoiseRawEvent;
    private isAllowedSession;
    private hasReadableEventText;
    private quoteEventPriority;
    private isQuoteSourceEvent;
    private toAgentRawRecallItem;
    private toAgentSourceAnchor;
    private toSourceRef;
    private shouldCompileTurn;
    private hasDurableTurnSignal;
}
//# sourceMappingURL=AgentMemoryBackend.d.ts.map