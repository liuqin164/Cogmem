import type { EventStore } from './EventStore.js';
import type { MemoryEvent } from '../types/index.js';
export type RuntimeEntityType = 'step' | 'merge' | 'validation' | 'policy' | 'executor' | 'state_machine';
export type RuntimeStatus = 'ready' | 'blocked' | 'pending' | 'matched' | 'missing';
export interface RuntimeStateRecord {
    projectId: string;
    runtimeId: string;
    entityType: RuntimeEntityType;
    entityKey: string;
    status: RuntimeStatus;
    metadata?: Record<string, unknown>;
    updatedAt: number;
}
export interface RuntimeTransitionRecord {
    projectId: string;
    transitionId: string;
    runtimeId: string;
    entityType: RuntimeEntityType;
    entityKey: string;
    transitionType: string;
    fromStatus?: string;
    toStatus: string;
    payload?: Record<string, unknown>;
    occurredAt: number;
}
export interface RuntimeSnapshot {
    projectId: string;
    runtimeId: string;
    states: RuntimeStateRecord[];
    transitions: RuntimeTransitionRecord[];
}
export interface RuntimeDiagnosticsHistoryPage {
    projectId: string;
    runtimeId: string;
    page: number;
    pageSize: number;
    totalTransitions: number;
    transitions: RuntimeTransitionRecord[];
    currentStates: RuntimeStateRecord[];
    appliedFilters?: {
        entityTypes?: string[];
        transitionTypes?: string[];
        status?: string[];
        startTime?: number;
        endTime?: number;
    };
}
export declare class PlanRuntimeStore {
    private db;
    private eventStore?;
    constructor(dbPath?: string, eventStore?: EventStore);
    private initializeSchema;
    upsertState(input: {
        projectId: string;
        runtimeId: string;
        entityType: RuntimeEntityType;
        entityKey: string;
        status: RuntimeStatus;
        metadata?: Record<string, unknown>;
        updatedAt?: number;
    }, options?: {
        emitEvent?: boolean;
    }): void;
    recordTransition(input: {
        projectId: string;
        runtimeId: string;
        entityType: RuntimeEntityType;
        entityKey: string;
        transitionType: string;
        fromStatus?: string;
        toStatus: string;
        payload?: Record<string, unknown>;
        occurredAt?: number;
    }, options?: {
        emitEvent?: boolean;
    }): void;
    private insertTransition;
    private enqueueEvent;
    recordDiscardedProjectionEvent(projector: string, event: MemoryEvent, reason: string): void;
    flushEventOutbox(ignoreSchedule?: boolean): number;
    getEventOutboxStats(projectId?: string): {
        pending: number;
        oldestCreatedAt?: number;
        deadLetter: number;
        lastError?: string;
    };
    getState(projectId: string, runtimeId: string, entityType: RuntimeEntityType, entityKey: string): RuntimeStateRecord | null;
    getSnapshot(projectId: string, runtimeId: string): RuntimeSnapshot;
    getHistoryPage(projectId: string, runtimeId: string, page?: number, pageSize?: number, filters?: {
        entityTypes?: RuntimeEntityType[];
        transitionTypes?: string[];
        status?: RuntimeStatus[];
        startTime?: number;
        endTime?: number;
    }): RuntimeDiagnosticsHistoryPage;
    getStateCount(projectId: string): number;
    beginProjectionBuild(projectionName: string): void;
    publishProjectionBuild(projectionName: string): void;
    discardProjectionBuild(projectionName: string): void;
    applyProjectedState(projectionName: string, sourceGlobalSeq: number, input: {
        projectId: string;
        runtimeId: string;
        entityType: RuntimeEntityType;
        entityKey: string;
        status: RuntimeStatus;
        metadata?: Record<string, unknown>;
        updatedAt: number;
    }, staging?: boolean): void;
    applyProjectedTransition(projectionName: string, sourceEventId: string, sourceGlobalSeq: number, input: {
        projectId: string;
        runtimeId: string;
        entityType: RuntimeEntityType;
        entityKey: string;
        transitionType: string;
        fromStatus?: string;
        toStatus: string;
        payload?: Record<string, unknown>;
        occurredAt: number;
    }, staging?: boolean): void;
    clearProjection(projectionName: string): void;
    getProjectionStateCount(projectionName: string, projectId?: string): number;
    clearAll(projectId: string): void;
    close(): void;
}
//# sourceMappingURL=PlanRuntimeStore.d.ts.map