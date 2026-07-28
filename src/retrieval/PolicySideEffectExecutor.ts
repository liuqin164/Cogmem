import { createHash, randomUUID } from 'crypto';
import type {
  PolicyExecutionRecord,
  PolicyExecutionStore,
  PolicyReplayPolicy
} from '../store/PolicyExecutionStore.js';

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

export class NoopPolicySideEffectExecutor implements PolicySideEffectExecutor {
  execute(effect: PolicySideEffect): PolicySideEffectResult {
    return {
      policy: effect.policy,
      action: effect.action,
      target: effect.target,
      status: 'executed',
      detail: 'noop'
    };
  }
}

export class ReliablePolicySideEffectExecutor implements PolicySideEffectExecutor {
  private strategy: 'linear' | 'exponential';
  private jitterRatio: number;
  private maxBackoffMs: number;
  private leaseMs: number;

  constructor(
    private delegate: PolicySideEffectExecutor,
    private store: PolicyExecutionStore,
    private maxRetries: number = 2,
    private backoffMs: number = 1000,
    options?: ReliablePolicyExecutorOptions
  ) {
    this.strategy = options?.strategy || 'linear';
    this.jitterRatio = Math.max(0, Math.min(options?.jitterRatio ?? 0, 1));
    this.maxBackoffMs = Math.max(backoffMs, options?.maxBackoffMs ?? backoffMs * 16);
    this.leaseMs = Math.max(1_000, options?.leaseMs ?? 5 * 60_000);
  }

  async execute(effect: PolicySideEffect): Promise<PolicySideEffectResult> {
    const now = Date.now();
    const idempotencyKey = effect.idempotencyKey || this.computeIdempotencyKey(effect);
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
        detail: 'idempotent_replay'
      };
    }
    if (claim.kind === 'ambiguous') return {
      policy: effect.policy,
      action: effect.action,
      target: effect.target,
      status: 'failed',
      detail: claim.record?.detail || 'legacy_execution_scope_ambiguous',
    };
    if (claim.kind === 'busy') return {
      policy: effect.policy,
      action: effect.action,
      target: effect.target,
      status: claim.record.status === 'in_progress' ? 'skipped' : 'failed',
      detail: claim.record.status === 'in_progress' ? 'execution_in_progress' : claim.record.detail || 'execution_retry_not_due',
    };

    let record = claim.record;
    let lastError: unknown;
    const attemptBase = record.attemptCount;

    for (let localAttempt = 1; localAttempt <= this.maxRetries + 1; localAttempt++) {
      const totalAttempt = attemptBase + localAttempt;
      try {
        const result = await this.delegate.execute({ ...effect, idempotencyKey });
        if (result.status === 'failed') {
          lastError = new Error(result.detail || 'policy_delegate_failed');
          if (localAttempt <= this.maxRetries) continue;
          break;
        }
        record = {
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
          status: result.status,
          attemptCount: totalAttempt,
          nextRetryAt: undefined,
          deadLetteredAt: undefined,
          replayPolicy: effect.replayPolicy || record.replayPolicy || 'manual',
          detail: result.detail,
          metadata: effect.metadata,
          updatedAt: Date.now()
        };
        this.store.finishClaim(record, leaseOwner);
        return result;
      } catch (error) {
        lastError = error;
        if (localAttempt <= this.maxRetries) continue;
      }
    }

    const replayPolicy = effect.replayPolicy || record.replayPolicy || 'manual';
    const failedAt = Date.now();
    const totalAttempt = attemptBase + this.maxRetries + 1;
    record = {
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
      status: 'failed',
      attemptCount: totalAttempt,
      nextRetryAt: replayPolicy === 'manual' ? undefined : failedAt + this.computeBackoff(totalAttempt, idempotencyKey),
      deadLetteredAt: replayPolicy === 'manual' ? failedAt : undefined,
      replayPolicy,
      detail: lastError instanceof Error ? lastError.message : String(lastError),
      metadata: effect.metadata,
      updatedAt: failedAt,
    };
    this.store.finishClaim(record, leaseOwner);
    return {
      policy: effect.policy,
      action: effect.action,
      target: effect.target,
      status: 'failed',
      detail: record.detail,
    };
  }

  replay(projectId: string, runtimeId: string): PolicySideEffectResult[] {
    return this.store.listByRuntime(projectId, runtimeId).map((record) => ({
      policy: record.policy,
      action: record.action as PolicySideEffectResult['action'],
      target: record.target,
      status: record.status === 'executed' ? 'executed' : record.status === 'failed' ? 'failed' : 'skipped',
      detail: record.detail
    }));
  }

  async replayPending(projectId: string, now: number = Date.now()): Promise<PolicySideEffectResult[]> {
    const pending = this.store.listPendingRetries(projectId, now)
      .filter((record) => record.replayPolicy !== 'manual');
    const results: PolicySideEffectResult[] = [];

    for (const record of pending) {
      if (record.replayPolicy === 'on_bootstrap' && now > (record.nextRetryAt || 0) + 365 * 24 * 60 * 60 * 1000) {
        continue;
      }

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
        policyGroup: record.policyGroup
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
      detail: record.detail
    }));
  }

  private buildRecord(
    effect: PolicySideEffect,
    idempotencyKey: string,
    now: number,
    attemptCount: number
  ): PolicyExecutionRecord {
    return {
      executionId: `pex-${randomUUID()}`,
      projectId: effect.projectId,
      idempotencyKey,
      runtimeId: effect.runtimeId,
      policy: effect.policy,
      action: effect.action,
      target: effect.target,
      status: 'failed',
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
      updatedAt: now
    };
  }

  private computeIdempotencyKey(effect: PolicySideEffect): string {
    const raw = JSON.stringify({
      projectId: effect.projectId,
      runtimeId: effect.runtimeId,
      policy: effect.policy,
      action: effect.action,
      target: effect.target,
      metadata: effect.metadata || {},
      actorId: effect.actorId,
      causationId: effect.causationId,
      correlationId: effect.correlationId,
      policyGroup: effect.policyGroup
    });
    return createHash('sha256').update(raw).digest('hex');
  }

  private computeBackoff(attempt: number, idempotencyKey: string): number {
    const base = this.strategy === 'exponential'
      ? this.backoffMs * Math.pow(2, Math.max(0, attempt - 1))
      : this.backoffMs * Math.max(1, attempt);
    const bounded = Math.min(base, this.maxBackoffMs);
    if (this.jitterRatio === 0) return bounded;

    const hash = createHash('sha256').update(`${idempotencyKey}:${attempt}`).digest();
    const normalized = hash[0]! / 255;
    const jitter = (normalized * 2 - 1) * this.jitterRatio * bounded;
    return Math.max(0, Math.round(bounded + jitter));
  }
}
