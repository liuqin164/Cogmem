import { createHash } from 'node:crypto';
import Database from 'bun:sqlite';

import type { GovernanceEvidenceRecord } from '../governance/MemoryGovernanceValidator.js';
import { EntityStore, type EntityRecord } from '../store/EntityStore.js';

export type EntityMergeCandidateStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'reverted';

export interface EntityMergeCandidate {
  candidateId: string;
  projectId?: string;
  sourceEntityId: string;
  targetEntityId: string;
  alias: string;
  confidence: number;
  status: EntityMergeCandidateStatus;
  reviewReasons: string[];
  evidenceEventIds: string[];
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface ProposeEntityMergeInput {
  projectId?: string;
  sourceEntityId: string;
  targetEntityId: string;
  alias: string;
  confidence: number;
  evidenceEventIds: string[];
  now?: number;
}

export class EntityGovernanceService {
  constructor(
    private readonly db: Database,
    private readonly entities: EntityStore,
    private readonly findEvidence: (eventId: string) => GovernanceEvidenceRecord | undefined,
  ) {
    this.initializeSchema();
  }

  proposeMerge(input: ProposeEntityMergeInput): EntityMergeCandidate {
    const now = input.now ?? Date.now();
    const source = this.requireEntity(input.sourceEntityId);
    const target = this.requireEntity(input.targetEntityId);
    const reasons: string[] = [];
    const evidence = input.evidenceEventIds.map((eventId) => this.findEvidence(eventId)).filter(Boolean) as GovernanceEvidenceRecord[];

    if (source.entityId === target.entityId) reasons.push('same_entity');
    if (source.type !== target.type) reasons.push('entity_type_mismatch');
    if (projectIdOf(source) && input.projectId && projectIdOf(source) !== input.projectId) reasons.push('project_boundary_violation');
    if (projectIdOf(target) && input.projectId && projectIdOf(target) !== input.projectId) reasons.push('project_boundary_violation');
    if (evidence.length !== input.evidenceEventIds.length) reasons.push('unknown_evidence');
    if (evidence.some((item) => item.projectId && input.projectId && item.projectId !== input.projectId)) reasons.push('project_boundary_violation');

    const hasUserEvidence = evidence.some((item) => item.role === 'user');
    if (source.type === 'person' && !hasUserEvidence) reasons.push('person_merge_requires_explicit_user_evidence');

    const fatal = reasons.some((reason) => ['same_entity', 'entity_type_mismatch', 'project_boundary_violation', 'unknown_evidence'].includes(reason));
    const threshold = source.type === 'person' ? 0.99 : 0.95;
    const status: EntityMergeCandidateStatus = fatal
      ? 'rejected'
      : input.confidence >= threshold && (source.type !== 'person' || hasUserEvidence)
        ? 'approved'
        : input.confidence < 0.6
          ? 'rejected'
          : 'pending';
    if (status === 'pending' && reasons.length === 0) reasons.push('confidence_requires_review');
    if (status === 'rejected' && reasons.length === 0) reasons.push('confidence_below_minimum');

    const candidateId = candidateIdFor(input);
    this.db.prepare(`
      INSERT INTO entity_merge_candidates (
        candidate_id, project_id, source_entity_id, target_entity_id, alias, confidence,
        status, review_reasons_json, evidence_event_ids_json, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(candidate_id) DO UPDATE SET
        confidence = excluded.confidence,
        status = excluded.status,
        review_reasons_json = excluded.review_reasons_json,
        evidence_event_ids_json = excluded.evidence_event_ids_json,
        updated_at = excluded.updated_at,
        version = entity_merge_candidates.version + 1
    `).run(
      candidateId,
      input.projectId || null,
      source.entityId,
      target.entityId,
      input.alias,
      input.confidence,
      status,
      JSON.stringify(reasons),
      JSON.stringify(input.evidenceEventIds),
      now,
      now,
    );
    return this.get(candidateId)!;
  }

  apply(candidateId: string, now: number = Date.now()): EntityMergeCandidate {
    const candidate = this.requireCandidate(candidateId);
    if (candidate.status === 'applied') return candidate;
    if (candidate.status !== 'approved') throw new Error(`Entity merge candidate is not approved: ${candidate.status}`);
    const source = this.requireEntity(candidate.sourceEntityId);
    const target = this.requireEntity(candidate.targetEntityId);
    if (!source.canonicalEntityId || !target.canonicalEntityId) throw new Error('Entity merge requires canonical entity ids.');

    this.db.transaction(() => {
      this.entities.addAlias(target.entityId, candidate.alias, now);
      this.entities.redirectInstance({ sourceEntityId: source.entityId, targetCanonicalEntityId: target.canonicalEntityId!, updatedAt: now });
      this.db.prepare(`
        INSERT INTO entity_resolution_log (
          log_id, candidate_id, source_entity_id, target_entity_id, previous_canonical_entity_id,
          previous_status, alias, action, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'merge', ?)
      `).run(
        `elog:${candidateId}:merge`,
        candidateId,
        source.entityId,
        target.entityId,
        source.canonicalEntityId!,
        source.status,
        candidate.alias,
        now,
      );
      this.updateStatus(candidateId, 'applied', now);
    })();
    return this.requireCandidate(candidateId);
  }

