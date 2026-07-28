import type { PolicyExecutionStore, PolicyReplayPolicy } from '../store/PolicyExecutionStore.js';
export interface PolicySideEffect {
    projectId: string;
    runtimeId?: string;
    policy: string;
    action: 'allow' | 'deny' | 'prefer';
    target?: string;
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
    replayPolicy?: PolicyReplayPolicy;
    actorId?: string;
    causationId?: string;
    correlationId?: string;
    policyGroup?: string;
}
export interface PolicySideEffectResult {
    policy: string;
    action: 'allow' | 'deny' | 'prefer';
    target?: string;
    status: 'executed' | 'skipped' | 'failed';
    detail?: string;
}
export interface PolicySideEffectExecutor {
    execute(effect: PolicySideEffect): Promise<PolicySideEffectResult> | PolicySideEffectResult;
}
export interface ReliablePolicyExecutorOptions {
    strategy?: 'linear' | 'exponential';
    jitterRatio?: number;
    maxBackoffMs?: number;
    leaseMs?: number;
}
export declare class NoopPolicySideEffectExecutor implements PolicySideEffectExecutor {
    execute(effect: PolicySideEffect): PolicySideEffectResult;
}
export declare class ReliablePolicySideEffectExecutor implements PolicySideEffectExecutor {
    private delegate;
    private store;
    private maxRetries;
    private backoffMs;
    private strategy;
    private jitterRatio;
    private maxBackoffMs;
    private leaseMs;
    constructor(delegate: PolicySideEffectExecutor, store: PolicyExecutionStore, maxRetries?: number, backoffMs?: number, options?: ReliablePolicyExecutorOptions);
    execute(effect: PolicySideEffect): Promise<PolicySideEffectResult>;
    replay(projectId: string, runtimeId: string): PolicySideEffectResult[];
    replayPending(projectId: string, now?: number): Promise<PolicySideEffectResult[]>;
    getDeadLetters(projectId: string, runtimeId?: string): PolicySideEffectResult[];
    private buildRecord;
    private computeIdempotencyKey;
    private computeBackoff;
}
//# sourceMappingURL=PolicySideEffectExecutor.d.ts.map