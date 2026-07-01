import { randomUUID } from 'node:crypto';
import type Database from 'bun:sqlite';
import type { MemoryEvent } from '../types/index.js';
import { summarizeEpisode } from './EpisodeSemanticSummarizer.js';

import type {
  EpisodeClosureMode,
  EpisodeClosureReasonCode,
  EpisodeClosureReceipt,
  EpisodeDreamState,
  EpisodeDreamStatus,
  EpisodeEventLink,
  EpisodeListOptions,
  EpisodeStatus,
  EpisodeType,
  MemoryEpisode,
  TurnRelation,
} from './EpisodeTypes.js';

interface CreateEpisodeInput {
  projectId: string;
  sessionId: string;
  sourceAgent?: string;
  conversationThreadId?: string;
  topicPath?: string;
  episodeType: EpisodeType;
  importance: number;
  eventId: string;
  globalSeq?: number;
  occurredAt: number;
  episodeTags?: string[];
  candidateTypes?: MemoryEpisode['candidateTypes'];
  importanceSignals?: string[];
  importanceReason?: string;
  linkedEpisodeId?: string;
}

export interface ClaimedEpisodeDreamJob {
  episodeId: string;
  projectId: string;
  leaseId: string;
  modeHint: 'micro' | 'normal' | 'deep';
  attempts: number;
  createdAt: number;
}

export class EpisodeStore {
  constructor(
    private readonly db: Database,
    private readonly resolveEvent?: (eventId: string) => MemoryEvent | null | undefined,
    options: { initializeSchemaForTests?: boolean } = {},
  ) {
    if (options.initializeSchemaForTests !== false) this.initializeSchema();
  }

