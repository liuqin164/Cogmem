import type { EncryptionProvider } from '../encryption/index.js';
import type { EventAuditPage, MemoryEvent, MemoryEventCausalityType, MemoryEventContext, MemoryRawEventType, MemoryEventRole, MemoryEventType, OrderingConfidence, StreamType } from '../types/index.js';
export interface ProjectionCheckpoint {
    projectionName: string;
    lastEventId?: string;
    lastEventTime?: number;
    lastRebuildAt?: number;
    lastFullCount: number;
    lastChecksum?: string;
    status: 'idle' | 'building' | 'ready' | 'degraded' | 'failed';
    metadata?: Record<string, unknown>;
}
export interface AppendEventInput<TPayload = Record<string, unknown>> {
    streamId: string;
    streamType: StreamType;
    eventType: MemoryEventType;
    rawEventType?: MemoryRawEventType;
    eventVersion?: number;
    projectId?: string;
    workspaceId?: string;
    actorId?: string;
    causationId?: string;
    correlationId?: string;
    sourceNeuronId?: string;
    sourceId?: string;
    contentHash?: string;
    threadId?: string;
    sessionId?: string;
    localDate?: string;
    threadSeq?: number;
    turnId?: string;
    turnSeq?: number;
    eventOrdinal?: number;
    role?: MemoryEventRole;
    parentEventId?: string;
    prevEventId?: string;
    nextEventId?: string;
    causalityType?: MemoryEventCausalityType;
    sourceOffset?: number;
    lineStart?: number;
    lineEnd?: number;
    charStart?: number;
    charEnd?: number;
    orderingConfidence?: OrderingConfidence;
    occurredAt?: number;
    payload: TPayload;
}
export declare class EventStore {
    private readonly encryptionProvider?;
    private db;
    constructor(dbPath?: string, encryptionProvider?: EncryptionProvider | undefined);
    private initializeSchema;
    private ensureCompatibilityColumns;
    append<TPayload = Record<string, unknown>>(input: AppendEventInput<TPayload>): MemoryEvent<TPayload>;
    getNextGlobalSeq(): number;
    getNextEventVersion(streamId: string): number;
    getNextThreadSeq(threadId: string): number;
    getNextTurnSeq(threadId: string): number;
    getEventsAfter(lastEventTime?: number): MemoryEvent[];
    getLatestEvent(): MemoryEvent | null;
    getEventsByStreamId(streamId: string): MemoryEvent[];
    queryEvents(page?: number, pageSize?: number, filters?: {
        streamId?: string[];
        streamType?: StreamType[];
        eventType?: MemoryEventType[];
        actorId?: string[];
        causationId?: string[];
        correlationId?: string[];
        projectId?: string[];
        workspaceId?: string[];
        threadId?: string[];
        sessionId?: string[];
        startTime?: number;
        endTime?: number;
    }): EventAuditPage;
    getEvent(eventId: string): MemoryEvent | null;
    getThreadEvents(threadId: string, options?: {
        projectId?: string;
        sessionId?: string;
        localDate?: string;
        limit?: number;
    }): MemoryEvent[];
    getEventContext(eventId: string, options?: {
        before?: number;
        after?: number;
    }): MemoryEventContext | null;
    searchRawEvents(query: string, options?: {
        projectId?: string;
        workspaceId?: string;
        threadId?: string;
        sessionId?: string;
        localDate?: string;
        startTime?: number;
        endTime?: number;
        limit?: number;
    }): MemoryEvent[];
    getChildEvents(parentEventId: string): MemoryEvent[];
    updateNextEventId(eventId: string, nextEventId: string | undefined): void;
    getEventCount(): number;
    getProjectionCheckpoint(projectionName: string): ProjectionCheckpoint | null;
    upsertProjectionCheckpoint(checkpoint: ProjectionCheckpoint): void;
    close(): void;
    private mapRow;
    private upsertRawEventFts;
    private rebuildRawEventFtsIfNeeded;
    private extractIndexText;
    private toRawEventFtsQuery;
    private fallbackRawTextSearch;
    private encodePayload;
    private decodePayload;
}
//# sourceMappingURL=EventStore.d.ts.map