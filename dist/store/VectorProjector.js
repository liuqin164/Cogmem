import { logger } from '../utils/Logger.js';
/**
 * 基于 memory_events 的最小向量投影器。
 * 目标：
 * - 启动时优先 replay 增量事件
 * - 只有在 checkpoint 不可信时才 full rebuild
 */
export class VectorProjector {
    eventStore;
    memoryGraph;
    vectorStore;
    projectionName;
    constructor(eventStore, memoryGraph, vectorStore, projectionName = 'hnsw_main') {
        this.eventStore = eventStore;
        this.memoryGraph = memoryGraph;
        this.vectorStore = vectorStore;
        this.projectionName = projectionName;
    }
    async bootstrap() {
        const checkpoint = this.eventStore.getProjectionCheckpoint(this.projectionName);
        const pendingEvents = this.eventStore.getEventsAfterGlobalSeq(checkpoint?.lastGlobalSeq);
        if (!checkpoint || checkpoint.lastGlobalSeq === undefined) {
            await this.fullRebuild('initial_build');
            return;
        }
        if (checkpoint.status !== 'ready') {
            await this.fullRebuild(`checkpoint_${checkpoint.status}`);
            return;
        }
        if (pendingEvents.length === 0) {
            logger.info(`Vector projection ready: count=${checkpoint.lastFullCount}`);
            return;
        }
        try {
            await this.replay(pendingEvents, checkpoint.lastRebuildAt);
        }
        catch (error) {
            logger.warn('Vector replay failed, falling back to full rebuild', error);
            await this.fullRebuild('replay_failed');
        }
    }
    async fullRebuild(reason) {
        logger.warn(`Rebuilding vector projection from SQLite: reason=${reason}`);
        this.eventStore.upsertProjectionCheckpoint({
            projectionName: this.projectionName,
            status: 'building',
            lastFullCount: 0,
            metadata: { reason }
        });
        const pageSize = 2000;
        const vectors = new Map();
        let pageNo = 0;
        let sourceGlobalSeq = this.eventStore.getLatestGlobalSeq();
        await this.memoryGraph.forEachNeuronVectorPage(pageSize, async (rows) => {
            pageNo += 1;
            for (const row of rows) {
                if (row.vector.length === 0)
                    continue;
                vectors.set(row.id, row.vector);
            }
            if (pageNo % 10 === 0) {
                logger.info(`Vector rebuild progress: pages=${pageNo}, indexed=${vectors.size}`);
            }
            await Promise.resolve();
        }, { includeStatuses: ['active', 'cold'], onlyNotDeleted: true });
        let throughGlobalSeq = this.eventStore.getLatestGlobalSeq();
        for (const event of this.eventStore.getEventsAfterGlobalSeq(sourceGlobalSeq, throughGlobalSeq)) {
            this.applyEventToMap(vectors, event);
        }
        await this.vectorStore.rebuildIndex([...vectors].map(([id, vector]) => ({ id, vector })));
        while (true) {
            const latestGlobalSeq = this.eventStore.getLatestGlobalSeq();
            if (latestGlobalSeq <= throughGlobalSeq)
                break;
            const events = this.eventStore.getEventsAfterGlobalSeq(throughGlobalSeq, latestGlobalSeq);
            for (const event of events)
                this.applyEvent(event);
            throughGlobalSeq = latestGlobalSeq;
            await Promise.resolve();
        }
        const latestEvent = this.eventStore.getEventsAfterGlobalSeq(undefined, throughGlobalSeq).at(-1);
        this.eventStore.upsertProjectionCheckpoint({
            projectionName: this.projectionName,
            lastEventId: latestEvent?.eventId,
            lastEventTime: latestEvent?.occurredAt,
            lastGlobalSeq: throughGlobalSeq,
            lastRebuildAt: Date.now(),
            lastFullCount: this.vectorStore.getCurrentCount(),
            status: 'ready',
            metadata: {
                reason,
                mode: 'full_rebuild'
            }
        });
    }
    async replay(events, previousRebuildAt) {
        if (events.length === 0)
            return;
        logger.info(`Replaying vector projection events: count=${events.length}`);
        for (const event of events) {
            this.applyEvent(event);
            await Promise.resolve();
        }
        const lastEvent = events[events.length - 1];
        this.eventStore.upsertProjectionCheckpoint({
            projectionName: this.projectionName,
            lastEventId: lastEvent?.eventId,
            lastEventTime: lastEvent?.occurredAt,
            lastGlobalSeq: lastEvent?.globalSeq ?? this.eventStore.getLatestGlobalSeq(),
            lastRebuildAt: previousRebuildAt,
            lastFullCount: this.vectorStore.getCurrentCount(),
            status: 'ready',
            metadata: {
                mode: 'incremental_replay',
                replayedEventCount: events.length
            }
        });
    }
    applyEvent(event) {
        switch (event.eventType) {
            case 'INGESTED':
            case 'RESTORED': {
                const neuron = this.memoryGraph.getNeuron(event.streamId);
                if (!neuron)
                    return;
                if (neuron.metadata.status === 'archived')
                    return;
                if (!neuron.coordinates.V || neuron.coordinates.V.length === 0)
                    return;
                this.vectorStore.addVector(neuron.id, neuron.coordinates.V);
                return;
            }
            case 'ARCHIVED': {
                this.vectorStore.removePoint(event.streamId);
                return;
            }
            default:
                return;
        }
    }
    applyEventToMap(vectors, event) {
        switch (event.eventType) {
            case 'INGESTED':
            case 'RESTORED': {
                const neuron = this.memoryGraph.getNeuron(event.streamId);
                if (!neuron || neuron.metadata.status === 'archived' || !neuron.coordinates.V?.length) {
                    vectors.delete(event.streamId);
                    return;
                }
                vectors.set(neuron.id, neuron.coordinates.V);
                return;
            }
            case 'ARCHIVED':
                vectors.delete(event.streamId);
                return;
        }
    }
}