  createEpisode(input: CreateEpisodeInput): MemoryEpisode {
    const episodeId = `episode-${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO memory_episodes (
        episode_id, project_id, session_id, source_agent, conversation_thread_id, topic_path, episode_type, status,
        importance, start_event_id, end_event_id, start_seq, end_seq, event_count,
        started_at, updated_at, episode_tags_json, candidate_types_json, importance_signals_json,
        importance_reason, linked_episode_id, dream_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'none')
    `).run(
      episodeId, input.projectId, input.sessionId, input.sourceAgent || null, input.conversationThreadId || null, input.topicPath || null,
      input.episodeType, input.importance, input.eventId, input.eventId,
      input.globalSeq ?? null, input.globalSeq ?? null, input.occurredAt, input.occurredAt,
      JSON.stringify(input.episodeTags || []), JSON.stringify(input.candidateTypes || []),
      JSON.stringify(input.importanceSignals || []), input.importanceReason || null, input.linkedEpisodeId || null,
    );
    return this.getEpisode(episodeId)!;
  }

  findActiveEpisode(projectId: string, sessionId: string, sourceAgent?: string, conversationThreadId?: string): MemoryEpisode | undefined {
    const exact = this.findActiveEpisodeRow(projectId, sessionId, sourceAgent, conversationThreadId);
    if (exact) return mapEpisode(exact);

    // Episodes created before source/thread scoping have both fields unset. Reuse
    // only that legacy shape so an upgrade does not split an in-flight episode or
    // merge modern episodes that already carry explicit ownership metadata.
    if (!sourceAgent && !conversationThreadId) return undefined;
    const legacy = this.db.prepare(`
      SELECT * FROM memory_episodes
      WHERE project_id = ? AND session_id = ? AND status IN ('open', 'soft_sealed')
        AND source_agent IS NULL AND conversation_thread_id IS NULL
      ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1
    `).get(projectId, sessionId) as EpisodeRow | null;
    return legacy ? mapEpisode(legacy) : undefined;
  }

  private findActiveEpisodeRow(projectId: string, sessionId: string, sourceAgent?: string, conversationThreadId?: string): EpisodeRow | null {
    const where = [`project_id = ?`, `session_id = ?`, `status IN ('open', 'soft_sealed')`];
    const params: Array<string> = [projectId, sessionId];
    if (sourceAgent) { where.push('source_agent = ?'); params.push(sourceAgent); }
    if (conversationThreadId) { where.push('conversation_thread_id = ?'); params.push(conversationThreadId); }
    return this.db.prepare(`
      SELECT * FROM memory_episodes WHERE ${where.join(' AND ')}
      ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1
    `).get(...params) as EpisodeRow | null;
  }

  claimLegacyEpisodeScope(episodeId: string, sourceAgent?: string, conversationThreadId?: string): MemoryEpisode | undefined {
    if (!sourceAgent && !conversationThreadId) return this.getEpisode(episodeId);
    if (this.resolveEvent) {
      const events = this.listEventLinks(episodeId).slice(-10)
        .map((link) => this.resolveEvent!(link.eventId)).filter((event): event is MemoryEvent => Boolean(event));
      const mismatch = events.some((event) => {
        const metadata = (event.payload as { metadata?: { sourceAgent?: unknown } } | undefined)?.metadata;
        const eventSourceAgent = typeof metadata?.sourceAgent === 'string' ? metadata.sourceAgent : undefined;
        return (sourceAgent && eventSourceAgent && eventSourceAgent !== sourceAgent)
          || (conversationThreadId && event.threadId && event.threadId !== conversationThreadId);
      });
      if (mismatch) return undefined;
    }
    this.db.prepare(`
      UPDATE memory_episodes SET source_agent = ?, conversation_thread_id = ?
      WHERE episode_id = ? AND source_agent IS NULL AND conversation_thread_id IS NULL
    `).run(sourceAgent || null, conversationThreadId || null, episodeId);
    const episode = this.getEpisode(episodeId);
    if (!episode) return undefined;
    if (sourceAgent && episode.sourceAgent !== sourceAgent) return undefined;
    if (conversationThreadId && episode.conversationThreadId !== conversationThreadId) return undefined;
    return episode;
  }

  getEpisode(episodeId: string): MemoryEpisode | undefined {
    const row = this.db.prepare(`SELECT * FROM memory_episodes WHERE episode_id = ?`).get(episodeId) as EpisodeRow | null;
    return row ? mapEpisode(row) : undefined;
  }

  listEpisodes(options: EpisodeListOptions = {}): MemoryEpisode[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (options.projectId) { where.push('project_id = ?'); params.push(options.projectId); }
    if (options.sessionId) { where.push('session_id = ?'); params.push(options.sessionId); }
    if (options.statuses?.length) {
      where.push(`status IN (${options.statuses.map(() => '?').join(', ')})`);
      params.push(...options.statuses);
    }
    const rows = this.db.prepare(`
      SELECT * FROM memory_episodes ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY updated_at DESC, episode_id DESC LIMIT ?
    `).all(...params, Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 1000))) as EpisodeRow[];
    return rows.map(mapEpisode);
  }

  appendEvent(input: {
    episodeId: string;
    eventId: string;
    relation: TurnRelation;
    confidence: number;
    globalSeq?: number;
    occurredAt: number;
    episodeType?: EpisodeType;
    importance?: number;
    summaryText?: string;
    candidateTypes?: MemoryEpisode['candidateTypes'];
    importanceSignals?: string[];
    importanceReason?: string;
  }): EpisodeEventLink {
    const existing = this.getEventLink(input.eventId);
    if (existing) return existing;
    const episode = this.getEpisode(input.episodeId);
    if (!episode || episode.status !== 'open') throw new Error(`episode_not_open:${input.episodeId}`);
    const position = episode.eventCount + 1;
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO memory_episode_events (episode_id, event_id, position, relation, confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(input.episodeId, input.eventId, position, input.relation, input.confidence, input.occurredAt);
      const candidateTypes = [...new Set([...episode.candidateTypes, ...(input.candidateTypes || [])])];
      const importanceSignals = [...new Set([...episode.importanceSignals, ...(input.importanceSignals || [])])];
      this.db.prepare(`
        UPDATE memory_episodes SET
          end_event_id = ?, end_seq = COALESCE(?, end_seq), event_count = ?, updated_at = ?,
          episode_type = COALESCE(?, episode_type), importance = MAX(importance, ?),
          summary = CASE WHEN ? IS NULL OR ? = '' THEN summary ELSE SUBSTR(COALESCE(summary || '\n', '') || ?, 1, 1600) END,
          candidate_types_json = ?, importance_signals_json = ?, importance_reason = COALESCE(?, importance_reason)
        WHERE episode_id = ?
      `).run(
        input.eventId, input.globalSeq ?? null, position, input.occurredAt,
        input.episodeType || null, input.importance ?? episode.importance,
        input.summaryText || null, input.summaryText || '', input.summaryText || '',
        JSON.stringify(candidateTypes), JSON.stringify(importanceSignals), input.importanceReason || null, input.episodeId,
      );
    })();
    return { episodeId: input.episodeId, eventId: input.eventId, position, relation: input.relation, confidence: input.confidence, createdAt: input.occurredAt };
  }

  getEventLink(eventId: string): EpisodeEventLink | undefined {
    const row = this.db.prepare(`SELECT * FROM memory_episode_events WHERE event_id = ?`).get(eventId) as EpisodeEventRow | null;
    return row ? mapEventLink(row) : undefined;
  }

  listEventLinks(episodeId: string): EpisodeEventLink[] {
    return (this.db.prepare(`
      SELECT * FROM memory_episode_events WHERE episode_id = ? ORDER BY position
    `).all(episodeId) as EpisodeEventRow[]).map(mapEventLink);
  }

  isEpisodeEmpty(episodeId: string): boolean {
    const episode = this.getEpisode(episodeId);
    if (!episode) throw new Error(`episode_not_found:${episodeId}`);
    return this.listEventLinks(episodeId).length === 0;
  }

  addCrossReference(input: {
    projectId: string; episodeId: string; referencedEpisodeId?: string; eventId?: string;
    relation: string; createdBy: string; confidence?: number; now?: number;
  }): string {
    const episode = this.getEpisode(input.episodeId);
    if (!episode) throw new Error(`episode_not_found:${input.episodeId}`);
    if (episode.projectId !== input.projectId) throw new Error(`episode_project_mismatch:${input.episodeId}`);
    if (input.referencedEpisodeId) {
      const referenced = this.getEpisode(input.referencedEpisodeId);
      if (!referenced || referenced.projectId !== input.projectId) throw new Error(`episode_cross_ref_project_mismatch:${input.referencedEpisodeId}`);
    }
    const id = `episode-cross-ref-${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO episode_cross_refs (cross_ref_id, project_id, episode_id, referenced_episode_id, event_id,
        relation, created_by, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.projectId, input.episodeId, input.referencedEpisodeId || null, input.eventId || null,
      input.relation, input.createdBy, Math.max(0, Math.min(1, input.confidence ?? 1)), input.now ?? Date.now());
    return id;
  }

  moveEventForRepair(eventId: string, targetEpisodeId: string, now = Date.now()): { sourceEpisodeId: string; targetEpisodeId: string } {
    const link = this.getEventLink(eventId);
    if (!link) throw new Error(`episode_event_not_linked:${eventId}`);
    const source = this.getEpisode(link.episodeId);
    const target = this.getEpisode(targetEpisodeId);
    if (!source || !target) throw new Error('episode_not_found');
    if (source.projectId !== target.projectId) throw new Error('episode_project_mismatch');
    this.db.transaction(() => {
      const nextPosition = this.listEventLinks(targetEpisodeId).length + 1;
      this.db.prepare(`UPDATE memory_episode_events SET episode_id = ?, position = ?, created_at = ? WHERE event_id = ?`)
        .run(targetEpisodeId, nextPosition, now, eventId);
      this.resequenceEpisode(source.episodeId, now);
      this.resequenceEpisode(targetEpisodeId, now);
      this.invalidateEpisodeDerivedState(source.episodeId, now);
      this.invalidateEpisodeDerivedState(targetEpisodeId, now);
    })();
    return { sourceEpisodeId: source.episodeId, targetEpisodeId };
  }

  reclassifyForRepair(episodeId: string, input: { episodeType?: EpisodeType; topicPath?: string; importance?: number; now?: number }): MemoryEpisode {
    const episode = this.getEpisode(episodeId);
    if (!episode) throw new Error(`episode_not_found:${episodeId}`);
    this.db.prepare(`
      UPDATE memory_episodes SET episode_type = ?, topic_path = ?, importance = ?, updated_at = ? WHERE episode_id = ?
    `).run(input.episodeType || episode.episodeType, input.topicPath ?? episode.topicPath ?? null,
      input.importance === undefined ? episode.importance : Math.max(0, Math.min(1, input.importance)), input.now ?? Date.now(), episodeId);
    this.invalidateEpisodeDerivedState(episodeId, input.now ?? Date.now());
    return this.getEpisode(episodeId)!;
  }

  requeueDreamForRepair(episodeId: string, modeHint: 'micro' | 'normal' | 'deep' = 'normal', now = Date.now()): void {
    const episode = this.getEpisode(episodeId);
    if (!episode) throw new Error(`episode_not_found:${episodeId}`);
    if (episode.eventCount === 0) throw new Error(`episode_empty:${episodeId}`);
    if (episode.status !== 'sealed') throw new Error(`episode_not_sealed:${episodeId}`);
    this.db.prepare(`
      INSERT INTO episode_dream_jobs (episode_id, project_id, state, priority, mode_hint, attempts, candidate_ids_json, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?, 0, '[]', ?, ?)
      ON CONFLICT(episode_id) DO UPDATE SET state = 'pending', mode_hint = excluded.mode_hint, attempts = 0,
        lease_id = NULL, lease_until = NULL, last_error = NULL, retry_after = NULL, failure_category = NULL,
        candidate_ids_json = '[]', updated_at = excluded.updated_at
    `).run(episodeId, episode.projectId, Math.round(episode.importance * 100), modeHint, now, now);
    this.db.prepare(`UPDATE memory_episodes SET dream_status = 'queued', dream_error = NULL, last_dream_run_id = NULL WHERE episode_id = ?`).run(episodeId);
  }

  recordRepairAudit(input: { projectId: string; operation: string; payload: unknown; before: unknown; after: unknown; now?: number }): string {
    const repairId = `episode-repair-${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO episode_repair_audit (repair_id, project_id, operation, payload_json, before_json, after_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(repairId, input.projectId, input.operation, JSON.stringify(input.payload), JSON.stringify(input.before),
      JSON.stringify(input.after), input.now ?? Date.now());
    return repairId;
  }

  private invalidateEpisodeDerivedState(episodeId: string, now: number): void {
    this.db.prepare(`DELETE FROM episode_dream_jobs WHERE episode_id = ?`).run(episodeId);
    this.db.prepare(`
      UPDATE memory_episodes SET dream_status = 'none', last_dream_run_id = NULL, last_dreamed_at = NULL,
        dream_candidate_count = 0, dream_error = NULL, updated_at = ? WHERE episode_id = ?
    `).run(now, episodeId);
  }

  private resequenceEpisode(episodeId: string, now: number): void {
    const links = this.listEventLinks(episodeId);
    for (const [index, link] of links.entries()) {
      if (link.position !== index + 1) this.db.prepare(`UPDATE memory_episode_events SET position = ? WHERE event_id = ?`).run(index + 1, link.eventId);
    }
    const events = links.map((link) => this.resolveEvent?.(link.eventId)).filter((event): event is MemoryEvent => Boolean(event));
    const first = events[0];
    const last = events.at(-1);
    this.db.prepare(`
      UPDATE memory_episodes SET event_count = ?, start_event_id = COALESCE(?, start_event_id),
        end_event_id = COALESCE(?, end_event_id), start_seq = ?, end_seq = ?, updated_at = ? WHERE episode_id = ?
    `).run(links.length, first?.eventId || null, last?.eventId || null, first?.globalSeq ?? null, last?.globalSeq ?? null, now, episodeId);
  }

  reopenSoftEpisode(episodeId: string, now: number): MemoryEpisode {
    const result = this.db.prepare(`
      UPDATE memory_episodes SET status = 'open', sealed_at = NULL, updated_at = ?, dream_status = 'none', dream_error = NULL
      WHERE episode_id = ? AND status = 'soft_sealed'
    `).run(now, episodeId);
    if (!result.changes) throw new Error(`episode_not_soft_sealed:${episodeId}`);
    this.db.prepare(`DELETE FROM episode_dream_jobs WHERE episode_id = ? AND state IN ('pending', 'failed_retryable', 'retry_scheduled')`).run(episodeId);
    return this.getEpisode(episodeId)!;
  }

  sealEpisode(episodeId: string, input: {
    mode: EpisodeClosureMode;
    reason: string;
    reasonCode?: EpisodeClosureReasonCode;
    reasonDetail?: string;
    requiresReview?: boolean;
    semanticSummary?: MemoryEpisode['semanticSummary'];
    ignoredNearbyEventIds?: string[];
    unassignedNearbyEventIds?: string[];
    now?: number;
  }): EpisodeClosureReceipt {
    const now = input.now ?? Date.now();
    const episode = this.getEpisode(episodeId);
    if (!episode) throw new Error(`episode_not_found:${episodeId}`);
    const status: EpisodeStatus = input.mode === 'soft' ? 'soft_sealed' : 'sealed';
    const auditReseal = input.mode === 'manual' || input.reasonCode === 'repair' || /repair|force|recompute/iu.test(input.reason);
    if (episode.status === status && !auditReseal) {
      const existing = this.listClosureReceipts({ episodeId, limit: 1 })[0];
      if (existing) return existing;
    }
    const links = this.listEventLinks(episodeId);
    if (links.length === 0 && input.mode !== 'soft') throw new Error(`episode_empty:${episodeId}`);
    const requiresReview = input.requiresReview === true || links.length === 0;
    const semanticSummary = input.semanticSummary || summarizeEpisode(
      episode,
      links.map((link) => this.resolveEvent?.(link.eventId)).filter((event): event is MemoryEvent => Boolean(event)),
      links.map((link) => link.eventId),
    );
    const dreamMode = episode.eventCount >= 100
      ? 'deep' as const
      : episode.importance >= 0.8 || ['decision', 'correction', 'preference', 'goal', 'prospective'].includes(episode.episodeType)
        ? 'micro' as const : 'normal' as const;
    const receipt: EpisodeClosureReceipt = {
      receiptId: `episode-closure-${randomUUID()}`,
      episodeId,
      projectId: episode.projectId,
      closureMode: input.mode,
      closureReason: input.reason,
      closureReasonCode: input.reasonCode || normalizeClosureReasonCode(input.reason, input.mode),
      closureReasonDetail: input.reasonDetail || input.reason,
      sourceEventIds: links.map((link) => link.eventId),
      startSeq: episode.startSeq,
      endSeq: episode.endSeq,
      topicPath: episode.topicPath,
      episodeType: episode.episodeType,
      importance: episode.importance,
      dreamRecommended: links.length > 0 && !requiresReview,
      dreamMode,
      requiresReview,
      ignoredNearbyEventIds: input.ignoredNearbyEventIds || [],
      unassignedNearbyEventIds: input.unassignedNearbyEventIds || [],
      createdAt: now,
    };
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE memory_episodes SET status = ?, sealed_at = ?, updated_at = ?,
          semantic_summary_json = COALESCE(?, semantic_summary_json)
        WHERE episode_id = ?
      `).run(status, now, now, JSON.stringify(semanticSummary), episodeId);
      this.db.prepare(`
        INSERT INTO episode_closure_receipts (
          receipt_id, episode_id, project_id, closure_mode, closure_reason, source_event_ids_json,
          start_seq, end_seq, topic_path, episode_type, importance, dream_recommended, dream_mode, created_at,
          closure_reason_code, closure_reason_detail, requires_review,
          ignored_nearby_event_ids_json, unassigned_nearby_event_ids_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        receipt.receiptId, episodeId, episode.projectId, input.mode, input.reason,
        JSON.stringify(receipt.sourceEventIds), receipt.startSeq ?? null, receipt.endSeq ?? null,
        receipt.topicPath || null, receipt.episodeType, receipt.importance, receipt.dreamRecommended ? 1 : 0,
        receipt.dreamMode, now, receipt.closureReasonCode, receipt.closureReasonDetail || null,
        receipt.requiresReview ? 1 : 0, JSON.stringify(receipt.ignoredNearbyEventIds), JSON.stringify(receipt.unassignedNearbyEventIds),
      );
      if (status === 'sealed' && receipt.dreamRecommended && !receipt.requiresReview) this.enqueueDreamJob(episode, dreamMode, now);
    })();
    return receipt;
  }

  listClosureReceipts(options: { episodeId?: string; projectId?: string; limit?: number } = {}): EpisodeClosureReceipt[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (options.episodeId) { where.push('episode_id = ?'); params.push(options.episodeId); }
    if (options.projectId) { where.push('project_id = ?'); params.push(options.projectId); }
    const rows = this.db.prepare(`
      SELECT * FROM episode_closure_receipts ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC LIMIT ?
    `).all(...params, Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 1000))) as ClosureRow[];
    return rows.map(mapClosure);
  }

  sealIdleEpisodes(input: { projectId?: string; idleBefore: number; now?: number }): EpisodeClosureReceipt[] {
    const episodes = this.listEpisodes({ projectId: input.projectId, statuses: ['open'], limit: 1000 })
      .filter((episode) => episode.updatedAt <= input.idleBefore);
    return episodes.map((episode) => this.sealEpisode(episode.episodeId, { mode: 'soft', reason: 'idle_timeout', now: input.now }));
  }

  finalizeMatureSoftSeals(input: { projectId?: string; sealedBefore: number; now?: number }): number {
    const now = input.now ?? Date.now();
    const episodes = this.listEpisodes({ projectId: input.projectId, statuses: ['soft_sealed'], limit: 1000 })
      .filter((episode) => (episode.sealedAt || episode.updatedAt) <= input.sealedBefore);
    let sealed = 0;
    for (const episode of episodes) {
      if (this.isEpisodeEmpty(episode.episodeId)) {
        if (episode.dreamError !== 'episode_empty_soft_seal_not_promoted') {
          this.markEmptyEpisodeDreamSkipped(episode.episodeId, now, 'episode_empty_soft_seal_not_promoted');
        }
        continue;
      }
      this.sealEpisode(episode.episodeId, { mode: 'hard', reason: 'soft_seal_stabilized', now });
      sealed += 1;
    }
    return sealed;
  }

  claimDreamJobs(input: { projectId?: string; limit: number; now: number; leaseMs: number; maxAttempts: number; runId?: string }): ClaimedEpisodeDreamJob[] {
    this.db.prepare(`
      UPDATE episode_dream_jobs SET state = 'failed_terminal', lease_id = NULL, lease_until = NULL,
        failure_category = 'lease_attempt_limit',
        last_error = COALESCE(last_error, 'dream_lease_expired_at_attempt_limit'), updated_at = ?
      WHERE state = 'processing' AND lease_until IS NOT NULL AND lease_until < ? AND attempts >= ?
    `).run(input.now, input.now, input.maxAttempts);
    this.db.prepare(`
      UPDATE memory_episodes SET dream_status = 'failed', dream_error = 'dream_lease_expired_at_attempt_limit'
      WHERE episode_id IN (
        SELECT episode_id FROM episode_dream_jobs
        WHERE state = 'failed_terminal' AND failure_category = 'lease_attempt_limit' AND updated_at = ?
      )
    `).run(input.now);
    this.db.prepare(`
      UPDATE episode_dream_jobs SET state = 'failed_retryable', retry_after = ?, lease_id = NULL, lease_until = NULL,
        failure_category = 'lease_expired', last_error = COALESCE(last_error, 'dream_lease_expired'), updated_at = ?
      WHERE state = 'processing' AND lease_until IS NOT NULL AND lease_until < ? AND attempts < ?
    `).run(input.now + retryDelayMs(1), input.now, input.now, input.maxAttempts);
    this.db.prepare(`
      UPDATE memory_episodes SET dream_status = 'failed', dream_error = 'dream_lease_expired'
      WHERE episode_id IN (
        SELECT episode_id FROM episode_dream_jobs
        WHERE state = 'failed_retryable' AND failure_category = 'lease_expired' AND updated_at = ?
      )
    `).run(input.now);
    this.db.prepare(`
      UPDATE episode_dream_jobs SET state = 'retry_scheduled', updated_at = ?
      WHERE state = 'failed_retryable' AND retry_after IS NOT NULL AND retry_after <= ? AND attempts < ?
    `).run(input.now, input.now, input.maxAttempts);
    this.db.prepare(`
      UPDATE memory_episodes SET dream_status = 'queued', dream_error = NULL
      WHERE episode_id IN (SELECT episode_id FROM episode_dream_jobs WHERE state = 'retry_scheduled' AND updated_at = ?)
    `).run(input.now);
    this.skipEmptyDreamJobs({ projectId: input.projectId, now: input.now });
    const where = [`(j.state = 'pending' OR (j.state = 'retry_scheduled' AND j.attempts < ?))`];
    const params: Array<string | number> = [input.maxAttempts];
    if (input.projectId) { where.push('j.project_id = ?'); params.push(input.projectId); }
    const rows = this.db.prepare(`
      SELECT j.episode_id, j.project_id, j.mode_hint, j.attempts, j.created_at
      FROM episode_dream_jobs j
      JOIN memory_episodes e ON e.episode_id = j.episode_id
      WHERE ${where.join(' AND ')}
        AND e.event_count > 0
        AND EXISTS (SELECT 1 FROM memory_episode_events ee WHERE ee.episode_id = j.episode_id)
      ORDER BY j.priority DESC, j.created_at LIMIT ?
    `).all(...params, Math.max(1, Math.min(Math.trunc(input.limit), 100))) as Array<{
      episode_id: string; project_id: string; mode_hint: 'micro' | 'normal' | 'deep'; attempts: number; created_at: number;
    }>;
    const claimed: ClaimedEpisodeDreamJob[] = [];
    for (const row of rows) {
      const leaseId = `dream-lease-${randomUUID()}`;
      const result = this.db.prepare(`
        UPDATE episode_dream_jobs SET state = 'processing', lease_id = ?, lease_until = ?, attempts = attempts + 1,
          retry_after = NULL, updated_at = ?
        WHERE episode_id = ? AND state IN ('pending', 'retry_scheduled')
      `).run(leaseId, input.now + input.leaseMs, input.now, row.episode_id);
      if (result.changes) {
        this.db.prepare(`
          UPDATE memory_episodes SET dream_status = 'processing', last_dream_run_id = ?, dream_error = NULL
          WHERE episode_id = ?
        `).run(input.runId || null, row.episode_id);
        claimed.push({
          episodeId: row.episode_id, projectId: row.project_id, leaseId, modeHint: row.mode_hint,
          attempts: row.attempts + 1, createdAt: row.created_at,
        });
      }
    }
    return claimed;
  }

  skipEmptyDreamJobs(input: { projectId?: string; now?: number }): number {
    const now = input.now ?? Date.now();
    const params: Array<string | number> = [];
    const where = [
      `j.state IN ('pending', 'failed_retryable', 'retry_scheduled')`,
      `(COALESCE(e.event_count, 0) = 0 OR NOT EXISTS (
        SELECT 1 FROM memory_episode_events ee WHERE ee.episode_id = j.episode_id
      ))`,
    ];
    if (input.projectId) {
      where.push(`j.project_id = ?`);
      params.push(input.projectId);
    }
    const rows = this.db.prepare(`
      SELECT j.episode_id FROM episode_dream_jobs j
      LEFT JOIN memory_episodes e ON e.episode_id = j.episode_id
      WHERE ${where.join(' AND ')}
      ORDER BY j.updated_at DESC
      LIMIT 1000
    `).all(...params) as Array<{ episode_id: string }>;
    const episodeIds = rows.map((row) => row.episode_id);
    if (!episodeIds.length) return 0;
    this.markEmptyEpisodeDreamSkippedMany(episodeIds, now, 'episode_empty_skipped_no_raw_evidence');
    return episodeIds.length;
  }

  completeDreamJob(episodeId: string, leaseId: string, candidateIds: string[], now: number): void {
    const result = this.db.prepare(`
      UPDATE episode_dream_jobs SET state = 'processed', candidate_ids_json = ?, lease_id = NULL,
        lease_until = NULL, retry_after = NULL, failure_category = NULL, last_error = NULL, updated_at = ?
      WHERE episode_id = ? AND state = 'processing' AND lease_id = ?
    `).run(JSON.stringify(candidateIds), now, episodeId, leaseId);
    if (!result.changes) throw new Error(`episode_dream_lease_lost:${episodeId}`);
    this.db.prepare(`
      UPDATE memory_episodes SET dream_status = 'processed', last_dreamed_at = ?,
        dream_candidate_count = ?, dream_error = NULL WHERE episode_id = ?
    `).run(now, candidateIds.length, episodeId);
  }

  failDreamJob(episodeId: string, leaseId: string, error: string, input: {
    now: number;
    failureCategory: string;
    terminal: boolean;
    retryAfter?: number;
  }): void {
    const state: EpisodeDreamState = input.terminal ? 'failed_terminal' : 'failed_retryable';
    const result = this.db.prepare(`
      UPDATE episode_dream_jobs SET state = ?, last_error = ?, failure_category = ?, retry_after = ?,
        lease_id = NULL, lease_until = NULL, updated_at = ?
      WHERE episode_id = ? AND state = 'processing' AND lease_id = ?
    `).run(state, error.slice(0, 2000), input.failureCategory, input.retryAfter ?? null, input.now, episodeId, leaseId);
    if (!result.changes) return;
    this.db.prepare(`UPDATE memory_episodes SET dream_status = 'failed', dream_error = ? WHERE episode_id = ?`)
      .run(error.slice(0, 2000), episodeId);
  }

  retryFailed(projectId?: string): number {
    const result = projectId
      ? this.db.prepare(`UPDATE episode_dream_jobs SET state = 'pending', retry_after = NULL, lease_id = NULL, lease_until = NULL, updated_at = ? WHERE project_id = ? AND state = 'failed_retryable'`).run(Date.now(), projectId)
      : this.db.prepare(`UPDATE episode_dream_jobs SET state = 'pending', retry_after = NULL, lease_id = NULL, lease_until = NULL, updated_at = ? WHERE state = 'failed_retryable'`).run(Date.now());
    if (result.changes) {
      const where = projectId
        ? `episode_id IN (SELECT episode_id FROM episode_dream_jobs WHERE project_id = ? AND state = 'pending')`
        : `episode_id IN (SELECT episode_id FROM episode_dream_jobs WHERE state = 'pending')`;
      const statement = this.db.prepare(`UPDATE memory_episodes SET dream_status = 'queued', dream_error = NULL WHERE ${where}`);
      projectId ? statement.run(projectId) : statement.run();
    }
    return Number(result.changes || 0);
  }

  private markEmptyEpisodeDreamSkipped(episodeId: string, now: number, reason: string): void {
    this.markEmptyEpisodeDreamSkippedMany([episodeId], now, reason);
  }

  private markEmptyEpisodeDreamSkippedMany(episodeIds: string[], now: number, reason: string): void {
    if (!episodeIds.length) return;
    const placeholders = episodeIds.map(() => '?').join(', ');
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE episode_dream_jobs SET state = 'skipped', lease_id = NULL, lease_until = NULL,
          retry_after = NULL, failure_category = 'episode_empty', last_error = ?, candidate_ids_json = '[]',
          updated_at = ?
        WHERE episode_id IN (${placeholders})
          AND state IN ('pending', 'processing', 'failed_retryable', 'retry_scheduled')
      `).run(reason, now, ...episodeIds);
      this.db.prepare(`
        UPDATE memory_episodes SET dream_status = 'failed', dream_error = ?, last_dream_run_id = NULL,
          dream_candidate_count = 0, updated_at = ?
        WHERE episode_id IN (${placeholders})
      `).run(reason, now, ...episodeIds);
    })();
  }

  getDreamStatus(projectId?: string): EpisodeDreamStatus {
    const rows = (projectId
      ? this.db.prepare(`SELECT state, COUNT(*) AS count FROM episode_dream_jobs WHERE project_id = ? GROUP BY state`).all(projectId)
      : this.db.prepare(`SELECT state, COUNT(*) AS count FROM episode_dream_jobs GROUP BY state`).all()) as Array<{ state: EpisodeDreamState; count: number }>;
    const status: EpisodeDreamStatus = {
      projectId, pending: 0, processing: 0, processed: 0, failed: 0,
      failedRetryable: 0, failedTerminal: 0, retryScheduled: 0, skipped: 0,
    };
    for (const row of rows) {
      if (row.state === 'failed_retryable') status.failedRetryable = row.count;
      else if (row.state === 'failed_terminal') status.failedTerminal = row.count;
      else if (row.state === 'retry_scheduled') status.retryScheduled = row.count;
      else if (row.state === 'pending') status.pending = row.count;
      else if (row.state === 'processing') status.processing = row.count;
      else if (row.state === 'processed') status.processed = row.count;
      else if (row.state === 'skipped') status.skipped = row.count;
    }
    status.failed = status.failedRetryable + status.failedTerminal;
    return status;
  }

  countUnassignedRawEvents(projectId?: string): number {
    const row = projectId
      ? this.db.prepare(`
          SELECT COUNT(*) AS count FROM memory_events e
          LEFT JOIN memory_episode_events ee ON ee.event_id = e.event_id
          LEFT JOIN episode_event_dispositions ed ON ed.event_id = e.event_id
          WHERE e.event_type = 'RAW_EVENT_RECORDED' AND e.project_id = ? AND ee.event_id IS NULL AND ed.event_id IS NULL
        `).get(projectId)
      : this.db.prepare(`
          SELECT COUNT(*) AS count FROM memory_events e
          LEFT JOIN memory_episode_events ee ON ee.event_id = e.event_id
          LEFT JOIN episode_event_dispositions ed ON ed.event_id = e.event_id
          WHERE e.event_type = 'RAW_EVENT_RECORDED' AND ee.event_id IS NULL AND ed.event_id IS NULL
        `).get();
    return Number((row as { count?: number } | null)?.count || 0);
  }

  markEventDisposition(input: { eventId: string; projectId: string; disposition: 'ignored'; reason: string; now?: number }): void {
    this.db.prepare(`
      INSERT INTO episode_event_dispositions (event_id, project_id, disposition, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET disposition = excluded.disposition, reason = excluded.reason
    `).run(input.eventId, input.projectId, input.disposition, input.reason, input.now ?? Date.now());
  }

  hasEventDisposition(eventId: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM episode_event_dispositions WHERE event_id = ?`).get(eventId));
  }

  recordDreamRun(input: {
    runId: string; projectId?: string; requestedMode: string; selectedMode: string; reason: string;
    episodeIds: string[]; candidateIds: string[]; status: string; durationMs: number; error?: string; createdAt: number;
    failedEpisodes?: Array<{ episodeId: string; error: string; failureCategory: string; retryAfter?: number }>;
  }): void {
    this.db.prepare(`
      INSERT INTO episode_dream_runs (
        run_id, project_id, requested_mode, selected_mode, reason, episode_ids_json,
        candidate_ids_json, status, duration_ms, error, created_at, failed_episode_ids_json, failure_details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.runId, input.projectId || null, input.requestedMode, input.selectedMode, input.reason,
      JSON.stringify(input.episodeIds), JSON.stringify(input.candidateIds), input.status,
      input.durationMs, input.error || null, input.createdAt,
      JSON.stringify((input.failedEpisodes || []).map((item) => item.episodeId)), JSON.stringify(input.failedEpisodes || []),
    );
  }

  getIngestedEvent(projectId: string, sourceAgent: string, sourceSessionId: string, externalMessageId: string): string | undefined {
    const row = this.db.prepare(`
      SELECT event_id FROM episode_ingest_keys
      WHERE project_id = ? AND source_agent = ? AND source_session_id = ? AND external_message_id = ?
    `).get(projectId, sourceAgent, sourceSessionId, externalMessageId) as { event_id: string } | null;
    return row?.event_id;
  }

  recordIngestKey(input: { projectId: string; sourceAgent: string; sourceSessionId: string; externalMessageId: string; eventId: string; now?: number }): void {
    const now = input.now ?? Date.now();
    this.db.prepare(`
      INSERT OR IGNORE INTO episode_ingest_keys (
        ingest_key, project_id, source_agent, source_session_id, external_message_id, event_id, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?)
    `).run(
      `${input.projectId}\u0000${input.sourceAgent}\u0000${input.sourceSessionId}\u0000${input.externalMessageId}`,
      input.projectId, input.sourceAgent, input.sourceSessionId, input.externalMessageId, input.eventId, now, now,
    );
  }

  markIngestState(input: {
    projectId: string; sourceAgent: string; sourceSessionId: string; externalMessageId: string;
    state: 'reserved' | 'committed' | 'failed'; error?: string; now?: number;
  }): void {
    this.db.prepare(`
      UPDATE episode_ingest_keys SET state = ?, last_error = ?, updated_at = ?
      WHERE project_id = ? AND source_agent = ? AND source_session_id = ? AND external_message_id = ?
    `).run(input.state, input.error?.slice(0, 2000) || null, input.now ?? Date.now(),
      input.projectId, input.sourceAgent, input.sourceSessionId, input.externalMessageId);
  }

  getIngestState(projectId: string, sourceAgent: string, sourceSessionId: string, externalMessageId: string): {
    eventId: string; state: 'reserved' | 'committed' | 'failed'; error?: string; updatedAt?: number;
  } | undefined {
    const row = this.db.prepare(`
      SELECT event_id, state, last_error, updated_at FROM episode_ingest_keys
      WHERE project_id = ? AND source_agent = ? AND source_session_id = ? AND external_message_id = ?
    `).get(projectId, sourceAgent, sourceSessionId, externalMessageId) as {
      event_id: string; state: 'reserved' | 'committed' | 'failed'; last_error?: string | null; updated_at?: number | null;
    } | null;
    return row ? { eventId: row.event_id, state: row.state, error: row.last_error || undefined, updatedAt: row.updated_at ?? undefined } : undefined;
  }

  deleteByProject(projectId: string): number {
    let count = 0;
    const run = (sql: string) => { count += Number(this.db.prepare(sql).run(projectId).changes || 0); };
    run(`DELETE FROM episode_dream_runs WHERE project_id = ?`);
    run(`DELETE FROM episode_dream_jobs WHERE project_id = ?`);
    run(`DELETE FROM episode_closure_receipts WHERE project_id = ?`);
    run(`DELETE FROM episode_ingest_keys WHERE project_id = ?`);
    run(`DELETE FROM episode_event_dispositions WHERE project_id = ?`);
    const episodeIds = (this.db.prepare(`SELECT episode_id FROM memory_episodes WHERE project_id = ?`).all(projectId) as Array<{ episode_id: string }>).map((row) => row.episode_id);
    if (episodeIds.length) {
      const placeholders = episodeIds.map(() => '?').join(', ');
      count += Number(this.db.prepare(`DELETE FROM memory_episode_events WHERE episode_id IN (${placeholders})`).run(...episodeIds).changes || 0);
    }
    run(`DELETE FROM memory_episodes WHERE project_id = ?`);
    return count;
  }

  private enqueueDreamJob(episode: MemoryEpisode, modeHint: 'micro' | 'normal' | 'deep', now: number): void {
    const priority = Math.round(episode.importance * 100) + (['correction', 'decision', 'prospective'].includes(episode.episodeType) ? 30 : 0);
    this.db.prepare(`
      INSERT INTO episode_dream_jobs (episode_id, project_id, state, priority, mode_hint, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?, ?, ?)
      ON CONFLICT(episode_id) DO NOTHING
    `).run(episode.episodeId, episode.projectId, priority, modeHint, now, now);
    this.db.prepare(`UPDATE memory_episodes SET dream_status = 'queued', dream_error = NULL WHERE episode_id = ?`)
      .run(episode.episodeId);
  }

  private initializeSchema(): void {
    // Migration 22 is authoritative. This keeps direct store construction compatible in tests and embeddings.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_episodes (
        episode_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT NOT NULL, source_agent TEXT,
        conversation_thread_id TEXT, topic_path TEXT, episode_type TEXT NOT NULL, status TEXT NOT NULL, importance REAL NOT NULL,
        summary TEXT, start_event_id TEXT NOT NULL, end_event_id TEXT NOT NULL, start_seq INTEGER, end_seq INTEGER,
        event_count INTEGER NOT NULL, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, sealed_at INTEGER,
        semantic_summary_json TEXT, episode_tags_json TEXT NOT NULL DEFAULT '[]', candidate_types_json TEXT NOT NULL DEFAULT '[]',
        importance_signals_json TEXT NOT NULL DEFAULT '[]', importance_reason TEXT, linked_episode_id TEXT,
        dream_status TEXT NOT NULL DEFAULT 'none', last_dream_run_id TEXT, last_dreamed_at INTEGER,
        dream_candidate_count INTEGER NOT NULL DEFAULT 0, dream_error TEXT
      );
      CREATE TABLE IF NOT EXISTS memory_episode_events (
        episode_id TEXT NOT NULL, event_id TEXT NOT NULL UNIQUE, position INTEGER NOT NULL,
        relation TEXT NOT NULL, confidence REAL NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (episode_id, event_id)
      );
      CREATE TABLE IF NOT EXISTS episode_closure_receipts (
        receipt_id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, project_id TEXT NOT NULL, closure_mode TEXT NOT NULL,
        closure_reason TEXT NOT NULL, source_event_ids_json TEXT NOT NULL, start_seq INTEGER, end_seq INTEGER,
        topic_path TEXT, episode_type TEXT NOT NULL, importance REAL NOT NULL, dream_recommended INTEGER NOT NULL,
        dream_mode TEXT NOT NULL, created_at INTEGER NOT NULL, closure_reason_code TEXT NOT NULL DEFAULT 'manual',
        closure_reason_detail TEXT, requires_review INTEGER NOT NULL DEFAULT 0,
        ignored_nearby_event_ids_json TEXT NOT NULL DEFAULT '[]', unassigned_nearby_event_ids_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS episode_dream_jobs (
        episode_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, state TEXT NOT NULL, priority INTEGER NOT NULL,
        mode_hint TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lease_id TEXT, lease_until INTEGER,
        last_error TEXT, retry_after INTEGER, failure_category TEXT,
        candidate_ids_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS episode_dream_runs (
        run_id TEXT PRIMARY KEY, project_id TEXT, requested_mode TEXT NOT NULL, selected_mode TEXT NOT NULL,
        reason TEXT NOT NULL, episode_ids_json TEXT NOT NULL, candidate_ids_json TEXT NOT NULL, status TEXT NOT NULL,
        duration_ms INTEGER NOT NULL, error TEXT, created_at INTEGER NOT NULL,
        failed_episode_ids_json TEXT NOT NULL DEFAULT '[]', failure_details_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS episode_ingest_keys (
        ingest_key TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_agent TEXT NOT NULL,
        source_session_id TEXT NOT NULL, external_message_id TEXT NOT NULL,
        event_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'committed', created_at INTEGER NOT NULL,
        updated_at INTEGER, last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS episode_event_dispositions (
        event_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, disposition TEXT NOT NULL,
        reason TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS episode_cross_refs (
        cross_ref_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, episode_id TEXT NOT NULL, referenced_episode_id TEXT,
        event_id TEXT, relation TEXT NOT NULL, created_by TEXT NOT NULL, confidence REAL NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS episode_repair_audit (
        repair_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, operation TEXT NOT NULL, payload_json TEXT NOT NULL,
        before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at INTEGER NOT NULL
      );
    `);
  }
}

