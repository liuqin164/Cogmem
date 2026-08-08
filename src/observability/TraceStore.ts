import type Database from 'bun:sqlite';
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
  constructor(private db: Database) {}

  initSchema(): void {
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

  getDecisionChain(eventId: string): TraceEvent[] {
    const chain: TraceEvent[] = [];
    const visited = new Set<string>();
    let currentId: string | undefined = eventId;

    while (currentId && !visited.has(currentId)) {
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
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
}
