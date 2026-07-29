import { createHash, randomUUID } from 'crypto';
import type {
  PolicyExecutionRecord,
  PolicyExecutionStore,
  PolicyReplayPolicy,
} from '../store/PolicyExecutionStore.js';

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

export type PolicyExecutionOutcome =
  | 'executed'
  | 'definitely_not_executed'
  | 'failed_before_execution'
  | 'outcome_unknown';

interface PolicySideEffectResultBase {
  policy: string;
  action: 'allow' | 'deny' | 'prefer';
  target?: string;
  detail?: string;
}

export type PolicySideEffectResult =
  | (PolicySideEffectResultBase & { status: 'executed'; outcome: 'executed' })
  | (PolicySideEffectResultBase & { status: 'skipped'; outcome: 'executed' })
  | (PolicySideEffectResultBase & {
      status: 'failed';
      outcome: Exclude<PolicyExecutionOutcome, 'executed'>;
    })
  | (PolicySideEffectResultBase & { status: 'in_progress'; outcome?: never });

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

export class PolicySideEffectExecutionError extends Error {
  constructor(message: string, readonly outcome: Exclude<PolicyExecutionOutcome, 'executed'> = 'outcome_unknown') {
    super(message);
    this.name = 'PolicySideEffectExecutionError';
  }
}

export class NoopPolicySideEffectExecutor implements PolicySideEffectExecutor {
  execute(effect: PolicySideEffect): PolicySideEffectResult {
    return {
      policy: effect.policy,
      action: effect.action,
      target: effect.target,
      status: 'executed',
      outcome: 'executed',
      detail: 'noop',
    };
  }
}

export class ReliablePolicySideEffectExecutor implements PolicySideEffectExecutor {
  private readonly strategy: 'linear' | 'exponential';
  private readonly jitterRatio: number;
  private readonly maxBackoffMs: number;
  private readonly leaseMs: number;
  private readonly heartbeatIntervalMs: number;

  constructor(
    private readonly delegate: PolicySideEffectExecutor,
    private readonly store: PolicyExecutionStore,
    private readonly maxRetries: number = 2,
    private readonly backoffMs: number = 1000,
    options?: ReliablePolicyExecutorOptions,
  ) {
    this.strategy = options?.strategy || 'linear';
    this.jitterRatio = Math.max(0, Math.min(options?.jitterRatio ?? 0, 1));
    this.maxBackoffMs = Math.max(backoffMs, options?.maxBackoffMs ?? backoffMs * 16);
    this.leaseMs = Math.max(1_000, options?.leaseMs ?? 5 * 60_000);
    this.heartbeatIntervalMs = Math.max(
      100,
      Math.min(options?.heartbeatIntervalMs ?? this.leaseMs / 3, this.leaseMs / 2),
    );
  }

