import Database from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

export type ProspectiveMemoryType = 'intention' | 'commitment' | 'reminder' | 'open_loop' | 'plan';
export type ProspectiveMemoryStatus = 'pending' | 'confirmed' | 'deferred' | 'rejected' | 'completed' | 'expired';
export type ProspectiveMemoryProposer = 'deterministic' | 'model_candidate' | 'operator';

const PROSPECTIVE_MEMORY_TYPES: readonly ProspectiveMemoryType[] = ['intention', 'commitment', 'reminder', 'open_loop', 'plan'];
const PROSPECTIVE_MEMORY_STATUSES: readonly ProspectiveMemoryStatus[] = ['pending', 'confirmed', 'deferred', 'rejected', 'completed', 'expired'];
const PROSPECTIVE_MEMORY_PROPOSERS: readonly ProspectiveMemoryProposer[] = ['deterministic', 'model_candidate', 'operator'];
const TERMINAL_PROSPECTIVE_MEMORY_STATUSES: readonly ProspectiveMemoryStatus[] = ['rejected', 'completed', 'expired'];

export interface ProspectiveEvidenceRecord {
  eventId: string;
  projectId?: string;
  role?: string;
  globalSeq?: number;
  content?: string;
}

export interface ProspectiveMemoryRecord {
  candidateId: string;
  projectId: string;
  candidateType: ProspectiveMemoryType;
  canonicalKey: string;
  title: string;
  details?: string;
  status: ProspectiveMemoryStatus;
  proposedBy: ProspectiveMemoryProposer;
  evidenceEventIds: string[];
  confirmationEvidenceEventId?: string;
  dueAt?: number;
  deferredUntil?: number;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProposeProspectiveMemoryInput {
  projectId: string;
  candidateType: ProspectiveMemoryType;
  canonicalKey: string;
  title: string;
  details?: string;
  evidenceEventIds: string[];
  proposedBy: ProspectiveMemoryProposer;
  dueAt?: number;
}

export type ResolveProspectiveMemoryInput =
  | { action: 'confirm'; confirmationEvidenceEventId: string }
  | { action: 'reject' }
  | { action: 'defer'; deferredUntil: number }
  | { action: 'complete' }
  | { action: 'expire' };

export interface ProspectiveMemoryListOptions {
  projectId: string;
  statuses?: ProspectiveMemoryStatus[];
  limit?: number;
}

export type ProspectiveEvidenceLookup = (eventId: string) => ProspectiveEvidenceRecord | undefined;

export class ProspectiveMemoryService {
  constructor(private readonly db: Database, private readonly findEvidence: ProspectiveEvidenceLookup) {
    this.initializeSchema();
  }

  propose(input: ProposeProspectiveMemoryInput): ProspectiveMemoryRecord {
    return this.db.transaction(() => this.proposeInTransaction(input)).immediate();
  }

  private proposeInTransaction(input: ProposeProspectiveMemoryInput): ProspectiveMemoryRecord {
    const projectId = requireProjectId(input.projectId);
    if (!PROSPECTIVE_MEMORY_TYPES.includes(input.candidateType)) throw new Error('invalid_prospective_memory_type');
    if (!PROSPECTIVE_MEMORY_PROPOSERS.includes(input.proposedBy)) throw new Error('invalid_prospective_memory_proposer');
    const canonicalKey = input.canonicalKey.trim().toLowerCase();
    const title = input.title.trim();
    if (!canonicalKey || !title) throw new Error('prospective_key_and_title_required');
    if (input.dueAt !== undefined && (!Number.isFinite(input.dueAt) || input.dueAt < 0)) throw new Error('invalid_due_at');
    if (input.evidenceEventIds.length === 0) throw new Error('missing_evidence');
    const evidence = input.evidenceEventIds.map((eventId) => this.findEvidence(eventId));
    if (evidence.some((item) => !item)) throw new Error('unknown_evidence');
    if (evidence.some((item) => item?.projectId !== projectId)) throw new Error('project_boundary_violation');

    const evidenceIds = [...new Set(input.evidenceEventIds)].sort();
    const latest = this.getLatest(projectId, canonicalKey);
    if (latest && JSON.stringify([...latest.evidenceEventIds].sort()) === JSON.stringify(evidenceIds)) return latest;

    const now = Date.now();
    const candidateId = `prospective-${randomUUID()}`;
    const version = (latest?.version ?? 0) + 1;
    this.db.prepare(`
      INSERT INTO prospective_memories (
        candidate_id, project_id, candidate_type, canonical_key, title, details, status,
        proposed_by, evidence_event_ids_json, confirmation_evidence_event_id, due_at,
        deferred_until, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, ?, NULL, ?, ?, ?)
    `).run(
      candidateId, projectId, input.candidateType, canonicalKey, title, input.details ?? null,
      input.proposedBy, JSON.stringify(evidenceIds), input.dueAt ?? null, version, now, now,
    );
    this.recordTransition(candidateId, undefined, 'pending', 'proposed', input.evidenceEventIds[0], now);
    return this.get(candidateId, projectId)!;
  }

