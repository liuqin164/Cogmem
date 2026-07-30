import type { MemoryEvent } from '../types/index.js';
import { EventStore } from './EventStore.js';
import {
  PolicyExecutionStore,
  type PolicyExecutionOutcome,
  type PolicyExecutionStatus,
  type PolicyReplayPolicy,
  policyExecutionStateIsValid,
} from './PolicyExecutionStore.js';
import { PolicyProjectionStore } from './PolicyProjectionStore.js';
import { logger } from '../utils/Logger.js';

export class PolicyExecutionProjector {
  constructor(
    private eventStore: EventStore,
    private executionStore: PolicyExecutionStore,
    private projectionStore: PolicyProjectionStore,
    private projectId: string,
    private projectionName: string = `policy_execution_projection:${projectId.length}:${projectId}`
  ) {}

  async bootstrap(): Promise<void> {
    const checkpoint = this.projectionStore.getCheckpoint(this.projectionName);
    if (!checkpoint || checkpoint.lastGlobalSeq === undefined) {
      await this.fullRebuild('initial_build');
      return;
    }

    if (checkpoint.status !== 'ready') {
      await this.fullRebuild(`checkpoint_${checkpoint.status}`);
      return;
    }

    const throughGlobalSeq = this.eventStore.getLatestGlobalSeq();
    if (throughGlobalSeq <= checkpoint.lastGlobalSeq) {
      logger.info(`Policy execution projection ready: projection=${this.projectionName}`);
      return;
    }

    try {
      await this.replayRange(checkpoint.lastGlobalSeq, throughGlobalSeq, false, checkpoint.lastRebuildAt);
    } catch (error) {
      logger.warn('Policy execution replay failed, falling back to full rebuild', error);
      await this.fullRebuild('replay_failed');
    }
  }

  async fullRebuild(reason: string): Promise<void> {
    logger.warn(`Rebuilding policy execution projection: reason=${reason}`);
    const throughGlobalSeq = this.eventStore.getLatestGlobalSeq();
    this.projectionStore.upsertCheckpoint({
      projectionName: this.projectionName,
      status: 'building',
      lastFullCount: 0,
      metadata: { reason }
    });

    this.executionStore.beginReadModelBuild(this.projectId);
    try {
      const rebuilt = await this.replayRange(0, throughGlobalSeq, true, undefined, false);
      this.executionStore.publishReadModelBuild(this.projectId);
      this.writeCheckpoint(throughGlobalSeq, rebuilt.lastEvent, rebuilt.replayedEventCount, 'full_rebuild');
    } catch (error) {
      this.executionStore.discardReadModelBuild(this.projectId);
      throw error;
    }
  }

  private async replayRange(
    afterGlobalSeq: number,
    throughGlobalSeq: number,
    staging: boolean,
    previousRebuildAt?: number,
    updateCheckpoint = true,
  ): Promise<{ lastEvent?: MemoryEvent; replayedEventCount: number }> {
    let cursor = afterGlobalSeq;
    let replayedEventCount = 0;
    let lastEvent: MemoryEvent | undefined;
    for (;;) {
      const page = this.eventStore.getEventsByGlobalSeqPage({
        afterGlobalSeq: cursor,
        throughGlobalSeq,
        eventTypes: ['POLICY_EXECUTION_UPDATED'],
        projectId: this.projectId,
        limit: 500,
      });
      if (page.length === 0) break;
      for (const event of page) this.applyEvent(event, staging);
      lastEvent = page[page.length - 1];
      cursor = lastEvent?.globalSeq ?? cursor;
      replayedEventCount += page.length;
      await Promise.resolve();
    }
    if (updateCheckpoint) this.writeCheckpoint(
      throughGlobalSeq,
      lastEvent,
      replayedEventCount,
      staging ? 'full_rebuild' : 'incremental_replay',
      previousRebuildAt,
    );
    return { lastEvent, replayedEventCount };
  }

  private writeCheckpoint(
    throughGlobalSeq: number,
    lastEvent: MemoryEvent | undefined,
    replayedEventCount: number,
    mode: 'full_rebuild' | 'incremental_replay',
    previousRebuildAt?: number,
  ): void {
    this.projectionStore.upsertCheckpoint({
      projectionName: this.projectionName,
      lastEventId: lastEvent?.eventId,
      lastEventTime: lastEvent?.occurredAt,
      lastGlobalSeq: throughGlobalSeq,
      lastRebuildAt: previousRebuildAt ?? Date.now(),
      lastFullCount: this.executionStore.getReadModelCount(this.projectId),
      status: 'ready',
      metadata: { mode, replayedEventCount },
    });
  }

