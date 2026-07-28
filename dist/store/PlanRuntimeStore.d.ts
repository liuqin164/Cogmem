import type { EventStore } from './EventStore.js';
export type RuntimeEntityType = 'step' | 'merge' | 'validation' | 'policy' | 'executor' | 'state_machine';
export type RuntimeStatus = 'ready' | 'blocked' | 'pending' | 'matched' | 'missing';
export interface RuntimeStateRecord {
    runtimeId: string;
    entityType: RuntimeEntityType;
    entityKey: string;
    status: RuntimeStatus;
    metadata?: Record<string, unknown>;
    updatedAt: number;
}
export interface RuntimeTransitionRecord {
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
    runtimeId: string;
    states: RuntimeStateRecord[];
    transitions: RuntimeTransitionRecord[];
}
export interface RuntimeDiagnosticsHistoryPage {
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
    flushEventOutbox(): void;
    getState(runtimeId: string, entityType: RuntimeEntityType, entityKey: string): RuntimeStateRecord | null;
    getSnapshot(runtimeId: string): RuntimeSnapshot;
    getHistoryPage(runtimeId: string, page?: number, pageSize?: number, filters?: {
        entityTypes?: RuntimeEntityType[];
        transitionTypes?: string[];
        status?: RuntimeStatus[];
        startTime?: number;
        endTime?: number;
    }): RuntimeDiagnosticsHistoryPage;
    getStateCount(): number;
    applyProjectedState(projectionName: string, sourceGlobalSeq: number, input: {
        runtimeId: string;
        entityType: RuntimeEntityType;
        entityKey: string;
        status: RuntimeStatus;
        metadata?: Record<string, unknown>;
        updatedAt: number;
    }): void;
    applyProjectedTransition(projectionName: string, sourceEventId: string, input: {
        runtimeId: string;
        entityType: RuntimeEntityType;
        entityKey: string;
        transitionType: string;
        fromStatus?: string;
        toStatus: string;
        payload?: Record<string, unknown>;
        occurredAt: number;
    }): void;
    clearProjection(projectionName: string): void;
    getProjectionStateCount(projectionName: string): number;
    clearAll(): void;
    close(): void;
}
//# sourceMappingURL=PlanRuntimeStore.d.ts.map