  resolve(candidateId: string, input: ResolveProspectiveMemoryInput, projectId: string): ProspectiveMemoryRecord {
    return this.db.transaction(() => this.resolveInTransaction(candidateId, input, projectId)).immediate();
  }

  private resolveInTransaction(candidateId: string, input: ResolveProspectiveMemoryInput, projectId: string): ProspectiveMemoryRecord {
    projectId = requireProjectId(projectId);
    const current = this.getUnscoped(candidateId);
    if (!current) throw new Error('prospective_memory_not_found');
    if (current.projectId !== projectId) throw new Error('project_boundary_violation');
    if (TERMINAL_PROSPECTIVE_MEMORY_STATUSES.includes(current.status)) {
      throw new Error('terminal_prospective_memory_cannot_transition');
    }
    const now = Date.now();
    let status: ProspectiveMemoryStatus;
    let confirmationEvidenceEventId = current.confirmationEvidenceEventId;
    let deferredUntil = current.deferredUntil;

    switch (input.action) {
      case 'confirm': {
        if (current.status === 'confirmed') return current;
        const evidence = this.findEvidence(input.confirmationEvidenceEventId);
        if (!evidence) throw new Error('unknown_confirmation_evidence');
        if (evidence.projectId !== current.projectId) throw new Error('project_boundary_violation');
        if (evidence.role !== 'user') throw new Error('confirmation_requires_user_evidence');
        if (current.evidenceEventIds.includes(input.confirmationEvidenceEventId)) {
          throw new Error('confirmation_requires_distinct_user_evidence');
        }
        const proposalEvidence = current.evidenceEventIds.map((eventId) => this.findEvidence(eventId));
        const proposalSequences = proposalEvidence.map((item) => item?.globalSeq).filter((value): value is number => Number.isFinite(value));
        if (evidence.globalSeq === undefined || proposalSequences.length !== current.evidenceEventIds.length
          || evidence.globalSeq <= Math.max(...proposalSequences)) {
          throw new Error('confirmation_must_follow_proposal_evidence');
        }
        if (!isExplicitProspectiveConfirmation(evidence.content)) {
          throw new Error('confirmation_requires_explicit_affirmation');
        }
        const priorUse = this.db.prepare(`
          SELECT candidate_id FROM prospective_memories
          WHERE project_id = ? AND confirmation_evidence_event_id = ? AND candidate_id <> ?
          LIMIT 1
        `).get(current.projectId, input.confirmationEvidenceEventId, candidateId);
        if (priorUse) throw new Error('confirmation_evidence_already_used');
        status = 'confirmed';
        confirmationEvidenceEventId = input.confirmationEvidenceEventId;
        deferredUntil = undefined;
        break;
      }
      case 'reject': status = 'rejected'; break;
      case 'defer':
        if (current.status !== 'confirmed') throw new Error('only_confirmed_memory_can_be_deferred');
        if (!Number.isFinite(input.deferredUntil) || input.deferredUntil <= now) throw new Error('invalid_deferred_until');
        status = 'deferred';
        deferredUntil = input.deferredUntil;
        break;
      case 'complete':
        if (current.status !== 'confirmed') throw new Error('only_confirmed_memory_can_be_completed');
        status = 'completed';
        break;
      case 'expire': status = 'expired'; break;
    }

    this.db.prepare(`
      UPDATE prospective_memories
      SET status = ?, confirmation_evidence_event_id = ?, deferred_until = ?, updated_at = ?
      WHERE candidate_id = ?
    `).run(status, confirmationEvidenceEventId ?? null, deferredUntil ?? null, now, candidateId);
    this.recordTransition(candidateId, current.status, status, input.action, confirmationEvidenceEventId, now);
    return this.get(candidateId, projectId)!;
  }

  get(candidateId: string, projectId: string): ProspectiveMemoryRecord | null {
    projectId = requireProjectId(projectId);
    const row = this.db.prepare(`
      SELECT * FROM prospective_memories WHERE candidate_id = ? AND project_id = ?
    `).get(candidateId, projectId) as Record<string, unknown> | null;
    return row ? this.mapRow(row) : null;
  }

  list(options: ProspectiveMemoryListOptions): ProspectiveMemoryRecord[] {
    const projectId = requireProjectId(options.projectId);
    const statuses = options.statuses ?? ['pending', 'confirmed', 'deferred'];
    if (statuses.length === 0) return [];
    if (statuses.some((status) => !PROSPECTIVE_MEMORY_STATUSES.includes(status))) {
      throw new Error('invalid_prospective_memory_status');
    }
    const rows = this.db.prepare(`
      SELECT * FROM prospective_memories
      WHERE project_id = ? AND status IN (${statuses.map(() => '?').join(', ')})
      ORDER BY COALESCE(deferred_until, due_at, updated_at) ASC, updated_at DESC
      LIMIT ?
    `).all(projectId, ...statuses, boundedLimit(options.limit, 100, 500)) as Record<string, unknown>[];
    return rows.map((row) => this.mapRow(row));
  }

