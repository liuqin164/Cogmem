import Database from 'bun:sqlite';
import { createHash } from 'node:crypto';
export function policyExecutionStateIsValid(status, outcome) {
    if (status === 'in_progress')
        return outcome === undefined;
    if (status === 'executed' || status === 'skipped')
        return outcome === 'executed';
    return outcome === 'definitely_not_executed'
        || outcome === 'failed_before_execution'
        || outcome === 'outcome_unknown';
}
export class PolicyExecutionStore {
    db;
    ownsDb;
    eventStore;
    constructor(dbPath = ':memory:', eventStore) {
        this.db = typeof dbPath === 'string' ? new Database(dbPath) : dbPath;
        this.ownsDb = typeof dbPath === 'string';
        this.eventStore = eventStore;
        this.initializeSchema();
        this.flushAuditOutbox();
    }
    initializeSchema() {
        this.db.exec('PRAGMA busy_timeout=5000');
        const existing = this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='policy_executions'`).get();
        if (existing && (!this.hasScopedIdentity()
            || !['lease_owner', 'lease_until', 'execution_outcome'].every((column) => this.tableColumns().has(column)))) {
            throw new Error('policy_execution_schema_not_migrated');
        }
        for (const [table, columns] of [
            ['policy_execution_read_model', ['execution_outcome']],
            ['policy_execution_audit_outbox', ['attempt_count', 'last_error', 'next_retry_at', 'dead_lettered_at']],
        ]) {
            const exists = this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
            if (!exists)
                continue;
            const actual = new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
            if (columns.some((column) => !actual.has(column)))
                throw new Error(`policy_execution_schema_not_migrated:${table}`);
        }
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS policy_executions (
        execution_id TEXT PRIMARY KEY,
        project_scope TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        runtime_id TEXT,
        policy TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        status TEXT NOT NULL CHECK(status IN ('in_progress','executed','skipped','failed')),
        execution_outcome TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at INTEGER,
        dead_lettered_at INTEGER,
        replay_policy TEXT,
        actor_id TEXT,
        causation_id TEXT,
        correlation_id TEXT,
        policy_group TEXT,
        stream_type TEXT,
        event_type TEXT,
        detail TEXT,
        metadata_json TEXT,
        lease_owner TEXT,
        lease_until INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_scope, idempotency_key),
        CHECK(
          (status IN ('executed','skipped') AND execution_outcome='executed')
          OR (status='failed' AND execution_outcome IN ('definitely_not_executed','failed_before_execution','outcome_unknown'))
          OR (status='in_progress' AND execution_outcome IS NULL)
        )
      );

      CREATE INDEX IF NOT EXISTS idx_policy_executions_runtime
        ON policy_executions(project_scope, runtime_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_policy_executions_policy_group
        ON policy_executions(policy_group, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_policy_executions_actor
        ON policy_executions(actor_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_policy_executions_causation
        ON policy_executions(causation_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS policy_execution_legacy_tombstones (
        idempotency_key_hash TEXT PRIMARY KEY,
        legacy_execution_id TEXT NOT NULL,
        legacy_status TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS policy_execution_read_model (
        execution_id TEXT NOT NULL,
        project_scope TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        runtime_id TEXT,
        policy TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        status TEXT NOT NULL CHECK(status IN ('in_progress','executed','skipped','failed')),
        execution_outcome TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at INTEGER,
        dead_lettered_at INTEGER,
        replay_policy TEXT,
        actor_id TEXT,
        causation_id TEXT,
        correlation_id TEXT,
        policy_group TEXT,
        stream_type TEXT,
        event_type TEXT,
        detail TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        source_global_seq INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(project_scope,idempotency_key),
        CHECK(
          (status IN ('executed','skipped') AND execution_outcome='executed')
          OR (status='failed' AND execution_outcome IN ('definitely_not_executed','failed_before_execution','outcome_unknown'))
          OR (status='in_progress' AND execution_outcome IS NULL)
        )
      );

      CREATE TABLE IF NOT EXISTS policy_execution_audit_outbox (
        outbox_id TEXT PRIMARY KEY,
        project_scope TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_retry_at INTEGER,
        dead_lettered_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS projection_event_discard_receipts (
        projector TEXT NOT NULL, event_id TEXT NOT NULL, global_seq INTEGER NOT NULL DEFAULT 0,
        event_type TEXT NOT NULL, event_identity_hash TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(projector,event_id)
      );
    `);
    }
    getByIdempotencyKey(projectId, idempotencyKey) {
        const row = this.db.prepare(`
      SELECT * FROM policy_executions WHERE project_scope = ? AND idempotency_key = ?
    `).get(projectId, idempotencyKey);
        return row ? this.mapRow(row) : null;
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
    claim(seed, leaseOwner, leaseUntil, now = Date.now()) {
        return this.db.transaction(() => {
            const keyHash = createHash('sha256').update(seed.idempotencyKey).digest('hex');
            if (this.db.prepare(`SELECT 1 FROM policy_execution_legacy_tombstones WHERE idempotency_key_hash=?`).get(keyHash)) {
                return { kind: 'ambiguous' };
            }
            const inserted = this.db.prepare(`
        INSERT INTO policy_executions (
          execution_id,project_scope,idempotency_key,runtime_id,policy,action,target,status,
          execution_outcome,attempt_count,next_retry_at,dead_lettered_at,replay_policy,actor_id,causation_id,
          correlation_id,policy_group,stream_type,event_type,detail,metadata_json,
          lease_owner,lease_until,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,'in_progress',NULL,?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(project_scope,idempotency_key) DO NOTHING
      `).run(seed.executionId, seed.projectId, seed.idempotencyKey, seed.runtimeId ?? null, seed.policy, seed.action, seed.target ?? null, seed.attemptCount, seed.replayPolicy ?? null, seed.actorId ?? null, seed.causationId ?? null, seed.correlationId ?? null, seed.policyGroup ?? null, seed.streamType ?? 'system', seed.eventType ?? 'POLICY_EXECUTION_UPDATED', seed.detail ?? null, seed.metadata ? JSON.stringify(seed.metadata) : null, leaseOwner, leaseUntil, seed.createdAt, now);
            if (inserted.changes === 1) {
                return { kind: 'claimed', record: this.getByIdempotencyKey(seed.projectId, seed.idempotencyKey) };
            }
            let existing = this.getByIdempotencyKey(seed.projectId, seed.idempotencyKey);
            if (existing.status === 'executed' || existing.status === 'skipped')
                return { kind: 'executed', record: existing };
            if (existing.status === 'in_progress') {
                if ((existing.leaseUntil ?? 0) > now)
                    return { kind: 'busy', record: existing };
                const expired = this.db.prepare(`
          UPDATE policy_executions
          SET status='failed',detail='execution_outcome_ambiguous_after_lease_expiry',
              execution_outcome='outcome_unknown',dead_lettered_at=?,next_retry_at=NULL,
              lease_owner=NULL,lease_until=NULL,updated_at=?
          WHERE project_scope=? AND idempotency_key=? AND status='in_progress'
            AND COALESCE(lease_until,0)<=?
        `).run(now, now, seed.projectId, seed.idempotencyKey, now);
                existing = this.getByIdempotencyKey(seed.projectId, seed.idempotencyKey);
                return expired.changes === 1 ? { kind: 'ambiguous', record: existing } : { kind: 'busy', record: existing };
            }
            if (existing.deadLetteredAt !== undefined || (existing.nextRetryAt !== undefined && existing.nextRetryAt > now)) {
                return { kind: 'busy', record: existing };
            }
            const claimed = this.db.prepare(`
        UPDATE policy_executions
        SET status='in_progress',execution_outcome=NULL,lease_owner=?,lease_until=?,updated_at=?
        WHERE project_scope=? AND idempotency_key=? AND status='failed'
          AND dead_lettered_at IS NULL AND (next_retry_at IS NULL OR next_retry_at<=?)
      `).run(leaseOwner, leaseUntil, now, seed.projectId, seed.idempotencyKey, now);
            existing = this.getByIdempotencyKey(seed.projectId, seed.idempotencyKey);
            return claimed.changes === 1 ? { kind: 'claimed', record: existing } : { kind: 'busy', record: existing };
        })();
    }
    finishClaim(record, leaseOwner, options) {
        if (record.status === 'in_progress')
            throw new Error('policy_execution_terminal_status_required');
        if (!policyExecutionStateIsValid(record.status, record.executionOutcome))
            throw new Error('invalid_policy_execution_state');
        this.db.transaction(() => {
            const result = this.db.prepare(`
        UPDATE policy_executions SET
          runtime_id=?,policy=?,action=?,target=?,status=?,execution_outcome=?,attempt_count=?,
          next_retry_at=?,dead_lettered_at=?,replay_policy=?,actor_id=?,causation_id=?,
          correlation_id=?,policy_group=?,stream_type=?,event_type=?,detail=?,metadata_json=?,
          lease_owner=NULL,lease_until=NULL,updated_at=?
        WHERE project_scope=? AND idempotency_key=? AND status='in_progress' AND lease_owner=?
      `).run(record.runtimeId ?? null, record.policy, record.action, record.target ?? null, record.status, record.executionOutcome ?? null, record.attemptCount, record.nextRetryAt ?? null, record.deadLetteredAt ?? null, record.replayPolicy ?? null, record.actorId ?? null, record.causationId ?? null, record.correlationId ?? null, record.policyGroup ?? null, record.streamType ?? 'system', record.eventType ?? 'POLICY_EXECUTION_UPDATED', record.detail ?? null, record.metadata ? JSON.stringify(record.metadata) : null, record.updatedAt, record.projectId, record.idempotencyKey, leaseOwner);
            if (result.changes !== 1)
                throw new Error('policy_execution_claim_lost');
            if (options?.emitEvent !== false)
                this.enqueueAudit(record);
        })();
        if (options?.emitEvent !== false)
            this.flushAuditOutbox();
    }
    renewLease(projectId, idempotencyKey, leaseOwner, leaseUntil, now = Date.now()) {
        return this.db.prepare(`
      UPDATE policy_executions SET lease_until=?,updated_at=?
      WHERE project_scope=? AND idempotency_key=? AND status='in_progress' AND lease_owner=?
    `).run(leaseUntil, now, projectId, idempotencyKey, leaseOwner).changes === 1;
    }
    upsert(record, options) {
        if (!policyExecutionStateIsValid(record.status, record.executionOutcome))
            throw new Error('invalid_policy_execution_state');
        this.db.prepare(`
      INSERT INTO policy_executions (
        execution_id, project_scope, idempotency_key, runtime_id, policy, action, target,
        status, execution_outcome, attempt_count, next_retry_at, dead_lettered_at, replay_policy,
        actor_id, causation_id, correlation_id, policy_group, stream_type, event_type,
        detail, metadata_json, lease_owner, lease_until, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_scope, idempotency_key) DO UPDATE SET
        runtime_id=excluded.runtime_id, policy=excluded.policy, action=excluded.action,
        target=excluded.target, status=excluded.status, execution_outcome=excluded.execution_outcome,
        attempt_count=excluded.attempt_count,
        next_retry_at=excluded.next_retry_at, dead_lettered_at=excluded.dead_lettered_at,
        replay_policy=excluded.replay_policy, actor_id=excluded.actor_id,
        causation_id=excluded.causation_id, correlation_id=excluded.correlation_id,
        policy_group=excluded.policy_group, stream_type=excluded.stream_type,
        event_type=excluded.event_type, detail=excluded.detail,
        metadata_json=excluded.metadata_json, lease_owner=excluded.lease_owner,
        lease_until=excluded.lease_until, updated_at=excluded.updated_at
      WHERE policy_executions.status<>'in_progress'
        AND excluded.updated_at>=policy_executions.updated_at
    `).run(record.executionId, record.projectId, record.idempotencyKey, record.runtimeId ?? null, record.policy, record.action, record.target ?? null, record.status, record.executionOutcome ?? null, record.attemptCount, record.nextRetryAt ?? null, record.deadLetteredAt ?? null, record.replayPolicy ?? null, record.actorId ?? null, record.causationId ?? null, record.correlationId ?? null, record.policyGroup ?? null, record.streamType || 'system', record.eventType || 'POLICY_EXECUTION_UPDATED', record.detail ?? null, record.metadata ? JSON.stringify(record.metadata) : null, record.leaseOwner ?? null, record.leaseUntil ?? null, record.createdAt, record.updatedAt);
        if (options?.emitEvent !== false) {
            this.enqueueAudit(record);
            this.flushAuditOutbox();
        }
    }
    emitRecord(record, eventId) {
        this.eventStore?.append({
            eventId,
            streamId: `policy:${record.projectId.length}:${record.projectId}:${record.idempotencyKey}`,
            streamType: 'system',
            eventType: 'POLICY_EXECUTION_UPDATED',
            projectId: record.projectId,
            occurredAt: record.updatedAt,
            actorId: record.actorId,
            causationId: record.causationId,
            correlationId: record.correlationId,
            payload: {
                executionId: record.executionId,
                projectId: record.projectId,
                idempotencyKey: record.idempotencyKey,
                runtimeId: record.runtimeId,
                policy: record.policy,
                action: record.action,
                target: record.target,
                status: record.status,
                executionOutcome: record.executionOutcome,
                attemptCount: record.attemptCount,
                nextRetryAt: record.nextRetryAt,
                deadLetteredAt: record.deadLetteredAt,
                replayPolicy: record.replayPolicy,
                actorId: record.actorId,
                causationId: record.causationId,
                correlationId: record.correlationId,
                policyGroup: record.policyGroup,
                streamType: record.streamType || 'system',
                eventType: record.eventType || 'POLICY_EXECUTION_UPDATED',
                detail: record.detail,
                metadata: record.metadata,
                createdAt: record.createdAt,
                updatedAt: record.updatedAt
            }
        });
    }
    enqueueAudit(record) {
        const outboxId = this.auditEventId(record);
        this.db.prepare(`
      INSERT OR IGNORE INTO policy_execution_audit_outbox(outbox_id,project_scope,payload_json,created_at)
      VALUES(?,?,?,?)
    `).run(outboxId, record.projectId, JSON.stringify(record), Date.now());
    }
    flushAuditOutbox() {
        if (!this.eventStore)
            return 0;
        let flushed = 0;
        const dueAt = Date.now();
        for (;;) {
            const rows = this.db.prepare(`
        SELECT outbox_id,payload_json,attempt_count FROM policy_execution_audit_outbox
        WHERE dead_lettered_at IS NULL AND (next_retry_at IS NULL OR next_retry_at<=?)
        ORDER BY created_at,project_scope,outbox_id LIMIT 100
      `).all(dueAt);
            if (rows.length === 0)
                break;
            for (const row of rows) {
                try {
                    const record = JSON.parse(row.payload_json);
                    if (!this.eventStore.getEvent(row.outbox_id))
                        this.emitRecord(record, row.outbox_id);
                    this.db.prepare(`DELETE FROM policy_execution_audit_outbox WHERE outbox_id=?`).run(row.outbox_id);
                    flushed += 1;
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    const attempts = row.attempt_count + 1;
                    const malformed = error instanceof SyntaxError;
                    const failedAt = Date.now();
                    this.db.prepare(`
            UPDATE policy_execution_audit_outbox
            SET attempt_count=?,last_error=?,next_retry_at=?,dead_lettered_at=?
            WHERE outbox_id=?
          `).run(attempts, message.slice(0, 1000), malformed || attempts >= 5 ? null : failedAt + Math.min(60_000, 1000 * 2 ** (attempts - 1)), malformed || attempts >= 5 ? failedAt : null, row.outbox_id);
                }
            }
        }
        return flushed;
    }
    getAuditOutboxStats() {
        const row = this.db.prepare(`
      SELECT SUM(CASE WHEN dead_lettered_at IS NULL THEN 1 ELSE 0 END) AS pending,
        MIN(CASE WHEN dead_lettered_at IS NULL THEN created_at END) AS oldest_created_at,
        SUM(CASE WHEN dead_lettered_at IS NOT NULL THEN 1 ELSE 0 END) AS dead_letter
      FROM policy_execution_audit_outbox
    `).get();
        const error = this.db.prepare(`
      SELECT last_error FROM policy_execution_audit_outbox WHERE last_error IS NOT NULL
      ORDER BY COALESCE(dead_lettered_at,next_retry_at,created_at) DESC LIMIT 1
    `).get();
        return {
            pending: Number(row.pending ?? 0),
            oldestCreatedAt: row.oldest_created_at ?? undefined,
            deadLetter: Number(row.dead_letter ?? 0),
            lastError: error?.last_error,
        };
    }
    auditEventId(record) {
        return `policy-audit-${createHash('sha256').update([
            record.projectId, record.idempotencyKey, record.status, String(record.updatedAt),
            record.executionId, String(record.attemptCount), record.executionOutcome ?? '', record.detail ?? '',
        ].join('\0')).digest('hex').slice(0, 32)}`;
    }
    clearReadModelProject(projectId) {
        this.db.prepare(`DELETE FROM policy_execution_read_model WHERE project_scope=?`).run(projectId);
    }
    beginReadModelBuild(projectId) {
        this.db.exec(`CREATE TEMP TABLE IF NOT EXISTS policy_execution_read_model_stage (
      execution_id TEXT NOT NULL, project_scope TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      runtime_id TEXT, policy TEXT NOT NULL, action TEXT NOT NULL, target TEXT, status TEXT NOT NULL,
      execution_outcome TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0, next_retry_at INTEGER, dead_lettered_at INTEGER,
      replay_policy TEXT, actor_id TEXT, causation_id TEXT, correlation_id TEXT, policy_group TEXT,
      stream_type TEXT, event_type TEXT, detail TEXT, metadata_json TEXT, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, source_global_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(project_scope,idempotency_key)
    )`);
        this.db.prepare(`DELETE FROM policy_execution_read_model_stage WHERE project_scope=?`).run(projectId);
    }
    publishReadModelBuild(projectId) {
        this.db.transaction(() => {
            this.db.prepare(`DELETE FROM policy_execution_read_model WHERE project_scope=?`).run(projectId);
            const columns = `execution_id,project_scope,idempotency_key,runtime_id,policy,action,target,status,
        execution_outcome,attempt_count,next_retry_at,dead_lettered_at,replay_policy,actor_id,causation_id,
        correlation_id,policy_group,stream_type,event_type,detail,metadata_json,created_at,updated_at,source_global_seq`;
            this.db.prepare(`INSERT INTO policy_execution_read_model(${columns}) SELECT ${columns}
        FROM policy_execution_read_model_stage WHERE project_scope=?`).run(projectId);
            this.db.prepare(`DELETE FROM policy_execution_read_model_stage WHERE project_scope=?`).run(projectId);
        })();
    }
    discardReadModelBuild(projectId) {
        this.db.prepare(`DELETE FROM policy_execution_read_model_stage WHERE project_scope=?`).run(projectId);
    }
    upsertReadModel(record, sourceGlobalSeq = 0, staging = false) {
        const table = staging ? 'policy_execution_read_model_stage' : 'policy_execution_read_model';
        this.db.prepare(`
      INSERT INTO ${table} (
        execution_id,project_scope,idempotency_key,runtime_id,policy,action,target,status,
        execution_outcome,attempt_count,next_retry_at,dead_lettered_at,replay_policy,actor_id,causation_id,
        correlation_id,policy_group,stream_type,event_type,detail,metadata_json,created_at,updated_at,source_global_seq
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_scope,idempotency_key) DO UPDATE SET
        execution_id=excluded.execution_id,runtime_id=excluded.runtime_id,policy=excluded.policy,
        action=excluded.action,target=excluded.target,status=excluded.status,
        execution_outcome=excluded.execution_outcome,
        attempt_count=excluded.attempt_count,next_retry_at=excluded.next_retry_at,
        dead_lettered_at=excluded.dead_lettered_at,replay_policy=excluded.replay_policy,
        actor_id=excluded.actor_id,causation_id=excluded.causation_id,
        correlation_id=excluded.correlation_id,policy_group=excluded.policy_group,
        stream_type=excluded.stream_type,event_type=excluded.event_type,detail=excluded.detail,
        metadata_json=excluded.metadata_json,updated_at=excluded.updated_at,
        source_global_seq=excluded.source_global_seq
      WHERE excluded.source_global_seq>=${table}.source_global_seq
    `).run(record.executionId, record.projectId, record.idempotencyKey, record.runtimeId ?? null, record.policy, record.action, record.target ?? null, record.status, record.executionOutcome ?? null, record.attemptCount, record.nextRetryAt ?? null, record.deadLetteredAt ?? null, record.replayPolicy ?? null, record.actorId ?? null, record.causationId ?? null, record.correlationId ?? null, record.policyGroup ?? null, record.streamType ?? null, record.eventType ?? null, record.detail ?? null, record.metadata ? JSON.stringify(record.metadata) : null, record.createdAt, record.updatedAt, sourceGlobalSeq);
    }
    getReadModelCount(projectId) {
        const row = projectId === undefined
            ? this.db.prepare(`SELECT COUNT(*) AS count FROM policy_execution_read_model`).get()
            : this.db.prepare(`SELECT COUNT(*) AS count FROM policy_execution_read_model WHERE project_scope=?`).get(projectId);
        return Number(row?.count ?? 0);
    }
    getReadModelByIdempotencyKey(projectId, idempotencyKey) {
        const row = this.db.prepare(`
      SELECT * FROM policy_execution_read_model WHERE project_scope=? AND idempotency_key=?
    `).get(projectId, idempotencyKey);
        return row ? this.mapRow(row) : null;
    }
    listByRuntime(projectId, runtimeId) {
        const rows = this.db.prepare(`
      SELECT * FROM policy_executions WHERE project_scope = ? AND runtime_id = ? ORDER BY updated_at ASC, execution_id ASC
    `).all(projectId, runtimeId);
        return rows.map((row) => this.mapRow(row));
    }
    listPendingRetries(projectId, now = Date.now()) {
        const rows = this.db.prepare(`
      SELECT * FROM policy_executions
      WHERE status = 'failed'
        AND project_scope = ?
        AND dead_lettered_at IS NULL
        AND next_retry_at IS NOT NULL
        AND next_retry_at <= ?
      ORDER BY next_retry_at ASC, execution_id ASC
    `).all(projectId, now);
        return rows.map((row) => this.mapRow(row));
    }
    listDeadLetters(projectId, runtimeId) {
        const rows = runtimeId
            ? this.db.prepare(`
          SELECT * FROM policy_executions
          WHERE project_scope = ? AND dead_lettered_at IS NOT NULL AND runtime_id = ?
          ORDER BY dead_lettered_at ASC, execution_id ASC
        `).all(projectId, runtimeId)
            : this.db.prepare(`
          SELECT * FROM policy_executions
          WHERE project_scope = ? AND dead_lettered_at IS NOT NULL
          ORDER BY dead_lettered_at ASC, execution_id ASC
        `).all(projectId);
        return rows.map((row) => this.mapRow(row));
    }
    listByFilters(filters) {
        const { where, params } = this.buildFilterSql(filters);
        const rows = this.db.prepare(`
      SELECT * FROM policy_executions
      ${where}
      ORDER BY updated_at DESC, execution_id DESC
    `).all(...params);
        return rows.map((row) => this.mapRow(row));
    }
    getAuditPage(page = 1, pageSize = 20, filters) {
        const safePage = Math.max(page, 1);
        const safePageSize = Math.max(pageSize, 1);
        const offset = (safePage - 1) * safePageSize;
        const { where, params } = this.buildFilterSql(filters);
        const totalRow = this.db.prepare(`
      SELECT COUNT(*) AS count FROM policy_executions ${where}
    `).get(...params);
        const rows = this.db.prepare(`
      SELECT * FROM policy_executions
      ${where}
      ORDER BY updated_at DESC, execution_id DESC
      LIMIT ? OFFSET ?
    `).all(...params, safePageSize, offset);
        return {
            page: safePage,
            pageSize: safePageSize,
            total: totalRow?.count || 0,
            records: rows.map((row) => this.mapRow(row)),
            appliedFilters: {
                projectId: filters?.projectId,
                runtimeId: filters?.runtimeId,
                actorId: filters?.actorId,
                causationId: filters?.causationId,
                correlationId: filters?.correlationId,
                policyGroup: filters?.policyGroup,
                streamType: filters?.streamType,
                eventType: filters?.eventType,
                policy: filters?.policy,
                target: filters?.target,
                status: filters?.status,
                replayPolicy: filters?.replayPolicy,
                startTime: filters?.startTime,
                endTime: filters?.endTime
            }
        };
    }
    getExecutionCount(projectId) {
        const row = projectId === undefined
            ? this.db.prepare(`SELECT COUNT(*) AS count FROM policy_executions`).get()
            : this.db.prepare(`SELECT COUNT(*) AS count FROM policy_executions WHERE project_scope=?`).get(projectId);
        return row?.count || 0;
    }
    close() {
        if (this.ownsDb)
            this.db.close();
    }
    buildFilterSql(filters) {
        const conditions = [];
        const params = [];
        if (filters?.projectId !== undefined) {
            conditions.push('project_scope = ?');
            params.push(filters.projectId);
        }
        if (filters?.runtimeId) {
            conditions.push('runtime_id = ?');
            params.push(filters.runtimeId);
        }
        if (filters?.actorId && filters.actorId.length > 0) {
            conditions.push(`actor_id IN (${filters.actorId.map(() => '?').join(', ')})`);
            params.push(...filters.actorId);
        }
        if (filters?.causationId && filters.causationId.length > 0) {
            conditions.push(`causation_id IN (${filters.causationId.map(() => '?').join(', ')})`);
            params.push(...filters.causationId);
        }
        if (filters?.correlationId && filters.correlationId.length > 0) {
            conditions.push(`correlation_id IN (${filters.correlationId.map(() => '?').join(', ')})`);
            params.push(...filters.correlationId);
        }
        if (filters?.policyGroup && filters.policyGroup.length > 0) {
            conditions.push(`policy_group IN (${filters.policyGroup.map(() => '?').join(', ')})`);
            params.push(...filters.policyGroup);
        }
        if (filters?.streamType && filters.streamType.length > 0) {
            conditions.push(`stream_type IN (${filters.streamType.map(() => '?').join(', ')})`);
            params.push(...filters.streamType);
        }
        if (filters?.eventType && filters.eventType.length > 0) {
            conditions.push(`event_type IN (${filters.eventType.map(() => '?').join(', ')})`);
            params.push(...filters.eventType);
        }
        if (filters?.policy && filters.policy.length > 0) {
            conditions.push(`policy IN (${filters.policy.map(() => '?').join(', ')})`);
            params.push(...filters.policy);
        }
        if (filters?.target && filters.target.length > 0) {
            conditions.push(`target IN (${filters.target.map(() => '?').join(', ')})`);
            params.push(...filters.target);
        }
        if (filters?.status && filters.status.length > 0) {
            conditions.push(`status IN (${filters.status.map(() => '?').join(', ')})`);
            params.push(...filters.status);
        }
        if (filters?.replayPolicy && filters.replayPolicy.length > 0) {
            conditions.push(`replay_policy IN (${filters.replayPolicy.map(() => '?').join(', ')})`);
            params.push(...filters.replayPolicy);
        }
        if (filters?.startTime !== undefined) {
            conditions.push('updated_at >= ?');
            params.push(filters.startTime);
        }
        if (filters?.endTime !== undefined) {
            conditions.push('updated_at <= ?');
            params.push(filters.endTime);
        }
        return {
            where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
            params
        };
    }
    mapRow(row) {
        return {
            executionId: row.execution_id,
            projectId: row.project_scope,
            idempotencyKey: row.idempotency_key,
            runtimeId: row.runtime_id || undefined,
            policy: row.policy,
            action: row.action,
            target: row.target || undefined,
            status: row.status,
            executionOutcome: row.execution_outcome || undefined,
            attemptCount: row.attempt_count,
            nextRetryAt: row.next_retry_at || undefined,
            deadLetteredAt: row.dead_lettered_at || undefined,
            replayPolicy: row.replay_policy || undefined,
            actorId: row.actor_id || undefined,
            causationId: row.causation_id || undefined,
            correlationId: row.correlation_id || undefined,
            policyGroup: row.policy_group || undefined,
            streamType: row.stream_type || undefined,
            eventType: row.event_type || undefined,
            detail: row.detail || undefined,
            metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
            leaseOwner: row.lease_owner || undefined,
            leaseUntil: row.lease_until ?? undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    hasScopedIdentity() {
        const columns = this.tableColumns();
        if (!columns.has('project_scope'))
            return false;
        return this.db.prepare(`PRAGMA index_list(policy_executions)`).all()
            .filter((index) => index.unique === 1)
            .some((index) => this.db.prepare(`PRAGMA index_info(${index.name})`).all()
            .map((column) => column.name).join('|') === 'project_scope|idempotency_key');
    }
    tableColumns() {
        return new Set(this.db.prepare(`PRAGMA table_info(policy_executions)`).all().map((row) => row.name));
    }
}
