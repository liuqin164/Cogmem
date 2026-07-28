import { logger } from '../utils/Logger.js';
export class RuntimeProjector {
    eventStore;
    runtimeStore;
    projectionStore;
    projectionName;
    constructor(eventStore, runtimeStore, projectionStore, projectionName = 'runtime_projection_main') {
        this.eventStore = eventStore;
        this.runtimeStore = runtimeStore;
        this.projectionStore = projectionStore;
        this.projectionName = projectionName;
    }
    async bootstrap() {
        const checkpoint = this.projectionStore.getCheckpoint(this.projectionName);
        const pendingEvents = this.eventStore.getEventsAfterGlobalSeq(checkpoint?.lastGlobalSeq)
            .filter((event) => this.isRuntimeEvent(event));
        if (!checkpoint || checkpoint.lastGlobalSeq === undefined) {
            await this.fullRebuild('initial_build');
            return;
        }
        if (checkpoint.status !== 'ready') {
            await this.fullRebuild(`checkpoint_${checkpoint.status}`);
            return;
        }
        if (pendingEvents.length === 0) {
            logger.info(`Runtime projection ready: projection=${this.projectionName}`);
            return;
        }
        try {
            await this.replay(pendingEvents, checkpoint.lastRebuildAt);
        }
        catch (error) {
            logger.warn('Runtime replay failed, falling back to full rebuild', error);
            await this.fullRebuild('replay_failed');
        }
    }
    async fullRebuild(reason) {
        logger.warn(`Rebuilding runtime projection: reason=${reason}`);
        this.projectionStore.upsertCheckpoint({
            projectionName: this.projectionName,
            status: 'building',
            lastFullCount: 0,
            metadata: { reason }
        });
        this.runtimeStore.clearProjection(this.projectionName);
        const runtimeEvents = this.eventStore.getEventsAfterGlobalSeq(undefined).filter((event) => this.isRuntimeEvent(event));
        await this.replay(runtimeEvents);
    }
    async replay(events, previousRebuildAt) {
        if (events.length === 0) {
            const latestEvent = this.eventStore.getLatestEvent();
            this.projectionStore.upsertCheckpoint({
                projectionName: this.projectionName,
                lastEventId: latestEvent?.eventId,
                lastEventTime: latestEvent?.occurredAt,
                lastGlobalSeq: this.eventStore.getLatestGlobalSeq(),
                lastRebuildAt: previousRebuildAt ?? Date.now(),
                lastFullCount: this.runtimeStore.getProjectionStateCount(this.projectionName),
                status: 'ready',
                metadata: { mode: 'incremental_replay', replayedEventCount: 0 }
            });
            return;
        }
        logger.info(`Replaying runtime projection events: count=${events.length}`);
        for (const event of events) {
            this.applyEvent(event);
            await Promise.resolve();
        }
        const lastEvent = events[events.length - 1];
        this.projectionStore.upsertCheckpoint({
            projectionName: this.projectionName,
            lastEventId: lastEvent?.eventId,
            lastEventTime: lastEvent?.occurredAt,
            lastGlobalSeq: lastEvent?.globalSeq ?? this.eventStore.getLatestGlobalSeq(),
            lastRebuildAt: previousRebuildAt ?? Date.now(),
            lastFullCount: this.runtimeStore.getProjectionStateCount(this.projectionName),
            status: 'ready',
            metadata: {
                mode: 'incremental_replay',
                replayedEventCount: events.length
            }
        });
    }
    applyEvent(event) {
        const payload = (event.payload || {});
        switch (event.eventType) {
            case 'RUNTIME_STATE_UPDATED':
                if (!payload.runtimeId || !payload.entityType || !payload.entityKey || !payload.status)
                    return;
                this.runtimeStore.applyProjectedState(this.projectionName, event.globalSeq ?? 0, {
                    runtimeId: String(payload.runtimeId),
                    entityType: String(payload.entityType),
                    entityKey: String(payload.entityKey),
                    status: String(payload.status),
                    metadata: payload.metadata || undefined,
                    updatedAt: event.occurredAt
                });
                return;
            case 'RUNTIME_TRANSITION_RECORDED':
                if (!payload.runtimeId || !payload.entityType || !payload.entityKey || !payload.transitionType || !payload.toStatus)
                    return;
                this.runtimeStore.applyProjectedTransition(this.projectionName, event.eventId, {
                    runtimeId: String(payload.runtimeId),
                    entityType: String(payload.entityType),
                    entityKey: String(payload.entityKey),
                    transitionType: String(payload.transitionType),
                    fromStatus: payload.fromStatus ? String(payload.fromStatus) : undefined,
                    toStatus: String(payload.toStatus),
                    payload: payload.data || undefined,
                    occurredAt: event.occurredAt
                });
                return;
            default:
                return;
        }
    }
    isRuntimeEvent(event) {
        return event.eventType === 'RUNTIME_STATE_UPDATED'
            || event.eventType === 'RUNTIME_TRANSITION_RECORDED';
    }
}
