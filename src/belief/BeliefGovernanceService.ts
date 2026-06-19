import Database from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

export type BeliefOwnership = 'user' | 'project' | 'system';
export type GovernedBeliefType = 'preference' | 'goal' | 'boundary' | 'decision' | 'fact' | 'observation';
export type GovernedBeliefStatus = 'active' | 'weak' | 'needs_confirmation' | 'possible_conflict' | 'superseded' | 'rejected';
export type BeliefRelation = 'assert' | 'reinforce' | 'correct' | 'contradict';

export interface BeliefEvidenceRecord {
  eventId: string;
  projectId?: string;
  role?: string;
}

export interface GovernedBeliefRecord {
  beliefId: string;
  projectId?: string;
  ownership: BeliefOwnership;
  beliefType: GovernedBeliefType;
  canonicalKey: string;
  statement: string;
  status: GovernedBeliefStatus;
  confidence: number;
  version: number;
  validFrom: number;
  validTo?: number;
  supersedesBeliefId?: string;
  supersededByBeliefId?: string;
  evidenceEventIds: string[];
  sourceRoles: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ApplyBeliefInput {
  projectId?: string;
  ownership: BeliefOwnership;
  beliefType: GovernedBeliefType;
  canonicalKey: string;
  statement: string;
  evidenceEventIds: string[];
  relation?: BeliefRelation;
  confidence?: number;
  reason?: string;
  occurredAt?: number;
}

export type BeliefEvidenceLookup = (eventId: string) => BeliefEvidenceRecord | undefined;

export class BeliefGovernanceService {
  constructor(
    private readonly db: Database,
    private readonly findEvidence: BeliefEvidenceLookup,
  ) {
    this.initializeSchema();
  }

  apply(input: ApplyBeliefInput): GovernedBeliefRecord {
    const canonicalKey = input.canonicalKey.trim().toLowerCase();
    const statement = input.statement.trim();
    if (!canonicalKey || !statement) throw new Error('belief_key_and_statement_required');
    if (input.evidenceEventIds.length === 0) throw new Error('missing_evidence');

    const evidence = input.evidenceEventIds.map((eventId) => this.findEvidence(eventId));
    if (evidence.some((item) => !item)) throw new Error('unknown_evidence');
    if (input.projectId && evidence.some((item) => item?.projectId && item.projectId !== input.projectId)) {
      throw new Error('project_boundary_violation');
    }
    if (input.ownership === 'user' && !evidence.some((item) => item?.role === 'user')) {
      throw new Error('user_ownership_requires_user_evidence');
    }

    const relation = input.relation ?? 'assert';
    const current = this.getCurrent(input.projectId, canonicalKey)[0];
    const sameStatement = current && this.normalizeStatement(current.statement) === this.normalizeStatement(statement);
    if (current && (relation === 'reinforce' || (relation === 'assert' && sameStatement))) {
      return this.reinforce(current, input, evidence as BeliefEvidenceRecord[]);
    }

    const status: GovernedBeliefStatus = current && relation !== 'correct'
      ? 'possible_conflict'
      : 'active';
    const now = input.occurredAt ?? Date.now();
    const beliefId = `belief-${randomUUID()}`;
    const confidence = this.clamp(input.confidence ?? (input.ownership === 'user' ? 0.86 : 0.72));

    const transaction = this.db.transaction(() => {
      if (current && relation === 'correct') {
        this.db.prepare(`
          UPDATE belief_graph_nodes
          SET status = 'superseded', valid_to = ?, superseded_by_belief_id = ?, updated_at = ?
          WHERE belief_id = ? AND status = 'active'
        `).run(now, beliefId, now, current.beliefId);
      }
      this.db.prepare(`
        INSERT INTO belief_graph_nodes (
          belief_id, project_id, ownership, belief_type, canonical_key, statement, status,
          confidence, version, valid_from, valid_to, supersedes_belief_id,
          superseded_by_belief_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, NULL, ?, ?)
      `).run(
        beliefId, input.projectId ?? null, input.ownership, input.beliefType, canonicalKey,
        statement, status, confidence, now, relation === 'correct' ? current?.beliefId ?? null : null, now, now,
      );
      this.insertEvidence(beliefId, evidence as BeliefEvidenceRecord[], relation === 'contradict' ? 'contradicts' : 'supports', now);
      this.insertVersion(beliefId, 1, input.reason ?? relation, input.evidenceEventIds[0], now);

      if (current && relation === 'correct') {
        this.db.prepare(`
          INSERT INTO belief_graph_conflicts (
            conflict_id, project_id, prior_belief_id, proposed_belief_id, relation,
            status, reason, evidence_event_ids_json, created_at
          ) VALUES (?, ?, ?, ?, 'corrects', 'resolved', ?, ?, ?)
        `).run(`conflict-${randomUUID()}`, input.projectId ?? null, current.beliefId, beliefId, input.reason ?? null, JSON.stringify(input.evidenceEventIds), now);
      } else if (current) {
        this.db.prepare(`
          INSERT INTO belief_graph_conflicts (
            conflict_id, project_id, prior_belief_id, proposed_belief_id, relation,
            status, reason, evidence_event_ids_json, created_at
          ) VALUES (?, ?, ?, ?, 'contradicts', 'pending', ?, ?, ?)
        `).run(`conflict-${randomUUID()}`, input.projectId ?? null, current.beliefId, beliefId, input.reason ?? null, JSON.stringify(input.evidenceEventIds), now);
      }
    });
    transaction();
    return this.getById(beliefId)!;
  }

