import Database from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import type { EventStore } from './EventStore.js';

export type RuntimeEntityType = 'step' | 'merge' | 'validation' | 'policy' | 'executor' | 'state_machine';
export type RuntimeStatus = 'ready' | 'blocked' | 'pending' | 'matched' | 'missing';

export interface RuntimeStateRecord {
  projectId: string;
  runtimeId: string;
  entityType: RuntimeEntityType;
  entityKey: string;
  status: RuntimeStatus;
  metadata?: Record<string, unknown>;
  updatedAt: number;
}

export interface RuntimeTransitionRecord {
  projectId: string;
  transitionId: string;
  runtimeId: string;
  entityType: RuntimeEntityType;
  entityKey: string;
  transitionType: string;
  fromStatus?: string;
  toStatus: string;
  payload?: Record<string, unknown>;
  occurredAt: number;
}

export interface RuntimeSnapshot {
  projectId: string;
  runtimeId: string;
  states: RuntimeStateRecord[];
  transitions: RuntimeTransitionRecord[];
}

export interface RuntimeDiagnosticsHistoryPage {
  projectId: string;
  runtimeId: string;
  page: number;
  pageSize: number;
  totalTransitions: number;
  transitions: RuntimeTransitionRecord[];
  currentStates: RuntimeStateRecord[];
  appliedFilters?: {
    entityTypes?: string[];
    transitionTypes?: string[];
    status?: string[];
    startTime?: number;
    endTime?: number;
  };
}

export class PlanRuntimeStore {
  private db: Database;
  private eventStore?: EventStore;

  constructor(dbPath: string = ':memory:', eventStore?: EventStore) {
    this.db = new Database(dbPath);
    this.eventStore = eventStore;
    this.initializeSchema();
    this.flushEventOutbox();
  }

