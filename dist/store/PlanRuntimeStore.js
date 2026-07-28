import Database from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
export class PlanRuntimeStore {
    db;
    eventStore;
    constructor(dbPath = ':memory:', eventStore) {
        this.db = new Database(dbPath);
        this.eventStore = eventStore;
        this.initializeSchema();
        this.flushEventOutbox();
    }
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_states (
        runtime_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata_json TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (runtime_id, entity_type, entity_key)
      );

      CREATE INDEX IF NOT EXISTS idx_runtime_states_runtime
        ON runtime_states(runtime_id, entity_type, updated_at DESC);

      CREATE TABLE IF NOT EXISTS runtime_transitions (
        transition_id TEXT PRIMARY KEY,
        runtime_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        transition_type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        payload_json TEXT,
        occurred_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_runtime_transitions_runtime
        ON runtime_transitions(runtime_id, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS runtime_event_outbox (
        outbox_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runtime_projection_states (
        projection_name TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata_json TEXT,
        updated_at INTEGER NOT NULL,
        source_global_seq INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (projection_name, runtime_id, entity_type, entity_key)
      );

      CREATE TABLE IF NOT EXISTS runtime_projection_transitions (
        projection_name TEXT NOT NULL,
        transition_id TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        transition_type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        payload_json TEXT,
        occurred_at INTEGER NOT NULL,
        PRIMARY KEY (projection_name, transition_id)
      );
    `);
    }
    upsertState(input, options) {
        const updatedAt = input.updatedAt ?? Date.now();
        this.db.transaction(() => {
            const existing = this.getState(input.runtimeId, input.entityType, input.entityKey);
            this.db.prepare(`
        INSERT OR REPLACE INTO runtime_states (
          runtime_id, entity_type, entity_key, status, metadata_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(input.runtimeId, input.entityType, input.entityKey, input.status, input.metadata ? JSON.stringify(input.metadata) : null, updatedAt);
            if (!existing || existing.status !== input.status) {
                this.insertTransition({
                    runtimeId: input.runtimeId,
                    entityType: input.entityType,
                    entityKey: input.entityKey,
                    transitionType: 'state_update',
                    fromStatus: existing?.status,
                    toStatus: input.status,
                    payload: input.metadata,
                    occurredAt: updatedAt
                }, options?.emitEvent !== false);
            }
            if (options?.emitEvent !== false)
                this.enqueueEvent({
                    streamId: `${input.runtimeId}:${input.entityType}:${input.entityKey}`,
                    streamType: 'system',
                    eventType: 'RUNTIME_STATE_UPDATED',
                    occurredAt: updatedAt,
                    payload: {
                        runtimeId: input.runtimeId,
                        entityType: input.entityType,
                        entityKey: input.entityKey,
                        status: input.status,
                        metadata: input.metadata
                    }
                });
        })();
        this.flushEventOutbox();
    }
    recordTransition(input, options) {
        this.db.transaction(() => this.insertTransition(input, options?.emitEvent !== false))();
        this.flushEventOutbox();
    }
    insertTransition(input, emitEvent) {
        const occurredAt = input.occurredAt ?? Date.now();
        const transitionId = `rt-${randomUUID()}`;
        this.db.prepare(`
      INSERT INTO runtime_transitions (
        transition_id, runtime_id, entity_type, entity_key, transition_type,
        from_status, to_status, payload_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(transitionId, input.runtimeId, input.entityType, input.entityKey, input.transitionType, input.fromStatus || null, input.toStatus, input.payload ? JSON.stringify(input.payload) : null, occurredAt);
        if (emitEvent)
            this.enqueueEvent({
                streamId: `${input.runtimeId}:${input.entityType}:${input.entityKey}`,
                streamType: 'system',
                eventType: 'RUNTIME_TRANSITION_RECORDED',
                occurredAt,
                payload: {
                    runtimeId: input.runtimeId,
                    entityType: input.entityType,
                    entityKey: input.entityKey,
                    transitionType: input.transitionType,
                    fromStatus: input.fromStatus,
                    toStatus: input.toStatus,
                    data: input.payload
                }
            });
    }
    enqueueEvent(input) {
        const outboxId = `evt-runtime-${randomUUID()}`;
        this.db.prepare(`INSERT INTO runtime_event_outbox(outbox_id,payload_json,created_at) VALUES(?,?,?)`)
            .run(outboxId, JSON.stringify({ ...input, eventId: outboxId }), Date.now());
    }
    flushEventOutbox() {
        if (!this.eventStore)
            return;
        const rows = this.db.prepare(`
      SELECT outbox_id,payload_json FROM runtime_event_outbox ORDER BY created_at,outbox_id
    `).all();
        for (const row of rows) {
            try {
                if (!this.eventStore.getEvent(row.outbox_id)) {
                    this.eventStore.append(JSON.parse(row.payload_json));
                }
                this.db.prepare(`DELETE FROM runtime_event_outbox WHERE outbox_id=?`).run(row.outbox_id);
            }
            catch {
                break;
            }
        }
    }
    getState(runtimeId, entityType, entityKey) {
        const row = this.db.prepare(`
      SELECT runtime_id, entity_type, entity_key, status, metadata_json, updated_at
      FROM runtime_states
      WHERE runtime_id = ? AND entity_type = ? AND entity_key = ?
    `).get(runtimeId, entityType, entityKey);
        if (!row)
            return null;
        return {
            runtimeId: row.runtime_id,
            entityType: row.entity_type,
            entityKey: row.entity_key,
            status: row.status,
            metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
            updatedAt: row.updated_at
        };
    }
    getSnapshot(runtimeId) {
        const states = this.db.prepare(`
      SELECT runtime_id, entity_type, entity_key, status, metadata_json, updated_at
      FROM runtime_states
      WHERE runtime_id = ?
      ORDER BY entity_type ASC, entity_key ASC
    `).all(runtimeId);
        const transitions = this.db.prepare(`
      SELECT transition_id, runtime_id, entity_type, entity_key, transition_type,
             from_status, to_status, payload_json, occurred_at
      FROM runtime_transitions
      WHERE runtime_id = ?
      ORDER BY occurred_at ASC, transition_id ASC
    `).all(runtimeId);
        return {
            runtimeId,
            states: states.map((row) => ({
                runtimeId: row.runtime_id,
                entityType: row.entity_type,
                entityKey: row.entity_key,
                status: row.status,
                metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
                updatedAt: row.updated_at
            })),
            transitions: transitions.map((row) => ({
                transitionId: row.transition_id,
                runtimeId: row.runtime_id,
                entityType: row.entity_type,
                entityKey: row.entity_key,
                transitionType: row.transition_type,
                fromStatus: row.from_status || undefined,
                toStatus: row.to_status,
                payload: row.payload_json ? JSON.parse(row.payload_json) : undefined,
                occurredAt: row.occurred_at
            }))
        };
    }
    getHistoryPage(runtimeId, page = 1, pageSize = 20, filters) {
        const safePage = Math.max(page, 1);
        const safePageSize = Math.max(pageSize, 1);
        const offset = (safePage - 1) * safePageSize;
        const transitionConds = ['runtime_id = ?'];
        const transitionParams = [runtimeId];
        const stateConds = ['runtime_id = ?'];
        const stateParams = [runtimeId];
        if (filters?.entityTypes && filters.entityTypes.length > 0) {
            const placeholders = filters.entityTypes.map(() => '?').join(', ');
            transitionConds.push(`entity_type IN (${placeholders})`);
            stateConds.push(`entity_type IN (${placeholders})`);
            transitionParams.push(...filters.entityTypes);
            stateParams.push(...filters.entityTypes);
        }
        if (filters?.transitionTypes && filters.transitionTypes.length > 0) {
            const placeholders = filters.transitionTypes.map(() => '?').join(', ');
            transitionConds.push(`transition_type IN (${placeholders})`);
            transitionParams.push(...filters.transitionTypes);
        }
        if (filters?.status && filters.status.length > 0) {
            const placeholders = filters.status.map(() => '?').join(', ');
            stateConds.push(`status IN (${placeholders})`);
            stateParams.push(...filters.status);
        }
        if (filters?.startTime !== undefined) {
            transitionConds.push('occurred_at >= ?');
            stateConds.push('updated_at >= ?');
            transitionParams.push(filters.startTime);
            stateParams.push(filters.startTime);
        }
        if (filters?.endTime !== undefined) {
            transitionConds.push('occurred_at <= ?');
            stateConds.push('updated_at <= ?');
            transitionParams.push(filters.endTime);
            stateParams.push(filters.endTime);
        }
        const totalRow = this.db.prepare(`
      SELECT COUNT(*) AS count FROM runtime_transitions WHERE ${transitionConds.join(' AND ')}
    `).get(...transitionParams);
        const transitions = this.db.prepare(`
      SELECT transition_id, runtime_id, entity_type, entity_key, transition_type,
             from_status, to_status, payload_json, occurred_at
      FROM runtime_transitions
      WHERE ${transitionConds.join(' AND ')}
      ORDER BY occurred_at DESC, transition_id DESC
      LIMIT ? OFFSET ?
    `).all(...transitionParams, safePageSize, offset);
        const states = this.db.prepare(`
      SELECT runtime_id, entity_type, entity_key, status, metadata_json, updated_at
      FROM runtime_states
      WHERE ${stateConds.join(' AND ')}
      ORDER BY updated_at DESC, entity_type ASC, entity_key ASC
    `).all(...stateParams);
        return {
            runtimeId,
            page: safePage,
            pageSize: safePageSize,
            totalTransitions: totalRow?.count || 0,
            transitions: transitions.map((row) => ({
                transitionId: row.transition_id,
                runtimeId: row.runtime_id,
                entityType: row.entity_type,
                entityKey: row.entity_key,
                transitionType: row.transition_type,
                fromStatus: row.from_status || undefined,
                toStatus: row.to_status,
                payload: row.payload_json ? JSON.parse(row.payload_json) : undefined,
                occurredAt: row.occurred_at
            })),
            currentStates: states.map((row) => ({
                runtimeId: row.runtime_id,
                entityType: row.entity_type,
                entityKey: row.entity_key,
                status: row.status,
                metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
                updatedAt: row.updated_at
            })),
            appliedFilters: {
                entityTypes: filters?.entityTypes,
                transitionTypes: filters?.transitionTypes,
                status: filters?.status,
                startTime: filters?.startTime,
                endTime: filters?.endTime
            }
        };
    }
    getStateCount() {
        const row = this.db.prepare(`SELECT COUNT(*) AS count FROM runtime_states`).get();
        return row?.count || 0;
    }
    applyProjectedState(projectionName, sourceGlobalSeq, input) {
        this.db.prepare(`
      INSERT INTO runtime_projection_states (
        projection_name, runtime_id, entity_type, entity_key, status, metadata_json, updated_at, source_global_seq
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(projection_name, runtime_id, entity_type, entity_key) DO UPDATE SET
        status=excluded.status,
        metadata_json=excluded.metadata_json,
        updated_at=excluded.updated_at,
        source_global_seq=excluded.source_global_seq
      WHERE excluded.source_global_seq >= runtime_projection_states.source_global_seq
    `).run(projectionName, input.runtimeId, input.entityType, input.entityKey, input.status, input.metadata ? JSON.stringify(input.metadata) : null, input.updatedAt, sourceGlobalSeq);
    }
    applyProjectedTransition(projectionName, sourceEventId, input) {
        this.db.prepare(`
      INSERT OR IGNORE INTO runtime_projection_transitions (
        projection_name, transition_id, runtime_id, entity_type, entity_key,
        transition_type, from_status, to_status, payload_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(projectionName, sourceEventId, input.runtimeId, input.entityType, input.entityKey, input.transitionType, input.fromStatus ?? null, input.toStatus, input.payload ? JSON.stringify(input.payload) : null, input.occurredAt);
    }
    clearProjection(projectionName) {
        this.db.transaction(() => {
            this.db.prepare(`DELETE FROM runtime_projection_states WHERE projection_name = ?`).run(projectionName);
            this.db.prepare(`DELETE FROM runtime_projection_transitions WHERE projection_name = ?`).run(projectionName);
        })();
    }
    getProjectionStateCount(projectionName) {
        const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM runtime_projection_states WHERE projection_name = ?
    `).get(projectionName);
        return row?.count ?? 0;
    }
    clearAll() {
        this.db.exec(`
      DELETE FROM runtime_states;
      DELETE FROM runtime_transitions;
    `);
    }
    close() {
        this.db.close();
    }
}
