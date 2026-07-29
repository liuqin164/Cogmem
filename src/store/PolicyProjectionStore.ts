import Database from 'bun:sqlite';
import type { ProjectionCheckpoint } from './EventStore.js';

export class PolicyProjectionStore {
  private db: Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    const exists = this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='policy_projection_state'`).get();
    if (exists) {
      const columns = new Set((this.db.prepare(`PRAGMA table_info(policy_projection_state)`).all() as Array<{ name: string }>).map((row) => row.name));
      if (!columns.has('last_global_seq')) throw new Error('projection_schema_not_migrated:policy_projection_state');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS policy_projection_state (
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
    `);
  }

  getCheckpoint(projectionName: string): ProjectionCheckpoint | null {
    const row = this.db.prepare(`
      SELECT * FROM policy_projection_state WHERE projection_name = ?
    `).get(projectionName) as any;

    if (!row) return null;
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

  upsertCheckpoint(checkpoint: ProjectionCheckpoint): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO policy_projection_state (
        projection_name, last_event_id, last_event_time, last_global_seq, last_rebuild_at,
        last_full_count, last_checksum, status, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      checkpoint.projectionName,
      checkpoint.lastEventId || null,
      checkpoint.lastEventTime ?? null,
      checkpoint.lastGlobalSeq ?? null,
      checkpoint.lastRebuildAt ?? null,
      checkpoint.lastFullCount,
      checkpoint.lastChecksum || null,
      checkpoint.status,
      checkpoint.metadata ? JSON.stringify(checkpoint.metadata) : null
    );
  }

  getStats(projectionName: string): {
    projectionName: string;
    checkpointStatus: 'idle' | 'building' | 'ready' | 'degraded' | 'failed';
    lastEventId?: string;
    lastEventTime?: number;
    lastRebuildAt?: number;
    lastFullCount: number;
  } {
    const checkpoint = this.getCheckpoint(projectionName);
    return {
      projectionName,
      checkpointStatus: checkpoint?.status || 'idle',
      lastEventId: checkpoint?.lastEventId,
      lastEventTime: checkpoint?.lastEventTime,
      lastRebuildAt: checkpoint?.lastRebuildAt,
      lastFullCount: checkpoint?.lastFullCount || 0
    };
  }

  close(): void {
    this.db.close();
  }
}
