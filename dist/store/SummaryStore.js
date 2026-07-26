import Database from 'bun:sqlite';
import { randomUUID } from 'crypto';
export class SummaryStore {
    db;
    constructor(dbOrPath = ':memory:') {
        this.db = typeof dbOrPath === 'string' ? new Database(dbOrPath) : dbOrPath;
        this.initSchema();
    }
    initSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS deep_write_summaries (
        summary_id TEXT PRIMARY KEY,
        project_id TEXT,
        session_id TEXT,
        scope TEXT NOT NULL,
        window_start INTEGER,
        window_end INTEGER,
        text TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        source_neuron_ids_json TEXT NOT NULL,
        deep_write_run_id TEXT,
        deep_write_candidate_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        superseded_by_summary_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_deep_write_summaries_project_scope
        ON deep_write_summaries(project_id, scope, window_end DESC);

      CREATE INDEX IF NOT EXISTS idx_deep_write_summaries_session
        ON deep_write_summaries(session_id, created_at DESC);

      CREATE VIRTUAL TABLE IF NOT EXISTS deep_write_summaries_fts
        USING fts5(text, content='deep_write_summaries', content_rowid='rowid');

      CREATE TRIGGER IF NOT EXISTS deep_write_summaries_ai
      AFTER INSERT ON deep_write_summaries BEGIN
        INSERT INTO deep_write_summaries_fts(rowid, text) VALUES (new.rowid, new.text);
      END;

      CREATE TRIGGER IF NOT EXISTS deep_write_summaries_ad
      AFTER DELETE ON deep_write_summaries BEGIN
        INSERT INTO deep_write_summaries_fts(deep_write_summaries_fts, rowid, text)
        VALUES('delete', old.rowid, old.text);
      END;

      CREATE TRIGGER IF NOT EXISTS deep_write_summaries_au
      AFTER UPDATE ON deep_write_summaries BEGIN
        INSERT INTO deep_write_summaries_fts(deep_write_summaries_fts, rowid, text)
        VALUES('delete', old.rowid, old.text);
        INSERT INTO deep_write_summaries_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
    `);
    }
    migrateLegacyFactSummaries() {
        this.initSchema();
        const factColumns = this.db.prepare(`PRAGMA table_info(facts)`).all();
        if (!factColumns.some((column) => column.name === 'predicate_family'))
            return 0;
        const rows = this.db.prepare(`
      SELECT *
      FROM facts
      WHERE predicate_family = 'deep_write_summary'
        AND status != 'superseded'
    `).all();
        let migrated = 0;
        for (const row of rows) {
            const factId = String(row.fact_id);
            const existing = this.db.prepare(`
        SELECT summary_id FROM deep_write_summaries WHERE deep_write_candidate_id = ?
      `).get(factId);
            if (!existing) {
                const metadata = parseJsonObject(row.metadata_json);
                this.insertSummary({
                    projectId: typeof metadata.projectId === 'string' ? metadata.projectId : undefined,
                    sessionId: typeof metadata.sessionId === 'string' ? metadata.sessionId : undefined,
                    scope: 'turn_window',
                    windowStart: typeof row.valid_from === 'number' ? row.valid_from : undefined,
                    windowEnd: typeof row.valid_from === 'number' ? row.valid_from : undefined,
                    text: String(row.object_value || row.source_text || ''),
                    confidence: Number(row.confidence || 0.5),
                    status: 'provisional',
                    sourceNeuronIds: [String(row.neuron_id)].filter(Boolean),
                    deepWriteRunId: typeof metadata.deep_write_run_id === 'string' ? metadata.deep_write_run_id : undefined,
                    deepWriteCandidateId: factId,
                    createdAt: Number(row.valid_from || Date.now()),
                    updatedAt: Date.now()
                });
                migrated += 1;
            }
            this.db.prepare(`
        UPDATE facts
        SET status = 'superseded',
            valid_to = COALESCE(valid_to, ?)
        WHERE fact_id = ?
      `).run(Date.now(), factId);
        }
        return migrated;
    }
    insertSummary(input) {
        const now = Date.now();
        const record = {
            ...input,
            summaryId: input.summaryId || `sum-${randomUUID()}`,
            createdAt: input.createdAt ?? now,
            updatedAt: input.updatedAt ?? now
        };
        this.db.prepare(`
      INSERT INTO deep_write_summaries (
        summary_id, project_id, session_id, scope, window_start, window_end,
        text, confidence, status, source_neuron_ids_json, deep_write_run_id,
        deep_write_candidate_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.summaryId, record.projectId ?? null, record.sessionId || null, record.scope, record.windowStart ?? null, record.windowEnd ?? null, record.text, record.confidence, record.status, JSON.stringify(record.sourceNeuronIds), record.deepWriteRunId || null, record.deepWriteCandidateId || null, record.createdAt, record.updatedAt);
        return record;
    }
    getById(id) {
        const row = this.db.prepare(`SELECT * FROM deep_write_summaries WHERE summary_id = ?`).get(id);
        return row ? this.mapRow(row) : null;
    }
    listByProject(projectId, options) {
        const params = [projectId];
        let sql = `SELECT * FROM deep_write_summaries WHERE COALESCE(project_id,'') = ?`;
        if (options?.scope) {
            sql += ` AND scope = ?`;
            params.push(options.scope);
        }
        sql += ` ORDER BY COALESCE(window_end, created_at) DESC, summary_id DESC LIMIT ?`;
        params.push(options?.limit ?? 20);
        return this.db.prepare(sql).all(...params).map((row) => this.mapRow(row));
    }
    listBySession(sessionId, projectId, options) {
        const rows = this.db.prepare(`
      SELECT * FROM deep_write_summaries
      WHERE session_id = ? AND COALESCE(project_id,'') = ?
      ORDER BY created_at DESC, summary_id DESC
      LIMIT ?
    `).all(sessionId, projectId, options?.limit ?? 20);
        return rows.map((row) => this.mapRow(row));
    }
    findRelevant(query, projectId, limit = 3) {
        const trimmed = query.trim();
        if (!trimmed)
            return [];
        const ftsQuery = trimmed.split(/\s+/).slice(0, 8).join(' OR ');
        const params = [ftsQuery];
        let sql = `
      SELECT s.*
      FROM deep_write_summaries_fts f
      JOIN deep_write_summaries s ON s.rowid = f.rowid
      WHERE deep_write_summaries_fts MATCH ?
        AND s.status IN ('provisional', 'verified')
    `;
        if (projectId !== undefined) {
            sql += ` AND COALESCE(s.project_id, '') = ?`;
            params.push(projectId);
        }
        sql += ` ORDER BY s.confidence DESC, s.updated_at DESC LIMIT ?`;
        params.push(limit);
        try {
            return this.db.prepare(sql).all(...params).map((row) => this.mapRow(row));
        }
        catch {
            return this.fallbackFindRelevant(trimmed, projectId, limit);
        }
    }
    markSuperseded(summaryId, supersededBySummaryId) {
        this.db.prepare(`
      UPDATE deep_write_summaries
      SET status = 'superseded',
          superseded_by_summary_id = COALESCE(?, superseded_by_summary_id),
          updated_at = ?
      WHERE summary_id = ?
    `).run(supersededBySummaryId || null, Date.now(), summaryId);
        return this.getById(summaryId);
    }
    fallbackFindRelevant(query, projectId, limit) {
        const tokens = query.toLowerCase().split(/\s+/).filter((token) => token.length >= 2);
        const rows = this.db.prepare(`
      SELECT * FROM deep_write_summaries
      WHERE status IN ('provisional', 'verified')
        AND (? IS NULL OR COALESCE(project_id, '') = ?)
      ORDER BY confidence DESC, updated_at DESC
      LIMIT 100
    `).all(projectId === undefined ? null : projectId, projectId === undefined ? null : projectId);
        return rows
            .map((row) => ({ row, score: tokens.filter((token) => row.text.toLowerCase().includes(token)).length }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score || b.row.confidence - a.row.confidence)
            .slice(0, limit)
            .map((item) => this.mapRow(item.row));
    }
    mapRow(row) {
        return {
            summaryId: row.summary_id,
            projectId: row.project_id == null ? undefined : String(row.project_id),
            sessionId: row.session_id || undefined,
            scope: row.scope,
            windowStart: row.window_start ?? undefined,
            windowEnd: row.window_end ?? undefined,
            text: row.text,
            confidence: row.confidence,
            status: row.status,
            sourceNeuronIds: JSON.parse(row.source_neuron_ids_json || '[]'),
            deepWriteRunId: row.deep_write_run_id || undefined,
            deepWriteCandidateId: row.deep_write_candidate_id || undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            supersededBySummaryId: row.superseded_by_summary_id || undefined
        };
    }
}
function parseJsonObject(value) {
    if (typeof value !== 'string' || !value.trim())
        return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
