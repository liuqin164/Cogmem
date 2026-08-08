import type { MemoryEvent } from '../types/index.js';
import { EventStore } from './EventStore.js';
import { PlanRuntimeStore, type RuntimeEntityType, type RuntimeStatus } from './PlanRuntimeStore.js';
import { RuntimeProjectionStore } from './RuntimeProjectionStore.js';
import { logger } from '../utils/Logger.js';

export class RuntimeProjector {
  constructor(
    private eventStore: EventStore,
    private runtimeStore: PlanRuntimeStore,
    private projectionStore: RuntimeProjectionStore,
    private projectionName: string = 'runtime_projection_main'
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
      logger.info(`Runtime projection ready: projection=${this.projectionName}`);
      return;
    }

    try {
      await this.replayRange(checkpoint.lastGlobalSeq, throughGlobalSeq, false, checkpoint.lastRebuildAt);
    } catch (error) {
      logger.warn('Runtime replay failed, falling back to full rebuild', error);
      await this.fullRebuild('replay_failed');
    }
  }

  async fullRebuild(reason: string): Promise<void> {
    logger.warn(`Rebuilding runtime projection: reason=${reason}`);
    const throughGlobalSeq = this.eventStore.getLatestGlobalSeq();
    this.projectionStore.upsertCheckpoint({
      projectionName: this.projectionName,
      status: 'building',
      lastFullCount: 0,
      metadata: { reason }
    });

    this.runtimeStore.beginProjectionBuild(this.projectionName);
    try {
      const rebuilt = await this.replayRange(0, throughGlobalSeq, true, undefined, false);
      this.runtimeStore.publishProjectionBuild(this.projectionName);
      this.writeCheckpoint(throughGlobalSeq, rebuilt.lastEvent, rebuilt.replayedEventCount, 'full_rebuild');
    } catch (error) {
      this.runtimeStore.discardProjectionBuild(this.projectionName);
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
        eventTypes: ['RUNTIME_STATE_UPDATED', 'RUNTIME_TRANSITION_RECORDED'],
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
      lastFullCount: this.runtimeStore.getProjectionStateCount(this.projectionName),
      status: 'ready',
      metadata: { mode, replayedEventCount },
    });
  }

  private applyEvent(event: MemoryEvent, staging = false): void {
    const payload = (event.payload || {}) as Record<string, unknown>;
    const projectId = event.projectId;
    if (projectId === undefined) {
      this.runtimeStore.recordDiscardedProjectionEvent('runtime', event, 'legacy_event_scope_unproven');
      return;
    }
    if (payload.projectId !== undefined && payload.projectId !== projectId) {
      this.runtimeStore.recordDiscardedProjectionEvent('runtime', event, 'event_payload_scope_mismatch');
      return;
    }

    switch (event.eventType) {
      case 'RUNTIME_STATE_UPDATED':
        if (!isNonEmptyString(payload.runtimeId)
          || !isRuntimeEntityType(payload.entityType)
          || !isNonEmptyString(payload.entityKey)
          || !isRuntimeStatus(payload.status)
          || !isOptionalRecord(payload.metadata)) {
          this.runtimeStore.recordDiscardedProjectionEvent('runtime', event, 'invalid_runtime_event_payload');
          return;
        }
        this.runtimeStore.applyProjectedState(this.projectionName, event.globalSeq ?? 0, {
          projectId,
          runtimeId: payload.runtimeId,
          entityType: payload.entityType,
          entityKey: payload.entityKey,
          status: payload.status,
          metadata: payload.metadata,
          updatedAt: event.occurredAt
        }, staging);
        return;

      case 'RUNTIME_TRANSITION_RECORDED':
        if (!isNonEmptyString(payload.transitionId)
          || !isNonEmptyString(payload.runtimeId)
          || !isRuntimeEntityType(payload.entityType)
          || !isNonEmptyString(payload.entityKey)
          || !isNonEmptyString(payload.transitionType)
          || !isRuntimeTransitionStatus(payload.toStatus)
          || (payload.fromStatus !== undefined && !isRuntimeTransitionStatus(payload.fromStatus))
          || !isOptionalRecord(payload.data)) {
          this.runtimeStore.recordDiscardedProjectionEvent('runtime', event, 'invalid_runtime_event_payload');
          return;
        }
        this.runtimeStore.applyProjectedTransition(this.projectionName, payload.transitionId, event.eventId, event.globalSeq ?? 0, {
          projectId,
          runtimeId: payload.runtimeId,
          entityType: payload.entityType,
          entityKey: payload.entityKey,
          transitionType: payload.transitionType,
          fromStatus: payload.fromStatus,
          toStatus: payload.toStatus,
          payload: payload.data,
          occurredAt: event.occurredAt
        }, staging);
        return;

      default:
        return;
    }
  }

}

const RUNTIME_ENTITY_TYPES = new Set<RuntimeEntityType>(['step', 'merge', 'validation', 'policy', 'executor', 'state_machine']);
const RUNTIME_STATUSES = new Set<RuntimeStatus>(['ready', 'blocked', 'pending', 'matched', 'missing']);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRuntimeEntityType(value: unknown): value is RuntimeEntityType {
  return typeof value === 'string' && RUNTIME_ENTITY_TYPES.has(value as RuntimeEntityType);
}

function isRuntimeStatus(value: unknown): value is RuntimeStatus {
  return typeof value === 'string' && RUNTIME_STATUSES.has(value as RuntimeStatus);
}

function isRuntimeTransitionStatus(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function isOptionalRecord(value: unknown): value is Record<string, unknown> | undefined {
  return value === undefined || (typeof value === 'object' && value !== null && !Array.isArray(value));
}
