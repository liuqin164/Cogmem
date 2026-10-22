/**
 * SQLite implementations of the domain ports.
 *
 * These adapters delegate to the existing stores. They exist to fix the
 * boundary, not to reimplement behavior: every method forwards to the code
 * that already ships, so the SQLite path stays the behavioral oracle a future
 * backend must match.
 */
import { EventStore } from '../../store/EventStore.js';
import { EpisodeStore } from '../../episode/EpisodeStore.js';
import { MemoryBindingStore } from '../../store/MemoryBindingStore.js';
import { MemoryBindingService } from '../../binding/MemoryBindingService.js';
import { SqliteSharedMemory } from './SqliteSharedMemory.js';
class SqliteRawLedger {
    store;
    db;
    constructor(store, db) {
        this.store = store;
        this.db = db;
    }
    async appendEvent(input) {
        return this.store.append(input);
    }
    async appendBatch(inputs) {
        // One transaction so a mid-batch failure leaves no partial archive.
        return this.db.transaction(() => inputs.map((input) => this.store.append(input)))();
    }
    async getEvent(eventId) {
        return this.store.getEvent(eventId);
    }
    async listBySeq(from, through) {
        return this.store.getEventsAfterGlobalSeq(from - 1, through);
    }
    async count() {
        return this.store.getEventCount();
    }
}
class SqliteEpisodes {
    store;
    constructor(store) {
        this.store = store;
    }
    async create(input) {
        return this.store.createEpisode(input);
    }
    async appendEvent(command) {
        this.store.appendEvent({
            episodeId: command.episodeId,
            eventId: command.eventId,
            relation: command.relation,
            confidence: command.confidence,
            globalSeq: command.globalSeq,
            occurredAt: command.occurredAt,
            summaryText: command.summaryText,
        });
    }
    async seal(episodeId, command) {
        this.store.sealEpisode(episodeId, {
            mode: command.mode,
            reason: command.reason,
            reasonCode: command.reasonCode,
            reasonDetail: command.reasonDetail,
            requiresReview: command.requiresReview,
            now: command.now,
        });
        const sealed = this.store.getEpisode(episodeId);
        if (!sealed)
            throw new Error(`episode_not_found_after_seal:${episodeId}`);
        return sealed;
    }
    async get(episodeId) {
        return this.store.getEpisode(episodeId) ?? null;
    }
    async list(options = {}) {
        return this.store.listEpisodes(options);
    }
}
class SqliteGraph {
    service;
    constructor(service) {
        this.service = service;
    }
    async bindEvent(input) {
        return this.service.bindEvent(input);
    }
    async bindRawEvent(event) {
        return this.service.bindRawEvent(event);
    }
    async anchors(query, options = {}) {
        return this.service.recallGraphAnchors(query, options);
    }
}
class SqliteRecall {
    recallEngine;
    constructor(recallEngine) {
        this.recallEngine = recallEngine;
    }
    async recall(query, options = {}) {
        return this.recallEngine.recallAsync(query, options);
    }
}
class SqliteGovernance {
    executor;
    constructor(executor) {
        this.executor = executor;
    }
    async commit(plan) {
        return this.executor.execute(plan);
    }
}
export function createSqlitePorts(options) {
    const { db } = options;
    const events = new EventStore(db);
    const episodes = new EpisodeStore(db, (eventId) => events.getEvent(eventId));
    const bindings = new MemoryBindingService(new MemoryBindingStore(db));
    return {
        rawLedger: new SqliteRawLedger(events, db),
        episodes: new SqliteEpisodes(episodes),
        graph: new SqliteGraph(bindings),
        recall: options.recall ? new SqliteRecall(options.recall) : null,
        governance: options.governance ? new SqliteGovernance(options.governance) : null,
        shared: options.shared ?? new SqliteSharedMemory(db),
    };
}
