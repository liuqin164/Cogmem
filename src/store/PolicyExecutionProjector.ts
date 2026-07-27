import type { MemoryEvent } from '../types/index.js';
import { EventStore } from './EventStore.js';
import { PolicyExecutionStore } from './PolicyExecutionStore.js';
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
    const pendingEvents = this.eventStore.getEventsAfter(checkpoint?.lastEventTime)
      .filter((event) => this.isPolicyExecutionEvent(event));

    if (!checkpoint) {
      await this.fullRebuild('initial_build');
      return;
    }

    if (checkpoint.status !== 'ready') {
      await this.fullRebuild(`checkpoint_${checkpoint.status}`);
      return;
    }

    if (pendingEvents.length === 0) {
      logger.info(`Policy execution projection ready: projection=${this.projectionName}`);
      return;
    }

    try {
      await this.replay(pendingEvents, checkpoint.lastRebuildAt);
    } catch (error) {
      logger.warn('Policy execution replay failed, falling back to full rebuild', error);
      await this.fullRebuild('replay_failed');
    }
  }

  async fullRebuild(reason: string): Promise<void> {
    logger.warn(`Rebuilding policy execution projection: reason=${reason}`);
    this.projectionStore.upsertCheckpoint({
      projectionName: this.projectionName,
      status: 'building',
      lastFullCount: 0,
      metadata: { reason }
    });

    this.executionStore.clearProject(this.projectId);
    const policyEvents = this.eventStore.getEventsAfter(undefined).filter((event) => this.isPolicyExecutionEvent(event));
    await this.replay(policyEvents);
  }

  async replay(events: MemoryEvent[], previousRebuildAt?: number): Promise<void> {
    if (events.length === 0) {
      const latestEvent = this.eventStore.getEventsAfter(undefined).filter((event) => this.isPolicyExecutionEvent(event)).at(-1);
      this.projectionStore.upsertCheckpoint({
        projectionName: this.projectionName,
        lastEventId: latestEvent?.eventId,
        lastEventTime: latestEvent?.occurredAt,
        lastRebuildAt: previousRebuildAt ?? Date.now(),
        lastFullCount: this.executionStore.getExecutionCount(this.projectId),
        status: 'ready',
        metadata: { mode: 'incremental_replay', replayedEventCount: 0 }
      });
      return;
    }

    logger.info(`Replaying policy execution projection events: count=${events.length}`);
    for (const event of events) {
      this.applyEvent(event);
      await Promise.resolve();
    }

    const lastEvent = events[events.length - 1];
    this.projectionStore.upsertCheckpoint({
      projectionName: this.projectionName,
      lastEventId: lastEvent?.eventId,
      lastEventTime: lastEvent?.occurredAt,
      lastRebuildAt: previousRebuildAt ?? Date.now(),
      lastFullCount: this.executionStore.getExecutionCount(this.projectId),
      status: 'ready',
      metadata: {
        mode: 'incremental_replay',
        replayedEventCount: events.length
      }
    });
  }

  private applyEvent(event: MemoryEvent): void {
    const payload = (event.payload || {}) as Record<string, unknown>;
    if (event.eventType !== 'POLICY_EXECUTION_UPDATED') return;
    if (!payload.executionId || !payload.idempotencyKey || !payload.policy || !payload.action || !payload.status) return;

    this.executionStore.upsert({
      executionId: String(payload.executionId),
      projectId: event.projectId!,
      idempotencyKey: String(payload.idempotencyKey),
      runtimeId: payload.runtimeId ? String(payload.runtimeId) : undefined,
      policy: String(payload.policy),
      action: String(payload.action),
      target: payload.target ? String(payload.target) : undefined,
      status: String(payload.status) as 'executed' | 'skipped' | 'failed',
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
    }, { emitEvent: false });
  }

  private isPolicyExecutionEvent(event: MemoryEvent): boolean {
    return event.eventType === 'POLICY_EXECUTION_UPDATED' && event.projectId === this.projectId;
  }
}
