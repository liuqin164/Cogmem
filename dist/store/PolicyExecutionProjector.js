import { logger } from '../utils/Logger.js';
export class PolicyExecutionProjector {
    eventStore;
    executionStore;
    projectionStore;
    projectId;
    projectionName;
    constructor(eventStore, executionStore, projectionStore, projectId, projectionName = `policy_execution_projection:${projectId.length}:${projectId}`) {
        this.eventStore = eventStore;
        this.executionStore = executionStore;
        this.projectionStore = projectionStore;
        this.projectId = projectId;
        this.projectionName = projectionName;
    }
    async bootstrap() {
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
        }
        catch (error) {
            logger.warn('Policy execution replay failed, falling back to full rebuild', error);
            await this.fullRebuild('replay_failed');
        }
    }
    async fullRebuild(reason) {
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
    async replay(events, previousRebuildAt) {
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
    applyEvent(event) {
        const payload = (event.payload || {});
        if (event.eventType !== 'POLICY_EXECUTION_UPDATED')
            return;
        if (!payload.executionId || !payload.idempotencyKey || !payload.policy || !payload.action || !payload.status)
            return;
        this.executionStore.upsert({
            executionId: String(payload.executionId),
            projectId: event.projectId,
            idempotencyKey: String(payload.idempotencyKey),
            runtimeId: payload.runtimeId ? String(payload.runtimeId) : undefined,
            policy: String(payload.policy),
            action: String(payload.action),
            target: payload.target ? String(payload.target) : undefined,
            status: String(payload.status),
            attemptCount: Number(payload.attemptCount || 0),
            nextRetryAt: payload.nextRetryAt ? Number(payload.nextRetryAt) : undefined,
            deadLetteredAt: payload.deadLetteredAt ? Number(payload.deadLetteredAt) : undefined,
            replayPolicy: payload.replayPolicy ? String(payload.replayPolicy) : undefined,
            actorId: payload.actorId ? String(payload.actorId) : undefined,
            causationId: payload.causationId ? String(payload.causationId) : undefined,
            correlationId: payload.correlationId ? String(payload.correlationId) : event.correlationId,
            policyGroup: payload.policyGroup ? String(payload.policyGroup) : undefined,
            streamType: payload.streamType ? String(payload.streamType) : event.streamType,
            eventType: payload.eventType ? String(payload.eventType) : event.eventType,
            detail: payload.detail ? String(payload.detail) : undefined,
            metadata: payload.metadata,
            createdAt: Number(payload.createdAt || event.occurredAt),
            updatedAt: Number(payload.updatedAt || event.occurredAt)
        }, { emitEvent: false });
    }
    isPolicyExecutionEvent(event) {
        return event.eventType === 'POLICY_EXECUTION_UPDATED' && event.projectId === this.projectId;
    }
}