  private applyEvent(event: MemoryEvent, staging = false): void {
    const payload = (event.payload || {}) as Record<string, unknown>;
    if (event.eventType !== 'POLICY_EXECUTION_UPDATED') return;
    const projectId = event.projectId;
    if (projectId === undefined) {
      this.executionStore.recordDiscardedProjectionEvent('policy_execution', event, 'legacy_event_scope_unproven');
      return;
    }
    if (payload.projectId !== undefined && payload.projectId !== projectId) {
      this.executionStore.recordDiscardedProjectionEvent('policy_execution', event, 'event_payload_scope_mismatch');
      return;
    }
    const outcome = policyOutcome(payload.executionOutcome);
    if (!isNonEmptyString(payload.executionId)
      || !isNonEmptyString(payload.idempotencyKey)
      || !isNonEmptyString(payload.policy)
      || !isNonEmptyString(payload.action)
      || !isPolicyStatus(payload.status)
      || (payload.executionOutcome !== undefined && outcome === undefined)
      || !policyExecutionStateIsValid(payload.status, outcome)
      || !isOptionalNonNegativeNumber(payload.attemptCount)
      || !isOptionalNumber(payload.nextRetryAt)
      || !isOptionalNumber(payload.deadLetteredAt)
      || !isOptionalReplayPolicy(payload.replayPolicy)
      || !isOptionalRecord(payload.metadata)
      || !isOptionalNumber(payload.createdAt)
      || !isOptionalNumber(payload.updatedAt)) {
      this.executionStore.recordDiscardedProjectionEvent('policy_execution', event, 'invalid_policy_event_payload');
      return;
    }

    this.executionStore.upsertReadModel({
      executionId: payload.executionId,
      projectId,
      idempotencyKey: payload.idempotencyKey,
      runtimeId: payload.runtimeId ? String(payload.runtimeId) : undefined,
      policy: payload.policy,
      action: payload.action,
      target: payload.target ? String(payload.target) : undefined,
      status: payload.status,
      executionOutcome: outcome,
      attemptCount: payload.attemptCount ?? 0,
      nextRetryAt: payload.nextRetryAt,
      deadLetteredAt: payload.deadLetteredAt,
      replayPolicy: payload.replayPolicy,
      actorId: payload.actorId ? String(payload.actorId) : undefined,
      causationId: payload.causationId ? String(payload.causationId) : undefined,
      correlationId: payload.correlationId ? String(payload.correlationId) : event.correlationId,
      policyGroup: payload.policyGroup ? String(payload.policyGroup) : undefined,
      streamType: payload.streamType ? String(payload.streamType) : event.streamType,
      eventType: payload.eventType ? String(payload.eventType) : event.eventType,
      detail: payload.detail ? String(payload.detail) : undefined,
      metadata: payload.metadata,
      createdAt: payload.createdAt ?? event.occurredAt,
      updatedAt: payload.updatedAt ?? event.occurredAt
    }, event.globalSeq ?? 0, staging);
  }

}

const POLICY_STATUSES = new Set<PolicyExecutionStatus>(['in_progress', 'executed', 'skipped', 'failed']);
const REPLAY_POLICIES = new Set<PolicyReplayPolicy>(['manual', 'on_bootstrap', 'always', 'scheduled_only']);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPolicyStatus(value: unknown): value is PolicyExecutionStatus {
  return typeof value === 'string' && POLICY_STATUSES.has(value as PolicyExecutionStatus);
}

function isOptionalReplayPolicy(value: unknown): value is PolicyReplayPolicy | undefined {
  return value === undefined || (typeof value === 'string' && REPLAY_POLICIES.has(value as PolicyReplayPolicy));
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isOptionalNonNegativeNumber(value: unknown): value is number | undefined {
  return isOptionalNumber(value) && (value === undefined || value >= 0);
}

function isOptionalRecord(value: unknown): value is Record<string, unknown> | undefined {
  return value === undefined || (typeof value === 'object' && value !== null && !Array.isArray(value));
}

function policyOutcome(value: unknown): PolicyExecutionOutcome | undefined {
  return value === 'executed'
    || value === 'definitely_not_executed'
    || value === 'failed_before_execution'
    || value === 'outcome_unknown'
    ? value
    : undefined;
}
