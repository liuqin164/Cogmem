import { projectScope } from '../topology/ProjectScope.js';
export function dreamLedgerProjectKey(projectId) {
    if (projectId === undefined)
        return 'all';
    const scope = projectScope(projectId);
    return `scope:${scope.length}:${scope}`;
}
export class DreamLedgerStore {
    db;
    constructor(db) {
        this.db = db;
        this.initializeSchema();
    }
    getStatus(projectId) {
        const state = this.getState(projectId);
        const lastDreamedGlobalSeq = state?.lastDreamedGlobalSeq;
        const rawEventCount = this.countRawEvents(projectId);
        const dreamedRawCount = lastDreamedGlobalSeq === undefined
            ? 0
            : this.countRawEvents(projectId, { maxGlobalSeq: lastDreamedGlobalSeq });
        const undreamedRawCount = Math.max(0, rawEventCount - dreamedRawCount);
        return {
            projectId,
            rawEventCount,
            dreamedRawCount,
            undreamedRawCount,
            dreamCoverageRate: rawEventCount === 0 ? 1 : dreamedRawCount / rawEventCount,
            lastDreamedGlobalSeq,
            lastDreamedAt: state?.lastDreamedAt,
            updatedAt: state?.updatedAt,
        };
    }
    markDreamed(projectId, globalSeq, dreamedAt = Date.now()) {
        const key = dreamLedgerProjectKey(projectId);
        this.db.prepare(`
      INSERT INTO dream_ledger_state (project_key, project_id, last_dreamed_global_seq, last_dreamed_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_key) DO UPDATE SET
        last_dreamed_global_seq = excluded.last_dreamed_global_seq,
        last_dreamed_at = excluded.last_dreamed_at,
        updated_at = excluded.updated_at
    `).run(key, projectId === undefined ? null : projectScope(projectId), globalSeq, dreamedAt, dreamedAt);
        return this.getStatus(projectId);
    }
    initializeSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS dream_ledger_state (
        project_key TEXT PRIMARY KEY,
        project_id TEXT,
        last_dreamed_global_seq INTEGER,
        last_dreamed_at INTEGER,
        updated_at INTEGER NOT NULL
      );
    `);
    }
    getState(projectId) {
        const row = this.db.prepare(`
      SELECT last_dreamed_global_seq, last_dreamed_at, updated_at
      FROM dream_ledger_state
      WHERE project_key = ?
    `).get(dreamLedgerProjectKey(projectId));
        if (!row)
            return null;
        return {
            lastDreamedGlobalSeq: row.last_dreamed_global_seq ?? undefined,
            lastDreamedAt: row.last_dreamed_at ?? undefined,
            updatedAt: row.updated_at ?? undefined,
        };
    }
    countRawEvents(projectId, options = {}) {
        const conditions = [`event_type = 'RAW_EVENT_RECORDED'`];
        const params = [];
        if (projectId !== undefined) {
            conditions.push("COALESCE(project_id, '') = ?");
            params.push(projectScope(projectId));
        }
        if (options.maxGlobalSeq !== undefined) {
            conditions.push('global_seq <= ?');
            params.push(options.maxGlobalSeq);
        }
        const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM memory_events
      WHERE ${conditions.join(' AND ')}
    `).get(...params);
        return row?.count || 0;
    }
}
