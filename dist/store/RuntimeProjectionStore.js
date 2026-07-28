import Database from 'bun:sqlite';
export class RuntimeProjectionStore {
    db;
    constructor(dbPath = ':memory:') {
        this.db = new Database(dbPath);
        this.initializeSchema();
    }
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_projection_state (
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
    getCheckpoint(projectionName) {
        const row = this.db.prepare(`
      SELECT * FROM runtime_projection_state WHERE projection_name = ?
    `).get(projectionName);
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
    upsertCheckpoint(checkpoint) {
        this.db.prepare(`
      INSERT OR REPLACE INTO runtime_projection_state (
        projection_name, last_event_id, last_event_time, last_global_seq, last_rebuild_at,
        last_full_count, last_checksum, status, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(checkpoint.projectionName, checkpoint.lastEventId || null, checkpoint.lastEventTime ?? null, checkpoint.lastGlobalSeq ?? null, checkpoint.lastRebuildAt ?? null, checkpoint.lastFullCount, checkpoint.lastChecksum || null, checkpoint.status, checkpoint.metadata ? JSON.stringify(checkpoint.metadata) : null);
    }
    getStats(projectionName) {
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
    close() {
        this.db.close();
    }
}
