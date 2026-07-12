import { randomUUID } from 'crypto';
export class DeepWriteCandidateStore {
    db;
    constructor(db) {
        this.db = db;
        this.initSchema();
    }
    getDatabase() {
        return this.db;
    }
    countActivePromotions(targetType, targetId, excludingCandidateId) {
        const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM deep_write_candidates
      WHERE promotion_target_type = ?
        AND promotion_target_id = ?
        AND status IN ('staged', 'candidate', 'promoted', 'needs_confirmation')
        AND (? IS NULL OR candidate_id <> ?)
    `).get(targetType, targetId, excludingCandidateId || null, excludingCandidateId || null);
        return Number(row?.count || 0);
    }
    initSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS deep_write_runs (
        run_id TEXT PRIMARY KEY,
        project_id TEXT,
        session_id TEXT,
        source_neuron_ids_json TEXT NOT NULL,
        model_provider TEXT,
        model_name TEXT,
        mode TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        output_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at INTEGER NOT NULL,
        source_episode_id TEXT,
        dream_job_lease_id TEXT,
        lease_until INTEGER,
        attempt_generation INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS deep_write_candidates (
        candidate_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        candidate_type TEXT NOT NULL,
        status TEXT NOT NULL,
        confidence REAL NOT NULL,
        content_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        promotion_target_type TEXT,
        promotion_target_id TEXT,
        status_reason TEXT,
        review_after INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(run_id) REFERENCES deep_write_runs(run_id)
      );

      CREATE INDEX IF NOT EXISTS idx_deep_write_runs_project_created
        ON deep_write_runs(project_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_deep_write_candidates_run
        ON deep_write_candidates(run_id);

      CREATE INDEX IF NOT EXISTS idx_deep_write_candidates_status
        ON deep_write_candidates(status, candidate_type);
    `);
        this.ensureColumn('deep_write_candidates', 'status_reason', 'TEXT');
        this.ensureColumn('deep_write_candidates', 'publish_status', 'TEXT');
        this.ensureColumn('deep_write_candidates', 'review_after', 'INTEGER');
        this.ensureColumn('deep_write_candidates', 'updated_at', 'INTEGER');
        this.ensureColumn('deep_write_runs', 'source_episode_id', 'TEXT');
        this.ensureColumn('deep_write_runs', 'dream_job_lease_id', 'TEXT');
        this.ensureColumn('deep_write_runs', 'lease_until', 'INTEGER');
        this.ensureColumn('deep_write_runs', 'attempt_generation', 'INTEGER');
        this.ensureColumn('deep_write_runs', 'updated_at', 'INTEGER');
        this.db.exec(`
      UPDATE deep_write_candidates
      SET updated_at = created_at
      WHERE updated_at IS NULL
    `);
    }
    insertRun(input) {
        const record = {
            ...input,
            runId: input.runId || randomUUID(),
            createdAt: input.createdAt ?? Date.now()
        };
        this.db.prepare(`
      INSERT INTO deep_write_runs (
        run_id, project_id, session_id, source_neuron_ids_json, model_provider,
        model_name, mode, prompt_hash, output_hash, status, error, created_at
        , source_episode_id, dream_job_lease_id, lease_until, attempt_generation, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.runId, record.projectId || null, record.sessionId || null, JSON.stringify(record.sourceNeuronIds), record.modelProvider || null, record.modelName || null, record.mode, record.promptHash, record.outputHash, record.status, record.error || null, record.createdAt, record.sourceEpisodeId || null, record.dreamJobLeaseId || null, record.leaseUntil ?? null, record.attemptGeneration ?? null, record.updatedAt ?? record.createdAt);
        return record;
    }
    insertCandidates(inputs) {
        const records = inputs.map((input) => ({
            ...input,
            candidateId: input.candidateId || randomUUID(),
            createdAt: input.createdAt ?? Date.now(),
            updatedAt: input.createdAt ?? Date.now()
        }));
        const stmt = this.db.prepare(`
      INSERT INTO deep_write_candidates (
        candidate_id, run_id, candidate_type, status, confidence, content_json,
        evidence_json, promotion_target_type, promotion_target_id, status_reason,
        publish_status, review_after, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        this.db.transaction(() => {
            for (const record of records) {
                stmt.run(record.candidateId, record.runId, record.candidateType, record.status, record.confidence, JSON.stringify(record.content), JSON.stringify(record.evidence), record.promotionTargetType || null, record.promotionTargetId || null, record.statusReason || null, record.publishStatus || null, record.reviewAfter ?? null, record.createdAt, record.updatedAt);
            }
        })();
        return records;
    }
    getRun(runId) {
        const row = this.db.prepare(`
      SELECT *
      FROM deep_write_runs
      WHERE run_id = ?
    `).get(runId);
        return row ? this.mapRun(row) : null;
    }
    listCandidatesByRun(runId) {
        const rows = this.db.prepare(`
      SELECT *
      FROM deep_write_candidates
      WHERE run_id = ?
      ORDER BY created_at ASC, candidate_id ASC
    `).all(runId);
        return rows.map((row) => this.mapCandidate(row));
    }
    getCandidate(candidateId) {
        const row = this.db.prepare(`
      SELECT *
      FROM deep_write_candidates
      WHERE candidate_id = ?
    `).get(candidateId);
        return row ? this.mapCandidate(row) : null;
    }
    claimCandidate(candidateId, updatedAt = Date.now()) {
        const result = this.db.prepare(`
      UPDATE deep_write_candidates
      SET status = 'promoting', updated_at = ?
      WHERE candidate_id = ? AND status = 'candidate'
    `).run(updatedAt, candidateId);
        return Number(result.changes || 0) === 1;
    }
    listCandidatesByStatus(statuses, options) {
        if (statuses.length === 0)
            return [];
        const params = [...statuses];
        let sql = `
      SELECT *
      FROM deep_write_candidates
      WHERE status IN (${statuses.map(() => '?').join(', ')})
    `;
        if (options?.candidateTypes?.length) {
            sql += ` AND candidate_type IN (${options.candidateTypes.map(() => '?').join(', ')})`;
            params.push(...options.candidateTypes);
        }
        sql += ` ORDER BY created_at ASC, candidate_id ASC LIMIT ?`;
        params.push(options?.limit ?? 100);
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((row) => this.mapCandidate(row));
    }
    listCandidates(options = {}) {
        const params = [];
        const conditions = options.statuses?.includes('staged') ? [] : ["c.status <> 'staged'"];
        let sql = `
      SELECT c.*
      FROM deep_write_candidates c
      JOIN deep_write_runs r ON r.run_id = c.run_id
    `;
        if (options.statuses?.length) {
            conditions.push(`c.status IN (${options.statuses.map(() => '?').join(', ')})`);
            params.push(...options.statuses);
        }
        if (options.candidateTypes?.length) {
            conditions.push(`c.candidate_type IN (${options.candidateTypes.map(() => '?').join(', ')})`);
            params.push(...options.candidateTypes);
        }
        if (options.projectId) {
            conditions.push('r.project_id = ?');
            params.push(options.projectId);
        }
        if (options.runId) {
            conditions.push('c.run_id = ?');
            params.push(options.runId);
        }
        if (options.after) {
            conditions.push('(c.created_at > ? OR (c.created_at = ? AND c.candidate_id > ?))');
            params.push(options.after.createdAt, options.after.createdAt, options.after.candidateId);
        }
        if (conditions.length)
            sql += ` WHERE ${conditions.join(' AND ')}`;
        sql += ` ORDER BY c.created_at ASC, c.candidate_id ASC LIMIT ?`;
        params.push(options.limit ?? 100);
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((row) => this.mapCandidate(row));
    }
    countCandidates(options = {}) {
        const params = [];
        const conditions = options.statuses?.includes('staged') ? [] : ["c.status <> 'staged'"];
        let sql = `
      SELECT COUNT(*) AS count
      FROM deep_write_candidates c
      JOIN deep_write_runs r ON r.run_id = c.run_id
    `;
        if (options.statuses?.length) {
            conditions.push(`c.status IN (${options.statuses.map(() => '?').join(', ')})`);
            params.push(...options.statuses);
        }
        if (options.candidateTypes?.length) {
            conditions.push(`c.candidate_type IN (${options.candidateTypes.map(() => '?').join(', ')})`);
            params.push(...options.candidateTypes);
        }
        if (options.projectId) {
            conditions.push('r.project_id = ?');
            params.push(options.projectId);
        }
        if (options.runId) {
            conditions.push('c.run_id = ?');
            params.push(options.runId);
        }
        if (conditions.length)
            sql += ` WHERE ${conditions.join(' AND ')}`;
        const row = this.db.prepare(sql).get(...params);
        return row?.count || 0;
    }
    updateCandidateStatus(candidateId, status, promotionTarget, expectedStatus) {
        this.db.prepare(`
      UPDATE deep_write_candidates
      SET status = ?,
          promotion_target_type = COALESCE(?, promotion_target_type),
          promotion_target_id = COALESCE(?, promotion_target_id),
          status_reason = COALESCE(?, status_reason),
          review_after = COALESCE(?, review_after),
          updated_at = ?
      WHERE candidate_id = ? AND (? IS NULL OR status = ?)
    `).run(status, promotionTarget?.type || null, promotionTarget?.id || null, promotionTarget?.reason || null, promotionTarget?.reviewAfter ?? null, promotionTarget?.updatedAt ?? Date.now(), candidateId, expectedStatus || null, expectedStatus || null);
    }
    publishStagedCandidates(runId, candidateIds, updatedAt) {
        const statement = this.db.prepare(`UPDATE deep_write_candidates SET status = COALESCE(publish_status, 'candidate'), updated_at = ? WHERE candidate_id = ? AND run_id = ? AND status = 'staged'`);
        for (const candidateId of candidateIds) {
            const staged = Number(statement.run(updatedAt, candidateId, runId).changes || 0);
            if (staged === 1)
                continue;
            const visible = this.db.prepare(`SELECT status, run_id FROM deep_write_candidates WHERE candidate_id = ?`).get(candidateId);
            if (visible?.run_id !== runId || visible.status !== 'shadow')
                throw new Error(`staged_candidate_publish_conflict:${candidateId}`);
        }
    }
    failStagedRun(runId, now, reason) {
        this.db.transaction(() => {
            this.db.prepare(`UPDATE deep_write_candidates SET status = 'superseded', status_reason = ?, updated_at = ? WHERE run_id = ? AND status IN ('staged', 'shadow')`).run(reason, now, runId);
            this.db.prepare(`UPDATE deep_write_runs SET status = 'failed', error = ? WHERE run_id = ? AND status = 'staged'`).run(reason, runId);
        })();
    }
    updateRunStatus(runId, expected, next) {
        const result = this.db.prepare(`UPDATE deep_write_runs SET status = ? WHERE run_id = ? AND status = ?`).run(next, runId, expected);
        if (Number(result.changes || 0) !== 1)
            throw new Error(`dream_run_status_conflict:${runId}`);
    }
    abandonStaleStagedRuns(before, updatedAt, projectId) {
        const transaction = this.db.transaction(() => {
            const candidates = this.db.prepare(`
        SELECT r.run_id
        FROM deep_write_runs r
        LEFT JOIN episode_dream_jobs j ON j.episode_id = r.source_episode_id
        WHERE r.status = 'staged' AND r.created_at < ?
          AND (? IS NULL OR r.project_id = ?)
          AND (
            j.episode_id IS NULL
            OR j.state <> 'processing'
            OR j.lease_id <> r.dream_job_lease_id
            OR j.lease_until IS NULL
            OR j.lease_until < ?
          )
      `).all(before, projectId || null, projectId || null, updatedAt);
            let abandoned = 0;
            for (const row of candidates) {
                this.db.prepare(`
          UPDATE deep_write_candidates
          SET status = 'superseded', status_reason = 'staged_run_abandoned', updated_at = ?
          WHERE run_id = ? AND status IN ('staged', 'shadow')
        `).run(updatedAt, row.run_id);
                const result = this.db.prepare(`
          UPDATE deep_write_runs SET status = 'abandoned', error = COALESCE(error, 'staged_run_abandoned')
          WHERE run_id = ? AND status = 'staged'
        `).run(row.run_id);
                abandoned += Number(result.changes || 0);
            }
            return abandoned;
        });
        return transaction();
    }
    updateCandidateReviewData(candidateId, input) {
        this.db.prepare(`
      UPDATE deep_write_candidates
      SET content_json=?, evidence_json=?, promotion_target_type=?, promotion_target_id=?,
          status=?, status_reason=?, review_after=?, updated_at=?
      WHERE candidate_id=?
    `).run(JSON.stringify(input.content), JSON.stringify(input.evidence), input.promotionTargetType || null, input.promotionTargetId || null, input.status, input.statusReason, input.reviewAfter ?? null, input.updatedAt ?? Date.now(), candidateId);
    }
    expireNeedsConfirmation(input) {
        const params = [input.before];
        let sql = `
      SELECT c.candidate_id
      FROM deep_write_candidates c
      JOIN deep_write_runs r ON r.run_id = c.run_id
      WHERE c.status = 'needs_confirmation'
        AND COALESCE(c.updated_at, c.created_at) < ?
    `;
        if (input.projectId) {
            sql += ' AND r.project_id = ?';
            params.push(input.projectId);
        }
        sql += ' ORDER BY COALESCE(c.updated_at, c.created_at) ASC, c.candidate_id ASC LIMIT ?';
        params.push(input.limit ?? 1000);
        const rows = this.db.prepare(sql).all(...params);
        const now = input.now ?? Date.now();
        this.db.transaction(() => {
            for (const row of rows) {
                this.updateCandidateStatus(row.candidate_id, 'superseded', {
                    type: 'review_queue_expiry',
                    id: row.candidate_id,
                    reason: 'needs_confirmation_ttl_expired',
                    updatedAt: now,
                });
            }
        })();
        return {
            expired: rows.length,
            candidateIds: rows.map((row) => row.candidate_id),
            cutoff: input.before,
        };
    }
    mapRun(row) {
        return {
            runId: row.run_id,
            projectId: row.project_id || undefined,
            sessionId: row.session_id || undefined,
            sourceNeuronIds: JSON.parse(row.source_neuron_ids_json || '[]'),
            modelProvider: row.model_provider || undefined,
            modelName: row.model_name || undefined,
            mode: row.mode,
            promptHash: row.prompt_hash,
            outputHash: row.output_hash,
            status: row.status,
            error: row.error || undefined,
            sourceEpisodeId: row.source_episode_id || undefined,
            dreamJobLeaseId: row.dream_job_lease_id || undefined,
            leaseUntil: row.lease_until ?? undefined,
            attemptGeneration: row.attempt_generation ?? undefined,
            updatedAt: row.updated_at ?? row.created_at,
            createdAt: row.created_at
        };
    }
    mapCandidate(row) {
        return {
            candidateId: row.candidate_id,
            runId: row.run_id,
            candidateType: row.candidate_type,
            status: row.status,
            publishStatus: row.publish_status || undefined,
            confidence: row.confidence,
            content: JSON.parse(row.content_json || '{}'),
            evidence: JSON.parse(row.evidence_json || '[]'),
            promotionTargetType: row.promotion_target_type || undefined,
            promotionTargetId: row.promotion_target_id || undefined,
            statusReason: row.status_reason || undefined,
            reviewAfter: row.review_after ?? undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at || row.created_at
        };
    }
    ensureColumn(table, column, definition) {
        const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
        if (columns.some((item) => item.name === column))
            return;
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}
