import type Database from 'bun:sqlite';
import { parseJsonObject } from '../utils/Values.js';
import type { TraceEvent, TraceEventType } from './TraceEvent.js';

interface TraceEventRow {
  id: string;
  timestamp: number;
  task_id: string | null;
  project_id: string | null;
  event_type: TraceEventType;
  payload: string;
  parent_event_id: string | null;
}

export class TraceStore {
  /**
   * A read-only store never initializes the schema and refuses every write. The observatory opens
   * the database `readonly: true` and may not create the table it is about to read (#206); a
   * factory makes that promise explicit instead of relying on the caller not to call `initSchema`.
   */
  static readOnly(db: Database): TraceStore {
    return new TraceStore(db, { readonly: true });
  }

  constructor(private db: Database, private readonly options: { readonly?: boolean } = {}) {}

  initSchema(): void {
    this.assertWritable();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trace_events (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        task_id TEXT,
        project_id TEXT,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        parent_event_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_trace_events_task_id_timestamp
        ON trace_events(task_id, timestamp);

      CREATE INDEX IF NOT EXISTS idx_trace_events_project_id_timestamp
        ON trace_events(project_id, timestamp);

      CREATE INDEX IF NOT EXISTS idx_trace_events_event_type_timestamp
        ON trace_events(event_type, timestamp);

      CREATE INDEX IF NOT EXISTS idx_trace_events_parent_event_id
        ON trace_events(parent_event_id);
    `);
  }

  append(event: TraceEvent): void {
    this.assertWritable();
    this.db.prepare(`
      INSERT INTO trace_events (
        id,
        timestamp,
        task_id,
        project_id,
        event_type,
        payload,
        parent_event_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.timestamp,
      event.taskId ?? null,
      event.projectId ?? null,
      event.eventType,
      JSON.stringify(event.payload),
      event.parentEventId ?? null
    );
  }

  /**
   * Keep the newest `maxRows` events and delete the rest.
   *
   * The trace is append-only by nature and nothing else trims it, so without this the table the
   * observatory lists grows without bound. One statement; the writer that owns the retention policy
   * runs it in the background of its own appends rather than on every recall.
   */
  pruneToLimit(maxRows: number): number {
    this.assertWritable();
    const result = this.db.prepare(`
      DELETE FROM trace_events WHERE id IN (
        SELECT id FROM trace_events ORDER BY timestamp DESC, id DESC LIMIT -1 OFFSET ?
      )
    `).run(Math.max(0, Math.floor(maxRows)));
    return Number(result.changes ?? 0);
  }

  queryByTaskId(taskId: string): TraceEvent[] {
    const rows = this.db.prepare(`
      SELECT id, timestamp, task_id, project_id, event_type, payload, parent_event_id
      FROM trace_events
      WHERE task_id = ?
      ORDER BY timestamp ASC, id ASC
    `).all(taskId) as TraceEventRow[];

    return rows.map((row) => this.mapRow(row));
  }

  queryByEventType(eventType: TraceEventType): TraceEvent[] {
    const rows = this.db.prepare(`
      SELECT id, timestamp, task_id, project_id, event_type, payload, parent_event_id
      FROM trace_events
      WHERE event_type = ?
      ORDER BY timestamp ASC, id ASC
    `).all(eventType) as TraceEventRow[];

    return rows.map((row) => this.mapRow(row));
  }

  queryByProjectId(projectId: string): TraceEvent[] {
    const rows = this.db.prepare(`
      SELECT id, timestamp, task_id, project_id, event_type, payload, parent_event_id
      FROM trace_events
      WHERE project_id = ?
      ORDER BY timestamp ASC, id ASC
    `).all(projectId) as TraceEventRow[];

    return rows.map((row) => this.mapRow(row));
  }

  /**
   * Walk `parent_event_id` from `eventId` up to the root.
   *
   * `limit` is the display layer's payload bound, not a traversal rule: the chain keeps the nearest
   * `limit` events (the leaf side) and is returned root-first like the unbounded call. Callers that
   * need the full chain omit it, which is what `TraceQuery.decisionChain` does.
   */
  getDecisionChain(eventId: string, limit?: number): TraceEvent[] {
    const max = limit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(limit));
    const chain: TraceEvent[] = [];
    const visited = new Set<string>();
    let currentId: string | undefined = eventId;

    while (currentId && !visited.has(currentId) && chain.length < max) {
      visited.add(currentId);
      const row = this.db.prepare(`
        SELECT id, timestamp, task_id, project_id, event_type, payload, parent_event_id
        FROM trace_events
        WHERE id = ?
      `).get(currentId) as TraceEventRow | null;

      if (!row) break;

      const event = this.mapRow(row);
      chain.push(event);
      currentId = event.parentEventId;
    }

    return chain.reverse();
  }

  private mapRow(row: TraceEventRow): TraceEvent {
    return {
      id: row.id,
      timestamp: row.timestamp,
      taskId: row.task_id ?? undefined,
      projectId: row.project_id == null ? undefined : String(row.project_id),
      eventType: row.event_type,
      payload: this.parsePayload(row.payload),
      parentEventId: row.parent_event_id ?? undefined
    };
  }

  private parsePayload(value: string): Record<string, unknown> {
    return parseJsonObject(value);
  }

  private assertWritable(): void {
    if (this.options.readonly) throw new Error('trace_store_read_only');
  }
}
