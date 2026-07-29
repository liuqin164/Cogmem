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
        }
        catch (error) {
            logger.warn('Runtime replay failed, falling back to full rebuild', error);
            await this.fullRebuild('replay_failed');
        }
    }
    async fullRebuild(reason) {
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
        }
        catch (error) {
            this.runtimeStore.discardProjectionBuild(this.projectionName);
            throw error;
        }
    }
    async replay(events, previousRebuildAt) {
        logger.info(`Replaying runtime projection events: count=${events.length}`);
        for (const event of events.filter((item) => this.isRuntimeEvent(item)))
            this.applyEvent(event);
        const lastEvent = events[events.length - 1];
        this.projectionStore.upsertCheckpoint({
            projectionName: this.projectionName,
            lastEventId: lastEvent?.eventId,
            lastEventTime: lastEvent?.occurredAt,
            lastGlobalSeq: lastEvent?.globalSeq ?? 0,
            lastRebuildAt: previousRebuildAt ?? Date.now(),
            lastFullCount: this.runtimeStore.getProjectionStateCount(this.projectionName),
            status: 'ready',
            metadata: {
                mode: 'incremental_replay',
                replayedEventCount: events.length
            }
        });
    }
    async replayRange(afterGlobalSeq, throughGlobalSeq, staging, previousRebuildAt, updateCheckpoint = true) {
        let cursor = afterGlobalSeq;
        let replayedEventCount = 0;
        let lastEvent;
        for (;;) {
            const page = this.eventStore.getEventsByGlobalSeqPage({
                afterGlobalSeq: cursor,
                throughGlobalSeq,
                eventTypes: ['RUNTIME_STATE_UPDATED', 'RUNTIME_TRANSITION_RECORDED'],
                limit: 500,
            });
            if (page.length === 0)
                break;
            for (const event of page)
                this.applyEvent(event, staging);
            lastEvent = page[page.length - 1];
            cursor = lastEvent?.globalSeq ?? cursor;
            replayedEventCount += page.length;
            await Promise.resolve();
        }
        if (updateCheckpoint)
            this.writeCheckpoint(throughGlobalSeq, lastEvent, replayedEventCount, staging ? 'full_rebuild' : 'incremental_replay', previousRebuildAt);
        return { lastEvent, replayedEventCount };
    }
    writeCheckpoint(throughGlobalSeq, lastEvent, replayedEventCount, mode, previousRebuildAt) {
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
    applyEvent(event, staging = false) {
        const payload = (event.payload || {});
        const projectId = event.projectId ?? (typeof payload.projectId === 'string' ? payload.projectId : '');
        switch (event.eventType) {
            case 'RUNTIME_STATE_UPDATED':
                if (!payload.runtimeId || !payload.entityType || !payload.entityKey || !payload.status)
                    return;
                this.runtimeStore.applyProjectedState(this.projectionName, event.globalSeq ?? 0, {
                    projectId,
                    runtimeId: String(payload.runtimeId),
                    entityType: String(payload.entityType),
                    entityKey: String(payload.entityKey),
                    status: String(payload.status),
                    metadata: payload.metadata || undefined,
                    updatedAt: event.occurredAt
                }, staging);
                return;
            case 'RUNTIME_TRANSITION_RECORDED':
                if (!payload.runtimeId || !payload.entityType || !payload.entityKey || !payload.transitionType || !payload.toStatus)
                    return;
                this.runtimeStore.applyProjectedTransition(this.projectionName, event.eventId, event.globalSeq ?? 0, {
                    projectId,
                    runtimeId: String(payload.runtimeId),
                    entityType: String(payload.entityType),
                    entityKey: String(payload.entityKey),
                    transitionType: String(payload.transitionType),
                    fromStatus: payload.fromStatus ? String(payload.fromStatus) : undefined,
                    toStatus: String(payload.toStatus),
                    payload: payload.data || undefined,
                    occurredAt: event.occurredAt
                }, staging);
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
