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
  }

  async execute(effect: PolicySideEffect): Promise<PolicySideEffectResult> {
    const now = Date.now();
    const idempotencyKey = effect.idempotencyKey || this.computeIdempotencyKey(effect);
    const existing = this.store.getByIdempotencyKey(effect.projectId, idempotencyKey);

    if (existing?.status === 'executed') {
      return {
        policy: existing.policy,
        action: existing.action as PolicySideEffectResult['action'],
        target: existing.target,
        status: 'skipped',
        detail: 'idempotent_replay'
      };
    }

    let record = existing || this.buildRecord(effect, idempotencyKey, now, 0);
    let lastError: unknown;
    const attemptBase = existing?.attemptCount || 0;

    for (let localAttempt = 1; localAttempt <= this.maxRetries + 1; localAttempt++) {
      const totalAttempt = attemptBase + localAttempt;
      try {
        const result = await this.delegate.execute({ ...effect, idempotencyKey });
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
          status: result.status === 'failed' ? 'failed' : 'executed',
          attemptCount: totalAttempt,
          nextRetryAt: undefined,
          deadLetteredAt: undefined,
          replayPolicy: effect.replayPolicy || record.replayPolicy || 'manual',
          detail: result.detail,
          metadata: effect.metadata,
          updatedAt: Date.now()
        };
        this.store.upsert(record);
        return result;
      } catch (error) {
        lastError = error;
        const replayPolicy = effect.replayPolicy || record.replayPolicy || 'manual';
        const isLastAttempt = localAttempt >= this.maxRetries + 1;
        const shouldRetryLater = !isLastAttempt || replayPolicy !== 'manual';
        const deadLetter = isLastAttempt && (replayPolicy === 'manual');

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
          nextRetryAt: shouldRetryLater ? Date.now() + this.computeBackoff(totalAttempt, idempotencyKey) : undefined,
          deadLetteredAt: deadLetter ? Date.now() : undefined,
          replayPolicy,
          detail: error instanceof Error ? error.message : String(error),
          metadata: effect.metadata,
          updatedAt: Date.now()
        };
        this.store.upsert(record);
      }
    }

    return {
      policy: effect.policy,
      action: effect.action,
      target: effect.target,
      status: 'failed',
      detail: lastError instanceof Error ? lastError.message : String(lastError)
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
