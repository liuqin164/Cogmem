import Database from 'bun:sqlite';
import { createHash, randomUUID } from 'crypto';
import type { EncryptionProvider } from '../encryption/index.js';
import type {
  EventAuditPage,
  MemoryEvent,
  MemoryEventCausalityType,
  MemoryEventContext,
  MemoryRawEventType,
  MemoryEventRole,
  MemoryEventType,
  OrderingConfidence,
  StreamType,
} from '../types/index.js';

export interface ProjectionCheckpoint {
  projectionName: string;
  lastEventId?: string;
  lastEventTime?: number;
  lastRebuildAt?: number;
  lastFullCount: number;
  lastChecksum?: string;
  status: 'idle' | 'building' | 'ready' | 'degraded' | 'failed';
  metadata?: Record<string, unknown>;
}

export interface AppendEventInput<TPayload = Record<string, unknown>> {
  eventId?: string;
  streamId: string;
  streamType: StreamType;
  eventType: MemoryEventType;
  rawEventType?: MemoryRawEventType;
  eventVersion?: number;
  projectId?: string;
  workspaceId?: string;
  actorId?: string;
  causationId?: string;
  correlationId?: string;
  sourceNeuronId?: string;
  sourceId?: string;
  contentHash?: string;
  threadId?: string;
  sessionId?: string;
  localDate?: string;
  threadSeq?: number;
  turnId?: string;
  turnSeq?: number;
  eventOrdinal?: number;
  role?: MemoryEventRole;
  parentEventId?: string;
  prevEventId?: string;
  nextEventId?: string;
  causalityType?: MemoryEventCausalityType;
  sourceOffset?: number;
  lineStart?: number;
  lineEnd?: number;
  charStart?: number;
  charEnd?: number;
  orderingConfidence?: OrderingConfidence;
  occurredAt?: number;
  payload: TPayload;
}

const MEMORY_EVENT_COLUMNS = `
  event_id, global_seq, stream_id, stream_type, event_type, raw_event_type, event_version, project_id,
  workspace_id, actor_id, causation_id, correlation_id, source_neuron_id, source_id,
  content_hash, thread_id, session_id, local_date, thread_seq, turn_id, turn_seq,
  event_ordinal, role, parent_event_id, prev_event_id, next_event_id, causality_type,
  source_offset, line_start, line_end, char_start, char_end, ordering_confidence,
  occurred_at, payload_json, payload_hash, created_at
`;

export class EventStore {
  private db: Database;

