import type { MemoryEvent } from '../types/index.js';
import { EventStore } from './EventStore.js';
import { PolicyExecutionStore, type PolicyExecutionOutcome } from './PolicyExecutionStore.js';
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
    if (!payload.executionId || !payload.idempotencyKey || !payload.policy || !payload.action || !payload.status) return;
    const projectId = event.projectId ?? (typeof payload.projectId === 'string' ? payload.projectId : undefined);
    if (projectId === undefined) {
      this.executionStore.recordDiscardedProjectionEvent('policy_execution', event, 'legacy_event_scope_unproven');
      return;
    }

    this.executionStore.upsertReadModel({
      executionId: String(payload.executionId),
      projectId,
      idempotencyKey: String(payload.idempotencyKey),
      runtimeId: payload.runtimeId ? String(payload.runtimeId) : undefined,
      policy: String(payload.policy),
      action: String(payload.action),
      target: payload.target ? String(payload.target) : undefined,
      status: String(payload.status) as 'executed' | 'skipped' | 'failed',
      executionOutcome: policyOutcome(payload.executionOutcome),
      attemptCount: Number(payload.attemptCount || 0),
      nextRetryAt: payload.nextRetryAt ? Number(payload.nextRetryAt) : undefined,
      deadLetteredAt: payload.deadLetteredAt ? Number(payload.deadLetteredAt) : undefined,
      replayPolicy: payload.replayPolicy ? String(payload.replayPolicy) as 'manual' | 'on_bootstrap' | 'always' | 'scheduled_only' : undefined,
      actorId: payload.actorId ? String(payload.actorId) : undefined,
      causationId: payload.causationId ? String(payload.causationId) : undefined,
      correlationId: payload.correlationId ? String(payload.correlationId) : event.correlationId,
      policyGroup: payload.policyGroup ? String(payload.policyGroup) : undefined,
      streamType: payload.streamType ? String(payload.streamType) : event.streamType,
      eventType: payload.eventType ? String(payload.eventType) : event.eventType,
      detail: payload.detail ? String(payload.detail) : undefined,
      metadata: payload.metadata as Record<string, unknown> | undefined,
      createdAt: Number(payload.createdAt || event.occurredAt),
      updatedAt: Number(payload.updatedAt || event.occurredAt)
    }, event.globalSeq ?? 0, staging);
  }

}

function policyOutcome(value: unknown): PolicyExecutionOutcome | undefined {
  return value === 'executed'
    || value === 'definitely_not_executed'
    || value === 'failed_before_execution'
    || value === 'outcome_unknown'
    ? value
    : undefined;
}
