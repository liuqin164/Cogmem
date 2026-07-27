import Database from 'bun:sqlite';
import { createHash } from 'node:crypto';
import type { EventStore } from './EventStore.js';
import type { PolicyExecutionAuditPage } from '../types/index.js';

export type PolicyReplayPolicy = 'manual' | 'on_bootstrap' | 'always' | 'scheduled_only';

export interface PolicyExecutionRecord {
  executionId: string;
  projectId: string;
  idempotencyKey: string;
  runtimeId?: string;
  policy: string;
  action: string;
  target?: string;
  status: 'executed' | 'skipped' | 'failed';
  attemptCount: number;
  nextRetryAt?: number;
  deadLetteredAt?: number;
  replayPolicy?: PolicyReplayPolicy;
  actorId?: string;
  causationId?: string;
  correlationId?: string;
  policyGroup?: string;
  streamType?: string;
  eventType?: string;
  detail?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface PolicyExecutionAuditFilters {
  projectId?: string;
  runtimeId?: string;
  actorId?: string[];
  causationId?: string[];
  correlationId?: string[];
  policyGroup?: string[];
  streamType?: string[];
  eventType?: string[];
  policy?: string[];
  target?: string[];
  status?: Array<'executed' | 'skipped' | 'failed'>;
  replayPolicy?: PolicyReplayPolicy[];
  startTime?: number;
  endTime?: number;
}

export class PolicyExecutionStore {
  private db: Database;
  private eventStore?: EventStore;

  constructor(dbPath: string = ':memory:', eventStore?: EventStore) {
    this.db = new Database(dbPath);
    this.eventStore = eventStore;
    this.initializeSchema();
  }

  private initializeSchema(): void {
    const existing = this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='policy_executions'`).get();
    if (existing && !this.hasScopedIdentity()) this.quarantineUnscopedExecutions();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS policy_executions (
        execution_id TEXT PRIMARY KEY,
        project_scope TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        runtime_id TEXT,
        policy TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        status TEXT NOT NULL,
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
        UNIQUE(project_scope, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_policy_executions_runtime
        ON policy_executions(project_scope, runtime_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_policy_executions_policy_group
        ON policy_executions(policy_group, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_policy_executions_actor
        ON policy_executions(actor_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_policy_executions_causation
        ON policy_executions(causation_id, updated_at DESC);
    `);