  constructor(dbPath: string = ':memory:', private readonly encryptionProvider?: EncryptionProvider) {
    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_events (
        event_id TEXT PRIMARY KEY,
        global_seq INTEGER,
        stream_id TEXT NOT NULL,
        stream_type TEXT NOT NULL,
        event_type TEXT NOT NULL,
        raw_event_type TEXT,
        event_version INTEGER NOT NULL,
        project_id TEXT,
        workspace_id TEXT,
        actor_id TEXT,
        causation_id TEXT,
        correlation_id TEXT,
        source_neuron_id TEXT,
        source_id TEXT,
        content_hash TEXT,
        thread_id TEXT,
        session_id TEXT,
        local_date TEXT,
        thread_seq INTEGER,
        turn_id TEXT,
        turn_seq INTEGER,
        event_ordinal INTEGER,
        role TEXT,
        parent_event_id TEXT,
        prev_event_id TEXT,
        next_event_id TEXT,
        causality_type TEXT,
        source_offset INTEGER,
        line_start INTEGER,
        line_end INTEGER,
        char_start INTEGER,
        char_end INTEGER,
        ordering_confidence TEXT,
        occurred_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        UNIQUE (stream_id, event_version)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_events_stream
        ON memory_events(stream_type, stream_id, event_version);

      CREATE INDEX IF NOT EXISTS idx_memory_events_type_time
        ON memory_events(event_type, occurred_at DESC);

      CREATE INDEX IF NOT EXISTS idx_memory_events_global_seq
        ON memory_events(global_seq);

      CREATE INDEX IF NOT EXISTS idx_memory_events_thread_order
        ON memory_events(thread_id, thread_seq, event_ordinal, global_seq);

      CREATE INDEX IF NOT EXISTS idx_memory_events_parent
        ON memory_events(parent_event_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_events_fts USING fts5(
        event_id UNINDEXED,
        text,
        project_id UNINDEXED,
        workspace_id UNINDEXED,
        thread_id UNINDEXED,
        session_id UNINDEXED,
        local_date UNINDEXED,
        role UNINDEXED,
        raw_event_type UNINDEXED,
        tokenize='unicode61'
      );

      CREATE TABLE IF NOT EXISTS vector_projection_state (
        projection_name TEXT PRIMARY KEY,
        last_event_id TEXT,
        last_event_time INTEGER,
        last_rebuild_at INTEGER,
        last_full_count INTEGER NOT NULL DEFAULT 0,
        last_checksum TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        metadata_json TEXT
      );
    `);
    this.ensureCompatibilityColumns();
  }

  private ensureCompatibilityColumns(): void {
    const rows = this.db.prepare(`PRAGMA table_info(memory_events)`).all() as Array<{ name: string }>;
    const names = new Set(rows.map((row) => row.name));
    const addColumn = (name: string, ddl: string): void => {
      if (!names.has(name)) this.db.exec(`ALTER TABLE memory_events ADD COLUMN ${ddl};`);
    };

    addColumn('global_seq', 'global_seq INTEGER');
    addColumn('raw_event_type', 'raw_event_type TEXT');
    addColumn('workspace_id', 'workspace_id TEXT');
    addColumn('source_id', 'source_id TEXT');
    addColumn('content_hash', 'content_hash TEXT');
    addColumn('thread_id', 'thread_id TEXT');
    addColumn('session_id', 'session_id TEXT');
    addColumn('local_date', 'local_date TEXT');
    addColumn('thread_seq', 'thread_seq INTEGER');
    addColumn('turn_id', 'turn_id TEXT');
    addColumn('turn_seq', 'turn_seq INTEGER');
    addColumn('event_ordinal', 'event_ordinal INTEGER');
    addColumn('role', 'role TEXT');
    addColumn('parent_event_id', 'parent_event_id TEXT');
    addColumn('prev_event_id', 'prev_event_id TEXT');
    addColumn('next_event_id', 'next_event_id TEXT');
    addColumn('causality_type', 'causality_type TEXT');
    addColumn('source_offset', 'source_offset INTEGER');
    addColumn('line_start', 'line_start INTEGER');
    addColumn('line_end', 'line_end INTEGER');
    addColumn('char_start', 'char_start INTEGER');
    addColumn('char_end', 'char_end INTEGER');
    addColumn('ordering_confidence', 'ordering_confidence TEXT');

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_events_global_seq ON memory_events(global_seq);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_events_thread_order ON memory_events(thread_id, thread_seq, event_ordinal, global_seq);`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_events_parent ON memory_events(parent_event_id);`);
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_events_fts USING fts5(
        event_id UNINDEXED,
        text,
        project_id UNINDEXED,
        workspace_id UNINDEXED,
        thread_id UNINDEXED,
        session_id UNINDEXED,
        local_date UNINDEXED,
        role UNINDEXED,
        raw_event_type UNINDEXED,
        tokenize='unicode61'
      );
    `);
    this.rebuildRawEventFtsIfNeeded();
  }

  append<TPayload = Record<string, unknown>>(input: AppendEventInput<TPayload>): MemoryEvent<TPayload> {
    const eventVersion = input.eventVersion ?? this.getNextEventVersion(input.streamId);
    const occurredAt = input.occurredAt ?? Date.now();
    const payloadJson = JSON.stringify(input.payload);
    const storedPayloadJson = this.encodePayload(payloadJson);
    const payloadHash = createHash('sha256').update(payloadJson).digest('hex');
    const threadId = input.threadId ?? (input.streamType === 'thread' ? input.streamId : undefined);
    const threadSeq = input.threadSeq ?? (threadId ? this.getNextThreadSeq(threadId) : undefined);
    const globalSeq = this.getNextGlobalSeq();
    const createdAt = Date.now();
    const event: MemoryEvent<TPayload> = {
      eventId: input.eventId || `evt-${randomUUID()}`,
      globalSeq,
      streamId: input.streamId,
      streamType: input.streamType,
      eventType: input.eventType,
      rawEventType: input.rawEventType,
      eventVersion,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      causationId: input.causationId,
      correlationId: input.correlationId,
      sourceNeuronId: input.sourceNeuronId,
      sourceId: input.sourceId,
      contentHash: input.contentHash ?? payloadHash,
      threadId,
      sessionId: input.sessionId,
      localDate: input.localDate ?? new Date(occurredAt).toISOString().slice(0, 10),
      threadSeq,
      turnId: input.turnId,
      turnSeq: input.turnSeq,
      eventOrdinal: input.eventOrdinal,
      role: input.role,
      parentEventId: input.parentEventId,
      prevEventId: input.prevEventId,
      nextEventId: input.nextEventId,
      causalityType: input.causalityType,
      sourceOffset: input.sourceOffset,
      lineStart: input.lineStart,
      lineEnd: input.lineEnd,
      charStart: input.charStart,
      charEnd: input.charEnd,
      orderingConfidence: input.orderingConfidence ?? (threadSeq || input.eventOrdinal ? 'high' : 'low'),
      occurredAt,
      payload: input.payload,
      payloadHash,
      createdAt,
      ingestedAt: createdAt
    };

    this.db.prepare(`
      INSERT INTO memory_events (
        event_id, global_seq, stream_id, stream_type, event_type, raw_event_type, event_version, project_id,
        workspace_id, actor_id, causation_id, correlation_id, source_neuron_id, source_id,
        content_hash, thread_id, session_id, local_date, thread_seq, turn_id, turn_seq,
        event_ordinal, role, parent_event_id, prev_event_id, next_event_id, causality_type,
        source_offset, line_start, line_end, char_start, char_end, ordering_confidence,
        occurred_at, payload_json, payload_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      event.globalSeq ?? null,
      event.streamId,
      event.streamType,
      event.eventType,
      event.rawEventType || null,
      event.eventVersion,
      event.projectId || null,
      event.workspaceId || null,
      event.actorId || null,
      event.causationId || null,
      event.correlationId || null,
      event.sourceNeuronId || null,
      event.sourceId || null,
      event.contentHash || null,
      event.threadId || null,
      event.sessionId || null,
      event.localDate || null,
      event.threadSeq || null,
      event.turnId || null,
      event.turnSeq || null,
      event.eventOrdinal || null,
      event.role || null,
      event.parentEventId || null,
      event.prevEventId || null,
      event.nextEventId || null,
      event.causalityType || null,
      event.sourceOffset || null,
      event.lineStart || null,
      event.lineEnd || null,
      event.charStart || null,
      event.charEnd || null,
      event.orderingConfidence || null,
      event.occurredAt,
      storedPayloadJson,
      event.payloadHash,
      event.createdAt
    );

    this.upsertRawEventFts(event);
    return event;
  }

  getNextGlobalSeq(): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(global_seq), 0) AS seq
      FROM memory_events
    `).get() as { seq: number } | null;
    return (row?.seq || 0) + 1;
  }

  getNextEventVersion(streamId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(event_version), 0) AS version
      FROM memory_events
      WHERE stream_id = ?
    `).get(streamId) as { version: number } | null;
    return (row?.version || 0) + 1;
  }

  getNextThreadSeq(threadId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(thread_seq), 0) AS seq
      FROM memory_events
      WHERE thread_id = ? OR (thread_id IS NULL AND stream_type = 'thread' AND stream_id = ?)
    `).get(threadId, threadId) as { seq: number } | null;
    return (row?.seq || 0) + 1;
  }

  getNextTurnSeq(threadId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(turn_seq), 0) AS seq
      FROM memory_events
      WHERE thread_id = ? OR (thread_id IS NULL AND stream_type = 'thread' AND stream_id = ?)
    `).get(threadId, threadId) as { seq: number } | null;
    return (row?.seq || 0) + 1;
  }

  getEventsAfter(lastEventTime?: number): MemoryEvent[] {
    const rows = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      WHERE (? IS NULL OR occurred_at > ?)
      ORDER BY COALESCE(global_seq, 0) ASC, occurred_at ASC, event_id ASC
    `).all(lastEventTime || null, lastEventTime || null) as any[];

    return rows.map((row) => this.mapRow(row));
  }

  getLatestEvent(): MemoryEvent | null {
    const row = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      ORDER BY COALESCE(global_seq, 0) DESC, occurred_at DESC, event_id DESC
      LIMIT 1
    `).get() as any;

    if (!row) return null;
    return this.mapRow(row);
  }

  listRawEventsAfterGlobalSeq(options: {
    projectId?: string;
    workspaceId?: string;
    threadId?: string;
    sessionId?: string;
    afterGlobalSeq?: number;
    limit?: number;
  } = {}): MemoryEvent[] {
    const conditions = [`event_type = 'RAW_EVENT_RECORDED'`];
    const params: Array<string | number> = [];
    if (options.projectId) {
      conditions.push('project_id = ?');
      params.push(options.projectId);
    }
    if (options.workspaceId) {
      conditions.push('workspace_id = ?');
      params.push(options.workspaceId);
    }
    if (options.threadId) {
      conditions.push('thread_id = ?');
      params.push(options.threadId);
    }
    if (options.sessionId) {
      conditions.push('session_id = ?');
      params.push(options.sessionId);
    }
    if (options.afterGlobalSeq !== undefined) {
      conditions.push('COALESCE(global_seq, 0) > ?');
      params.push(options.afterGlobalSeq);
    }
    params.push(Math.max(1, options.limit ?? 100));
    const rows = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(global_seq, 0) ASC, occurred_at ASC, event_id ASC
      LIMIT ?
    `).all(...params) as any[];
    return rows.map((row) => this.mapRow(row));
  }

  getEventsByStreamId(streamId: string): MemoryEvent[] {
    const rows = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      WHERE stream_id = ?
      ORDER BY event_version ASC, COALESCE(global_seq, 0) ASC, event_id ASC
    `).all(streamId) as any[];

    return rows.map((row) => this.mapRow(row));
  }

  queryEvents(
    page: number = 1,
    pageSize: number = 20,
    filters?: {
      streamId?: string[];
      streamType?: StreamType[];
      eventType?: MemoryEventType[];
      actorId?: string[];
      causationId?: string[];
      correlationId?: string[];
      projectId?: string[];
      workspaceId?: string[];
      threadId?: string[];
      sessionId?: string[];
      startTime?: number;
      endTime?: number;
      sinceGlobalSeq?: number;
      untilGlobalSeq?: number;
      order?: 'asc' | 'desc';
    }
  ): EventAuditPage {
    const safePage = Math.max(1, page);
    const safePageSize = Math.max(1, pageSize);
    const offset = (safePage - 1) * safePageSize;
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filters?.streamId?.length) {
      conditions.push(`stream_id IN (${filters.streamId.map(() => '?').join(', ')})`);
      params.push(...filters.streamId);
    }
    if (filters?.streamType?.length) {
      conditions.push(`stream_type IN (${filters.streamType.map(() => '?').join(', ')})`);
      params.push(...filters.streamType);
    }
    if (filters?.eventType?.length) {
      conditions.push(`event_type IN (${filters.eventType.map(() => '?').join(', ')})`);
      params.push(...filters.eventType);
    }
    if (filters?.actorId?.length) {
      conditions.push(`actor_id IN (${filters.actorId.map(() => '?').join(', ')})`);
      params.push(...filters.actorId);
    }
    if (filters?.causationId?.length) {
      conditions.push(`causation_id IN (${filters.causationId.map(() => '?').join(', ')})`);
      params.push(...filters.causationId);
    }
    if (filters?.correlationId?.length) {
      conditions.push(`correlation_id IN (${filters.correlationId.map(() => '?').join(', ')})`);
      params.push(...filters.correlationId);
    }
    if (filters?.projectId?.length) {
      conditions.push(`project_id IN (${filters.projectId.map(() => '?').join(', ')})`);
      params.push(...filters.projectId);
    }
    if (filters?.workspaceId?.length) {
      conditions.push(`workspace_id IN (${filters.workspaceId.map(() => '?').join(', ')})`);
      params.push(...filters.workspaceId);
    }
    if (filters?.threadId?.length) {
      conditions.push(`thread_id IN (${filters.threadId.map(() => '?').join(', ')})`);
      params.push(...filters.threadId);
    }
    if (filters?.sessionId?.length) {
      conditions.push(`session_id IN (${filters.sessionId.map(() => '?').join(', ')})`);
      params.push(...filters.sessionId);
    }
    if (filters?.startTime !== undefined) {
      conditions.push('occurred_at >= ?');
      params.push(filters.startTime);
    }
    if (filters?.endTime !== undefined) {
      conditions.push('occurred_at <= ?');
      params.push(filters.endTime);
    }
    if (filters?.sinceGlobalSeq !== undefined) {
      conditions.push('COALESCE(global_seq, 0) >= ?');
      params.push(filters.sinceGlobalSeq);
    }
    if (filters?.untilGlobalSeq !== undefined) {
      conditions.push('COALESCE(global_seq, 0) <= ?');
      params.push(filters.untilGlobalSeq);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderSql = filters?.order === 'asc'
      ? 'COALESCE(global_seq, 0) ASC, occurred_at ASC, event_id ASC'
      : 'COALESCE(global_seq, 0) DESC, occurred_at DESC, event_id DESC';
    const totalRow = this.db.prepare(`
      SELECT COUNT(*) AS count FROM memory_events ${where}
    `).get(...params) as { count: number } | null;
    const rows = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      ${where}
      ORDER BY ${orderSql}
      LIMIT ? OFFSET ?
    `).all(...params, safePageSize, offset) as any[];

    return {
      page: safePage,
      pageSize: safePageSize,
      total: totalRow?.count || 0,
      records: rows.map((row) => this.mapRow(row)),
      appliedFilters: {
        streamId: filters?.streamId,
        streamType: filters?.streamType,
        eventType: filters?.eventType,
        actorId: filters?.actorId,
        causationId: filters?.causationId,
        correlationId: filters?.correlationId,
        projectId: filters?.projectId,
        workspaceId: filters?.workspaceId,
        threadId: filters?.threadId,
        sessionId: filters?.sessionId,
        startTime: filters?.startTime,
        endTime: filters?.endTime,
        sinceGlobalSeq: filters?.sinceGlobalSeq,
        untilGlobalSeq: filters?.untilGlobalSeq,
        order: filters?.order,
      }
    };
  }

  getEvent(eventId: string): MemoryEvent | null {
    const row = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      WHERE event_id = ?
    `).get(eventId) as any;
    return row ? this.mapRow(row) : null;
  }

  getThreadEvents(
    threadId: string,
    options: {
      projectId?: string;
      sessionId?: string;
      localDate?: string;
      limit?: number;
    } = {},
  ): MemoryEvent[] {
    const conditions = [
      `(thread_id = ? OR (thread_id IS NULL AND stream_type = 'thread' AND stream_id = ?))`,
    ];
    const params: Array<string | number> = [threadId, threadId];
    if (options.projectId) {
      conditions.push('project_id = ?');
      params.push(options.projectId);
    }
    if (options.sessionId) {
      conditions.push('session_id = ?');
      params.push(options.sessionId);
    }
    if (options.localDate) {
      conditions.push('local_date = ?');
      params.push(options.localDate);
    }

    const limitSql = options.limit ? 'LIMIT ?' : '';
    if (options.limit) params.push(options.limit);
    const rows = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(thread_seq, event_version) ASC,
               COALESCE(event_ordinal, 0) ASC,
               COALESCE(global_seq, 0) ASC,
               event_id ASC
      ${limitSql}
    `).all(...params) as any[];
    return rows.map((row) => this.mapRow(row));
  }

  getEventContext(eventId: string, options: { before?: number; after?: number } = {}): MemoryEventContext | null {
    const event = this.getEvent(eventId);
    if (!event) return null;
    const beforeCount = Math.max(0, options.before ?? 2);
    const afterCount = Math.max(0, options.after ?? 2);
    const ordered = event.threadId
      ? this.getThreadEvents(event.threadId, { projectId: event.projectId })
      : this.getEventsByStreamId(event.streamId);
    const index = ordered.findIndex((item) => item.eventId === event.eventId);
    const before = index >= 0 ? ordered.slice(Math.max(0, index - beforeCount), index) : [];
    const after = index >= 0 ? ordered.slice(index + 1, index + 1 + afterCount) : [];
    return {
      event,
      before,
      after,
      parent: event.parentEventId ? this.getEvent(event.parentEventId) || undefined : undefined,
      children: this.getChildEvents(event.eventId),
    };
  }

  searchRawEvents(
    query: string,
    options: {
      projectId?: string;
      workspaceId?: string;
      threadId?: string;
      sessionId?: string;
      localDate?: string;
      startTime?: number;
      endTime?: number;
      limit?: number;
    } = {},
  ): MemoryEvent[] {
    const limit = Math.max(1, Math.min(options.limit ?? 20, 200));
    const ftsQuery = this.toRawEventFtsQuery(query);
    if (!ftsQuery) return [];

    const conditions = ['memory_events_fts MATCH ?'];
    const params: Array<string | number> = [ftsQuery];
    if (options.projectId) {
      conditions.push('e.project_id = ?');
      params.push(options.projectId);
    }
    if (options.workspaceId) {
      conditions.push('e.workspace_id = ?');
      params.push(options.workspaceId);
    }
    if (options.threadId) {
      conditions.push('e.thread_id = ?');
      params.push(options.threadId);
    }
    if (options.sessionId) {
      conditions.push('e.session_id = ?');
      params.push(options.sessionId);
    }
    if (options.localDate) {
      conditions.push('e.local_date = ?');
      params.push(options.localDate);
    }
    if (options.startTime !== undefined) {
      conditions.push('e.occurred_at >= ?');
      params.push(options.startTime);
    }
    if (options.endTime !== undefined) {
      conditions.push('e.occurred_at <= ?');
      params.push(options.endTime);
    }

    params.push(limit);
    const columns = MEMORY_EVENT_COLUMNS.split(',').map((column) => `e.${column.trim()}`).join(', ');
    const rows = this.db.prepare(`
      SELECT ${columns}
      FROM memory_events_fts
      JOIN memory_events e ON e.event_id = memory_events_fts.event_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(e.global_seq, 0) ASC,
               COALESCE(e.thread_seq, e.event_version) ASC,
               COALESCE(e.event_ordinal, 0) ASC,
               e.event_id ASC
      LIMIT ?
    `).all(...params) as any[];

    if (rows.length > 0) return rows.map((row) => this.mapRow(row));
    return this.fallbackRawTextSearch(query, options, limit);
  }

  getChildEvents(parentEventId: string): MemoryEvent[] {
    const rows = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      WHERE parent_event_id = ?
      ORDER BY COALESCE(thread_seq, event_version) ASC,
               COALESCE(event_ordinal, 0) ASC,
               COALESCE(global_seq, 0) ASC,
               event_id ASC
    `).all(parentEventId) as any[];
    return rows.map((row) => this.mapRow(row));
  }

  updateNextEventId(eventId: string, nextEventId: string | undefined): void {
    this.db.prepare(`
      UPDATE memory_events
      SET next_event_id = ?
      WHERE event_id = ?
    `).run(nextEventId || null, eventId);
  }

  getEventCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_events`).get() as { count: number } | null;
    return row?.count || 0;
  }

  getProjectionCheckpoint(projectionName: string): ProjectionCheckpoint | null {
    const row = this.db.prepare(`SELECT * FROM vector_projection_state WHERE projection_name = ?`).get(projectionName) as any;
    if (!row) return null;

    return {
      projectionName: row.projection_name,
      lastEventId: row.last_event_id || undefined,
      lastEventTime: row.last_event_time || undefined,
      lastRebuildAt: row.last_rebuild_at || undefined,
      lastFullCount: row.last_full_count || 0,
      lastChecksum: row.last_checksum || undefined,
      status: row.status,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined
    };
  }

  upsertProjectionCheckpoint(checkpoint: ProjectionCheckpoint): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO vector_projection_state (
        projection_name, last_event_id, last_event_time, last_rebuild_at,
        last_full_count, last_checksum, status, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      checkpoint.projectionName,
      checkpoint.lastEventId || null,
      checkpoint.lastEventTime || null,
      checkpoint.lastRebuildAt || null,
      checkpoint.lastFullCount,
      checkpoint.lastChecksum || null,
      checkpoint.status,
      checkpoint.metadata ? JSON.stringify(checkpoint.metadata) : null
    );
  }

  close(): void {
    this.db.close();
  }

  private mapRow(row: any): MemoryEvent {
    return {
      eventId: row.event_id,
      globalSeq: row.global_seq || undefined,
      streamId: row.stream_id,
      streamType: row.stream_type,
      eventType: row.event_type,
      rawEventType: row.raw_event_type || undefined,
      eventVersion: row.event_version,
      projectId: row.project_id || undefined,
      workspaceId: row.workspace_id || undefined,
      actorId: row.actor_id || undefined,
      causationId: row.causation_id || undefined,
      correlationId: row.correlation_id || undefined,
      sourceNeuronId: row.source_neuron_id || undefined,
      sourceId: row.source_id || undefined,
      contentHash: row.content_hash || undefined,
      threadId: row.thread_id || (row.stream_type === 'thread' ? row.stream_id : undefined),
      sessionId: row.session_id || undefined,
      localDate: row.local_date || undefined,
      threadSeq: row.thread_seq || undefined,
      turnId: row.turn_id || undefined,
      turnSeq: row.turn_seq || undefined,
      eventOrdinal: row.event_ordinal || undefined,
      role: row.role || undefined,
      parentEventId: row.parent_event_id || undefined,
      prevEventId: row.prev_event_id || undefined,
      nextEventId: row.next_event_id || undefined,
      causalityType: row.causality_type || undefined,
      sourceOffset: row.source_offset || undefined,
      lineStart: row.line_start || undefined,
      lineEnd: row.line_end || undefined,
      charStart: row.char_start || undefined,
      charEnd: row.char_end || undefined,
      orderingConfidence: row.ordering_confidence || undefined,
      occurredAt: row.occurred_at,
      payload: JSON.parse(this.decodePayload(row.payload_json)),
      payloadHash: row.payload_hash,
      createdAt: row.created_at,
      ingestedAt: row.created_at,
    };
  }

  private upsertRawEventFts(event: MemoryEvent<unknown>): void {
    this.db.prepare(`DELETE FROM memory_events_fts WHERE event_id = ?`).run(event.eventId);
    if (this.encryptionProvider) return;
    const text = this.extractIndexText(event.payload);
    if (!text.trim()) return;
    this.db.prepare(`
      INSERT INTO memory_events_fts (
        event_id, text, project_id, workspace_id, thread_id, session_id, local_date, role, raw_event_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      text,
      event.projectId || null,
      event.workspaceId || null,
      event.threadId || null,
      event.sessionId || null,
      event.localDate || null,
      event.role || null,
      event.rawEventType || null,
    );
  }

  private rebuildRawEventFtsIfNeeded(): void {
    if (this.encryptionProvider) {
      this.db.prepare(`DELETE FROM memory_events_fts`).run();
      return;
    }
    const ftsRow = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_events_fts`).get() as { count: number } | null;
    const eventRow = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_events`).get() as { count: number } | null;
    if ((ftsRow?.count || 0) >= (eventRow?.count || 0)) return;

    this.db.prepare(`DELETE FROM memory_events_fts`).run();
    const rows = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      ORDER BY COALESCE(global_seq, 0) ASC, event_id ASC
    `).all() as any[];
    for (const row of rows) {
      this.upsertRawEventFts(this.mapRow(row));
    }
  }

  private extractIndexText(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return '';
    const record = payload as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.output === 'string') return record.output;
    if (typeof record.title === 'string') return record.title;
    return '';
  }

  private toRawEventFtsQuery(query: string): string {
    return query
      .split(/[^\p{L}\p{N}_-]+/u)
      .map((token) => token.trim().replace(/"/g, ''))
      .filter((token) => token.length > 0)
      .slice(0, 12)
      .map((token) => `"${token}"`)
      .join(' ');
  }

  private fallbackRawTextSearch(
    query: string,
    options: {
      projectId?: string;
      workspaceId?: string;
      threadId?: string;
      sessionId?: string;
      localDate?: string;
      startTime?: number;
      endTime?: number;
    },
    limit: number,
  ): MemoryEvent[] {
    if (this.encryptionProvider) return [];
    const tokens = query
      .split(/[^\p{L}\p{N}_-]+/u)
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length > 0)
      .slice(0, 8);
    if (tokens.length === 0) return [];

    const conditions = tokens.map(() => `LOWER(memory_events_fts.text) LIKE ? ESCAPE '\\'`);
    const params: Array<string | number> = tokens.map((token) => `%${escapeSqlLike(token)}%`);
    if (options.projectId) {
      conditions.push('e.project_id = ?');
      params.push(options.projectId);
    }
    if (options.workspaceId) {
      conditions.push('e.workspace_id = ?');
      params.push(options.workspaceId);
    }
    if (options.threadId) {
      conditions.push('e.thread_id = ?');
      params.push(options.threadId);
    }
    if (options.sessionId) {
      conditions.push('e.session_id = ?');
      params.push(options.sessionId);
    }
    if (options.localDate) {
      conditions.push('e.local_date = ?');
      params.push(options.localDate);
    }
    if (options.startTime !== undefined) {
      conditions.push('e.occurred_at >= ?');
      params.push(options.startTime);
    }
    if (options.endTime !== undefined) {
      conditions.push('e.occurred_at <= ?');
      params.push(options.endTime);
    }

    params.push(limit);
    const columns = MEMORY_EVENT_COLUMNS.split(',').map((column) => `e.${column.trim()}`).join(', ');
    const rows = this.db.prepare(`
      SELECT ${columns}
      FROM memory_events_fts
      JOIN memory_events e ON e.event_id = memory_events_fts.event_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(e.global_seq, 0) ASC, e.event_id ASC
      LIMIT ?
    `).all(...params) as any[];
    return rows.map((row) => this.mapRow(row));
  }

  private encodePayload(payloadJson: string): string {
    return this.encryptionProvider?.encrypt(payloadJson) ?? payloadJson;
  }

  private decodePayload(payloadJson: string): string {
    return this.encryptionProvider?.decrypt(payloadJson) ?? payloadJson;
  }
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