  listDue(input: { projectId: string; atTime?: number; limit?: number }): ProspectiveMemoryRecord[] {
    const projectId = requireProjectId(input.projectId);
    const atTime = input.atTime ?? Date.now();
    if (!Number.isFinite(atTime) || atTime < 0) throw new Error('invalid_at_time');
    const rows = this.db.prepare(`
      SELECT * FROM prospective_memories
      WHERE project_id = ? AND (
        (status = 'confirmed' AND due_at IS NOT NULL AND due_at <= ?)
        OR (status = 'deferred' AND deferred_until IS NOT NULL AND deferred_until <= ?)
      )
      ORDER BY COALESCE(deferred_until, due_at) ASC, updated_at ASC LIMIT ?
    `).all(projectId, atTime, atTime, boundedLimit(input.limit, 20, 100)) as Record<string, unknown>[];
    return rows.map((row) => this.mapRow(row));
  }

  private getLatest(projectId: string, canonicalKey: string): ProspectiveMemoryRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM prospective_memories WHERE project_id = ? AND canonical_key = ?
      ORDER BY version DESC LIMIT 1
    `).get(projectId, canonicalKey) as Record<string, unknown> | null;
    return row ? this.mapRow(row) : null;
  }

  private getUnscoped(candidateId: string): ProspectiveMemoryRecord | null {
    const row = this.db.prepare(`SELECT * FROM prospective_memories WHERE candidate_id = ?`)
      .get(candidateId) as Record<string, unknown> | null;
    return row ? this.mapRow(row) : null;
  }

  private recordTransition(candidateId: string, from: ProspectiveMemoryStatus | undefined, to: ProspectiveMemoryStatus, action: string, eventId: string | undefined, now: number): void {
    this.db.prepare(`
      INSERT INTO prospective_memory_transitions (
        transition_id, candidate_id, from_status, to_status, action, evidence_event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(`transition-${randomUUID()}`, candidateId, from ?? null, to, action, eventId ?? null, now);
  }

  private mapRow(row: Record<string, unknown>): ProspectiveMemoryRecord {
    return {
      candidateId: String(row.candidate_id),
      projectId: String(row.project_id),
      candidateType: row.candidate_type as ProspectiveMemoryType,
      canonicalKey: String(row.canonical_key),
      title: String(row.title),
      details: row.details == null ? undefined : String(row.details),
      status: row.status as ProspectiveMemoryStatus,
      proposedBy: row.proposed_by as ProspectiveMemoryProposer,
      evidenceEventIds: JSON.parse(String(row.evidence_event_ids_json)),
      confirmationEvidenceEventId: row.confirmation_evidence_event_id == null ? undefined : String(row.confirmation_evidence_event_id),
      dueAt: row.due_at == null ? undefined : Number(row.due_at),
      deferredUntil: row.deferred_until == null ? undefined : Number(row.deferred_until),
      version: Number(row.version),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prospective_memories (
        candidate_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, candidate_type TEXT NOT NULL,
        canonical_key TEXT NOT NULL, title TEXT NOT NULL, details TEXT, status TEXT NOT NULL,
        proposed_by TEXT NOT NULL, evidence_event_ids_json TEXT NOT NULL,
        confirmation_evidence_event_id TEXT, due_at INTEGER, deferred_until INTEGER,
        version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_prospective_project_status_due
        ON prospective_memories(project_id, status, due_at, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_prospective_project_status_deferred
        ON prospective_memories(project_id, status, deferred_until, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_prospective_project_key_version
        ON prospective_memories(project_id, canonical_key, version DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_prospective_project_key_version_unique
        ON prospective_memories(project_id, canonical_key, version);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_prospective_confirmation_evidence_unique
        ON prospective_memories(project_id, confirmation_evidence_event_id)
        WHERE confirmation_evidence_event_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS prospective_memory_transitions (
        transition_id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, from_status TEXT,
        to_status TEXT NOT NULL, action TEXT NOT NULL, evidence_event_id TEXT, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_prospective_transitions_candidate
        ON prospective_memory_transitions(candidate_id, created_at DESC);
    `);
  }
}

function isExplicitProspectiveConfirmation(content: string | undefined): boolean {
  const text = content?.trim();
  if (!text) return false;
  if (/\b(?:no|not|don['’]?t|cancel|reject|deny|decline|abort)\b|(?:不要|不确认|取消|拒绝|否认|いいえ|キャンセル|拒否)/iu.test(text)) {
    return false;
  }
  return /\b(?:yes|confirm|approve|authorize|proceed)\b|(?:确认|同意|批准|没错|是的|はい|確認|承認)/iu.test(text);
}

function requireProjectId(projectId: string): string {
  const normalized = projectId.trim();
  if (!normalized) throw new Error('project_id_required');
  return normalized;
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('invalid_limit');
  return Math.min(maximum, limit);
}