interface EpisodeRow {
  episode_id: string; project_id: string; session_id: string; source_agent?: string | null;
  conversation_thread_id?: string | null; topic_path?: string | null;
  episode_type: EpisodeType; status: EpisodeStatus; importance: number; summary?: string | null;
  semantic_summary_json?: string | null; episode_tags_json?: string | null; candidate_types_json?: string | null;
  importance_signals_json?: string | null; importance_reason?: string | null; linked_episode_id?: string | null;
  dream_status?: MemoryEpisode['dreamStatus']; last_dream_run_id?: string | null; last_dreamed_at?: number | null;
  dream_candidate_count?: number; dream_error?: string | null;
  start_event_id: string; end_event_id: string; start_seq?: number | null; end_seq?: number | null;
  event_count: number; started_at: number; updated_at: number; sealed_at?: number | null;
}
interface EpisodeEventRow { episode_id: string; event_id: string; position: number; relation: TurnRelation; confidence: number; created_at: number }
interface ClosureRow {
  receipt_id: string; episode_id: string; project_id: string; closure_mode: EpisodeClosureMode; closure_reason: string;
  source_event_ids_json: string; start_seq?: number | null; end_seq?: number | null; topic_path?: string | null;
  episode_type: EpisodeType; importance: number; dream_recommended: number; dream_mode: 'micro' | 'normal' | 'deep'; created_at: number;
  closure_reason_code?: EpisodeClosureReasonCode | null; closure_reason_detail?: string | null; requires_review?: number;
  ignored_nearby_event_ids_json?: string | null; unassigned_nearby_event_ids_json?: string | null;
}