  async execute(effect: PolicySideEffect): Promise<PolicySideEffectResult> {
    const now = Date.now();
    const idempotencyKey = effect.idempotencyKey?.trim()
      || (effect.stableOperationId?.trim() ? this.computeIdempotencyKey(effect) : undefined);
    if (!idempotencyKey) {
      return {
        policy: effect.policy,
        action: effect.action,
        target: effect.target,
        status: 'failed',
        outcome: 'definitely_not_executed',
        detail: 'policy_operation_identity_required',
      };
    }
    const leaseOwner = `policy-worker-${randomUUID()}`;
    const claim = this.store.claim(
      this.buildRecord(effect, idempotencyKey, now, 0),
      leaseOwner,
      now + this.leaseMs,
      now,
    );
    if (claim.kind === 'executed') {
      return {
        policy: claim.record.policy,
        action: claim.record.action as PolicySideEffectResult['action'],
        target: claim.record.target,
        status: 'skipped',
        outcome: 'executed',
        detail: 'idempotent_replay',
      };
    }
    if (claim.kind === 'ambiguous') {
      return this.unknownResult(effect, claim.record?.detail || 'legacy_execution_scope_ambiguous');
    }
    if (claim.kind === 'busy') {
      if (claim.record.status === 'in_progress') {
        return {
          policy: effect.policy,
          action: effect.action,
          target: effect.target,
          status: 'in_progress',
          detail: 'execution_in_progress',
        };
      }
      return this.unknownResult(effect, claim.record.detail || 'execution_retry_not_due');
    }

    const record = claim.record;
    const attemptBase = record.attemptCount;
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      try {
        leaseLost ||= !this.store.renewLease(
          effect.projectId,
          idempotencyKey,
          leaseOwner,
          Date.now() + this.leaseMs,
        );
      } catch {
        leaseLost = true;
      }
    }, this.heartbeatIntervalMs);
    heartbeat.unref?.();

    try {
      for (let localAttempt = 1; localAttempt <= this.maxRetries + 1; localAttempt++) {
        const totalAttempt = attemptBase + localAttempt;
        let result: PolicySideEffectResult;
        try {
          result = await this.delegate.execute({ ...effect, idempotencyKey });
        } catch (error) {
          const outcome = error instanceof PolicySideEffectExecutionError ? error.outcome : 'outcome_unknown';
          if (this.retryable(outcome) && localAttempt <= this.maxRetries && !leaseLost) continue;
          return this.finishFailure(
            effect,
            record,
            leaseOwner,
            idempotencyKey,
            totalAttempt,
            outcome,
            error instanceof Error ? error.message : String(error),
          );
        }

        if (!this.validResult(result, effect)) {
          return this.finishFailure(
            effect,
            record,
            leaseOwner,
            idempotencyKey,
            totalAttempt,
            'outcome_unknown',
            'delegate_protocol_error',
          );
        }

        if (result.status === 'failed') {
          const outcome = result.outcome;
          if (this.retryable(outcome) && localAttempt <= this.maxRetries && !leaseLost) continue;
          return this.finishFailure(
            effect,
            record,
            leaseOwner,
            idempotencyKey,
            totalAttempt,
            outcome,
            result.detail || 'policy_delegate_failed',
          );
        }

        if (result.status === 'in_progress') {
          return this.finishFailure(
            effect,
            record,
            leaseOwner,
            idempotencyKey,
            totalAttempt,
            'outcome_unknown',
            'delegate_returned_in_progress',
          );
        }
        if (leaseLost) return this.unknownResult(effect, 'external_effect_succeeded_lease_lost');

        const terminal = this.terminalRecord(effect, record, {
          status: result.status,
          attemptCount: totalAttempt,
          detail: result.detail,
        });
        try {
          this.store.finishClaim(terminal, leaseOwner);
        } catch {
          return this.unknownResult(effect, 'external_effect_succeeded_persistence_unknown');
        }
        return result;
      }
      return this.unknownResult(effect, 'execution_loop_exhausted');
    } finally {
      clearInterval(heartbeat);
    }
  }

  replay(projectId: string, runtimeId: string): PolicySideEffectResult[] {
    return this.store.listByRuntime(projectId, runtimeId).map((record) => ({
      policy: record.policy,
      action: record.action as PolicySideEffectResult['action'],
      target: record.target,
      status: record.status,
      ...(record.status === 'executed' || record.status === 'skipped'
        ? { outcome: 'executed' as const }
        : { outcome: 'outcome_unknown' as const }),
      detail: record.detail,
    })) as PolicySideEffectResult[];
  }

  async replayPending(projectId: string, now: number = Date.now()): Promise<PolicySideEffectResult[]> {
    const pending = this.store.listPendingRetries(projectId, now)
      .filter((record) => record.replayPolicy !== 'manual');
    const results: PolicySideEffectResult[] = [];
    for (const record of pending) {
      if (record.replayPolicy === 'on_bootstrap' && now > (record.nextRetryAt || 0) + 365 * 24 * 60 * 60 * 1000) continue;
      results.push(await this.execute({
        projectId: record.projectId,
        runtimeId: record.runtimeId,
        policy: record.policy,
        action: record.action as PolicySideEffectResult['action'],
        target: record.target,
        metadata: record.metadata,
        idempotencyKey: record.idempotencyKey,
        replayPolicy: record.replayPolicy,
        actorId: record.actorId,
        causationId: record.causationId,
        correlationId: record.correlationId,
        policyGroup: record.policyGroup,
      }));
    }
    return results;
  }

  getDeadLetters(projectId: string, runtimeId?: string): PolicySideEffectResult[] {
    return this.store.listDeadLetters(projectId, runtimeId).map((record) => ({
      policy: record.policy,
      action: record.action as PolicySideEffectResult['action'],
      target: record.target,
      status: 'failed',
      outcome: 'outcome_unknown',
      detail: record.detail,
    }));
  }

  private finishFailure(
    effect: PolicySideEffect,
    record: PolicyExecutionRecord,
    leaseOwner: string,
    idempotencyKey: string,
    attemptCount: number,
    outcome: Exclude<PolicyExecutionOutcome, 'executed'>,
    detail: string,
  ): PolicySideEffectResult {
    const failedAt = Date.now();
    const replayPolicy = effect.replayPolicy || record.replayPolicy || 'manual';
    const canReplay = this.retryable(outcome) && replayPolicy !== 'manual';
    const failed = this.terminalRecord(effect, record, {
      status: 'failed',
      attemptCount,
      detail: outcome === 'outcome_unknown' ? `outcome_unknown:${detail}` : detail,
      nextRetryAt: canReplay ? failedAt + this.computeBackoff(attemptCount, idempotencyKey) : undefined,
      deadLetteredAt: canReplay ? undefined : failedAt,
      updatedAt: failedAt,
    });
    try {
      this.store.finishClaim(failed, leaseOwner);
    } catch {
      return this.unknownResult(effect, 'policy_failure_persistence_unknown');
    }
    return {
      policy: effect.policy,
      action: effect.action,
      target: effect.target,
      status: 'failed',
      outcome,
      detail: failed.detail,
    };
  }

  private terminalRecord(
    effect: PolicySideEffect,
    record: PolicyExecutionRecord,
    terminal: Pick<PolicyExecutionRecord, 'status' | 'attemptCount'> & Partial<PolicyExecutionRecord>,
  ): PolicyExecutionRecord {
    return {
      ...record,
      projectId: effect.projectId,
      runtimeId: effect.runtimeId,
      policy: effect.policy,
      action: effect.action,
      target: effect.target,
      actorId: effect.actorId,
      causationId: effect.causationId,
      correlationId: effect.correlationId,
      policyGroup: effect.policyGroup,
      streamType: 'system',
      eventType: 'POLICY_EXECUTION_UPDATED',
      nextRetryAt: undefined,
      deadLetteredAt: undefined,
      replayPolicy: effect.replayPolicy || record.replayPolicy || 'manual',
      metadata: effect.metadata,
      updatedAt: Date.now(),
      ...terminal,
    };
  }

  private buildRecord(
    effect: PolicySideEffect,
    idempotencyKey: string,
    now: number,
    attemptCount: number,
  ): PolicyExecutionRecord {
    return {
      executionId: `pex-${randomUUID()}`,
      projectId: effect.projectId,
      idempotencyKey,
      runtimeId: effect.runtimeId,
      policy: effect.policy,
      action: effect.action,
      target: effect.target,
      status: 'in_progress',
      attemptCount,
      replayPolicy: effect.replayPolicy || 'manual',
      actorId: effect.actorId,
      causationId: effect.causationId,
      correlationId: effect.correlationId,
      policyGroup: effect.policyGroup,
      streamType: 'system',
      eventType: 'POLICY_EXECUTION_UPDATED',
      metadata: effect.metadata,
      createdAt: now,
      updatedAt: now,
    };
  }

  private computeIdempotencyKey(effect: PolicySideEffect): string {
    return createHash('sha256').update(canonicalJson({
      projectId: effect.projectId,
      policy: effect.policy,
      action: effect.action,
      target: effect.target,
      stableOperationId: effect.stableOperationId,
    })).digest('hex');
  }

  private retryable(outcome: PolicyExecutionOutcome): boolean {
    return outcome === 'definitely_not_executed' || outcome === 'failed_before_execution';
  }

  private validResult(result: unknown, effect: PolicySideEffect): result is PolicySideEffectResult {
    if (!result || typeof result !== 'object') return false;
    const value = result as Record<string, unknown>;
    if (value.policy !== effect.policy || value.action !== effect.action) return false;
    if (value.target !== undefined && value.target !== effect.target) return false;
    if (value.status === 'executed' || value.status === 'skipped') return value.outcome === 'executed';
    if (value.status === 'failed') {
      return value.outcome === 'definitely_not_executed'
        || value.outcome === 'failed_before_execution'
        || value.outcome === 'outcome_unknown';
    }
    return value.status === 'in_progress' && value.outcome === undefined;
  }

  private unknownResult(effect: PolicySideEffect, detail: string): PolicySideEffectResult {
    return {
      policy: effect.policy,
      action: effect.action,
      target: effect.target,
      status: 'failed',
      outcome: 'outcome_unknown',
      detail,
    };
  }

  private computeBackoff(attempt: number, idempotencyKey: string): number {
    const base = this.strategy === 'exponential'
      ? this.backoffMs * Math.pow(2, Math.max(0, attempt - 1))
      : this.backoffMs * Math.max(1, attempt);
    const bounded = Math.min(base, this.maxBackoffMs);
    if (this.jitterRatio === 0) return bounded;
    const hash = createHash('sha256').update(`${idempotencyKey}:${attempt}`).digest();
    const jitter = (hash[0]! / 255 * 2 - 1) * this.jitterRatio * bounded;
    return Math.max(0, Math.round(bounded + jitter));
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