  private initializeSchema(): void {
    for (const table of [
      'runtime_states',
      'runtime_transitions',
      'runtime_event_outbox',
      'runtime_projection_states',
      'runtime_projection_transitions',
    ]) {
      const exists = this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
      if (!exists) continue;
      const columns = new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
      if (!columns.has('project_scope')) throw new Error(`runtime_schema_not_migrated:${table}`);
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
        PRIMARY KEY (project_scope, outbox_id)
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

  upsertState(input: {
    projectId: string;
    runtimeId: string;
    entityType: RuntimeEntityType;
    entityKey: string;
    status: RuntimeStatus;
    metadata?: Record<string, unknown>;
    updatedAt?: number;
  }, options?: { emitEvent?: boolean }): void {
    const updatedAt = input.updatedAt ?? Date.now();
    this.db.transaction(() => {
      const existing = this.getState(input.projectId, input.runtimeId, input.entityType, input.entityKey);
      this.db.prepare(`
        INSERT OR REPLACE INTO runtime_states (
          project_scope, runtime_id, entity_type, entity_key, status, metadata_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.projectId,
        input.runtimeId,
        input.entityType,
        input.entityKey,
        input.status,
        input.metadata ? JSON.stringify(input.metadata) : null,
        updatedAt
      );
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
      if (options?.emitEvent !== false) this.enqueueEvent({
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

  recordTransition(input: {
    projectId: string;
    runtimeId: string;
    entityType: RuntimeEntityType;
    entityKey: string;
    transitionType: string;
    fromStatus?: string;
    toStatus: string;
    payload?: Record<string, unknown>;
    occurredAt?: number;
  }, options?: { emitEvent?: boolean }): void {
    this.db.transaction(() => this.insertTransition(input, options?.emitEvent !== false))();
    this.flushEventOutbox();
  }

  private insertTransition(input: {
    projectId: string;
    runtimeId: string;
    entityType: RuntimeEntityType;
    entityKey: string;
    transitionType: string;
    fromStatus?: string;
    toStatus: string;
    payload?: Record<string, unknown>;
    occurredAt?: number;
  }, emitEvent: boolean): void {
    const occurredAt = input.occurredAt ?? Date.now();
    const transitionId = `rt-${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO runtime_transitions (
        project_scope, transition_id, runtime_id, entity_type, entity_key, transition_type,
        from_status, to_status, payload_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.projectId,
      transitionId,
      input.runtimeId,
      input.entityType,
      input.entityKey,
      input.transitionType,
      input.fromStatus || null,
      input.toStatus,
      input.payload ? JSON.stringify(input.payload) : null,
      occurredAt
    );
    if (emitEvent) this.enqueueEvent({
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

  private enqueueEvent(input: Record<string, unknown> & { projectId: string }): void {
    const outboxId = `evt-runtime-${randomUUID()}`;
    this.db.prepare(`INSERT INTO runtime_event_outbox(project_scope,outbox_id,payload_json,created_at) VALUES(?,?,?,?)`)
      .run(input.projectId, outboxId, JSON.stringify({ ...input, eventId: outboxId }), Date.now());
  }

  flushEventOutbox(): void {
    if (!this.eventStore) return;
    const rows = this.db.prepare(`
      SELECT project_scope,outbox_id,payload_json FROM runtime_event_outbox ORDER BY created_at,outbox_id
    `).all() as Array<{ project_scope: string; outbox_id: string; payload_json: string }>;
    for (const row of rows) {
      try {
        if (!this.eventStore.getEvent(row.outbox_id)) {
          this.eventStore.append(JSON.parse(row.payload_json));
        }
        this.db.prepare(`DELETE FROM runtime_event_outbox WHERE project_scope=? AND outbox_id=?`).run(row.project_scope, row.outbox_id);
      } catch {
        break;
      }
    }
  }

  getState(projectId: string, runtimeId: string, entityType: RuntimeEntityType, entityKey: string): RuntimeStateRecord | null {
    const row = this.db.prepare(`
      SELECT runtime_id, entity_type, entity_key, status, metadata_json, updated_at
      FROM runtime_states
      WHERE project_scope = ? AND runtime_id = ? AND entity_type = ? AND entity_key = ?
    `).get(projectId, runtimeId, entityType, entityKey) as any;

    if (!row) return null;
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

  getSnapshot(projectId: string, runtimeId: string): RuntimeSnapshot {
    const states = this.db.prepare(`
      SELECT runtime_id, entity_type, entity_key, status, metadata_json, updated_at
      FROM runtime_states
      WHERE project_scope = ? AND runtime_id = ?
      ORDER BY entity_type ASC, entity_key ASC
    `).all(projectId, runtimeId) as any[];

    const transitions = this.db.prepare(`
      SELECT transition_id, runtime_id, entity_type, entity_key, transition_type,
             from_status, to_status, payload_json, occurred_at
      FROM runtime_transitions
      WHERE project_scope = ? AND runtime_id = ?
      ORDER BY occurred_at ASC, transition_id ASC
    `).all(projectId, runtimeId) as any[];

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

  getHistoryPage(
    projectId: string,
    runtimeId: string,
    page: number = 1,
    pageSize: number = 20,
    filters?: {
      entityTypes?: RuntimeEntityType[];
      transitionTypes?: string[];
      status?: RuntimeStatus[];
      startTime?: number;
      endTime?: number;
    }
  ): RuntimeDiagnosticsHistoryPage {
    const safePage = Math.max(page, 1);
    const safePageSize = Math.max(pageSize, 1);
    const offset = (safePage - 1) * safePageSize;

    const transitionConds = ['project_scope = ?', 'runtime_id = ?'];
    const transitionParams: Array<string | number> = [projectId, runtimeId];
    const stateConds = ['project_scope = ?', 'runtime_id = ?'];
    const stateParams: Array<string | number> = [projectId, runtimeId];

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
    `).get(...transitionParams) as { count: number } | null;

    const transitions = this.db.prepare(`
      SELECT transition_id, runtime_id, entity_type, entity_key, transition_type,
             from_status, to_status, payload_json, occurred_at
      FROM runtime_transitions
      WHERE ${transitionConds.join(' AND ')}
      ORDER BY occurred_at DESC, transition_id DESC
      LIMIT ? OFFSET ?
    `).all(...transitionParams, safePageSize, offset) as any[];

    const states = this.db.prepare(`
      SELECT runtime_id, entity_type, entity_key, status, metadata_json, updated_at
      FROM runtime_states
      WHERE ${stateConds.join(' AND ')}
      ORDER BY updated_at DESC, entity_type ASC, entity_key ASC
    `).all(...stateParams) as any[];

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

  getStateCount(projectId: string): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM runtime_states WHERE project_scope=?`).get(projectId) as { count: number } | null;
    return row?.count || 0;
  }

  beginProjectionBuild(projectionName: string): void {
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

  publishProjectionBuild(projectionName: string): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM runtime_projection_states WHERE projection_name=?`).run(projectionName);
      this.db.prepare(`DELETE FROM runtime_projection_transitions WHERE projection_name=?`).run(projectionName);
      this.db.prepare(`INSERT INTO runtime_projection_states SELECT * FROM runtime_projection_states_stage WHERE projection_name=?`).run(projectionName);
      this.db.prepare(`INSERT INTO runtime_projection_transitions SELECT * FROM runtime_projection_transitions_stage WHERE projection_name=?`).run(projectionName);
      this.discardProjectionBuild(projectionName);
    })();
  }

  discardProjectionBuild(projectionName: string): void {
    this.db.prepare(`DELETE FROM runtime_projection_states_stage WHERE projection_name=?`).run(projectionName);
    this.db.prepare(`DELETE FROM runtime_projection_transitions_stage WHERE projection_name=?`).run(projectionName);
  }

  applyProjectedState(projectionName: string, sourceGlobalSeq: number, input: {
    projectId: string;
    runtimeId: string;
    entityType: RuntimeEntityType;
    entityKey: string;
    status: RuntimeStatus;
    metadata?: Record<string, unknown>;
    updatedAt: number;
  }, staging = false): void {
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
    `).run(
      projectionName,
      input.projectId,
      input.runtimeId,
      input.entityType,
      input.entityKey,
      input.status,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.updatedAt,
      sourceGlobalSeq
    );
  }

  applyProjectedTransition(projectionName: string, sourceEventId: string, sourceGlobalSeq: number, input: {
    projectId: string;
    runtimeId: string;
    entityType: RuntimeEntityType;
    entityKey: string;
    transitionType: string;
    fromStatus?: string;
    toStatus: string;
    payload?: Record<string, unknown>;
    occurredAt: number;
  }, staging = false): void {
    const table = staging ? 'runtime_projection_transitions_stage' : 'runtime_projection_transitions';
    this.db.prepare(`
      INSERT OR IGNORE INTO ${table} (
        projection_name, project_scope, transition_id, runtime_id, entity_type, entity_key,
        transition_type, from_status, to_status, payload_json, occurred_at, source_global_seq
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectionName,
      input.projectId,
      sourceEventId,
      input.runtimeId,
      input.entityType,
      input.entityKey,
      input.transitionType,
      input.fromStatus ?? null,
      input.toStatus,
      input.payload ? JSON.stringify(input.payload) : null,
      input.occurredAt,
      sourceGlobalSeq
    );
  }

  clearProjection(projectionName: string): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM runtime_projection_states WHERE projection_name = ?`).run(projectionName);
      this.db.prepare(`DELETE FROM runtime_projection_transitions WHERE projection_name = ?`).run(projectionName);
    })();
  }

  getProjectionStateCount(projectionName: string, projectId?: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM runtime_projection_states
      WHERE projection_name = ? AND (? IS NULL OR project_scope = ?)
    `).get(projectionName, projectId ?? null, projectId ?? null) as { count: number } | null;
    return row?.count ?? 0;
  }

  clearAll(projectId: string): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM runtime_states WHERE project_scope=?`).run(projectId);
      this.db.prepare(`DELETE FROM runtime_transitions WHERE project_scope=?`).run(projectId);
      this.db.prepare(`DELETE FROM runtime_event_outbox WHERE project_scope=?`).run(projectId);
    })();
  }

  close(): void {
    this.db.close();
  }
}