    const columns = this.db.prepare(`PRAGMA table_info(policy_executions)`).all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));

    if (!columnNames.has('actor_id')) {
      this.db.exec(`ALTER TABLE policy_executions ADD COLUMN actor_id TEXT;`);
    }
    if (!columnNames.has('causation_id')) {
      this.db.exec(`ALTER TABLE policy_executions ADD COLUMN causation_id TEXT;`);
    }
    if (!columnNames.has('policy_group')) {
      this.db.exec(`ALTER TABLE policy_executions ADD COLUMN policy_group TEXT;`);
    }
    if (!columnNames.has('correlation_id')) {
      this.db.exec(`ALTER TABLE policy_executions ADD COLUMN correlation_id TEXT;`);
    }
    if (!columnNames.has('stream_type')) {
      this.db.exec(`ALTER TABLE policy_executions ADD COLUMN stream_type TEXT;`);
    }
    if (!columnNames.has('event_type')) {
      this.db.exec(`ALTER TABLE policy_executions ADD COLUMN event_type TEXT;`);
    }
  }

  getByIdempotencyKey(projectId: string, idempotencyKey: string): PolicyExecutionRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM policy_executions WHERE project_scope = ? AND idempotency_key = ?
    `).get(projectId, idempotencyKey) as unknown;
    return row ? this.mapRow(row) : null;
  }

  upsert(record: PolicyExecutionRecord, options?: { emitEvent?: boolean }): void {
    this.db.prepare(`
      INSERT INTO policy_executions (
        execution_id, project_scope, idempotency_key, runtime_id, policy, action, target,
        status, attempt_count, next_retry_at, dead_lettered_at, replay_policy,
        actor_id, causation_id, correlation_id, policy_group, stream_type, event_type,
        detail, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_scope, idempotency_key) DO UPDATE SET
        runtime_id=excluded.runtime_id, policy=excluded.policy, action=excluded.action,
        target=excluded.target, status=excluded.status, attempt_count=excluded.attempt_count,
        next_retry_at=excluded.next_retry_at, dead_lettered_at=excluded.dead_lettered_at,
        replay_policy=excluded.replay_policy, actor_id=excluded.actor_id,
        causation_id=excluded.causation_id, correlation_id=excluded.correlation_id,
        policy_group=excluded.policy_group, stream_type=excluded.stream_type,
        event_type=excluded.event_type, detail=excluded.detail,
        metadata_json=excluded.metadata_json, updated_at=excluded.updated_at
    `).run(
      record.executionId,
      record.projectId,
      record.idempotencyKey,
      record.runtimeId ?? null,
      record.policy,
      record.action,
      record.target ?? null,
      record.status,
      record.attemptCount,
      record.nextRetryAt ?? null,
      record.deadLetteredAt ?? null,
      record.replayPolicy ?? null,
      record.actorId ?? null,
      record.causationId ?? null,
      record.correlationId ?? null,
      record.policyGroup ?? null,
      record.streamType || 'system',
      record.eventType || 'POLICY_EXECUTION_UPDATED',
      record.detail ?? null,
      record.metadata ? JSON.stringify(record.metadata) : null,
      record.createdAt,
      record.updatedAt
    );

    if (options?.emitEvent !== false) {
      this.eventStore?.append({
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
  }

  listByRuntime(projectId: string, runtimeId: string): PolicyExecutionRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM policy_executions WHERE project_scope = ? AND runtime_id = ? ORDER BY updated_at ASC, execution_id ASC
    `).all(projectId, runtimeId) as unknown[];
    return rows.map((row) => this.mapRow(row));
  }

  listPendingRetries(projectId: string, now: number = Date.now()): PolicyExecutionRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM policy_executions
      WHERE status = 'failed'
        AND project_scope = ?
        AND dead_lettered_at IS NULL
        AND next_retry_at IS NOT NULL
        AND next_retry_at <= ?
      ORDER BY next_retry_at ASC, execution_id ASC
    `).all(projectId, now) as unknown[];
    return rows.map((row) => this.mapRow(row));
  }

  listDeadLetters(projectId: string, runtimeId?: string): PolicyExecutionRecord[] {
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

    return (rows as unknown[]).map((row) => this.mapRow(row));
  }

  listByFilters(filters?: PolicyExecutionAuditFilters): PolicyExecutionRecord[] {
    const { where, params } = this.buildFilterSql(filters);
    const rows = this.db.prepare(`
      SELECT * FROM policy_executions
      ${where}
      ORDER BY updated_at DESC, execution_id DESC
    `).all(...params) as unknown[];
    return rows.map((row) => this.mapRow(row));
  }

  getAuditPage(
    page: number = 1,
    pageSize: number = 20,
    filters?: PolicyExecutionAuditFilters
  ): PolicyExecutionAuditPage {
    const safePage = Math.max(page, 1);
    const safePageSize = Math.max(pageSize, 1);
    const offset = (safePage - 1) * safePageSize;
    const { where, params } = this.buildFilterSql(filters);

    const totalRow = this.db.prepare(`
      SELECT COUNT(*) AS count FROM policy_executions ${where}
    `).get(...params) as { count: number } | null;

    const rows = this.db.prepare(`
      SELECT * FROM policy_executions
      ${where}
      ORDER BY updated_at DESC, execution_id DESC
      LIMIT ? OFFSET ?
    `).all(...params, safePageSize, offset) as unknown[];

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

  getExecutionCount(projectId?: string): number {
    const row = projectId === undefined
      ? this.db.prepare(`SELECT COUNT(*) AS count FROM policy_executions`).get() as { count: number } | null
      : this.db.prepare(`SELECT COUNT(*) AS count FROM policy_executions WHERE project_scope=?`).get(projectId) as { count: number } | null;
    return row?.count || 0;
  }

  clearProject(projectId: string): void {
    this.db.prepare(`DELETE FROM policy_executions WHERE project_scope=?`).run(projectId);
  }

  close(): void {
    this.db.close();
  }

  private buildFilterSql(filters?: PolicyExecutionAuditFilters): {
    where: string;
    params: Array<string | number>;
  } {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

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

  private mapRow(row: any): PolicyExecutionRecord {
    return {
      executionId: row.execution_id,
      projectId: row.project_scope,
      idempotencyKey: row.idempotency_key,
      runtimeId: row.runtime_id || undefined,
      policy: row.policy,
      action: row.action,
      target: row.target || undefined,
      status: row.status,
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
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private hasScopedIdentity(): boolean {
    const columns = new Set((this.db.prepare(`PRAGMA table_info(policy_executions)`).all() as Array<{ name: string }>).map((row) => row.name));
    if (!columns.has('project_scope')) return false;
    return (this.db.prepare(`PRAGMA index_list(policy_executions)`).all() as Array<{ name: string; unique: number }>)
      .filter((index) => index.unique === 1)
      .some((index) => (this.db.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{ name: string }>)
        .map((column) => column.name).join('|') === 'project_scope|idempotency_key');
  }

  private quarantineUnscopedExecutions(): void {
    const rows = this.db.prepare(`SELECT * FROM policy_executions`).all() as Array<Record<string, unknown>>;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS policy_execution_quarantine (
        execution_id TEXT PRIMARY KEY,
        record_hash TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      ALTER TABLE policy_executions RENAME TO policy_executions_unscoped;
    `);
    const insert = this.db.prepare(`INSERT OR REPLACE INTO policy_execution_quarantine VALUES(?,?,?,?)`);
    for (const row of rows) {
      insert.run(
        String(row.execution_id),
        createHash('sha256').update(JSON.stringify(row)).digest('hex'),
        'project_scope_unproven',
        Date.now(),
      );
    }
    this.db.exec(`DROP TABLE policy_executions_unscoped`);
  }
}