  revert(candidateId: string, now: number = Date.now()): EntityMergeCandidate {
    const candidate = this.requireCandidate(candidateId);
    if (candidate.status === 'reverted') return candidate;
    if (candidate.status !== 'applied') throw new Error(`Entity merge candidate is not applied: ${candidate.status}`);
    const log = this.db.prepare(`
      SELECT * FROM entity_resolution_log WHERE candidate_id = ? AND action = 'merge'
      ORDER BY created_at DESC LIMIT 1
    `).get(candidateId) as Record<string, unknown> | null;
    if (!log) throw new Error(`Missing entity merge audit log: ${candidateId}`);

    this.db.transaction(() => {
      this.entities.restoreInstance({
        entityId: candidate.sourceEntityId,
        canonicalEntityId: String(log.previous_canonical_entity_id),
        status: String(log.previous_status) as EntityRecord['status'],
        updatedAt: now,
      });
      this.entities.removeAlias(candidate.targetEntityId, String(log.alias), now);
      this.db.prepare(`
        INSERT INTO entity_resolution_log (
          log_id, candidate_id, source_entity_id, target_entity_id, previous_canonical_entity_id,
          previous_status, alias, action, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'revert', ?)
      `).run(
        `elog:${candidateId}:revert:${now}`,
        candidateId,
        candidate.sourceEntityId,
        candidate.targetEntityId,
        String(log.previous_canonical_entity_id),
        String(log.previous_status),
        String(log.alias),
        now,
      );
      this.updateStatus(candidateId, 'reverted', now);
    })();
    return this.requireCandidate(candidateId);
  }

  get(candidateId: string): EntityMergeCandidate | null {
    const row = this.db.prepare(`SELECT * FROM entity_merge_candidates WHERE candidate_id = ?`).get(candidateId) as Record<string, unknown> | null;
    return row ? mapCandidate(row) : null;
  }

  list(options: { projectId?: string; status?: EntityMergeCandidateStatus; limit?: number } = {}): EntityMergeCandidate[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.projectId) { clauses.push('project_id = ?'); params.push(options.projectId); }
    if (options.status) { clauses.push('status = ?'); params.push(options.status); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(Math.max(1, Math.min(500, options.limit ?? 100)));
    return (this.db.prepare(`SELECT * FROM entity_merge_candidates ${where} ORDER BY updated_at DESC LIMIT ?`).all(...params) as Array<Record<string, unknown>>)
      .map(mapCandidate);
  }

  private requireEntity(entityId: string): EntityRecord {
    const entity = this.entities.findByEntityId(entityId);
    if (!entity) throw new Error(`Unknown entity: ${entityId}`);
    return entity;
  }

  private requireCandidate(candidateId: string): EntityMergeCandidate {
    const candidate = this.get(candidateId);
    if (!candidate) throw new Error(`Unknown entity merge candidate: ${candidateId}`);
    return candidate;
  }

  private updateStatus(candidateId: string, status: EntityMergeCandidateStatus, now: number): void {
    this.db.prepare(`
      UPDATE entity_merge_candidates SET status = ?, updated_at = ?, version = version + 1 WHERE candidate_id = ?
    `).run(status, now, candidateId);
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entity_merge_candidates (
        candidate_id TEXT PRIMARY KEY,
        project_id TEXT,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        alias TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        review_reasons_json TEXT NOT NULL,
        evidence_event_ids_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_entity_merge_candidates_project
        ON entity_merge_candidates(project_id, status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS entity_resolution_log (
        log_id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        previous_canonical_entity_id TEXT NOT NULL,
        previous_status TEXT NOT NULL,
        alias TEXT NOT NULL,
        action TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }
}

function candidateIdFor(input: ProposeEntityMergeInput): string {
  const value = [input.projectId || '', input.sourceEntityId, input.targetEntityId, input.alias.toLowerCase()].join('\0');
  return `emerge-${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function projectIdOf(entity: EntityRecord): string | undefined {
  return typeof entity.metadata?.projectId === 'string' ? entity.metadata.projectId : undefined;
}

function mapCandidate(row: Record<string, unknown>): EntityMergeCandidate {
  return {
    candidateId: String(row.candidate_id),
    projectId: row.project_id ? String(row.project_id) : undefined,
    sourceEntityId: String(row.source_entity_id),
    targetEntityId: String(row.target_entity_id),
    alias: String(row.alias),
    confidence: Number(row.confidence),
    status: String(row.status) as EntityMergeCandidateStatus,
    reviewReasons: parseArray(row.review_reasons_json),
    evidenceEventIds: parseArray(row.evidence_event_ids_json),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    version: Number(row.version),
  };
}

function parseArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
