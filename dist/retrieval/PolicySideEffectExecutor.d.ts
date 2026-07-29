import type { PolicyExecutionStore, PolicyReplayPolicy } from '../store/PolicyExecutionStore.js';
export interface PolicySideEffect {
    projectId: string;
    runtimeId?: string;
    policy: string;
    action: 'allow' | 'deny' | 'prefer';
    target?: string;
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
    stableOperationId?: string;
    replayPolicy?: PolicyReplayPolicy;
    actorId?: string;
    causationId?: string;
    correlationId?: string;
    policyGroup?: string;
}
export type PolicyExecutionOutcome = 'executed' | 'definitely_not_executed' | 'failed_before_execution' | 'outcome_unknown';
interface PolicySideEffectResultBase {
    policy: string;
    action: 'allow' | 'deny' | 'prefer';
    target?: string;
    detail?: string;
}
export type PolicySideEffectResult = (PolicySideEffectResultBase & {
    status: 'executed';
    outcome: 'executed';
}) | (PolicySideEffectResultBase & {
    status: 'skipped';
    outcome: 'executed';
}) | (PolicySideEffectResultBase & {
    status: 'failed';
    outcome: Exclude<PolicyExecutionOutcome, 'executed'>;
}) | (PolicySideEffectResultBase & {
    status: 'in_progress';
    outcome?: never;
});
export interface PolicySideEffectExecutor {
    execute(effect: PolicySideEffect): Promise<PolicySideEffectResult> | PolicySideEffectResult;
}
export interface ReliablePolicyExecutorOptions {
    strategy?: 'linear' | 'exponential';
    jitterRatio?: number;
    maxBackoffMs?: number;
    leaseMs?: number;
    heartbeatIntervalMs?: number;
}
export declare class PolicySideEffectExecutionError extends Error {
    readonly outcome: Exclude<PolicyExecutionOutcome, 'executed'>;
    constructor(message: string, outcome?: Exclude<PolicyExecutionOutcome, 'executed'>);
}
export declare class NoopPolicySideEffectExecutor implements PolicySideEffectExecutor {
    execute(effect: PolicySideEffect): PolicySideEffectResult;
}
export declare class ReliablePolicySideEffectExecutor implements PolicySideEffectExecutor {
    private readonly delegate;
    private readonly store;
    private readonly maxRetries;
    private readonly backoffMs;
    private readonly strategy;
    private readonly jitterRatio;
    private readonly maxBackoffMs;
    private readonly leaseMs;
    private readonly heartbeatIntervalMs;
    constructor(delegate: PolicySideEffectExecutor, store: PolicyExecutionStore, maxRetries?: number, backoffMs?: number, options?: ReliablePolicyExecutorOptions);
    execute(effect: PolicySideEffect): Promise<PolicySideEffectResult>;
    replay(projectId: string, runtimeId: string): PolicySideEffectResult[];
    replayPending(projectId: string, now?: number): Promise<PolicySideEffectResult[]>;
    getDeadLetters(projectId: string, runtimeId?: string): PolicySideEffectResult[];
    private finishFailure;
    private terminalRecord;
    private buildRecord;
    private computeIdempotencyKey;
    private retryable;
    private validResult;
    private unknownResult;
    private computeBackoff;
}
export {};
//# sourceMappingURL=PolicySideEffectExecutor.d.ts.map