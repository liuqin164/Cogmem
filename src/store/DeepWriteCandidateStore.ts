import { randomUUID } from 'crypto';
import type Database from 'bun:sqlite';

export type DeepWriteRunStatus = 'succeeded' | 'failed' | 'skipped';
export type DeepWriteCandidateStatus = 'shadow' | 'candidate' | 'promoted' | 'rejected' | 'needs_confirmation' | 'superseded';

export interface DeepWriteRunInput {
  runId?: string;
  projectId?: string;
  sessionId?: string;
  sourceNeuronIds: string[];
  modelProvider?: string;
  modelName?: string;
  mode: string;
  promptHash: string;
  outputHash: string;
  status: DeepWriteRunStatus;
  error?: string;
  createdAt?: number;
}

export interface DeepWriteCandidateInput {
  candidateId?: string;
  runId: string;
  candidateType: string;
  status: DeepWriteCandidateStatus;
  confidence: number;
  content: unknown;
  evidence: unknown;
  promotionTargetType?: string;
  promotionTargetId?: string;
  statusReason?: string;
  createdAt?: number;
}

export interface DeepWriteRunRecord extends DeepWriteRunInput {
  runId: string;
  createdAt: number;
}

export interface DeepWriteCandidateRecord extends DeepWriteCandidateInput {
  candidateId: string;
  createdAt: number;
  updatedAt: number;
}

export interface DeepWriteCandidateListOptions {
  statuses?: DeepWriteCandidateStatus[];
  candidateTypes?: string[];
  projectId?: string;
  runId?: string;
  limit?: number;
}

type RunRow = {
  run_id: string;
  project_id: string | null;
  session_id: string | null;
  source_neuron_ids_json: string;
  model_provider: string | null;
  model_name: string | null;
  mode: string;
  prompt_hash: string;
  output_hash: string;
  status: DeepWriteRunStatus;
  error: string | null;
  created_at: number;
};

type CandidateRow = {
  candidate_id: string;
  run_id: string;
  candidate_type: string;
  status: DeepWriteCandidateStatus;
  confidence: number;
  content_json: string;
  evidence_json: string;
  promotion_target_type: string | null;
  promotion_target_id: string | null;
  status_reason: string | null;
  created_at: number;
  updated_at: number;
};

export class DeepWriteCandidateStore {
  constructor(private readonly db: Database) {
    this.initSchema();
  }

  initSchema(): void {
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
        created_at INTEGER NOT NULL
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
    this.ensureColumn('deep_write_candidates', 'updated_at', 'INTEGER');
    this.db.exec(`
      UPDATE deep_write_candidates
      SET updated_at = created_at
      WHERE updated_at IS NULL
    `);
  }

  insertRun(input: DeepWriteRunInput): DeepWriteRunRecord {
    const record: DeepWriteRunRecord = {
      ...input,
      runId: input.runId || randomUUID(),
      createdAt: input.createdAt ?? Date.now()
    };

    this.db.prepare(`
      INSERT INTO deep_write_runs (
        run_id, project_id, session_id, source_neuron_ids_json, model_provider,
        model_name, mode, prompt_hash, output_hash, status, error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.runId,
      record.projectId || null,
      record.sessionId || null,
      JSON.stringify(record.sourceNeuronIds),
      record.modelProvider || null,
      record.modelName || null,
      record.mode,
      record.promptHash,
      record.outputHash,
      record.status,
      record.error || null,
      record.createdAt
    );

    return record;
  }

  insertCandidates(inputs: DeepWriteCandidateInput[]): DeepWriteCandidateRecord[] {
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
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (const record of records) {
        stmt.run(
          record.candidateId,
          record.runId,
          record.candidateType,
          record.status,
          record.confidence,
          JSON.stringify(record.content),
          JSON.stringify(record.evidence),
          record.promotionTargetType || null,
          record.promotionTargetId || null,
          record.statusReason || null,
          record.createdAt,
          record.updatedAt
        );
      }
    })();

    return records;
  }

  getRun(runId: string): DeepWriteRunRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM deep_write_runs
      WHERE run_id = ?
    `).get(runId) as RunRow | null;
    return row ? this.mapRun(row) : null;
  }

  listCandidatesByRun(runId: string): DeepWriteCandidateRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM deep_write_candidates
      WHERE run_id = ?
      ORDER BY created_at ASC, candidate_id ASC
    `).all(runId) as CandidateRow[];
    return rows.map((row) => this.mapCandidate(row));
  }

  getCandidate(candidateId: string): DeepWriteCandidateRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM deep_write_candidates
      WHERE candidate_id = ?
    `).get(candidateId) as CandidateRow | null;
    return row ? this.mapCandidate(row) : null;
  }

  listCandidatesByStatus(
    statuses: DeepWriteCandidateStatus[],
    options?: { candidateTypes?: string[]; limit?: number }
  ): DeepWriteCandidateRecord[] {
    if (statuses.length === 0) return [];
    const params: Array<string | number> = [...statuses];
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
    const rows = this.db.prepare(sql).all(...params) as CandidateRow[];
    return rows.map((row) => this.mapCandidate(row));
  }

  listCandidates(options: DeepWriteCandidateListOptions = {}): DeepWriteCandidateRecord[] {
    const params: Array<string | number> = [];
    const conditions: string[] = [];
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
    if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
    sql += ` ORDER BY c.created_at ASC, c.candidate_id ASC LIMIT ?`;
    params.push(options.limit ?? 100);

    const rows = this.db.prepare(sql).all(...params) as CandidateRow[];
    return rows.map((row) => this.mapCandidate(row));
  }

  countCandidates(options: Omit<DeepWriteCandidateListOptions, 'limit'> = {}): number {
    const params: Array<string | number> = [];
    const conditions: string[] = [];
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
    if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;

    const row = this.db.prepare(sql).get(...params) as { count: number } | null;
    return row?.count || 0;
  }

  updateCandidateStatus(
    candidateId: string,
    status: DeepWriteCandidateStatus,
    promotionTarget?: { type?: string; id?: string; reason?: string; updatedAt?: number }
  ): void {
    this.db.prepare(`
      UPDATE deep_write_candidates
      SET status = ?,
          promotion_target_type = COALESCE(?, promotion_target_type),
          promotion_target_id = COALESCE(?, promotion_target_id),
          status_reason = COALESCE(?, status_reason),
          updated_at = ?
      WHERE candidate_id = ?
    `).run(
      status,
      promotionTarget?.type || null,
      promotionTarget?.id || null,
      promotionTarget?.reason || null,
      promotionTarget?.updatedAt ?? Date.now(),
      candidateId
    );
  }

  expireNeedsConfirmation(input: {
    projectId?: string;
    before: number;
    now?: number;
    limit?: number;
  }): { expired: number; candidateIds: string[]; cutoff: number } {
    const params: Array<string | number> = [input.before];
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
    const rows = this.db.prepare(sql).all(...params) as Array<{ candidate_id: string }>;
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

  private mapRun(row: RunRow): DeepWriteRunRecord {
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
      createdAt: row.created_at
    };
  }

  private mapCandidate(row: CandidateRow): DeepWriteCandidateRecord {
    return {
      candidateId: row.candidate_id,
      runId: row.run_id,
      candidateType: row.candidate_type,
      status: row.status,
      confidence: row.confidence,
      content: JSON.parse(row.content_json || '{}'),
      evidence: JSON.parse(row.evidence_json || '[]'),
      promotionTargetType: row.promotion_target_type || undefined,
      promotionTargetId: row.promotion_target_id || undefined,
      statusReason: row.status_reason || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at
    };
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((item) => item.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
