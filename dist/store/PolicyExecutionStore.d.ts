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
    status: 'executed' | 'skipped' | 'failed';
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
    status?: Array<'executed' | 'skipped' | 'failed'>;
    replayPolicy?: PolicyReplayPolicy[];
    startTime?: number;
    endTime?: number;
}
export declare class PolicyExecutionStore {
    private db;
    private eventStore?;
    constructor(dbPath?: string, eventStore?: EventStore);
    private initializeSchema;
    getByIdempotencyKey(projectId: string, idempotencyKey: string): PolicyExecutionRecord | null;
    upsert(record: PolicyExecutionRecord, options?: {
        emitEvent?: boolean;
    }): void;
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
    private quarantineUnscopedExecutions;
}
//# sourceMappingURL=PolicyExecutionStore.d.ts.map