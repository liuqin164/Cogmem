import Database from 'bun:sqlite';
import type { EventStore } from './EventStore.js';
import type { PolicyExecutionAuditPage } from '../types/index.js';
export type PolicyReplayPolicy = 'manual' | 'on_bootstrap' | 'always' | 'scheduled_only';
export interface PolicyExecutionRecord {
    executionId: string;
    projectId: string;
    idempotencyKey: string;
    runtimeId?: string;
    policy: string;
    action: string;
    target?: string;
    status: 'in_progress' | 'executed' | 'skipped' | 'failed';
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
    status?: Array<'in_progress' | 'executed' | 'skipped' | 'failed'>;
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
    claim(seed: PolicyExecutionRecord, leaseOwner: string, leaseUntil: number, now?: number): PolicyExecutionClaim;
    finishClaim(record: PolicyExecutionRecord, leaseOwner: string, options?: {
        emitEvent?: boolean;
    }): void;
    upsert(record: PolicyExecutionRecord, options?: {
        emitEvent?: boolean;
    }): void;
    private emitRecord;
    listByRuntime(projectId: string, runtimeId: string): PolicyExecutionRecord[];
    listPendingRetries(projectId: string, now?: number): PolicyExecutionRecord[];
    listDeadLetters(projectId: string, runtimeId?: string): PolicyExecutionRecord[];
    listByFilters(filters?: PolicyExecutionAuditFilters): PolicyExecutionRecord[];
    getAuditPage(page?: number, pageSize?: number, filters?: PolicyExecutionAuditFilters): PolicyExecutionAuditPage;
    getExecutionCount(projectId?: string): number;
    clearProject(projectId: string): void;
    close(): void;
    private buildFilterSql;
    private mapRow;
    private hasScopedIdentity;
    private tableColumns;
}
//# sourceMappingURL=PolicyExecutionStore.d.ts.map