  getById(beliefId: string): GovernedBeliefRecord | null {
    const row = this.db.prepare(`SELECT * FROM belief_graph_nodes WHERE belief_id = ?`).get(beliefId) as Record<string, unknown> | null;
    return row ? this.mapRow(row) : null;
  }

  getCurrent(projectId: string | undefined, canonicalKey: string): GovernedBeliefRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM belief_graph_nodes
      WHERE canonical_key = ? AND status = 'active'
        AND ((? IS NULL AND project_id IS NULL) OR project_id = ?)
      ORDER BY updated_at DESC
    `).all(canonicalKey.trim().toLowerCase(), projectId ?? null, projectId ?? null) as Record<string, unknown>[];
    return rows.map((row) => this.mapRow(row));
  }

  getHistory(projectId: string | undefined, canonicalKey: string): GovernedBeliefRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM belief_graph_nodes
      WHERE canonical_key = ? AND ((? IS NULL AND project_id IS NULL) OR project_id = ?)
      ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'possible_conflict' THEN 1 ELSE 2 END, updated_at DESC
    `).all(canonicalKey.trim().toLowerCase(), projectId ?? null, projectId ?? null) as Record<string, unknown>[];
    return rows.map((row) => this.mapRow(row));
  }

  private reinforce(current: GovernedBeliefRecord, input: ApplyBeliefInput, evidence: BeliefEvidenceRecord[]): GovernedBeliefRecord {
    const now = input.occurredAt ?? Date.now();
    const version = current.version + 1;
    const confidence = this.clamp(Math.max(current.confidence, input.confidence ?? 0) + 0.03);
    const transaction = this.db.transaction(() => {
      this.db.prepare(`UPDATE belief_graph_nodes SET confidence = ?, version = ?, updated_at = ? WHERE belief_id = ?`)
        .run(confidence, version, now, current.beliefId);
      this.insertEvidence(current.beliefId, evidence, 'supports', now);
      this.insertVersion(current.beliefId, version, input.reason ?? 'reinforced', input.evidenceEventIds[0], now);
    });
    transaction();
    return this.getById(current.beliefId)!;
  }

  private insertEvidence(beliefId: string, evidence: BeliefEvidenceRecord[], evidenceType: string, now: number): void {
    const statement = this.db.prepare(`
      INSERT OR IGNORE INTO belief_graph_evidence (belief_id, event_id, source_role, evidence_type, weight, created_at)
      VALUES (?, ?, ?, ?, 1.0, ?)
    `);
    for (const item of evidence) statement.run(beliefId, item.eventId, item.role ?? 'unknown', evidenceType, now);
  }

  private insertVersion(beliefId: string, version: number, reason: string, eventId: string | undefined, now: number): void {
    const row = this.db.prepare(`SELECT * FROM belief_graph_nodes WHERE belief_id = ?`).get(beliefId);
    this.db.prepare(`
      INSERT INTO belief_graph_versions (belief_id, version, snapshot_json, reason, evidence_event_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(beliefId, version, JSON.stringify(row ?? {}), reason, eventId ?? null, now);
  }

  private mapRow(row: Record<string, unknown>): GovernedBeliefRecord {
    const evidence = this.db.prepare(`
      SELECT event_id, source_role FROM belief_graph_evidence WHERE belief_id = ? ORDER BY created_at, event_id
    `).all(String(row.belief_id)) as Array<{ event_id: string; source_role: string }>;
    return {
      beliefId: String(row.belief_id),
      projectId: row.project_id == null ? undefined : String(row.project_id),
      ownership: row.ownership as BeliefOwnership,
      beliefType: row.belief_type as GovernedBeliefType,
      canonicalKey: String(row.canonical_key),
      statement: String(row.statement),
      status: row.status as GovernedBeliefStatus,
      confidence: Number(row.confidence),
      version: Number(row.version),
      validFrom: Number(row.valid_from),
      validTo: row.valid_to == null ? undefined : Number(row.valid_to),
      supersedesBeliefId: row.supersedes_belief_id == null ? undefined : String(row.supersedes_belief_id),
      supersededByBeliefId: row.superseded_by_belief_id == null ? undefined : String(row.superseded_by_belief_id),
      evidenceEventIds: evidence.map((item) => item.event_id),
      sourceRoles: [...new Set(evidence.map((item) => item.source_role))],
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private normalizeStatement(value: string): string {
    return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS belief_graph_nodes (
        belief_id TEXT PRIMARY KEY, project_id TEXT, ownership TEXT NOT NULL, belief_type TEXT NOT NULL,
        canonical_key TEXT NOT NULL, statement TEXT NOT NULL, status TEXT NOT NULL, confidence REAL NOT NULL,
        version INTEGER NOT NULL DEFAULT 1, valid_from INTEGER NOT NULL, valid_to INTEGER,
        supersedes_belief_id TEXT, superseded_by_belief_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_belief_graph_current
        ON belief_graph_nodes(project_id, canonical_key) WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS idx_belief_graph_history
        ON belief_graph_nodes(project_id, canonical_key, updated_at DESC);
      CREATE TABLE IF NOT EXISTS belief_graph_evidence (
        belief_id TEXT NOT NULL, event_id TEXT NOT NULL, source_role TEXT NOT NULL,
        evidence_type TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1.0, created_at INTEGER NOT NULL,
        PRIMARY KEY (belief_id, event_id, evidence_type)
      );
      CREATE TABLE IF NOT EXISTS belief_graph_versions (
        belief_id TEXT NOT NULL, version INTEGER NOT NULL, snapshot_json TEXT NOT NULL,
        reason TEXT NOT NULL, evidence_event_id TEXT, created_at INTEGER NOT NULL,
        PRIMARY KEY (belief_id, version)
      );
      CREATE TABLE IF NOT EXISTS belief_graph_conflicts (
        conflict_id TEXT PRIMARY KEY, project_id TEXT, prior_belief_id TEXT NOT NULL,
        proposed_belief_id TEXT NOT NULL, relation TEXT NOT NULL, status TEXT NOT NULL,
        reason TEXT, evidence_event_ids_json TEXT NOT NULL, created_at INTEGER NOT NULL
      );
    `);
  }
}
