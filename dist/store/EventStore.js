import Database from 'bun:sqlite';
import { createHash, randomUUID } from 'crypto';
import { assertLocalDate, localDateFor, resolveProjectClockContext } from '../utils/LocalDateContext.js';
const MEMORY_EVENT_COLUMNS = `
  event_id, global_seq, stream_id, stream_type, event_type, raw_event_type, event_version, project_id,
  workspace_id, actor_id, causation_id, correlation_id, source_neuron_id, source_id,
  content_hash, thread_id, session_id, local_date, local_date_source, thread_seq, turn_id, turn_seq,
  event_ordinal, role, parent_event_id, prev_event_id, next_event_id, causality_type,
  source_offset, line_start, line_end, char_start, char_end, ordering_confidence,
  occurred_at, payload_json, payload_hash, created_at
`;
export class EventStore {
    encryptionProvider;
    projectTimeZone;
    validatedLocalDates = new Set();
    db;
    ownsDb = true;
    constructor(dbPath = ':memory:', encryptionProvider, projectTimeZone) {
        this.encryptionProvider = encryptionProvider;
        this.projectTimeZone = projectTimeZone;
        if (dbPath instanceof Database) {
            this.db = dbPath;
            this.ownsDb = false;
        }
        else {
            this.db = new Database(dbPath);
        }
        this.initializeSchema();
    }
    getProjectTimeZone() { return this.projectTimeZone; }
    initializeSchema() {
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
        project_scope TEXT NOT NULL DEFAULT '',
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
        local_date_source TEXT NOT NULL DEFAULT 'legacy_unknown',
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
        UNIQUE (project_scope, stream_id, event_version)
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
        last_global_seq INTEGER,
        last_rebuild_at INTEGER,
        last_full_count INTEGER NOT NULL DEFAULT 0,
        last_checksum TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS event_sequence_counters (
        counter_key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
    `);
        this.ensureCompatibilityColumns();
        this.seedSequenceCounters();
    }
    ensureCompatibilityColumns() {
        const rows = this.db.prepare(`PRAGMA table_info(memory_events)`).all();
        const names = new Set(rows.map((row) => row.name));
        const addColumn = (name, ddl) => {
            if (!names.has(name))
                this.db.exec(`ALTER TABLE memory_events ADD COLUMN ${ddl};`);
        };
        addColumn('global_seq', 'global_seq INTEGER');
        addColumn('raw_event_type', 'raw_event_type TEXT');
        addColumn('workspace_id', 'workspace_id TEXT');
        addColumn('source_id', 'source_id TEXT');
        addColumn('content_hash', 'content_hash TEXT');
        addColumn('thread_id', 'thread_id TEXT');
        addColumn('session_id', 'session_id TEXT');
        addColumn('local_date', 'local_date TEXT');
        addColumn('local_date_source', "local_date_source TEXT NOT NULL DEFAULT 'legacy_unknown'");
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
      CREATE TABLE IF NOT EXISTS import_source_anchors (
        project_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        import_anchor TEXT NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        content_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, source_id, import_anchor)
      );
    `);
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
    append(input, retry = 0) {
        try {
            return this.db.transaction(() => this.appendAtomic(input))();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const streamConflict = /UNIQUE constraint failed: memory_events\.(?:project_scope, memory_events\.)?stream_id(?:, memory_events\.event_version)?/.test(message);
            const anchorConflict = message === 'import_anchor_already_exists';
            if ((streamConflict || message.includes('database is locked')) && input.eventVersion === undefined && retry < 5) {
                return this.append(input, retry + 1);
            }
            if (!anchorConflict)
                throw error;
            const metadata = input.payload?.metadata;
            const anchor = typeof metadata?.importAnchor === 'string' ? metadata.importAnchor : undefined;
            const existing = anchor && input.projectId !== undefined && input.sourceId
                ? this.findImportedEventAnchor(input.projectId, input.sourceId, anchor)
                : null;
            if (!existing)
                throw error;
            const contentHash = input.contentHash ?? createHash('sha256').update(JSON.stringify(input.payload)).digest('hex');
            if (existing.contentHash !== contentHash)
                throw new Error(`import_anchor_content_conflict:${anchor}`);
            return existing;
        }
    }
    appendAtomic(input) {
        const eventVersion = input.eventVersion ?? this.getNextEventVersion(input.streamId, input.projectId ?? '');
        const occurredAt = input.occurredAt ?? Date.now();
        if (!Number.isFinite(occurredAt) || Math.abs(occurredAt) > 8_640_000_000_000_000)
            throw new Error('invalid_event_timestamp');
        const payloadJson = JSON.stringify(input.payload);
        const storedPayloadJson = this.encodePayload(payloadJson);
        const payloadHash = createHash('sha256').update(payloadJson).digest('hex');
        const threadId = input.threadId ?? (input.streamType === 'thread' ? input.streamId : undefined);
        const threadSeq = input.threadSeq ?? (threadId ? this.getNextThreadSeq(threadId, input.projectId ?? '') : undefined);
        const globalSeq = this.getNextGlobalSeq();
        const createdAt = Date.now();
        // A caller-provided date is evidence supplied by the caller, never the
        // clock used to prove a generated date. Compute the clock independently
        // so generated provenance cannot be forged by self-comparison.
        if (input.localDateSource && input.localDateSource !== 'explicit' && input.localDateSource !== 'legacy_unknown') {
            throw new Error('invalid_local_date_source');
        }
        if (input.projectTimeZone && this.projectTimeZone && input.projectTimeZone !== this.projectTimeZone) {
            throw new Error('project_timezone_override_forbidden');
        }
        const clock = resolveProjectClockContext({ now: occurredAt, timeZone: input.timeZone, projectTimeZone: this.projectTimeZone ?? input.projectTimeZone });
        const localDate = input.localDate ?? clock.localDateNow;
        const localDateSource = input.localDateSource ?? (input.localDate
            ? 'explicit'
            : clock.source === 'explicit'
                ? 'generated_explicit_timezone'
                : clock.source === 'project_config'
                    ? 'generated_project_timezone'
                    : clock.source === 'host_environment'
                        ? 'generated_host_timezone'
                        : 'generated_utc_fallback');
        if (localDateSource === 'explicit' && !input.localDate)
            throw new Error('explicit_local_date_required');
        // Resolver validation already covers generated dates. Re-check only data
        // supplied by a caller so bulk ingestion does not pay the civil-date
        // round-trip cost twice for every event.
        if (input.localDate) {
            this.assertExplicitLocalDate(localDate, clock.timeZone);
            if (localDateSource === 'explicit' && localDate !== localDateFor(occurredAt, clock.timeZone))
                throw new Error('explicit_local_date_timestamp_mismatch');
        }
        if (localDateSource.startsWith('generated_') && localDate !== clock.localDateNow)
            throw new Error('generated_local_date_mismatch');
        const event = {
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
            localDate,
            localDateSource,
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
            orderingConfidence: input.orderingConfidence ?? (threadSeq !== undefined || input.eventOrdinal !== undefined || input.sourceOffset !== undefined || input.lineStart !== undefined ? 'high' : 'low'),
            occurredAt,
            payload: input.payload,
            payloadHash,
            createdAt,
            ingestedAt: createdAt
        };
        const insert = () => this.db.prepare(`
      INSERT INTO memory_events (
        event_id, global_seq, stream_id, stream_type, event_type, raw_event_type, event_version, project_id, project_scope,
        workspace_id, actor_id, causation_id, correlation_id, source_neuron_id, source_id,
        content_hash, thread_id, session_id, local_date, local_date_source, thread_seq, turn_id, turn_seq,
        event_ordinal, role, parent_event_id, prev_event_id, next_event_id, causality_type,
        source_offset, line_start, line_end, char_start, char_end, ordering_confidence,
        occurred_at, payload_json, payload_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event.eventId, event.globalSeq ?? null, event.streamId, event.streamType, event.eventType, event.rawEventType || null, event.eventVersion, event.projectId ?? null, event.projectId ?? '', event.workspaceId || null, event.actorId || null, event.causationId || null, event.correlationId || null, event.sourceNeuronId || null, event.sourceId || null, event.contentHash || null, event.threadId || null, event.sessionId || null, event.localDate || null, event.localDateSource || 'legacy_unknown', event.threadSeq ?? null, event.turnId || null, event.turnSeq ?? null, event.eventOrdinal ?? null, event.role || null, event.parentEventId || null, event.prevEventId || null, event.nextEventId || null, event.causalityType || null, event.sourceOffset ?? null, event.lineStart ?? null, event.lineEnd ?? null, event.charStart ?? null, event.charEnd ?? null, event.orderingConfidence || null, event.occurredAt, storedPayloadJson, event.payloadHash, event.createdAt);
        this.assertLinkedEventScopes(event.projectId, [event.parentEventId, event.prevEventId, event.nextEventId]);
        insert();
        this.advanceSequence(sequenceKey('event', event.projectId ?? '', event.streamId), event.eventVersion);
        if (event.threadId && event.threadSeq !== undefined)
            this.advanceSequence(sequenceKey('thread', event.projectId ?? '', event.threadId), event.threadSeq);
        if (event.threadId && event.turnSeq !== undefined)
            this.advanceSequence(sequenceKey('turn', event.projectId ?? '', event.threadId), event.turnSeq);
        this.upsertImportAnchor(event);
        this.upsertRawEventFts(event);
        return event;
    }
    assertExplicitLocalDate(localDate, timeZone) {
        const key = `${timeZone}\0${localDate}`;
        if (this.validatedLocalDates.has(key))
            return;
        assertLocalDate(localDate, timeZone);
        // Keep the cache bounded for long-lived import processes.
        if (this.validatedLocalDates.size >= 512)
            this.validatedLocalDates.clear();
        this.validatedLocalDates.add(key);
    }
    upsertImportAnchor(event) {
        const metadata = event.payload?.metadata;
        const anchor = typeof metadata?.importAnchor === 'string' ? metadata.importAnchor : undefined;
        if (!anchor || event.projectId === undefined || !event.sourceId || !event.contentHash)
            return;
        this.db.prepare(`
      INSERT INTO import_source_anchors (project_id, source_id, import_anchor, event_id, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, source_id, import_anchor) DO NOTHING
    `).run(event.projectId, event.sourceId, anchor, event.eventId, event.contentHash, event.createdAt);
        const inserted = this.db.prepare(`SELECT event_id FROM import_source_anchors WHERE project_id = ? AND source_id = ? AND import_anchor = ?`)
            .get(event.projectId, event.sourceId, anchor);
        if (inserted?.event_id !== event.eventId) {
            const existingEvent = inserted?.event_id
                ? this.db.prepare(`SELECT 1 FROM memory_events WHERE event_id = ?`).get(inserted.event_id)
                : null;
            if (!existingEvent) {
                this.db.prepare(`
          UPDATE import_source_anchors
          SET event_id = ?, content_hash = ?, created_at = ?
          WHERE project_id = ? AND source_id = ? AND import_anchor = ?
        `).run(event.eventId, event.contentHash, event.createdAt, event.projectId, event.sourceId, anchor);
                return;
            }
            throw new Error('import_anchor_already_exists');
        }
    }
    getNextGlobalSeq() {
        return this.nextSequence('global');
    }
    getNextEventVersion(streamId, projectId) {
        return this.nextSequence(sequenceKey('event', projectId ?? '', streamId));
    }
    getNextThreadSeq(threadId, projectId) {
        return this.nextSequence(sequenceKey('thread', projectId ?? '', threadId));
    }
    getNextTurnSeq(threadId, projectId) {
        return this.nextSequence(sequenceKey('turn', projectId ?? '', threadId));
    }
    nextSequence(key) {
        const row = this.db.prepare(`
      INSERT INTO event_sequence_counters(counter_key,value) VALUES(?,1)
      ON CONFLICT(counter_key) DO UPDATE SET value=value+1
      RETURNING value
    `).get(key);
        return row.value;
    }
    advanceSequence(key, value) {
        this.db.prepare(`INSERT INTO event_sequence_counters(counter_key,value) VALUES(?,?)
      ON CONFLICT(counter_key) DO UPDATE SET value=MAX(value,excluded.value)`).run(key, value);
    }
    seedSequenceCounters() {
        const upsert = this.db.prepare(`INSERT INTO event_sequence_counters(counter_key,value) VALUES(?,?)
      ON CONFLICT(counter_key) DO UPDATE SET value=MAX(value,excluded.value)`);
        const global = this.db.prepare(`SELECT COALESCE(MAX(global_seq),0) AS value FROM memory_events`).get();
        upsert.run('global', global.value);
        for (const row of this.db.prepare(`SELECT project_scope,stream_id,MAX(event_version) AS value FROM memory_events GROUP BY project_scope,stream_id`).all()) {
            upsert.run(sequenceKey('event', row.project_scope, row.stream_id), row.value);
        }
        for (const row of this.db.prepare(`SELECT project_scope,COALESCE(thread_id,stream_id) AS thread_id,MAX(thread_seq) AS thread_value,MAX(turn_seq) AS turn_value
      FROM memory_events WHERE thread_id IS NOT NULL OR stream_type='thread' GROUP BY project_scope,COALESCE(thread_id,stream_id)`).all()) {
            if (row.thread_value != null)
                upsert.run(sequenceKey('thread', row.project_scope, row.thread_id), row.thread_value);
            if (row.turn_value != null)
                upsert.run(sequenceKey('turn', row.project_scope, row.thread_id), row.turn_value);
        }
    }
    getEventsAfter(lastEventTime) {
        const rows = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      WHERE (? IS NULL OR occurred_at > ?)
      ORDER BY COALESCE(global_seq, 0) ASC, occurred_at ASC, event_id ASC
    `).all(lastEventTime ?? null, lastEventTime ?? null);
        return rows.map((row) => this.mapRow(row));
    }
    getEventsAfterGlobalSeq(lastGlobalSeq, throughGlobalSeq) {
        const rows = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      WHERE (? IS NULL OR COALESCE(global_seq, 0) > ?)
        AND (? IS NULL OR COALESCE(global_seq, 0) <= ?)
      ORDER BY COALESCE(global_seq, 0) ASC, occurred_at ASC, event_id ASC
    `).all(lastGlobalSeq ?? null, lastGlobalSeq ?? null, throughGlobalSeq ?? null, throughGlobalSeq ?? null);
        return rows.map((row) => this.mapRow(row));
    }
    getEventsByGlobalSeqPage(options) {
        const conditions = ['COALESCE(global_seq,0)>?', 'COALESCE(global_seq,0)<=?'];
        const params = [options.afterGlobalSeq ?? 0, options.throughGlobalSeq];
        if (options.eventTypes?.length) {
            conditions.push(`event_type IN (${options.eventTypes.map(() => '?').join(',')})`);
            params.push(...options.eventTypes);
        }
        if (options.projectId !== undefined) {
            conditions.push(`COALESCE(project_id,'')=?`);
            params.push(options.projectId);
        }
        params.push(Math.max(1, Math.min(options.limit ?? 500, 5_000)));
        const rows = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(global_seq,0), occurred_at, event_id
      LIMIT ?
    `).all(...params);
        return rows.map((row) => this.mapRow(row));
    }
    getLatestGlobalSeq() {
        const row = this.db.prepare(`SELECT COALESCE(MAX(global_seq), 0) AS value FROM memory_events`).get();
        return row.value;
    }
    findImportedEventAnchor(projectId, sourceId, importAnchor) {
        const row = this.db.prepare(`
      SELECT ${qualifiedMemoryEventColumns('e')}
      FROM import_source_anchors a
      JOIN memory_events e ON e.event_id = a.event_id
      WHERE a.project_id = ? AND a.source_id = ? AND a.import_anchor = ?
    `).get(projectId, sourceId, importAnchor);
        return row ? this.mapRow(row) : null;
    }
    getLatestEvent() {
        const row = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      ORDER BY COALESCE(global_seq, 0) DESC, occurred_at DESC, event_id DESC
      LIMIT 1
    `).get();
        if (!row)
            return null;
        return this.mapRow(row);
    }
    listRawEventsAfterGlobalSeq(options = {}) {
        const conditions = [`event_type = 'RAW_EVENT_RECORDED'`];
        const params = [];
        if (options.projectId !== undefined) {
            conditions.push("COALESCE(project_id, '') = ?");
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
    `).all(...params);
        return rows.map((row) => this.mapRow(row));
    }
    getEventsByStreamId(streamId, projectId) {
        const scope = projectId === undefined ? '' : ` AND project_scope=?`;
        const rows = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      WHERE stream_id = ?${scope}
      ORDER BY event_version ASC, COALESCE(global_seq, 0) ASC, event_id ASC
    `).all(streamId, ...(projectId === undefined ? [] : [projectId]));
        return rows.map((row) => this.mapRow(row));
    }
    queryEvents(page = 1, pageSize = 20, filters) {
        const safePage = Math.max(1, page);
        const safePageSize = Math.max(1, pageSize);
        const offset = (safePage - 1) * safePageSize;
        const conditions = [];
        const params = [];
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
            conditions.push(`COALESCE(project_id, '') IN (${filters.projectId.map(() => '?').join(', ')})`);
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
            conditions.push('occurred_at < ?');
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
    `).get(...params);
        const rows = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      ${where}
      ORDER BY ${orderSql}
      LIMIT ? OFFSET ?
    `).all(...params, safePageSize, offset);
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
    getEvent(eventId) {
        const row = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      WHERE event_id = ?
    `).get(eventId);
        return row ? this.mapRow(row) : null;
    }
    getThreadEvents(threadId, options = {}) {
        const conditions = [
            `(thread_id = ? OR (thread_id IS NULL AND stream_type = 'thread' AND stream_id = ?))`,
        ];
        const params = [threadId, threadId];
        if (options.projectId !== undefined) {
            conditions.push("COALESCE(project_id, '') = ?");
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
        const boundedLimit = options.limit === undefined ? undefined : Math.max(1, Math.min(Math.trunc(options.limit), 10_000));
        const limitSql = boundedLimit === undefined ? '' : 'LIMIT ?';
        if (boundedLimit !== undefined)
            params.push(boundedLimit);
        const rows = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      WHERE ${conditions.join(' AND ')}
      ORDER BY COALESCE(thread_seq, event_version) ASC,
               COALESCE(event_ordinal, 0) ASC,
               COALESCE(global_seq, 0) ASC,
               event_id ASC
      ${limitSql}
    `).all(...params);
        return rows.map((row) => this.mapRow(row));
    }
    getEventContext(eventId, options = {}) {
        const event = this.getEvent(eventId);
        if (!event)
            return null;
        const beforeCount = Math.max(0, options.before ?? 2);
        const afterCount = Math.max(0, options.after ?? 2);
        const ordered = event.threadId
            ? this.getThreadEvents(event.threadId, { projectId: event.projectId })
            : this.getEventsByStreamId(event.streamId, event.projectId ?? '');
        const index = ordered.findIndex((item) => item.eventId === event.eventId);
        const before = index >= 0 ? ordered.slice(Math.max(0, index - beforeCount), index) : [];
        const after = index >= 0 ? ordered.slice(index + 1, index + 1 + afterCount) : [];
        return {
            event,
            before,
            after,
            parent: event.parentEventId ? this.getEventInScope(event.parentEventId, event.projectId) : undefined,
            children: this.getChildEvents(event.eventId, event.projectId),
        };
    }
    searchRawEvents(query, options = {}) {
        const limit = Math.max(1, Math.min(options.limit ?? 20, 200));
        const ftsQuery = this.toRawEventFtsQuery(query);
        if (!ftsQuery)
            return [];
        const conditions = ['memory_events_fts MATCH ?'];
        const params = [ftsQuery];
        if (options.projectId !== undefined) {
            conditions.push("COALESCE(e.project_id, '') = ?");
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
            conditions.push('e.occurred_at < ?');
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
    `).all(...params);
        if (rows.length > 0)
            return rows.map((row) => this.mapRow(row));
        return this.fallbackRawTextSearch(query, options, limit);
    }
    getChildEvents(parentEventId, projectId) {
        const queryProject = projectId === undefined ? null : projectId;
        const rows = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      WHERE parent_event_id = ?
        AND (? IS NULL OR COALESCE(project_id,'') = ?)
      ORDER BY COALESCE(thread_seq, event_version) ASC,
               COALESCE(event_ordinal, 0) ASC,
               COALESCE(global_seq, 0) ASC,
               event_id ASC
    `).all(parentEventId, queryProject, queryProject);
        return rows.map((row) => this.mapRow(row));
    }
    updateNextEventId(eventId, nextEventId) {
        this.db.transaction(() => {
            const source = this.db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM memory_events WHERE event_id=?`).get(eventId);
            if (!source)
                throw new Error('event_link_source_not_found');
            if (nextEventId)
                this.assertLinkedEventScopes(source.scope, [nextEventId]);
            this.db.prepare(`UPDATE memory_events SET next_event_id=? WHERE event_id=?`).run(nextEventId || null, eventId);
        })();
    }
    getEventInScope(eventId, projectId) {
        const event = this.getEvent(eventId);
        return event && (event.projectId ?? '') === (projectId ?? '') ? event : undefined;
    }
    assertLinkedEventScopes(projectId, eventIds) {
        const scope = projectId ?? '';
        for (const eventId of new Set(eventIds.filter((id) => Boolean(id)))) {
            const row = this.db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM memory_events WHERE event_id=?`).get(eventId);
            if (!row)
                throw new Error('event_link_target_not_found');
            if (row.scope !== scope)
                throw new Error('event_link_project_scope_mismatch');
        }
    }
    getEventCount() {
        const row = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_events`).get();
        return row?.count || 0;
    }
    getProjectionCheckpoint(projectionName) {
        const row = this.db.prepare(`SELECT * FROM vector_projection_state WHERE projection_name = ?`).get(projectionName);
        if (!row)
            return null;
        return {
            projectionName: row.projection_name,
            lastEventId: row.last_event_id || undefined,
            lastEventTime: row.last_event_time || undefined,
            lastGlobalSeq: row.last_global_seq ?? undefined,
            lastRebuildAt: row.last_rebuild_at || undefined,
            lastFullCount: row.last_full_count || 0,
            lastChecksum: row.last_checksum || undefined,
            status: row.status,
            metadata: row.metadata_json ? JSON.parse(row.metadata_json) : undefined
        };
    }
    upsertProjectionCheckpoint(checkpoint) {
        this.db.prepare(`
      INSERT OR REPLACE INTO vector_projection_state (
        projection_name, last_event_id, last_event_time, last_global_seq, last_rebuild_at,
        last_full_count, last_checksum, status, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(checkpoint.projectionName, checkpoint.lastEventId || null, checkpoint.lastEventTime ?? null, checkpoint.lastGlobalSeq ?? null, checkpoint.lastRebuildAt ?? null, checkpoint.lastFullCount, checkpoint.lastChecksum || null, checkpoint.status, checkpoint.metadata ? JSON.stringify(checkpoint.metadata) : null);
    }
    close() {
        if (this.ownsDb)
            this.db.close();
    }
    mapRow(row) {
        return {
            eventId: row.event_id,
            globalSeq: row.global_seq || undefined,
            streamId: row.stream_id,
            streamType: row.stream_type,
            eventType: row.event_type,
            rawEventType: row.raw_event_type || undefined,
            eventVersion: row.event_version,
            projectId: row.project_id == null ? undefined : String(row.project_id),
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
            localDateSource: row.local_date_source || legacyLocalDateSource(row.payload_json),
            threadSeq: row.thread_seq ?? undefined,
            turnId: row.turn_id || undefined,
            turnSeq: row.turn_seq ?? undefined,
            eventOrdinal: row.event_ordinal ?? undefined,
            role: row.role || undefined,
            parentEventId: row.parent_event_id || undefined,
            prevEventId: row.prev_event_id || undefined,
            nextEventId: row.next_event_id || undefined,
            causalityType: row.causality_type || undefined,
            sourceOffset: row.source_offset ?? undefined,
            lineStart: row.line_start ?? undefined,
            lineEnd: row.line_end ?? undefined,
            charStart: row.char_start ?? undefined,
            charEnd: row.char_end ?? undefined,
            orderingConfidence: row.ordering_confidence || undefined,
            occurredAt: row.occurred_at,
            payload: JSON.parse(this.decodePayload(row.payload_json)),
            payloadHash: row.payload_hash,
            createdAt: row.created_at,
            ingestedAt: row.created_at,
        };
    }
    upsertRawEventFts(event) {
        this.db.prepare(`DELETE FROM memory_events_fts WHERE event_id = ?`).run(event.eventId);
        if (this.encryptionProvider)
            return;
        const text = this.extractIndexText(event.payload);
        if (!text.trim())
            return;
        this.db.prepare(`
      INSERT INTO memory_events_fts (
        event_id, text, project_id, workspace_id, thread_id, session_id, local_date, role, raw_event_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event.eventId, text, event.projectId ?? null, event.workspaceId || null, event.threadId || null, event.sessionId || null, event.localDate || null, event.role || null, event.rawEventType || null);
    }
    rebuildRawEventFtsIfNeeded() {
        if (this.encryptionProvider) {
            this.db.prepare(`DELETE FROM memory_events_fts`).run();
            return;
        }
        const ftsRow = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_events_fts`).get();
        const eventRow = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_events`).get();
        if ((ftsRow?.count || 0) >= (eventRow?.count || 0))
            return;
        this.db.prepare(`DELETE FROM memory_events_fts`).run();
        const rows = this.db.prepare(`
      SELECT ${MEMORY_EVENT_COLUMNS}
      FROM memory_events
      ORDER BY COALESCE(global_seq, 0) ASC, event_id ASC
    `).all();
        for (const row of rows) {
            this.upsertRawEventFts(this.mapRow(row));
        }
    }
    extractIndexText(payload) {
        if (!payload || typeof payload !== 'object')
            return '';
        const record = payload;
        if (typeof record.text === 'string')
            return record.text;
        if (typeof record.output === 'string')
            return record.output;
        if (typeof record.title === 'string')
            return record.title;
        return '';
    }
    toRawEventFtsQuery(query) {
        return query
            .split(/[^\p{L}\p{N}_-]+/u)
            .map((token) => token.trim().replace(/"/g, ''))
            .filter((token) => token.length > 0)
            .slice(0, 12)
            .map((token) => `"${token}"`)
            .join(' ');
    }
    fallbackRawTextSearch(query, options, limit) {
        if (this.encryptionProvider)
            return [];
        const tokens = query
            .split(/[^\p{L}\p{N}_-]+/u)
            .map((token) => token.trim().toLowerCase())
            .filter((token) => token.length > 0)
            .slice(0, 8);
        if (tokens.length === 0)
            return [];
        const conditions = tokens.map(() => `LOWER(memory_events_fts.text) LIKE ? ESCAPE '\\'`);
        const params = tokens.map((token) => `%${escapeSqlLike(token)}%`);
        if (options.projectId !== undefined) {
            conditions.push("COALESCE(e.project_id, '') = ?");
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
            conditions.push('e.occurred_at < ?');
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
    `).all(...params);
        return rows.map((row) => this.mapRow(row));
    }
    encodePayload(payloadJson) {
        return this.encryptionProvider?.encrypt(payloadJson) ?? payloadJson;
    }
    decodePayload(payloadJson) {
        return this.encryptionProvider?.decrypt(payloadJson) ?? payloadJson;
    }
}
function qualifiedMemoryEventColumns(alias) {
    return MEMORY_EVENT_COLUMNS.split(',').map((column) => `${alias}.${column.trim()}`).join(', ');
}
function escapeSqlLike(value) {
    return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
function sequenceKey(kind, projectId, id) {
    return `${kind}:${createHash('sha256').update(`${projectId}\0${id}`).digest('hex')}`;
}
function validCalendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value))
        return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function legacyLocalDateSource(payloadJson) {
    try {
        const payload = JSON.parse(payloadJson);
        if (payload.metadata?.localDateSource === 'event_store_utc_default')
            return 'generated_utc';
        if (payload.metadata?.localDateSource === 'explicit')
            return 'explicit';
    }
    catch {
        return 'legacy_unknown';
    }
    return 'legacy_unknown';
}
