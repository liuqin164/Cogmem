import Database from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
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
        for (const table of [
            'runtime_states',
            'runtime_transitions',
            'runtime_event_outbox',
            'runtime_projection_states',
            'runtime_projection_transitions',
        ]) {
            const exists = this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
            if (!exists)
                continue;
            const columns = new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
            if (!columns.has('project_scope'))
                throw new Error(`runtime_schema_not_migrated:${table}`);
            if (table === 'runtime_event_outbox'
                && ['attempt_count', 'last_error', 'next_retry_at', 'dead_lettered_at'].some((column) => !columns.has(column))) {
                throw new Error('runtime_schema_not_migrated:runtime_event_outbox');
            }
        }
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_states (
        project_scope TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata_json TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (project_scope, runtime_id, entity_type, entity_key)
      );

      CREATE INDEX IF NOT EXISTS idx_runtime_states_scope_runtime
        ON runtime_states(project_scope, runtime_id, entity_type, updated_at DESC);

      CREATE TABLE IF NOT EXISTS runtime_transitions (
        project_scope TEXT NOT NULL,
        transition_id TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        transition_type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        payload_json TEXT,
        occurred_at INTEGER NOT NULL,
        PRIMARY KEY (project_scope, transition_id)
      );

      CREATE INDEX IF NOT EXISTS idx_runtime_transitions_scope_runtime
        ON runtime_transitions(project_scope, runtime_id, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS runtime_event_outbox (
        project_scope TEXT NOT NULL,
        outbox_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_retry_at INTEGER,
        dead_lettered_at INTEGER,
        PRIMARY KEY (project_scope, outbox_id)
      );

      CREATE TABLE IF NOT EXISTS projection_event_discard_receipts (
        projector TEXT NOT NULL, event_id TEXT NOT NULL, global_seq INTEGER NOT NULL DEFAULT 0,
        event_type TEXT NOT NULL, event_identity_hash TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(projector,event_id)
      );

      CREATE TABLE IF NOT EXISTS runtime_projection_states (
        projection_name TEXT NOT NULL,
        project_scope TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata_json TEXT,
        updated_at INTEGER NOT NULL,
        source_global_seq INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (projection_name, project_scope, runtime_id, entity_type, entity_key)
      );

      CREATE TABLE IF NOT EXISTS runtime_projection_transitions (
        projection_name TEXT NOT NULL,
        project_scope TEXT NOT NULL,
        transition_id TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        transition_type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        payload_json TEXT,
        occurred_at INTEGER NOT NULL,
        source_global_seq INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (projection_name, project_scope, transition_id)
      );
    `);
    }
    upsertState(input, options) {
        const updatedAt = input.updatedAt ?? Date.now();
        this.db.transaction(() => {
            const existing = this.getState(input.projectId, input.runtimeId, input.entityType, input.entityKey);
            this.db.prepare(`
        INSERT OR REPLACE INTO runtime_states (
          project_scope, runtime_id, entity_type, entity_key, status, metadata_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(input.projectId, input.runtimeId, input.entityType, input.entityKey, input.status, input.metadata ? JSON.stringify(input.metadata) : null, updatedAt);
            if (!existing || existing.status !== input.status) {
                this.insertTransition({
                    projectId: input.projectId,
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
                    projectId: input.projectId,
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
        project_scope, transition_id, runtime_id, entity_type, entity_key, transition_type,
        from_status, to_status, payload_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.projectId, transitionId, input.runtimeId, input.entityType, input.entityKey, input.transitionType, input.fromStatus || null, input.toStatus, input.payload ? JSON.stringify(input.payload) : null, occurredAt);
        if (emitEvent)
            this.enqueueEvent({
                projectId: input.projectId,
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
        this.db.prepare(`INSERT INTO runtime_event_outbox(project_scope,outbox_id,payload_json,created_at) VALUES(?,?,?,?)`)
            .run(input.projectId, outboxId, JSON.stringify({ ...input, eventId: outboxId }), Date.now());
    }
    recordDiscardedProjectionEvent(projector, event, reason) {
        const eventIdentityHash = createHash('sha256')
            .update(JSON.stringify({
            eventId: event.eventId,
            globalSeq: event.globalSeq ?? 0,
            streamId: event.streamId,
            streamType: event.streamType,
            eventType: event.eventType,
            eventVersion: event.eventVersion,
            projectId: event.projectId,
            occurredAt: event.occurredAt,
            payloadHash: event.payloadHash,
            causationId: event.causationId,
            correlationId: event.correlationId,
            actorId: event.actorId,
            sourceId: event.sourceId,
        }))
            .digest('hex');
        this.db.prepare(`
      INSERT OR IGNORE INTO projection_event_discard_receipts(
        projector,event_id,global_seq,event_type,event_identity_hash,reason,created_at
      ) VALUES(?,?,?,?,?,?,?)
    `).run(projector, event.eventId, event.globalSeq ?? 0, event.eventType, eventIdentityHash, reason, Date.now());
    }
    flushEventOutbox() {
        if (!this.eventStore)
            return 0;
        let flushed = 0;
        const dueAt = Date.now();
        for (;;) {
            const rows = this.db.prepare(`
        SELECT project_scope,outbox_id,payload_json,attempt_count FROM runtime_event_outbox
        WHERE dead_lettered_at IS NULL AND (next_retry_at IS NULL OR next_retry_at<=?)
        ORDER BY created_at,project_scope,outbox_id LIMIT 100
      `).all(dueAt);
            if (rows.length === 0)
                break;
            for (const row of rows) {
                try {
                    if (!this.eventStore.getEvent(row.outbox_id)) {
                        this.eventStore.append(JSON.parse(row.payload_json));
                    }
                    this.db.prepare(`DELETE FROM runtime_event_outbox WHERE project_scope=? AND outbox_id=?`)
                        .run(row.project_scope, row.outbox_id);
                    flushed += 1;
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    const attempts = row.attempt_count + 1;
                    const malformed = error instanceof SyntaxError;
                    const failedAt = Date.now();
                    this.db.prepare(`
            UPDATE runtime_event_outbox
            SET attempt_count=?,last_error=?,next_retry_at=?,dead_lettered_at=?
            WHERE project_scope=? AND outbox_id=?
          `).run(attempts, message.slice(0, 1000), malformed || attempts >= 5 ? null : failedAt + Math.min(60_000, 1000 * 2 ** (attempts - 1)), malformed || attempts >= 5 ? failedAt : null, row.project_scope, row.outbox_id);
                }
            }
        }
        return flushed;
    }
    getEventOutboxStats(projectId) {
        const scope = projectId === undefined ? '' : 'WHERE project_scope=?';
        const params = projectId === undefined ? [] : [projectId];
        const row = this.db.prepare(`
      SELECT SUM(CASE WHEN dead_lettered_at IS NULL THEN 1 ELSE 0 END) AS pending,
        MIN(CASE WHEN dead_lettered_at IS NULL THEN created_at END) AS oldest_created_at,
        SUM(CASE WHEN dead_lettered_at IS NOT NULL THEN 1 ELSE 0 END) AS dead_letter
      FROM runtime_event_outbox ${scope}
    `).get(...params);
        const errorWhere = projectId === undefined
            ? 'WHERE last_error IS NOT NULL'
            : 'WHERE project_scope=? AND last_error IS NOT NULL';
        const error = this.db.prepare(`
      SELECT last_error FROM runtime_event_outbox ${errorWhere}
      ORDER BY COALESCE(dead_lettered_at,next_retry_at,created_at) DESC LIMIT 1
    `)
            .get(...params);
        return {
            pending: Number(row.pending ?? 0),
            oldestCreatedAt: row.oldest_created_at ?? undefined,
            deadLetter: Number(row.dead_letter ?? 0),
            lastError: error?.last_error,
        };
    }
    getState(projectId, runtimeId, entityType, entityKey) {
        const row = this.db.prepare(`
      SELECT runtime_id, entity_type, entity_key, status, metadata_json, updated_at
      FROM runtime_states
      WHERE project_scope = ? AND runtime_id = ? AND entity_type = ? AND entity_key = ?
    `).get(projectId, runtimeId, entityType, entityKey);
        if (!row)
            return null;
        return {
            projectId,
            runtimeId: row.runtime_id,
            entityType: row.entity_type,
            entityKey: row.entity_key,
            status: row.status,
            metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
            updatedAt: row.updated_at
        };
    }
    getSnapshot(projectId, runtimeId) {
        const states = this.db.prepare(`
      SELECT runtime_id, entity_type, entity_key, status, metadata_json, updated_at
      FROM runtime_states
      WHERE project_scope = ? AND runtime_id = ?
      ORDER BY entity_type ASC, entity_key ASC
    `).all(projectId, runtimeId);
        const transitions = this.db.prepare(`
      SELECT transition_id, runtime_id, entity_type, entity_key, transition_type,
             from_status, to_status, payload_json, occurred_at
      FROM runtime_transitions
      WHERE project_scope = ? AND runtime_id = ?
      ORDER BY occurred_at ASC, transition_id ASC
    `).all(projectId, runtimeId);
        return {
            projectId,
            runtimeId,
            states: states.map((row) => ({
                projectId,
                runtimeId: row.runtime_id,
                entityType: row.entity_type,
                entityKey: row.entity_key,
                status: row.status,
                metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
                updatedAt: row.updated_at
            })),
            transitions: transitions.map((row) => ({
                projectId,
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
    getHistoryPage(projectId, runtimeId, page = 1, pageSize = 20, filters) {
        const safePage = Math.max(page, 1);
        const safePageSize = Math.max(pageSize, 1);
        const offset = (safePage - 1) * safePageSize;
        const transitionConds = ['project_scope = ?', 'runtime_id = ?'];
        const transitionParams = [projectId, runtimeId];
        const stateConds = ['project_scope = ?', 'runtime_id = ?'];
        const stateParams = [projectId, runtimeId];
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
            projectId,
            runtimeId,
            page: safePage,
            pageSize: safePageSize,
            totalTransitions: totalRow?.count || 0,
            transitions: transitions.map((row) => ({
                projectId,
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
                projectId,
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
    getStateCount(projectId) {
        const row = this.db.prepare(`SELECT COUNT(*) AS count FROM runtime_states WHERE project_scope=?`).get(projectId);
        return row?.count || 0;
    }
    beginProjectionBuild(projectionName) {
        this.db.exec(`
      CREATE TEMP TABLE IF NOT EXISTS runtime_projection_states_stage (
        projection_name TEXT NOT NULL, project_scope TEXT NOT NULL, runtime_id TEXT NOT NULL,
        entity_type TEXT NOT NULL, entity_key TEXT NOT NULL, status TEXT NOT NULL, metadata_json TEXT,
        updated_at INTEGER NOT NULL, source_global_seq INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(projection_name,project_scope,runtime_id,entity_type,entity_key)
      );
      CREATE TEMP TABLE IF NOT EXISTS runtime_projection_transitions_stage (
        projection_name TEXT NOT NULL, project_scope TEXT NOT NULL, transition_id TEXT NOT NULL,
        runtime_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_key TEXT NOT NULL,
        transition_type TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, payload_json TEXT,
        occurred_at INTEGER NOT NULL, source_global_seq INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(projection_name,project_scope,transition_id)
      );
    `);
        this.discardProjectionBuild(projectionName);
    }
    publishProjectionBuild(projectionName) {
        this.db.transaction(() => {
            this.db.prepare(`DELETE FROM runtime_projection_states WHERE projection_name=?`).run(projectionName);
            this.db.prepare(`DELETE FROM runtime_projection_transitions WHERE projection_name=?`).run(projectionName);
            this.db.prepare(`INSERT INTO runtime_projection_states SELECT * FROM runtime_projection_states_stage WHERE projection_name=?`).run(projectionName);
            this.db.prepare(`INSERT INTO runtime_projection_transitions SELECT * FROM runtime_projection_transitions_stage WHERE projection_name=?`).run(projectionName);
            this.discardProjectionBuild(projectionName);
        })();
    }
    discardProjectionBuild(projectionName) {
        this.db.prepare(`DELETE FROM runtime_projection_states_stage WHERE projection_name=?`).run(projectionName);
        this.db.prepare(`DELETE FROM runtime_projection_transitions_stage WHERE projection_name=?`).run(projectionName);
    }
    applyProjectedState(projectionName, sourceGlobalSeq, input, staging = false) {
        const table = staging ? 'runtime_projection_states_stage' : 'runtime_projection_states';
        this.db.prepare(`
      INSERT INTO ${table} (
        projection_name, project_scope, runtime_id, entity_type, entity_key, status, metadata_json, updated_at, source_global_seq
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(projection_name, project_scope, runtime_id, entity_type, entity_key) DO UPDATE SET
        status=excluded.status,
        metadata_json=excluded.metadata_json,
        updated_at=excluded.updated_at,
        source_global_seq=excluded.source_global_seq
      WHERE excluded.source_global_seq >= ${table}.source_global_seq
    `).run(projectionName, input.projectId, input.runtimeId, input.entityType, input.entityKey, input.status, input.metadata ? JSON.stringify(input.metadata) : null, input.updatedAt, sourceGlobalSeq);
    }
    applyProjectedTransition(projectionName, sourceEventId, sourceGlobalSeq, input, staging = false) {
        const table = staging ? 'runtime_projection_transitions_stage' : 'runtime_projection_transitions';
        this.db.prepare(`
      INSERT OR IGNORE INTO ${table} (
        projection_name, project_scope, transition_id, runtime_id, entity_type, entity_key,
        transition_type, from_status, to_status, payload_json, occurred_at, source_global_seq
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(projectionName, input.projectId, sourceEventId, input.runtimeId, input.entityType, input.entityKey, input.transitionType, input.fromStatus ?? null, input.toStatus, input.payload ? JSON.stringify(input.payload) : null, input.occurredAt, sourceGlobalSeq);
    }
    clearProjection(projectionName) {
        this.db.transaction(() => {
            this.db.prepare(`DELETE FROM runtime_projection_states WHERE projection_name = ?`).run(projectionName);
            this.db.prepare(`DELETE FROM runtime_projection_transitions WHERE projection_name = ?`).run(projectionName);
        })();
    }
    getProjectionStateCount(projectionName, projectId) {
        const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM runtime_projection_states
      WHERE projection_name = ? AND (? IS NULL OR project_scope = ?)
    `).get(projectionName, projectId ?? null, projectId ?? null);
        return row?.count ?? 0;
    }
    clearAll(projectId) {
        this.db.transaction(() => {
            this.db.prepare(`DELETE FROM runtime_states WHERE project_scope=?`).run(projectId);
            this.db.prepare(`DELETE FROM runtime_transitions WHERE project_scope=?`).run(projectId);
            this.db.prepare(`DELETE FROM runtime_event_outbox WHERE project_scope=?`).run(projectId);
        })();
    }
    close() {
        this.db.close();
    }
}
