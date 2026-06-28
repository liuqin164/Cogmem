import Database from 'bun:sqlite';
import { existsSync } from 'node:fs';
/**
 * A query-only operational view. It deliberately does not initialize or migrate
 * schema, so status/candidate inspection can run beside an MCP process without
 * acquiring a write lock or changing an empty database.
 */
export class MemoryInspectionStore {
    dbPath;
    db;
    constructor(dbPath) {
        this.dbPath = dbPath;
        if (!existsSync(dbPath))
            return;
        this.db = new Database(dbPath, { readonly: true, create: false });
        this.db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;');
    }
    status(scope = {}) {
        const rawEventCount = this.countScopedEvents(scope);
        const rawLedgerCount = this.countRawEvents(scope.projectId);
        const dreamState = this.readDreamState(scope.projectId);
        const dreamedRawCount = dreamState.lastDreamedGlobalSeq === undefined
            ? 0
            : this.countRawEvents(scope.projectId, dreamState.lastDreamedGlobalSeq);
        const undreamedRawCount = Math.max(0, rawLedgerCount - dreamedRawCount);
        const queue = this.candidateQueue(scope.projectId);
        const vectorCount = this.countTable('vector_index');
        const liveEmbeddings = this.countTable('neuron_embeddings');
        const episodeDream = this.episodeDream(scope.projectId);
        const dreamBacklog = {
            projectId: scope.projectId,
            rawEventCount: rawLedgerCount,
            dreamedRawCount,
            undreamedRawCount,
            dreamCoverageRate: rawLedgerCount === 0 ? 1 : dreamedRawCount / rawLedgerCount,
            lastDreamedGlobalSeq: dreamState.lastDreamedGlobalSeq,
            lastDreamedAt: dreamState.lastDreamedAt,
            updatedAt: dreamState.updatedAt,
        };
        return {
            rawEventCount,
            rawEvents: rawEventCount,
            vectorCount,
            vectors: vectorCount,
            vectorState: {
                indexed: vectorCount,
                liveEmbeddings,
                recallAvailableWithoutVectors: rawLedgerCount > 0 || this.tableExists('beliefs') || this.tableExists('facts'),
                status: vectorCount > 0 || liveEmbeddings > 0 ? 'indexed' : 'not_indexed',
            },
            dreamedRawCount,
            undreamedRawCount,
            dreamCoverageRate: rawLedgerCount === 0 ? 1 : dreamedRawCount / rawLedgerCount,
            lastDreamedGlobalSeq: dreamState.lastDreamedGlobalSeq,
            lastDreamedAt: dreamState.lastDreamedAt,
            dreamBacklog,
            episodeDream,
            dreamCandidateQueue: queue,
            activeBeliefs: this.countBeliefs(scope.projectId),
        };
    }
    listCandidates(options) {
        if (!this.tableExists('deep_write_candidates') || !this.tableExists('deep_write_runs'))
            return [];
        const conditions = ['c.status = ?'];
        const params = [options.status];
        if (options.projectId) {
            conditions.push('r.project_id = ?');
            params.push(options.projectId);
        }
        params.push(Math.max(1, Math.min(options.limit, 5000)));
        const rows = this.db.prepare(`
      SELECT c.* FROM deep_write_candidates c
      JOIN deep_write_runs r ON r.run_id = c.run_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.created_at ASC, c.candidate_id ASC
      LIMIT ?
    `).all(...params);
        return rows.map((row) => ({
            candidateId: String(row.candidate_id),
            runId: String(row.run_id),
            candidateType: String(row.candidate_type),
            status: row.status,
            confidence: Number(row.confidence),
            content: parseJson(row.content_json),
            evidence: parseJson(row.evidence_json),
            promotionTargetType: optionalString(row.promotion_target_type),
            promotionTargetId: optionalString(row.promotion_target_id),
            statusReason: optionalString(row.status_reason),
            reviewAfter: optionalNumber(row.review_after),
            createdAt: Number(row.created_at),
            updatedAt: Number(row.updated_at ?? row.created_at),
        }));
    }
    close() {
        if (!this.db)
            return;
        this.db.close();
        this.db = undefined;
    }
    tableExists(name) {
        if (!this.db)
            return false;
        return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?`).get(name));
    }
    countTable(name) {
        if (!this.tableExists(name))
            return 0;
        return Number(this.db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get()?.count || 0);
    }
    countScopedEvents(scope) {
        if (!this.tableExists('memory_events'))
            return 0;
        const conditions = [];
        const params = [];
        for (const [column, value] of [
            ['project_id', scope.projectId], ['workspace_id', scope.workspaceId],
            ['thread_id', scope.threadId], ['session_id', scope.sessionId],
        ]) {
            if (!value)
                continue;
            conditions.push(`${column} = ?`);
            params.push(value);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        return Number(this.db.prepare(`SELECT COUNT(*) AS count FROM memory_events ${where}`).get(...params)?.count || 0);
    }
    countRawEvents(projectId, maxGlobalSeq) {
        if (!this.tableExists('memory_events'))
            return 0;
        const conditions = [`event_type = 'RAW_EVENT_RECORDED'`];
        const params = [];
        if (projectId) {
            conditions.push('project_id = ?');
            params.push(projectId);
        }
        if (maxGlobalSeq !== undefined) {
            conditions.push('global_seq <= ?');
            params.push(maxGlobalSeq);
        }
        return Number(this.db.prepare(`SELECT COUNT(*) AS count FROM memory_events WHERE ${conditions.join(' AND ')}`).get(...params)?.count || 0);
    }
    readDreamState(projectId) {
        if (!this.tableExists('dream_ledger_state'))
            return {};
        const row = this.db.prepare(`
      SELECT last_dreamed_global_seq, last_dreamed_at, updated_at
      FROM dream_ledger_state WHERE project_key = ?
    `).get(projectId || '__global__');
        return row ? {
            lastDreamedGlobalSeq: optionalNumber(row.last_dreamed_global_seq),
            lastDreamedAt: optionalNumber(row.last_dreamed_at),
            updatedAt: optionalNumber(row.updated_at),
        } : {};
    }
    episodeDream(projectId) {
        const result = {
            projectId, pending: 0, processing: 0, processed: 0, failed: 0,
            failedRetryable: 0, failedTerminal: 0, retryScheduled: 0, skipped: 0,
        };
        if (!this.tableExists('episode_dream_jobs'))
            return result;
        const rows = (projectId
            ? this.db.prepare(`SELECT state, COUNT(*) AS count FROM episode_dream_jobs WHERE project_id = ? GROUP BY state`).all(projectId)
            : this.db.prepare(`SELECT state, COUNT(*) AS count FROM episode_dream_jobs GROUP BY state`).all());
        const keys = {
            pending: 'pending', processing: 'processing', processed: 'processed', skipped: 'skipped',
            failed_retryable: 'failedRetryable', failed_terminal: 'failedTerminal', retry_scheduled: 'retryScheduled',
        };
        for (const row of rows)
            if (keys[row.state])
                result[keys[row.state]] = Number(row.count);
        result.failed = Number(result.failedRetryable) + Number(result.failedTerminal);
        return result;
    }
    candidateQueue(projectId) {
        const result = { candidate: 0, needsConfirmation: 0, promoted: 0, rejected: 0, superseded: 0, shadow: 0 };
        if (!this.tableExists('deep_write_candidates') || !this.tableExists('deep_write_runs'))
            return result;
        const rows = (projectId
            ? this.db.prepare(`SELECT c.status, COUNT(*) AS count FROM deep_write_candidates c JOIN deep_write_runs r ON r.run_id = c.run_id WHERE r.project_id = ? GROUP BY c.status`).all(projectId)
            : this.db.prepare(`SELECT status, COUNT(*) AS count FROM deep_write_candidates GROUP BY status`).all());
        for (const row of rows) {
            if (row.status === 'needs_confirmation')
                result.needsConfirmation = Number(row.count);
            else if (row.status in result)
                result[row.status] = Number(row.count);
        }
        return result;
    }
    countBeliefs(projectId) {
        if (!this.tableExists('beliefs'))
            return 0;
        const row = projectId
            ? this.db.prepare(`SELECT COUNT(*) AS count FROM beliefs WHERE status = 'active' AND project_id = ?`).get(projectId)
            : this.db.prepare(`SELECT COUNT(*) AS count FROM beliefs WHERE status = 'active'`).get();
        return Number(row?.count || 0);
    }
}
function parseJson(value) {
    if (typeof value !== 'string')
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function optionalString(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function optionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
