import { randomUUID } from 'node:crypto';
import { sealDuplicateOpenEpisodes } from './EpisodeActiveScopeGuard.js';
import { summarizeEpisode } from './EpisodeSemanticSummarizer.js';
import { replayEpisodeBoundaryState } from './EpisodeBoundaryReplayEngine.js';
export class EpisodeStore {
    db;
    resolveEvent;
    constructor(db, resolveEvent, options = {}) {
        this.db = db;
        this.resolveEvent = resolveEvent;
        this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
        const foreignKeys = this.db.prepare('PRAGMA foreign_keys').get();
        if (foreignKeys?.foreign_keys !== 1)
            throw new Error('episode_store_foreign_keys_disabled');
        if (options.initializeSchemaForTests !== false)
            this.initializeSchema();
    }
    getDatabase() {
        return this.db;
    }
    createEpisode(input) {
        const episodeId = `episode-${randomUUID()}`;
        this.db.prepare(`
      INSERT INTO memory_episodes (
        episode_id, project_id, session_id, source_agent, conversation_thread_id, topic_path, episode_type, status,
        importance, start_event_id, end_event_id, start_seq, end_seq, event_count,
        started_at, updated_at, episode_tags_json, candidate_types_json, importance_signals_json,
        importance_reason, linked_episode_id, dream_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'none')
    `).run(episodeId, input.projectId, input.sessionId, input.sourceAgent || null, input.conversationThreadId || null, input.topicPath || null, input.episodeType, input.importance, input.eventId, input.eventId, input.globalSeq ?? null, input.globalSeq ?? null, input.occurredAt, input.occurredAt, JSON.stringify(input.episodeTags || []), JSON.stringify(input.candidateTypes || []), JSON.stringify(input.importanceSignals || []), input.importanceReason || null, input.linkedEpisodeId || null);
        return this.getEpisode(episodeId);
    }
    findActiveEpisode(projectId, sessionId, sourceAgent, conversationThreadId) {
        const exact = this.findActiveEpisodeRow(projectId, sessionId, sourceAgent, conversationThreadId);
        if (exact)
            return mapEpisode(exact);
        // Episodes created before source/thread scoping have both fields unset. Reuse
        // only that legacy shape so an upgrade does not split an in-flight episode or
        // merge modern episodes that already carry explicit ownership metadata.
        if (!sourceAgent && !conversationThreadId)
            return undefined;
        const legacy = this.db.prepare(`
      SELECT * FROM memory_episodes
      WHERE project_id = ? AND session_id = ? AND status IN ('open', 'soft_sealed')
        AND source_agent IS NULL AND conversation_thread_id IS NULL
      ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1
    `).get(projectId, sessionId);
        return legacy ? mapEpisode(legacy) : undefined;
    }
    findActiveEpisodeRow(projectId, sessionId, sourceAgent, conversationThreadId) {
        return this.db.prepare(`
      SELECT * FROM memory_episodes
      WHERE project_id = ? AND session_id = ? AND status IN ('open', 'soft_sealed')
        AND COALESCE(source_agent, '') = ?
        AND COALESCE(conversation_thread_id, '') = ?
      ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1
    `).get(projectId, sessionId, sourceAgent ?? '', conversationThreadId ?? '');
    }
    claimLegacyEpisodeScope(episodeId, sourceAgent, conversationThreadId) {
        if (!sourceAgent && !conversationThreadId)
            return this.getEpisode(episodeId);
        if (this.resolveEvent) {
            const events = this.listEventLinks(episodeId)
                .map((link) => this.resolveEvent(link.eventId)).filter((event) => Boolean(event));
            const mismatch = events.some((event) => {
                const metadata = event.payload?.metadata;
                const eventSourceAgent = typeof metadata?.sourceAgent === 'string' ? metadata.sourceAgent : undefined;
                return (sourceAgent !== undefined && eventSourceAgent !== sourceAgent)
                    || (conversationThreadId !== undefined && (event.threadId || '') !== conversationThreadId);
            });
            if (mismatch)
                return undefined;
        }
        this.db.prepare(`
      UPDATE memory_episodes SET source_agent = ?, conversation_thread_id = ?
      WHERE episode_id = ? AND source_agent IS NULL AND conversation_thread_id IS NULL
    `).run(sourceAgent || null, conversationThreadId || null, episodeId);
        const episode = this.getEpisode(episodeId);
        if (!episode)
            return undefined;
        if (sourceAgent && episode.sourceAgent !== sourceAgent)
            return undefined;
        if (conversationThreadId && episode.conversationThreadId !== conversationThreadId)
            return undefined;
        return episode;
    }
    getEpisode(episodeId) {
        const row = this.db.prepare(`SELECT * FROM memory_episodes WHERE episode_id = ?`).get(episodeId);
        return row ? mapEpisode(row) : undefined;
    }
    listEpisodes(options = {}) {
        const where = [];
        const params = [];
        if (options.projectId) {
            where.push('project_id = ?');
            params.push(options.projectId);
        }
        if (options.sessionId) {
            where.push('session_id = ?');
            params.push(options.sessionId);
        }
        if (options.statuses?.length) {
            where.push(`status IN (${options.statuses.map(() => '?').join(', ')})`);
            params.push(...options.statuses);
        }
        const rows = this.db.prepare(`
      SELECT * FROM memory_episodes ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY updated_at DESC, episode_id DESC LIMIT ?
    `).all(...params, Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 1000)));
        return rows.map(mapEpisode);
    }
    listEpisodesForFrameBackfill(options) {
        const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 500));
        const params = [options.projectId];
        const cursorClause = options.cursor ? 'AND episode_id > ?' : '';
        if (options.cursor)
            params.push(options.cursor);
        const rows = this.db.prepare(`
      SELECT * FROM memory_episodes
      WHERE project_id=? AND status IN ('sealed','soft_sealed','open') ${cursorClause}
      ORDER BY episode_id ASC LIMIT ?
    `).all(...params, limit + 1);
        const episodes = rows.slice(0, limit).map(mapEpisode);
        return { episodes, ...(episodes.at(-1) ? { nextCursor: episodes.at(-1).episodeId } : {}), hasMore: rows.length > limit };
    }
    listEpisodesForBoundaryAudit(options) {
        const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 1000));
        const where = [`project_id = ?`];
        const params = [options.projectId];
        if (options.statuses?.length) {
            where.push(`status IN (${options.statuses.map(() => '?').join(', ')})`);
            params.push(...options.statuses);
        }
        const cursor = parseAuditCursor(options.cursor);
        if (cursor) {
            where.push(`(updated_at < ? OR (updated_at = ? AND episode_id < ?))`);
            params.push(cursor.updatedAt, cursor.updatedAt, cursor.episodeId);
        }
        const rows = this.db.prepare(`
      SELECT * FROM memory_episodes
      WHERE ${where.join(' AND ')}
      ORDER BY updated_at DESC, episode_id DESC
      LIMIT ?
    `).all(...params, limit + 1);
        const selected = rows.slice(0, limit);
        const last = selected.at(-1);
        return {
            episodes: selected.map(mapEpisode),
            nextCursor: rows.length > limit && last ? formatAuditCursor(last.updated_at, last.episode_id) : undefined,
        };
    }
    appendEvent(input) {
        const existing = this.getEventLink(input.eventId);
        if (existing) {
            if (existing.episodeId === input.episodeId)
                return existing;
            throw new Error(`episode_event_link_conflict:${input.eventId}`);
        }
        const episode = this.getEpisode(input.episodeId);
        if (!episode || episode.status !== 'open')
            throw new Error(`episode_not_open:${input.episodeId}`);
        let created;
        this.db.transaction(() => {
            const locked = this.db.prepare(`SELECT status FROM memory_episodes WHERE episode_id = ?`).get(input.episodeId);
            if (locked?.status !== 'open')
                throw new Error(`episode_not_open:${input.episodeId}`);
            const positionState = this.db.prepare(`
        SELECT COUNT(*) AS count, MIN(position) AS min_position, MAX(position) AS max_position
        FROM memory_episode_events WHERE episode_id = ?
      `).get(input.episodeId);
            const count = Number(positionState?.count ?? 0);
            if (count > 0 && (positionState?.min_position !== 1 || positionState?.max_position !== count)) {
                throw new Error(`episode_positions_corrupt:${input.episodeId}`);
            }
            const position = count + 1;
            this.db.prepare(`
        INSERT INTO memory_episode_events (episode_id, event_id, position, relation, confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(input.episodeId, input.eventId, position, input.relation, input.confidence, input.occurredAt);
            const candidateTypes = [...new Set([...episode.candidateTypes, ...(input.candidateTypes || [])])];
            const importanceSignals = [...new Set([...episode.importanceSignals, ...(input.importanceSignals || [])])];
            this.db.prepare(`
        UPDATE memory_episodes SET
          end_event_id = ?, end_seq = COALESCE(?, end_seq), event_count = ?, updated_at = MAX(updated_at, ?),
          episode_type = COALESCE(?, episode_type), importance = MAX(importance, ?),
          summary = CASE WHEN ? IS NULL OR ? = '' THEN summary ELSE SUBSTR(COALESCE(summary || '\n', '') || ?, 1, 1600) END,
          candidate_types_json = ?, importance_signals_json = ?, importance_reason = COALESCE(?, importance_reason)
        WHERE episode_id = ? AND status = 'open'
      `).run(input.eventId, input.globalSeq ?? null, position, input.occurredAt, input.episodeType || null, input.importance ?? episode.importance, input.summaryText || null, input.summaryText || '', input.summaryText || '', JSON.stringify(candidateTypes), JSON.stringify(importanceSignals), input.importanceReason || null, input.episodeId);
            created = { episodeId: input.episodeId, eventId: input.eventId, position, relation: input.relation, confidence: input.confidence, createdAt: input.occurredAt };
        })();
        return created;
    }
    getEventLink(eventId) {
        const row = this.db.prepare(`SELECT * FROM memory_episode_events WHERE event_id = ?`).get(eventId);
        return row ? mapEventLink(row) : undefined;
    }
    listEventLinks(episodeId) {
        return this.db.prepare(`
      SELECT * FROM memory_episode_events WHERE episode_id = ? ORDER BY position, event_id
    `).all(episodeId).map(mapEventLink);
    }
    getBoundarySnapshot(episodeId, timezone) {
        const episode = this.getEpisode(episodeId);
        if (!episode)
            throw new Error(`episode_not_found:${episodeId}`);
        if (!this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_events'`).get()) {
            const actualLinkCount = this.listEventLinks(episodeId).length;
            return { eventCount: actualLinkCount, actualLinkCount, storedEventCount: episode.eventCount, eventCountMismatch: actualLinkCount !== episode.eventCount, startedAt: episode.startedAt, updatedAt: episode.updatedAt, trustedLocalDates: [] };
        }
        const actualLinkCount = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM memory_episode_events WHERE episode_id = ?`).get(episodeId)?.count ?? 0);
        const hasLocalDateSource = this.db.prepare(`PRAGMA table_info(memory_events)`).all()
            .some((row) => row.name === 'local_date_source');
        const rows = this.db.prepare(`
      SELECT ee.event_id AS event_id, ee.position AS position, ee.relation AS relation,
        ee.confidence AS confidence, ee.created_at AS created_at, e.role AS role,
        e.local_date AS local_date,
        ${hasLocalDateSource ? 'e.local_date_source' : "'legacy_unknown'"} AS local_date_source,
        e.occurred_at AS occurred_at
      FROM memory_episode_events ee
      JOIN memory_events e ON e.event_id = ee.event_id
      WHERE ee.episode_id = ?
      ORDER BY ee.position, ee.event_id
    `).all(episodeId);
        const state = replayEpisodeBoundaryState({
            episode: { startedAt: episode.startedAt },
            timezone,
            pairs: rows.map((row) => ({
                link: { episodeId, eventId: row.event_id, position: row.position, relation: row.relation, confidence: row.confidence, createdAt: row.created_at },
                event: this.resolveEvent?.(row.event_id) || {
                    eventId: row.event_id,
                    role: row.role,
                    localDate: row.local_date ?? undefined,
                    localDateSource: row.local_date_source || 'legacy_unknown',
                    occurredAt: row.occurred_at ?? undefined,
                    payload: {},
                },
            })),
        });
        return {
            eventCount: actualLinkCount,
            actualLinkCount,
            storedEventCount: episode.eventCount,
            eventCountMismatch: actualLinkCount !== episode.eventCount,
            startedAt: episode.startedAt,
            updatedAt: state.lastEventAt ?? episode.updatedAt,
            lastEventAt: state.lastEventAt,
            lastTrustedUserLocalDate: state.lastTrustedUserLocalDate,
            lastTrustedLocalDate: state.lastTrustedUserLocalDate,
            trustedLocalDates: state.trustedLocalDates,
        };
    }
    transaction(fn) {
        const tx = this.db.transaction(fn);
        return typeof tx.immediate === 'function' ? tx.immediate() : tx();
    }
    isEpisodeEmpty(episodeId) {
        const episode = this.getEpisode(episodeId);
        if (!episode)
            throw new Error(`episode_not_found:${episodeId}`);
        return this.listEventLinks(episodeId).length === 0;
    }
    addCrossReference(input) {
        const episode = this.getEpisode(input.episodeId);
        if (!episode)
            throw new Error(`episode_not_found:${input.episodeId}`);
        if (episode.projectId !== input.projectId)
            throw new Error(`episode_project_mismatch:${input.episodeId}`);
        if (input.referencedEpisodeId) {
            const referenced = this.getEpisode(input.referencedEpisodeId);
            if (!referenced || referenced.projectId !== input.projectId)
                throw new Error(`episode_cross_ref_project_mismatch:${input.referencedEpisodeId}`);
        }
        const id = `episode-cross-ref-${randomUUID()}`;
        this.db.prepare(`
      INSERT INTO episode_cross_refs (cross_ref_id, project_id, episode_id, referenced_episode_id, event_id,
        relation, created_by, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.projectId, input.episodeId, input.referencedEpisodeId || null, input.eventId || null, input.relation, input.createdBy, Math.max(0, Math.min(1, input.confidence ?? 1)), input.now ?? Date.now());
        return id;
    }
    moveEventForRepair(eventId, targetEpisodeId, now = Date.now()) {
        const link = this.getEventLink(eventId);
        if (!link)
            throw new Error(`episode_event_not_linked:${eventId}`);
        const source = this.getEpisode(link.episodeId);
        const target = this.getEpisode(targetEpisodeId);
        if (!source || !target)
            throw new Error('episode_not_found');
        if (source.projectId !== target.projectId)
            throw new Error('episode_project_mismatch');
        if (source.sessionId !== target.sessionId
            || (source.sourceAgent || '') !== (target.sourceAgent || '')
            || (source.conversationThreadId || '') !== (target.conversationThreadId || '')) {
            throw new Error('episode_repair_scope_mismatch');
        }
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
    reclassifyForRepair(episodeId, input) {
        const episode = this.getEpisode(episodeId);
        if (!episode)
            throw new Error(`episode_not_found:${episodeId}`);
        this.db.prepare(`
      UPDATE memory_episodes SET episode_type = ?, topic_path = ?, importance = ?, updated_at = ? WHERE episode_id = ?
    `).run(input.episodeType || episode.episodeType, input.topicPath ?? episode.topicPath ?? null, input.importance === undefined ? episode.importance : Math.max(0, Math.min(1, input.importance)), input.now ?? Date.now(), episodeId);
        this.invalidateEpisodeDerivedState(episodeId, input.now ?? Date.now());
        return this.getEpisode(episodeId);
    }
    requeueDreamForRepair(episodeId, modeHint = 'normal', now = Date.now()) {
        const episode = this.getEpisode(episodeId);
        if (!episode)
            throw new Error(`episode_not_found:${episodeId}`);
        if (episode.eventCount === 0)
            throw new Error(`episode_empty:${episodeId}`);
        if (episode.status !== 'sealed')
            throw new Error(`episode_not_sealed:${episodeId}`);
        this.db.prepare(`
      INSERT INTO episode_dream_jobs (episode_id, project_id, state, priority, mode_hint, attempts, candidate_ids_json, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?, 0, '[]', ?, ?)
      ON CONFLICT(episode_id) DO UPDATE SET state = 'pending', mode_hint = excluded.mode_hint, attempts = 0,
        lease_id = NULL, lease_until = NULL, last_error = NULL, retry_after = NULL, failure_category = NULL,
        candidate_ids_json = '[]', updated_at = excluded.updated_at
    `).run(episodeId, episode.projectId, Math.round(episode.importance * 100), modeHint, now, now);
        this.db.prepare(`UPDATE memory_episodes SET dream_status = 'queued', dream_error = NULL, last_dream_run_id = NULL WHERE episode_id = ?`).run(episodeId);
    }
    recordRepairAudit(input) {
        const repairId = `episode-repair-${randomUUID()}`;
        this.db.prepare(`
      INSERT INTO episode_repair_audit (repair_id, project_id, operation, payload_json, before_json, after_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(repairId, input.projectId, input.operation, JSON.stringify(input.payload), JSON.stringify(input.before), JSON.stringify(input.after), input.now ?? Date.now());
        return repairId;
    }
    recordBoundaryDecision(input) {
        const decisionId = `episode-boundary-${randomUUID()}`;
        const result = this.db.prepare(`
      INSERT INTO episode_boundary_decisions (
        decision_id, project_id, session_id, source_agent, thread_id, primary_event_id,
        previous_episode_id, resulting_episode_id, policy_version, mode, guard_action,
        guard_codes_json, metrics_json, cpu_decision_json, reviewer_invoked,
        reviewer_decision_json, final_decision_json, warnings_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, primary_event_id, policy_version) DO NOTHING
    `).run(decisionId, input.projectId, input.sessionId, input.sourceAgent || null, input.threadId || null, input.primaryEventId, input.previousEpisodeId || null, input.resultingEpisodeId || null, input.policyVersion, input.mode, input.guardAction, JSON.stringify(input.guardCodes), JSON.stringify(input.metrics), JSON.stringify(safeDecision(input.cpuDecision)), input.reviewerInvoked ? 1 : 0, input.reviewerDecision ? JSON.stringify(safeDecision(input.reviewerDecision)) : null, JSON.stringify(safeDecision(input.finalDecision)), JSON.stringify(input.warnings), input.createdAt ?? Date.now());
        if (Number(result.changes || 0) > 0)
            return { recorded: true, decisionId, status: 'inserted' };
        const existingRow = this.db.prepare(`
      SELECT * FROM episode_boundary_decisions
      WHERE project_id = ? AND primary_event_id = ? AND policy_version = ?
      LIMIT 1
    `).get(input.projectId, input.primaryEventId, input.policyVersion);
        const existing = existingRow ? mapBoundaryDecision(existingRow) : undefined;
        if (existing && !sameBoundaryDecision(existing, input))
            throw new Error(`episode_boundary_decision_conflict:${input.primaryEventId}`);
        return { recorded: false, decisionId: existing?.decisionId, status: 'duplicate' };
    }
    listBoundaryDecisions(options = {}) {
        const where = [];
        const params = [];
        if (options.projectId) {
            where.push('project_id = ?');
            params.push(options.projectId);
        }
        if (options.primaryEventId) {
            where.push('primary_event_id = ?');
            params.push(options.primaryEventId);
        }
        const rows = this.db.prepare(`
      SELECT * FROM episode_boundary_decisions ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC LIMIT ?
    `).all(...params, Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 1000)));
        return rows.map(mapBoundaryDecision);
    }
    invalidateEpisodeDerivedState(episodeId, now) {
        this.db.prepare(`DELETE FROM episode_dream_jobs WHERE episode_id = ?`).run(episodeId);
        this.db.prepare(`
      UPDATE memory_episodes SET dream_status = 'none', last_dream_run_id = NULL, last_dreamed_at = NULL,
        dream_candidate_count = 0, dream_error = NULL, updated_at = ? WHERE episode_id = ?
    `).run(now, episodeId);
    }
    resequenceEpisode(episodeId, now) {
        const links = this.listEventLinks(episodeId);
        if (links.length === 0) {
            this.deleteEmptyEpisode(episodeId);
            return;
        }
        const eventById = new Map(links.map((link) => [link.eventId, this.resolveEvent?.(link.eventId)]));
        links.sort((left, right) => canonicalRepairOrder(eventById.get(left.eventId), eventById.get(right.eventId), left, right));
        const updatePosition = this.db.prepare(`UPDATE memory_episode_events SET position = ? WHERE event_id = ? AND episode_id = ?`);
        for (const [index, link] of links.entries())
            updatePosition.run(-1_000_000_000 - index, link.eventId, episodeId);
        for (const [index, link] of links.entries())
            updatePosition.run(index + 1, link.eventId, episodeId);
        const events = links.map((link) => eventById.get(link.eventId)).filter((event) => Boolean(event));
        const first = events[0];
        const last = events.at(-1);
        this.db.prepare(`
      UPDATE memory_episodes SET event_count = ?, start_event_id = ?, end_event_id = ?,
        start_seq = ?, end_seq = ?, updated_at = ? WHERE episode_id = ?
    `).run(links.length, first?.eventId ?? links[0].eventId, last?.eventId ?? links.at(-1).eventId, first?.globalSeq ?? null, last?.globalSeq ?? null, now, episodeId);
    }
    deleteEmptyEpisode(episodeId) {
        this.db.prepare(`DELETE FROM episode_closure_receipts WHERE episode_id = ?`).run(episodeId);
        this.db.prepare(`DELETE FROM episode_dream_jobs WHERE episode_id = ?`).run(episodeId);
        this.db.prepare(`DELETE FROM episode_cross_refs WHERE episode_id = ? OR referenced_episode_id = ?`).run(episodeId, episodeId);
        this.db.prepare(`DELETE FROM memory_episodes WHERE episode_id = ?`).run(episodeId);
    }
    reopenSoftEpisode(episodeId, now) {
        const result = this.db.prepare(`
      UPDATE memory_episodes SET status = 'open', sealed_at = NULL, updated_at = ?, dream_status = 'none', dream_error = NULL
      WHERE episode_id = ? AND status = 'soft_sealed'
    `).run(now, episodeId);
        if (!result.changes)
            throw new Error(`episode_not_soft_sealed:${episodeId}`);
        this.db.prepare(`DELETE FROM episode_dream_jobs WHERE episode_id = ? AND state IN ('pending', 'failed_retryable', 'retry_scheduled')`).run(episodeId);
        return this.getEpisode(episodeId);
    }
    sealEpisode(episodeId, input) {
        const now = input.now ?? Date.now();
        const episode = this.getEpisode(episodeId);
        if (!episode)
            throw new Error(`episode_not_found:${episodeId}`);
        const status = input.mode === 'soft' ? 'soft_sealed' : 'sealed';
        const auditReseal = input.mode === 'manual' || input.reasonCode === 'repair' || /repair|force|recompute/iu.test(input.reason);
        if (episode.status === status && !auditReseal) {
            const existing = this.listClosureReceipts({ episodeId, limit: 1 })[0];
            if (existing)
                return existing;
        }
        const links = this.listEventLinks(episodeId);
        if (links.length === 0 && input.mode !== 'soft')
            throw new Error(`episode_empty:${episodeId}`);
        const resolvedEvents = links.map((link) => this.resolveEvent?.(link.eventId));
        const missingRawEvidence = Boolean(this.resolveEvent) && resolvedEvents.some((event) => !event);
        const requiresReview = input.requiresReview === true || links.length === 0 || missingRawEvidence;
        const semanticSummary = input.semanticSummary || summarizeEpisode(episode, resolvedEvents.filter((event) => Boolean(event)), links.map((link) => link.eventId));
        const dreamMode = links.length >= 100
            ? 'deep'
            : episode.importance >= 0.8 || ['decision', 'correction', 'preference', 'goal', 'prospective'].includes(episode.episodeType)
                ? 'micro' : 'normal';
        const receipt = {
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
      `).run(receipt.receiptId, episodeId, episode.projectId, input.mode, input.reason, JSON.stringify(receipt.sourceEventIds), receipt.startSeq ?? null, receipt.endSeq ?? null, receipt.topicPath || null, receipt.episodeType, receipt.importance, receipt.dreamRecommended ? 1 : 0, receipt.dreamMode, now, receipt.closureReasonCode, receipt.closureReasonDetail || null, receipt.requiresReview ? 1 : 0, JSON.stringify(receipt.ignoredNearbyEventIds), JSON.stringify(receipt.unassignedNearbyEventIds));
            if (status === 'sealed' && receipt.dreamRecommended && !receipt.requiresReview)
                this.enqueueDreamJob(episode, dreamMode, now);
            if (status !== 'sealed') {
                this.db.prepare(`DELETE FROM episode_dream_jobs WHERE episode_id = ?`).run(episodeId);
                this.db.prepare(`UPDATE memory_episodes SET dream_status = 'none', dream_error = NULL, last_dream_run_id = NULL WHERE episode_id = ?`).run(episodeId);
            }
        })();
        return receipt;
    }
    listClosureReceipts(options = {}) {
        const where = [];
        const params = [];
        if (options.episodeId) {
            where.push('episode_id = ?');
            params.push(options.episodeId);
        }
        if (options.projectId) {
            where.push('project_id = ?');
            params.push(options.projectId);
        }
        const rows = this.db.prepare(`
      SELECT * FROM episode_closure_receipts ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC LIMIT ?
    `).all(...params, Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 1000)));
        return rows.map(mapClosure);
    }
    sealIdleEpisodes(input) {
        const episodes = this.listEpisodes({ projectId: input.projectId, statuses: ['open'], limit: 1000 })
            .filter((episode) => episode.updatedAt <= input.idleBefore);
        return episodes.map((episode) => this.sealEpisode(episode.episodeId, { mode: 'soft', reason: 'idle_timeout', now: input.now }));
    }
    finalizeMatureSoftSeals(input) {
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
    claimDreamJobs(input) {
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
        const params = [input.maxAttempts];
        if (input.projectId) {
            where.push('j.project_id = ?');
            params.push(input.projectId);
        }
        const rows = this.db.prepare(`
      SELECT j.episode_id, j.project_id, j.mode_hint, j.attempts, j.created_at
      FROM episode_dream_jobs j
      JOIN memory_episodes e ON e.episode_id = j.episode_id
      WHERE ${where.join(' AND ')}
        AND e.event_count > 0
        AND e.status = 'sealed'
        AND EXISTS (SELECT 1 FROM memory_episode_events ee WHERE ee.episode_id = j.episode_id)
      ORDER BY j.priority DESC, j.created_at LIMIT ?
    `).all(...params, Math.max(1, Math.min(Math.trunc(input.limit), 100)));
        const claimed = [];
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
                    leaseUntil: input.now + input.leaseMs, attemptGeneration: row.attempts + 1,
                });
            }
        }
        return claimed;
    }
    skipEmptyDreamJobs(input) {
        const now = input.now ?? Date.now();
        const params = [];
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
    `).all(...params);
        const episodeIds = rows.map((row) => row.episode_id);
        if (!episodeIds.length)
            return 0;
        this.markEmptyEpisodeDreamSkippedMany(episodeIds, now, 'episode_empty_skipped_no_raw_evidence');
        return episodeIds.length;
    }
    completeDreamJob(episodeId, leaseId, candidateIds, now, commitCandidates) {
        this.transaction(() => {
            commitCandidates?.();
            const result = this.db.prepare(`
        UPDATE episode_dream_jobs SET state = 'processed', candidate_ids_json = ?, lease_id = NULL,
          lease_until = NULL, retry_after = NULL, failure_category = NULL, last_error = NULL, updated_at = ?
        WHERE episode_id = ? AND state = 'processing' AND lease_id = ?
          AND lease_until IS NOT NULL AND lease_until >= ?
      `).run(JSON.stringify(candidateIds), now, episodeId, leaseId, now);
            if (!result.changes)
                throw new Error(`episode_dream_lease_lost:${episodeId}`);
            const episode = this.db.prepare(`
        UPDATE memory_episodes SET dream_status = 'processed', last_dreamed_at = ?,
          dream_candidate_count = ?, dream_error = NULL WHERE episode_id = ? AND status = 'sealed'
      `).run(now, candidateIds.length, episodeId);
            if (!episode.changes)
                throw new Error(`episode_dream_episode_not_sealed:${episodeId}`);
        });
    }
    failDreamJob(episodeId, leaseId, error, input) {
        this.transaction(() => {
            const state = input.terminal ? 'failed_terminal' : 'failed_retryable';
            const result = this.db.prepare(`
        UPDATE episode_dream_jobs SET state = ?, last_error = ?, failure_category = ?, retry_after = ?,
          lease_id = NULL, lease_until = NULL, updated_at = ?
        WHERE episode_id = ? AND state = 'processing' AND lease_id = ?
      `).run(state, error.slice(0, 2000), input.failureCategory, input.retryAfter ?? null, input.now, episodeId, leaseId);
            if (!result.changes)
                return;
            this.db.prepare(`UPDATE memory_episodes SET dream_status = 'failed', dream_error = ? WHERE episode_id = ?`)
                .run(error.slice(0, 2000), episodeId);
        });
    }
    retryFailed(projectId) {
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
    markEmptyEpisodeDreamSkipped(episodeId, now, reason) {
        this.markEmptyEpisodeDreamSkippedMany([episodeId], now, reason);
    }
    markEmptyEpisodeDreamSkippedMany(episodeIds, now, reason) {
        if (!episodeIds.length)
            return;
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
      UPDATE memory_episodes SET dream_status = 'skipped', dream_error = ?, last_dream_run_id = NULL,
          dream_candidate_count = 0, updated_at = ?
        WHERE episode_id IN (${placeholders})
      `).run(reason, now, ...episodeIds);
        })();
    }
    getDreamStatus(projectId) {
        const rows = (projectId
            ? this.db.prepare(`SELECT state, COUNT(*) AS count FROM episode_dream_jobs WHERE project_id = ? GROUP BY state`).all(projectId)
            : this.db.prepare(`SELECT state, COUNT(*) AS count FROM episode_dream_jobs GROUP BY state`).all());
        const status = {
            projectId, pending: 0, processing: 0, processed: 0, failed: 0,
            failedRetryable: 0, failedTerminal: 0, retryScheduled: 0, skipped: 0,
        };
        for (const row of rows) {
            if (row.state === 'failed_retryable')
                status.failedRetryable = row.count;
            else if (row.state === 'failed_terminal')
                status.failedTerminal = row.count;
            else if (row.state === 'retry_scheduled')
                status.retryScheduled = row.count;
            else if (row.state === 'pending')
                status.pending = row.count;
            else if (row.state === 'processing')
                status.processing = row.count;
            else if (row.state === 'processed')
                status.processed = row.count;
            else if (row.state === 'skipped')
                status.skipped = row.count;
        }
        status.failed = status.failedRetryable + status.failedTerminal;
        return status;
    }
    getDreamJobState(episodeId) {
        const row = this.db.prepare(`SELECT state FROM episode_dream_jobs WHERE episode_id = ?`).get(episodeId);
        return row?.state;
    }
    countUnassignedRawEvents(projectId) {
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
        return Number(row?.count || 0);
    }
    markEventDisposition(input) {
        this.db.prepare(`
      INSERT INTO episode_event_dispositions (event_id, project_id, disposition, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET disposition = excluded.disposition, reason = excluded.reason
    `).run(input.eventId, input.projectId, input.disposition, input.reason, input.now ?? Date.now());
    }
    hasEventDisposition(eventId) {
        return Boolean(this.db.prepare(`SELECT 1 FROM episode_event_dispositions WHERE event_id = ?`).get(eventId));
    }
    recordDreamRun(input) {
        this.db.prepare(`
      INSERT INTO episode_dream_runs (
        run_id, project_id, requested_mode, selected_mode, reason, episode_ids_json,
        candidate_ids_json, status, duration_ms, error, created_at, failed_episode_ids_json, failure_details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.runId, input.projectId || null, input.requestedMode, input.selectedMode, input.reason, JSON.stringify(input.episodeIds), JSON.stringify(input.candidateIds), input.status, input.durationMs, input.error || null, input.createdAt, JSON.stringify((input.failedEpisodes || []).map((item) => item.episodeId)), JSON.stringify(input.failedEpisodes || []));
    }
    getIngestedEvent(projectId, sourceAgent, sourceSessionId, externalMessageId) {
        const row = this.db.prepare(`
      SELECT event_id FROM episode_ingest_keys
      WHERE project_id = ? AND source_agent = ? AND source_session_id = ? AND external_message_id = ?
    `).get(projectId, sourceAgent, sourceSessionId, externalMessageId);
        return row?.event_id;
    }
    recordIngestKey(input) {
        const now = input.now ?? Date.now();
        this.db.prepare(`
      INSERT OR IGNORE INTO episode_ingest_keys (
        ingest_key, project_id, source_agent, source_session_id, external_message_id, event_id, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?)
    `).run(`${input.projectId}\u0000${input.sourceAgent}\u0000${input.sourceSessionId}\u0000${input.externalMessageId}`, input.projectId, input.sourceAgent, input.sourceSessionId, input.externalMessageId, input.eventId, now, now);
    }
    markIngestState(input) {
        this.db.prepare(`
      UPDATE episode_ingest_keys SET state = ?, last_error = ?, updated_at = ?
      WHERE project_id = ? AND source_agent = ? AND source_session_id = ? AND external_message_id = ?
    `).run(input.state, input.error?.slice(0, 2000) || null, input.now ?? Date.now(), input.projectId, input.sourceAgent, input.sourceSessionId, input.externalMessageId);
    }
    getIngestState(projectId, sourceAgent, sourceSessionId, externalMessageId) {
        const row = this.db.prepare(`
      SELECT event_id, state, last_error, updated_at FROM episode_ingest_keys
      WHERE project_id = ? AND source_agent = ? AND source_session_id = ? AND external_message_id = ?
    `).get(projectId, sourceAgent, sourceSessionId, externalMessageId);
        return row ? { eventId: row.event_id, state: row.state, error: row.last_error || undefined, updatedAt: row.updated_at ?? undefined } : undefined;
    }
    deleteByProject(projectId) {
        let count = 0;
        const run = (sql) => { count += Number(this.db.prepare(sql).run(projectId).changes || 0); };
        run(`DELETE FROM episode_dream_runs WHERE project_id = ?`);
        run(`DELETE FROM episode_dream_jobs WHERE project_id = ?`);
        run(`DELETE FROM episode_boundary_decisions WHERE project_id = ?`);
        run(`DELETE FROM episode_cross_refs WHERE project_id = ?`);
        run(`DELETE FROM episode_repair_audit WHERE project_id = ?`);
        run(`DELETE FROM episode_closure_receipts WHERE project_id = ?`);
        run(`DELETE FROM episode_ingest_keys WHERE project_id = ?`);
        run(`DELETE FROM episode_event_dispositions WHERE project_id = ?`);
        const episodeIds = this.db.prepare(`SELECT episode_id FROM memory_episodes WHERE project_id = ?`).all(projectId).map((row) => row.episode_id);
        if (episodeIds.length) {
            const placeholders = episodeIds.map(() => '?').join(', ');
            count += Number(this.db.prepare(`DELETE FROM memory_episode_events WHERE episode_id IN (${placeholders})`).run(...episodeIds).changes || 0);
        }
        run(`DELETE FROM memory_episodes WHERE project_id = ?`);
        return count;
    }
    enqueueDreamJob(episode, modeHint, now) {
        const priority = Math.round(episode.importance * 100) + (['correction', 'decision', 'prospective'].includes(episode.episodeType) ? 30 : 0);
        this.db.prepare(`
      INSERT INTO episode_dream_jobs (episode_id, project_id, state, priority, mode_hint, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?, ?, ?)
      ON CONFLICT(episode_id) DO UPDATE SET
        state = 'pending', mode_hint = excluded.mode_hint, retry_after = NULL, lease_id = NULL, lease_until = NULL,
        failure_category = NULL, last_error = NULL, updated_at = excluded.updated_at
      WHERE episode_dream_jobs.state IN ('pending', 'failed_retryable', 'retry_scheduled')
    `).run(episode.episodeId, episode.projectId, priority, modeHint, now, now);
        const job = this.db.prepare(`SELECT state FROM episode_dream_jobs WHERE episode_id = ?`).get(episode.episodeId);
        if (job?.state === 'pending') {
            this.db.prepare(`UPDATE memory_episodes SET dream_status = 'queued', dream_error = NULL WHERE episode_id = ?`)
                .run(episode.episodeId);
        }
    }
    initializeSchema() {
        this.transaction(() => this.initializeSchemaUnsafe());
    }
    initializeSchemaUnsafe() {
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
        PRIMARY KEY (episode_id, event_id),
        UNIQUE(episode_id, position),
        FOREIGN KEY (episode_id) REFERENCES memory_episodes(episode_id) ON DELETE CASCADE
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
      CREATE TABLE IF NOT EXISTS episode_boundary_decisions (
        decision_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT NOT NULL,
        source_agent TEXT, thread_id TEXT, primary_event_id TEXT NOT NULL,
        previous_episode_id TEXT, resulting_episode_id TEXT, policy_version TEXT NOT NULL,
        mode TEXT NOT NULL, guard_action TEXT NOT NULL, guard_codes_json TEXT NOT NULL,
        metrics_json TEXT NOT NULL, cpu_decision_json TEXT NOT NULL, reviewer_invoked INTEGER NOT NULL,
        reviewer_decision_json TEXT, final_decision_json TEXT NOT NULL, warnings_json TEXT NOT NULL,
        created_at INTEGER NOT NULL, UNIQUE(project_id, primary_event_id, policy_version)
      );
    `);
        this.ensureEpisodeCompatibilityColumns();
        sealDuplicateOpenEpisodes(this.db);
        this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_episodes_one_active_scope
        ON memory_episodes(project_id, session_id, COALESCE(source_agent, ''), COALESCE(conversation_thread_id, ''))
        WHERE status = 'open';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_episode_events_episode_position_unique
        ON memory_episode_events(episode_id, position);
    `);
    }
    ensureEpisodeCompatibilityColumns() {
        const addColumns = (table, definitions) => {
            const exists = this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
            if (!exists)
                return;
            const columns = new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
            for (const [name, definition] of Object.entries(definitions)) {
                if (!columns.has(name))
                    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
            }
        };
        addColumns('memory_episodes', {
            conversation_thread_id: 'TEXT', semantic_summary_json: 'TEXT', episode_tags_json: "TEXT NOT NULL DEFAULT '[]'",
            candidate_types_json: "TEXT NOT NULL DEFAULT '[]'", importance_signals_json: "TEXT NOT NULL DEFAULT '[]'",
            importance_reason: 'TEXT', linked_episode_id: 'TEXT', dream_status: "TEXT NOT NULL DEFAULT 'none'",
            last_dream_run_id: 'TEXT', last_dreamed_at: 'INTEGER', dream_candidate_count: "INTEGER NOT NULL DEFAULT 0", dream_error: 'TEXT',
        });
        addColumns('episode_closure_receipts', {
            closure_reason_code: "TEXT NOT NULL DEFAULT 'manual'", closure_reason_detail: 'TEXT', requires_review: 'INTEGER NOT NULL DEFAULT 0',
            ignored_nearby_event_ids_json: "TEXT NOT NULL DEFAULT '[]'", unassigned_nearby_event_ids_json: "TEXT NOT NULL DEFAULT '[]'",
        });
        addColumns('episode_dream_jobs', {
            retry_after: 'INTEGER', failure_category: 'TEXT', candidate_ids_json: "TEXT NOT NULL DEFAULT '[]'",
        });
        addColumns('episode_dream_runs', {
            failed_episode_ids_json: "TEXT NOT NULL DEFAULT '[]'", failure_details_json: "TEXT NOT NULL DEFAULT '[]'",
        });
        addColumns('episode_ingest_keys', {
            state: "TEXT NOT NULL DEFAULT 'committed'", updated_at: 'INTEGER', last_error: 'TEXT',
        });
        const episodeLinks = this.db.prepare(`
      SELECT rowid, episode_id, event_id FROM memory_episode_events ORDER BY episode_id, position, event_id
    `).all();
        const movePosition = this.db.prepare(`UPDATE memory_episode_events SET position = ? WHERE rowid = ?`);
        const nextPositions = new Map();
        for (const link of episodeLinks) {
            movePosition.run(-1_000_000_000 - link.rowid, link.rowid);
            const next = (nextPositions.get(link.episode_id) || 0) + 1;
            nextPositions.set(link.episode_id, next);
            movePosition.run(next, link.rowid);
        }
        const eventColumns = Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_events'`).get())
            ? new Set(this.db.prepare(`PRAGMA table_info(memory_events)`).all().map((row) => row.name))
            : new Set();
        const hasGlobalSeq = eventColumns.has('global_seq');
        const rebuild = hasGlobalSeq ? this.db.prepare(`
      UPDATE memory_episodes SET event_count = (SELECT COUNT(*) FROM memory_episode_events WHERE episode_id = ?),
        start_event_id = COALESCE((SELECT event_id FROM memory_episode_events WHERE episode_id = ? ORDER BY position, event_id LIMIT 1), start_event_id),
        end_event_id = COALESCE((SELECT event_id FROM memory_episode_events WHERE episode_id = ? ORDER BY position DESC, event_id DESC LIMIT 1), end_event_id),
        start_seq = COALESCE((SELECT e.global_seq FROM memory_episode_events ee JOIN memory_events e ON e.event_id = ee.event_id WHERE ee.episode_id = ? ORDER BY ee.position LIMIT 1), start_seq),
        end_seq = COALESCE((SELECT e.global_seq FROM memory_episode_events ee JOIN memory_events e ON e.event_id = ee.event_id WHERE ee.episode_id = ? ORDER BY ee.position DESC LIMIT 1), end_seq)
      WHERE episode_id = ?
    `) : undefined;
        const episodeRows = this.db.prepare(`SELECT episode_id FROM memory_episodes`).all();
        for (const row of episodeRows) {
            if (rebuild)
                rebuild.run(row.episode_id, row.episode_id, row.episode_id, row.episode_id, row.episode_id, row.episode_id);
            else
                this.db.prepare(`UPDATE memory_episodes SET event_count = (SELECT COUNT(*) FROM memory_episode_events WHERE episode_id = ?) WHERE episode_id = ?`).run(row.episode_id, row.episode_id);
        }
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_episode_events_episode ON memory_episode_events(episode_id, position);`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_episode_dream_retry ON episode_dream_jobs(state, retry_after, priority DESC, created_at);`);
    }
}
function mapEpisode(row) {
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
function mapEventLink(row) {
    return { episodeId: row.episode_id, eventId: row.event_id, position: row.position, relation: row.relation, confidence: row.confidence, createdAt: row.created_at };
}
function mapClosure(row) {
    return {
        receiptId: row.receipt_id, episodeId: row.episode_id, projectId: row.project_id,
        closureMode: row.closure_mode, closureReason: row.closure_reason,
        closureReasonCode: row.closure_reason_code || normalizeClosureReasonCode(row.closure_reason, row.closure_mode),
        closureReasonDetail: row.closure_reason_detail || undefined,
        sourceEventIds: JSON.parse(row.source_event_ids_json), startSeq: row.start_seq ?? undefined,
        endSeq: row.end_seq ?? undefined, topicPath: row.topic_path || undefined, episodeType: row.episode_type,
        importance: row.importance, dreamRecommended: row.dream_recommended === 1, dreamMode: row.dream_mode,
        requiresReview: row.requires_review === 1,
        ignoredNearbyEventIds: parseJson(row.ignored_nearby_event_ids_json, []),
        unassignedNearbyEventIds: parseJson(row.unassigned_nearby_event_ids_json, []),
        createdAt: row.created_at,
    };
}
function mapBoundaryDecision(row) {
    return {
        decisionId: row.decision_id,
        projectId: row.project_id,
        sessionId: row.session_id,
        sourceAgent: row.source_agent || undefined,
        threadId: row.thread_id || undefined,
        primaryEventId: row.primary_event_id,
        previousEpisodeId: row.previous_episode_id || undefined,
        resultingEpisodeId: row.resulting_episode_id || undefined,
        policyVersion: row.policy_version,
        mode: row.mode,
        guardAction: row.guard_action,
        guardCodes: parseJson(row.guard_codes_json, []),
        metrics: parseJson(row.metrics_json, { activeEventCount: 0, trustedLocalDates: [] }),
        cpuDecision: parseJson(row.cpu_decision_json, {}),
        reviewerInvoked: row.reviewer_invoked === 1,
        reviewerDecision: parseJson(row.reviewer_decision_json, undefined),
        finalDecision: parseJson(row.final_decision_json, {}),
        warnings: parseJson(row.warnings_json, []),
        createdAt: row.created_at,
    };
}
function normalizeClosureReasonCode(reason, mode) {
    if (/event_limit|max_events/u.test(reason))
        return 'event_limit';
    if (/duration_limit|max_duration/u.test(reason))
        return 'duration_limit';
    if (/idle_gap|max_idle/u.test(reason))
        return 'idle_gap';
    if (/local_date|trusted_local_date/u.test(reason))
        return 'local_date_boundary';
    if (reason.includes('topic_switch'))
        return 'topic_switch';
    if (reason.includes('batch'))
        return 'batch_boundary';
    if (reason.includes('idle'))
        return 'idle_timeout';
    if (reason.includes('soft_seal_stabilized'))
        return 'soft_seal_stabilized';
    if (reason.includes('repair'))
        return 'repair';
    if (reason.includes('explicit_user_closure'))
        return 'explicit_user_closure';
    return mode === 'manual' ? 'manual' : 'manual';
}
function formatAuditCursor(updatedAt, episodeId) {
    return `${updatedAt}:${episodeId}`;
}
function parseAuditCursor(cursor) {
    if (!cursor)
        return undefined;
    const separator = cursor.indexOf(':');
    if (separator <= 0)
        return undefined;
    const updatedAt = Number(cursor.slice(0, separator));
    const episodeId = cursor.slice(separator + 1);
    return Number.isFinite(updatedAt) && episodeId ? { updatedAt, episodeId } : undefined;
}
function parseJson(value, fallback) {
    if (!value)
        return fallback;
    try {
        return JSON.parse(value);
    }
    catch {
        return fallback;
    }
}
function canonicalRepairOrder(left, right, leftLink, rightLink) {
    const numeric = (value) => typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
    const keys = [
        [numeric(left?.turnSeq), numeric(right?.turnSeq)],
        [numeric(left?.eventOrdinal), numeric(right?.eventOrdinal)],
        [numeric(left?.globalSeq), numeric(right?.globalSeq)],
        [numeric(left?.occurredAt), numeric(right?.occurredAt)],
        [leftLink.position, rightLink.position],
    ];
    for (const [a, b] of keys)
        if (a !== b)
            return a - b;
    return leftLink.eventId.localeCompare(rightLink.eventId);
}
function safeDecision(decision) {
    return {
        relation: decision.relation,
        confidence: decision.confidence,
        signals: decision.signals?.slice(0, 20),
        needsLlmReview: decision.needsLlmReview,
        candidateTypes: decision.candidateTypes?.slice(0, 20),
        topicPath: decision.topicPath,
        closureCandidate: decision.closureCandidate,
        switchKind: decision.switchKind,
        episodeType: decision.episodeType,
        importance: decision.importance,
        importanceSignals: decision.importanceSignals?.slice(0, 20),
        rationale: decision.rationale?.slice(0, 240),
    };
}
function sameBoundaryDecision(existing, input) {
    return JSON.stringify({
        projectId: existing.projectId,
        sessionId: existing.sessionId,
        sourceAgent: existing.sourceAgent,
        threadId: existing.threadId,
        primaryEventId: existing.primaryEventId,
        previousEpisodeId: existing.previousEpisodeId,
        resultingEpisodeId: existing.resultingEpisodeId,
        policyVersion: existing.policyVersion,
        mode: existing.mode,
        guardAction: existing.guardAction,
        guardCodes: existing.guardCodes,
        metrics: existing.metrics,
        cpuDecision: safeDecision(existing.cpuDecision),
        reviewerInvoked: existing.reviewerInvoked,
        reviewerDecision: existing.reviewerDecision ? safeDecision(existing.reviewerDecision) : undefined,
        finalDecision: safeDecision(existing.finalDecision),
        warnings: existing.warnings,
    }) === JSON.stringify({
        projectId: input.projectId,
        sessionId: input.sessionId,
        sourceAgent: input.sourceAgent,
        threadId: input.threadId,
        primaryEventId: input.primaryEventId,
        previousEpisodeId: input.previousEpisodeId,
        resultingEpisodeId: input.resultingEpisodeId,
        policyVersion: input.policyVersion,
        mode: input.mode,
        guardAction: input.guardAction,
        guardCodes: input.guardCodes,
        metrics: input.metrics,
        cpuDecision: safeDecision(input.cpuDecision),
        reviewerInvoked: input.reviewerInvoked,
        reviewerDecision: input.reviewerDecision ? safeDecision(input.reviewerDecision) : undefined,
        finalDecision: safeDecision(input.finalDecision),
        warnings: input.warnings,
    });
}
function retryDelayMs(attempts) {
    return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}
