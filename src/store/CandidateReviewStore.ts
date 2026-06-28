import { randomUUID } from 'node:crypto';
import type Database from 'bun:sqlite';
import type { DeepWriteCandidateStatus } from './DeepWriteCandidateStore.js';

export type CandidateReviewAction = 'approve' | 'reject' | 'defer' | 'supersede' | 'relink';

export interface CandidateReviewRecord {
  reviewId: string;
  candidateId: string;
  projectId?: string;
  action: CandidateReviewAction;
  actor: string;
  reason: string;
  fromStatus: DeepWriteCandidateStatus;
  toStatus: DeepWriteCandidateStatus;
  confirmationEventId?: string;
  targetBeliefId?: string;
  replacementCandidateId?: string;
  reviewAfter?: number;
  decision: Record<string, unknown>;
  createdAt: number;
}

export class CandidateReviewStore {
  constructor(private readonly db: Database) {}

  insert(input: Omit<CandidateReviewRecord, 'reviewId' | 'createdAt'> & { reviewId?: string; createdAt?: number }): CandidateReviewRecord {
    const record: CandidateReviewRecord = {
      ...input,
      reviewId: input.reviewId || randomUUID(),
      createdAt: input.createdAt ?? Date.now(),
    };
    this.db.prepare(`
      INSERT INTO deep_write_candidate_reviews(
        review_id, candidate_id, project_id, action, actor, reason, from_status, to_status,
        confirmation_event_id, target_belief_id, replacement_candidate_id, review_after,
        decision_json, created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      record.reviewId, record.candidateId, record.projectId || null, record.action,
      record.actor, record.reason, record.fromStatus, record.toStatus,
      record.confirmationEventId || null, record.targetBeliefId || null,
      record.replacementCandidateId || null, record.reviewAfter ?? null,
      JSON.stringify(record.decision), record.createdAt,
    );
    return record;
  }

  list(options: { projectId?: string; candidateId?: string; limit?: number } = {}): CandidateReviewRecord[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.projectId) { clauses.push('project_id=?'); params.push(options.projectId); }
    if (options.candidateId) { clauses.push('candidate_id=?'); params.push(options.candidateId); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM deep_write_candidate_reviews ${where}
      ORDER BY created_at DESC, review_id DESC LIMIT ?
    `).all(...params, Math.max(1, Math.min(options.limit ?? 100, 500))) as Array<Record<string, unknown>>;
    return rows.map(mapReview);
  }
}

function mapReview(row: Record<string, unknown>): CandidateReviewRecord {
  return {
    reviewId: String(row.review_id),
    candidateId: String(row.candidate_id),
    projectId: row.project_id ? String(row.project_id) : undefined,
    action: String(row.action) as CandidateReviewAction,
    actor: String(row.actor),
    reason: String(row.reason),
    fromStatus: String(row.from_status) as DeepWriteCandidateStatus,
    toStatus: String(row.to_status) as DeepWriteCandidateStatus,
    confirmationEventId: row.confirmation_event_id ? String(row.confirmation_event_id) : undefined,
    targetBeliefId: row.target_belief_id ? String(row.target_belief_id) : undefined,
    replacementCandidateId: row.replacement_candidate_id ? String(row.replacement_candidate_id) : undefined,
    reviewAfter: row.review_after == null ? undefined : Number(row.review_after),
    decision: parseObject(row.decision_json),
    createdAt: Number(row.created_at),
  };
}

function parseObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
