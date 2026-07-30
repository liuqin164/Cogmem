import Database from 'bun:sqlite';
import type { EventStore } from './EventStore.js';
import type { MemoryEvent, PolicyExecutionAuditPage } from '../types/index.js';
export type PolicyReplayPolicy = 'manual' | 'on_bootstrap' | 'always' | 'scheduled_only';
export type PolicyExecutionStatus = 'in_progress' | 'executed' | 'skipped' | 'failed';
export type PolicyExecutionOutcome = 'executed' | 'definitely_not_executed' | 'failed_before_execution' | 'outcome_unknown';
export interface PolicyExecutionRecord {
    executionId: string;
    projectId: string;
    idempotencyKey: string;
    runtimeId?: string;
    policy: string;
    action: string;
    target?: string;
    status: PolicyExecutionStatus;
    executionOutcome?: PolicyExecutionOutcome;
    attemptCount: number;
    nextRetryAt?: number;
    deadLetteredAt?: number;
    replayPolicy?: PolicyReplayPolicy;
    actorId?: string;
    causationId?: string;
    correlationId?: string;
    policyGroup?: string;
    streamType?: string;
    eventType?: string;
    detail?: string;
    metadata?: Record<string, unknown>;
    leaseOwner?: string;
    leaseUntil?: number;
    createdAt: number;
    updatedAt: number;
}
export interface PolicyExecutionAuditFilters {
    projectId?: string;
    runtimeId?: string;
    actorId?: string[];
    causationId?: string[];
    correlationId?: string[];
    policyGroup?: string[];
    streamType?: string[];
    eventType?: string[];
    policy?: string[];
    target?: string[];
    status?: PolicyExecutionStatus[];
    replayPolicy?: PolicyReplayPolicy[];
    startTime?: number;
    endTime?: number;
}
export type PolicyExecutionClaim = {
    kind: 'claimed';
    record: PolicyExecutionRecord;
} | {
    kind: 'executed';
    record: PolicyExecutionRecord;
} | {
    kind: 'busy';
    record: PolicyExecutionRecord;
} | {
    kind: 'ambiguous';
    record?: PolicyExecutionRecord;
};
export declare class PolicyExecutionStore {
    private db;
    private ownsDb;
    private eventStore?;
    constructor(dbPath?: string | Database, eventStore?: EventStore);
    private initializeSchema;
    getByIdempotencyKey(projectId: string, idempotencyKey: string): PolicyExecutionRecord | null;
    recordDiscardedProjectionEvent(projector: string, event: MemoryEvent, reason: string): void;
    claim(seed: PolicyExecutionRecord, leaseOwner: string, leaseUntil: number, now?: number): PolicyExecutionClaim;
    finishClaim(record: PolicyExecutionRecord, leaseOwner: string, options?: {
        emitEvent?: boolean;
    }): void;
    renewLease(projectId: string, idempotencyKey: string, leaseOwner: string, leaseUntil: number, now?: number): boolean;
    upsert(record: PolicyExecutionRecord, options?: {
        emitEvent?: boolean;
    }): void;
    private emitRecord;
    private enqueueAudit;
    flushAuditOutbox(): number;
    getAuditOutboxStats(): {
        pending: number;
        oldestCreatedAt?: number;
        deadLetter: number;
        lastError?: string;
    };
    private auditEventId;
    clearReadModelProject(projectId: string): void;
    beginReadModelBuild(projectId: string): void;
    publishReadModelBuild(projectId: string): void;
    discardReadModelBuild(projectId: string): void;
    upsertReadModel(record: PolicyExecutionRecord, sourceGlobalSeq?: number, staging?: boolean): void;
    getReadModelCount(projectId?: string): number;
    getReadModelByIdempotencyKey(projectId: string, idempotencyKey: string): PolicyExecutionRecord | null;
    listByRuntime(projectId: string, runtimeId: string): PolicyExecutionRecord[];
    listPendingRetries(projectId: string, now?: number): PolicyExecutionRecord[];
    listDeadLetters(projectId: string, runtimeId?: string): PolicyExecutionRecord[];
    listByFilters(filters?: PolicyExecutionAuditFilters): PolicyExecutionRecord[];
    getAuditPage(page?: number, pageSize?: number, filters?: PolicyExecutionAuditFilters): PolicyExecutionAuditPage;
    getExecutionCount(projectId?: string): number;
    close(): void;
    private buildFilterSql;
    private mapRow;
    private hasScopedIdentity;
    private tableColumns;
}
//# sourceMappingURL=PolicyExecutionStore.d.ts.map