import Database from 'bun:sqlite';
export class IngestionCursorStore {
    db;
    closed = false;
    constructor(dbPath = ':memory:') {
        this.db = new Database(dbPath);
        this.initializeSchema();
    }
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS ingestion_source_cursors (
        source_id TEXT PRIMARY KEY,
        source_path TEXT NOT NULL,
        source_type TEXT NOT NULL,
        project_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_processed_at INTEGER,
        last_seen_hash TEXT,
        last_seen_mtime INTEGER,
        content_window_start INTEGER,
        content_window_end INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ingestion_processed_records (
        record_hash TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        source_type TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        content_window_start INTEGER NOT NULL,
        content_window_end INTEGER NOT NULL,
        processed_at INTEGER NOT NULL,
        neuron_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_ingestion_processed_source_window
        ON ingestion_processed_records(source_id, content_window_start, content_window_end, processed_at DESC);
    `);
    }
    registerSource(source) {
        const now = Date.now();
        this.db.prepare(`
      INSERT INTO ingestion_source_cursors (
        source_id, source_path, source_type, project_id, enabled, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        source_path = excluded.source_path,
        source_type = excluded.source_type,
        project_id = excluded.project_id,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `).run(source.sourceId, source.sourcePath, source.adapterKind, source.projectId || null, source.enabled === false ? 0 : 1, now);
    }
    listRegisteredSources() {
        const rows = this.db.prepare(`
      SELECT *
      FROM ingestion_source_cursors
      WHERE enabled = 1
      ORDER BY updated_at DESC, source_id ASC
    `).all();
        return rows.map((row) => this.mapCursor(row));
    }
    getCursor(sourceId) {
        const row = this.db.prepare(`
      SELECT *
      FROM ingestion_source_cursors
      WHERE source_id = ?
    `).get(sourceId);
        return row ? this.mapCursor(row) : null;
    }
    hasProcessedRecord(recordHash) {
        const row = this.db.prepare(`
      SELECT 1
      FROM ingestion_processed_records
      WHERE record_hash = ?
      LIMIT 1
    `).get(recordHash);
        return Boolean(row);
    }
    markRecordProcessed(record) {
        this.db.prepare(`
      INSERT OR REPLACE INTO ingestion_processed_records (
        record_hash, source_id, source_path, source_type, content_hash,
        content_window_start, content_window_end, processed_at, neuron_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.recordHash, record.sourceId, record.sourcePath, record.sourceType, record.contentHash, record.contentWindowStart, record.contentWindowEnd, record.processedAt, record.neuronId || null);
    }
    updateCursor(input) {
        this.db.prepare(`
      INSERT INTO ingestion_source_cursors (
        source_id, source_path, source_type, project_id, enabled,
        last_processed_at, last_seen_hash, last_seen_mtime,
        content_window_start, content_window_end, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        source_path = excluded.source_path,
        source_type = excluded.source_type,
        project_id = excluded.project_id,
        last_processed_at = excluded.last_processed_at,
        last_seen_hash = excluded.last_seen_hash,
        last_seen_mtime = excluded.last_seen_mtime,
        content_window_start = excluded.content_window_start,
        content_window_end = excluded.content_window_end,
        updated_at = excluded.updated_at
    `).run(input.sourceId, input.sourcePath, input.sourceType, input.projectId || null, input.lastProcessedAt, input.lastSeenHash, input.lastSeenMtime, input.contentWindowStart, input.contentWindowEnd, Date.now());
    }
    listProcessedRecordHashes(sourceId, windowStart, windowEnd) {
        const rows = this.db.prepare(`
      SELECT record_hash
      FROM ingestion_processed_records
      WHERE source_id = ?
        AND content_window_start = ?
        AND content_window_end = ?
    `).all(sourceId, windowStart, windowEnd);
        return new Set(rows.map((row) => row.record_hash));
    }
    listRecentUnprocessedSources(since) {
        const rows = this.db.prepare(`
      SELECT *
      FROM ingestion_source_cursors
      WHERE enabled = 1
        AND (
          last_processed_at IS NULL
          OR content_window_end IS NULL
          OR content_window_end < ?
        )
      ORDER BY updated_at DESC
    `).all(since);
        return rows.map((row) => this.mapCursor(row));
    }
    close() {
        if (this.closed)
            return;
        this.db.close();
        this.closed = true;
    }
    mapCursor(row) {
        return {
            sourceId: row.source_id,
            sourcePath: row.source_path,
            sourceType: row.source_type,
            projectId: row.project_id || undefined,
            enabled: row.enabled === 1,
            lastProcessedAt: row.last_processed_at || undefined,
            lastSeenHash: row.last_seen_hash || undefined,
            lastSeenMtime: row.last_seen_mtime || undefined,
            contentWindowStart: row.content_window_start || undefined,
            contentWindowEnd: row.content_window_end || undefined,
            updatedAt: row.updated_at
        };
    }
}
