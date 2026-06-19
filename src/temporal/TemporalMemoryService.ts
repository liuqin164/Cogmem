import Database from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

export type TimelineEntryType = 'milestone' | 'decision' | 'correction' | 'belief_version';

export interface TimelineEntryRecord {
  entryId: string;
  projectId?: string;
  entryType: TimelineEntryType;
  canonicalKey?: string;
  entityId?: string;
  beliefId?: string;
  title: string;
  summary?: string;
  reason?: string;
  occurredAt: number;
  evidenceEventIds: string[];
  createdAt: number;
}

export interface RecordTimelineEntryInput {
  projectId?: string;
  entryType: TimelineEntryType;
  canonicalKey?: string;
  entityId?: string;
  beliefId?: string;
  title: string;
  summary?: string;
  reason?: string;
  occurredAt?: number;
  evidenceEventIds: string[];
}

export interface TimelineListOptions {
  projectId?: string;
  canonicalKey?: string;
  entityId?: string;
  entryTypes?: TimelineEntryType[];
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export interface TemporalBeliefRecord {
  beliefId: string;
  projectId?: string;
  canonicalKey: string;
  statement: string;
  status: string;
  version: number;
  validFrom: number;
  validTo?: number;
  supersedesBeliefId?: string;
  supersededByBeliefId?: string;
}

export class TemporalMemoryService {
  constructor(private readonly db: Database) {
    this.initializeSchema();
  }

  record(input: RecordTimelineEntryInput): TimelineEntryRecord {
    const title = input.title.trim();
    if (!title) throw new Error('timeline_title_required');
    const now = Date.now();
    const occurredAt = input.occurredAt ?? now;
    const entryId = `timeline-${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO memory_timeline_entries (
        entry_id, project_id, entry_type, canonical_key, entity_id, belief_id,
        title, summary, reason, occurred_at, evidence_event_ids_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entryId, input.projectId ?? null, input.entryType, input.canonicalKey?.trim().toLowerCase() ?? null,
      input.entityId ?? null, input.beliefId ?? null, title, input.summary ?? null, input.reason ?? null,
      occurredAt, JSON.stringify([...new Set(input.evidenceEventIds)]), now,
    );
    return this.get(entryId)!;
  }

  get(entryId: string): TimelineEntryRecord | null {
    const row = this.db.prepare(`SELECT * FROM memory_timeline_entries WHERE entry_id = ?`).get(entryId) as Record<string, unknown> | null;
    return row ? this.mapTimelineRow(row) : null;
  }

  list(options: TimelineListOptions = {}): TimelineEntryRecord[] {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (options.projectId) { conditions.push('project_id = ?'); params.push(options.projectId); }
    if (options.canonicalKey) { conditions.push('canonical_key = ?'); params.push(options.canonicalKey.trim().toLowerCase()); }
    if (options.entityId) { conditions.push('entity_id = ?'); params.push(options.entityId); }
    if (options.startTime !== undefined) { conditions.push('occurred_at >= ?'); params.push(options.startTime); }
    if (options.endTime !== undefined) { conditions.push('occurred_at < ?'); params.push(options.endTime); }
    if (options.entryTypes?.length) {
      conditions.push(`entry_type IN (${options.entryTypes.map(() => '?').join(', ')})`);
      params.push(...options.entryTypes);
    }
    const limit = Math.max(1, Math.min(500, options.limit ?? 100));
    const rows = this.db.prepare(`
      SELECT * FROM memory_timeline_entries
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY occurred_at DESC, created_at DESC
      LIMIT ?
    `).all(...params, limit) as Record<string, unknown>[];
    return rows.map((row) => this.mapTimelineRow(row));
  }

  getBeliefAt(projectId: string | undefined, canonicalKey: string, atTime: number): TemporalBeliefRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM belief_graph_nodes
      WHERE canonical_key = ?
        AND ((? IS NULL AND project_id IS NULL) OR project_id = ?)
        AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)
        AND status != 'rejected' AND status != 'possible_conflict'
      ORDER BY valid_from DESC LIMIT 1
    `).get(canonicalKey.trim().toLowerCase(), projectId ?? null, projectId ?? null, atTime, atTime) as Record<string, unknown> | null;
    return row ? this.mapBeliefRow(row) : null;
  }

  getBeliefHistory(projectId: string | undefined, canonicalKey: string): TemporalBeliefRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM belief_graph_nodes
      WHERE canonical_key = ? AND ((? IS NULL AND project_id IS NULL) OR project_id = ?)
        AND status != 'rejected' AND status != 'possible_conflict'
      ORDER BY valid_from ASC, created_at ASC
    `).all(canonicalKey.trim().toLowerCase(), projectId ?? null, projectId ?? null) as Record<string, unknown>[];
    return rows.map((row) => this.mapBeliefRow(row));
  }

  private mapTimelineRow(row: Record<string, unknown>): TimelineEntryRecord {
    return {
      entryId: String(row.entry_id),
      projectId: row.project_id == null ? undefined : String(row.project_id),
      entryType: row.entry_type as TimelineEntryType,
      canonicalKey: row.canonical_key == null ? undefined : String(row.canonical_key),
      entityId: row.entity_id == null ? undefined : String(row.entity_id),
      beliefId: row.belief_id == null ? undefined : String(row.belief_id),
      title: String(row.title),
      summary: row.summary == null ? undefined : String(row.summary),
      reason: row.reason == null ? undefined : String(row.reason),
      occurredAt: Number(row.occurred_at),
      evidenceEventIds: JSON.parse(String(row.evidence_event_ids_json)),
      createdAt: Number(row.created_at),
    };
  }

  private mapBeliefRow(row: Record<string, unknown>): TemporalBeliefRecord {
    return {
      beliefId: String(row.belief_id),
      projectId: row.project_id == null ? undefined : String(row.project_id),
      canonicalKey: String(row.canonical_key),
      statement: String(row.statement),
      status: String(row.status),
      version: Number(row.version),
      validFrom: Number(row.valid_from),
      validTo: row.valid_to == null ? undefined : Number(row.valid_to),
      supersedesBeliefId: row.supersedes_belief_id == null ? undefined : String(row.supersedes_belief_id),
      supersededByBeliefId: row.superseded_by_belief_id == null ? undefined : String(row.superseded_by_belief_id),
    };
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_timeline_entries (
        entry_id TEXT PRIMARY KEY, project_id TEXT, entry_type TEXT NOT NULL, canonical_key TEXT,
        entity_id TEXT, belief_id TEXT, title TEXT NOT NULL, summary TEXT, reason TEXT,
        occurred_at INTEGER NOT NULL, evidence_event_ids_json TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_timeline_project_time
        ON memory_timeline_entries(project_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_timeline_canonical_time
        ON memory_timeline_entries(project_id, canonical_key, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_timeline_entity_time
        ON memory_timeline_entries(project_id, entity_id, occurred_at DESC);
    `);
  }
}