function mapEpisode(row: EpisodeRow): MemoryEpisode {
  return {
    episodeId: row.episode_id, projectId: row.project_id, sessionId: row.session_id,
    sourceAgent: row.source_agent || undefined, conversationThreadId: row.conversation_thread_id || undefined,
    topicPath: row.topic_path || undefined,
    episodeType: row.episode_type, status: row.status, importance: row.importance, summary: row.summary || undefined,
    semanticSummary: parseJson(row.semantic_summary_json, undefined),
    episodeTags: parseJson(row.episode_tags_json, []), candidateTypes: parseJson(row.candidate_types_json, []),
    importanceSignals: parseJson(row.importance_signals_json, []), importanceReason: row.importance_reason || undefined,
    linkedEpisodeId: row.linked_episode_id || undefined, dreamStatus: row.dream_status || 'none',
    lastDreamRunId: row.last_dream_run_id || undefined, lastDreamedAt: row.last_dreamed_at ?? undefined,
    dreamCandidateCount: row.dream_candidate_count || 0, dreamError: row.dream_error || undefined,
    startEventId: row.start_event_id, endEventId: row.end_event_id,
    startSeq: row.start_seq ?? undefined, endSeq: row.end_seq ?? undefined, eventCount: row.event_count,
    startedAt: row.started_at, updatedAt: row.updated_at, sealedAt: row.sealed_at ?? undefined,
  };
}
function mapEventLink(row: EpisodeEventRow): EpisodeEventLink {
  return { episodeId: row.episode_id, eventId: row.event_id, position: row.position, relation: row.relation, confidence: row.confidence, createdAt: row.created_at };
}
function mapClosure(row: ClosureRow): EpisodeClosureReceipt {
  return {
    receiptId: row.receipt_id, episodeId: row.episode_id, projectId: row.project_id,
    closureMode: row.closure_mode, closureReason: row.closure_reason,
    closureReasonCode: row.closure_reason_code || normalizeClosureReasonCode(row.closure_reason, row.closure_mode),
    closureReasonDetail: row.closure_reason_detail || undefined,
    sourceEventIds: JSON.parse(row.source_event_ids_json) as string[], startSeq: row.start_seq ?? undefined,
    endSeq: row.end_seq ?? undefined, topicPath: row.topic_path || undefined, episodeType: row.episode_type,
    importance: row.importance, dreamRecommended: row.dream_recommended === 1, dreamMode: row.dream_mode,
    requiresReview: row.requires_review === 1,
    ignoredNearbyEventIds: parseJson(row.ignored_nearby_event_ids_json, []),
    unassignedNearbyEventIds: parseJson(row.unassigned_nearby_event_ids_json, []),
    createdAt: row.created_at,
  };
}

function normalizeClosureReasonCode(reason: string, mode: EpisodeClosureMode): EpisodeClosureReasonCode {
  if (reason.includes('topic_switch')) return 'topic_switch';
  if (reason.includes('batch')) return 'batch_boundary';
  if (reason.includes('idle')) return 'idle_timeout';
  if (reason.includes('soft_seal_stabilized')) return 'soft_seal_stabilized';
  if (reason.includes('repair')) return 'repair';
  if (reason.includes('explicit_user_closure')) return 'explicit_user_closure';
  return mode === 'manual' ? 'manual' : 'manual';
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function retryDelayMs(attempts: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}
