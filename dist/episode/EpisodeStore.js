import { randomUUID } from 'node:crypto';
export class EpisodeStore {
    db;
    constructor(db) {
        this.db = db;
        this.initializeSchema();
    }
    createEpisode(input) {
        const episodeId = `episode-${randomUUID()}`;
        this.db.prepare(`
      INSERT INTO memory_episodes (
        episode_id, project_id, session_id, source_agent, topic_path, episode_type, status,
        importance, start_event_id, end_event_id, start_seq, end_seq, event_count,
        started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(episodeId, input.projectId, input.sessionId, input.sourceAgent || null, input.topicPath || null, input.episodeType, input.importance, input.eventId, input.eventId, input.globalSeq ?? null, input.globalSeq ?? null, input.occurredAt, input.occurredAt);
        return this.getEpisode(episodeId);
    }
    findActiveEpisode(projectId, sessionId) {
        const row = this.db.prepare(`
      SELECT * FROM memory_episodes
      WHERE project_id = ? AND session_id = ? AND status IN ('open', 'soft_sealed')
      ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1
    `).get(projectId, sessionId);
        return row ? mapEpisode(row) : undefined;
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
    appendEvent(input) {
        const existing = this.getEventLink(input.eventId);
        if (existing)
            return existing;
        const episode = this.getEpisode(input.episodeId);
        if (!episode || episode.status !== 'open')
            throw new Error(`episode_not_open:${input.episodeId}`);
        const position = episode.eventCount + 1;
        this.db.transaction(() => {
            this.db.prepare(`
        INSERT INTO memory_episode_events (episode_id, event_id, position, relation, confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(input.episodeId, input.eventId, position, input.relation, input.confidence, input.occurredAt);
            this.db.prepare(`
        UPDATE memory_episodes SET
          end_event_id = ?, end_seq = COALESCE(?, end_seq), event_count = ?, updated_at = ?,
          episode_type = COALESCE(?, episode_type), importance = MAX(importance, ?),
          summary = CASE WHEN ? IS NULL OR ? = '' THEN summary ELSE SUBSTR(COALESCE(summary || '\n', '') || ?, 1, 1600) END
        WHERE episode_id = ?
      `).run(input.eventId, input.globalSeq ?? null, position, input.occurredAt, input.episodeType || null, input.importance ?? episode.importance, input.summaryText || null, input.summaryText || '', input.summaryText || '', input.episodeId);
        })();
        return { episodeId: input.episodeId, eventId: input.eventId, position, relation: input.relation, confidence: input.confidence, createdAt: input.occurredAt };
    }
    getEventLink(eventId) {
        const row = this.db.prepare(`SELECT * FROM memory_episode_events WHERE event_id = ?`).get(eventId);
        return row ? mapEventLink(row) : undefined;
    }
    listEventLinks(episodeId) {
        return this.db.prepare(`
      SELECT * FROM memory_episode_events WHERE episode_id = ? ORDER BY position
    `).all(episodeId).map(mapEventLink);
    }
    reopenSoftEpisode(episodeId, now) {
        const result = this.db.prepare(`
      UPDATE memory_episodes SET status = 'open', sealed_at = NULL, updated_at = ?
      WHERE episode_id = ? AND status = 'soft_sealed'
    `).run(now, episodeId);
        if (!result.changes)
            throw new Error(`episode_not_soft_sealed:${episodeId}`);
        this.db.prepare(`DELETE FROM episode_dream_jobs WHERE episode_id = ? AND state IN ('pending', 'failed')`).run(episodeId);
        return this.getEpisode(episodeId);
    }
    sealEpisode(episodeId, input) {
        const now = input.now ?? Date.now();
        const episode = this.getEpisode(episodeId);
        if (!episode)
            throw new Error(`episode_not_found:${episodeId}`);
        const status = input.mode === 'soft' ? 'soft_sealed' : 'sealed';
        if (episode.status === status) {
            const existing = this.listClosureReceipts({ episodeId, limit: 1 })[0];
            if (existing)
                return existing;
        }
        const links = this.listEventLinks(episodeId);
        const dreamMode = episode.importance >= 0.8 || ['decision', 'correction', 'preference', 'goal', 'prospective'].includes(episode.episodeType)
            ? 'micro' : 'normal';
        const receipt = {
            receiptId: `episode-closure-${randomUUID()}`,
            episodeId,
            projectId: episode.projectId,
            closureMode: input.mode,
            closureReason: input.reason,
            sourceEventIds: links.map((link) => link.eventId),
            startSeq: episode.startSeq,
            endSeq: episode.endSeq,
            topicPath: episode.topicPath,
            episodeType: episode.episodeType,
            importance: episode.importance,
            dreamRecommended: links.length > 0,
            dreamMode,
            createdAt: now,
        };
        this.db.transaction(() => {
            this.db.prepare(`UPDATE memory_episodes SET status = ?, sealed_at = ?, updated_at = ? WHERE episode_id = ?`)
                .run(status, now, now, episodeId);
            this.db.prepare(`
        INSERT INTO episode_closure_receipts (
          receipt_id, episode_id, project_id, closure_mode, closure_reason, source_event_ids_json,
          start_seq, end_seq, topic_path, episode_type, importance, dream_recommended, dream_mode, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(receipt.receiptId, episodeId, episode.projectId, input.mode, input.reason, JSON.stringify(receipt.sourceEventIds), receipt.startSeq ?? null, receipt.endSeq ?? null, receipt.topicPath || null, receipt.episodeType, receipt.importance, receipt.dreamRecommended ? 1 : 0, receipt.dreamMode, now);
            if (status === 'sealed' && receipt.dreamRecommended)
                this.enqueueDreamJob(episode, dreamMode, now);
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
        for (const episode of episodes)
            this.sealEpisode(episode.episodeId, { mode: 'hard', reason: 'soft_seal_stabilized', now });
        return episodes.length;
    }
    claimDreamJobs(input) {
        this.db.prepare(`
      UPDATE episode_dream_jobs SET state = 'failed', lease_id = NULL, lease_until = NULL,
        last_error = COALESCE(last_error, 'dream_lease_expired_at_attempt_limit'), updated_at = ?
      WHERE state = 'processing' AND lease_until IS NOT NULL AND lease_until < ? AND attempts >= ?
    `).run(input.now, input.now, input.maxAttempts);
        this.db.prepare(`
      UPDATE episode_dream_jobs SET state = 'pending', lease_id = NULL, lease_until = NULL, updated_at = ?
      WHERE state = 'processing' AND lease_until IS NOT NULL AND lease_until < ? AND attempts < ?
    `).run(input.now, input.now, input.maxAttempts);
        const where = [`state IN ('pending', 'failed')`, 'attempts < ?'];
        const params = [input.maxAttempts];
        if (input.projectId) {
            where.push('project_id = ?');
            params.push(input.projectId);
        }
        const rows = this.db.prepare(`
      SELECT episode_id, project_id, mode_hint, attempts FROM episode_dream_jobs
      WHERE ${where.join(' AND ')} ORDER BY priority DESC, created_at LIMIT ?
    `).all(...params, Math.max(1, Math.min(Math.trunc(input.limit), 100)));
        const claimed = [];
        for (const row of rows) {
            const leaseId = `dream-lease-${randomUUID()}`;
            const result = this.db.prepare(`
        UPDATE episode_dream_jobs SET state = 'processing', lease_id = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
        WHERE episode_id = ? AND state IN ('pending', 'failed')
      `).run(leaseId, input.now + input.leaseMs, input.now, row.episode_id);
            if (result.changes)
                claimed.push({ episodeId: row.episode_id, projectId: row.project_id, leaseId, modeHint: row.mode_hint, attempts: row.attempts + 1 });
        }
        return claimed;
    }
    completeDreamJob(episodeId, leaseId, candidateIds, now) {
        const result = this.db.prepare(`
      UPDATE episode_dream_jobs SET state = 'processed', candidate_ids_json = ?, lease_id = NULL,
        lease_until = NULL, last_error = NULL, updated_at = ?
      WHERE episode_id = ? AND state = 'processing' AND lease_id = ?
    `).run(JSON.stringify(candidateIds), now, episodeId, leaseId);
        if (!result.changes)
            throw new Error(`episode_dream_lease_lost:${episodeId}`);
    }
    failDreamJob(episodeId, leaseId, error, now) {
        this.db.prepare(`
      UPDATE episode_dream_jobs SET state = 'failed', last_error = ?, lease_id = NULL, lease_until = NULL, updated_at = ?
      WHERE episode_id = ? AND state = 'processing' AND lease_id = ?
    `).run(error.slice(0, 2000), now, episodeId, leaseId);
    }
    retryFailed(projectId) {
        const result = projectId
            ? this.db.prepare(`UPDATE episode_dream_jobs SET state = 'pending', attempts = 0, lease_id = NULL, lease_until = NULL, last_error = NULL, updated_at = ? WHERE project_id = ? AND state = 'failed'`).run(Date.now(), projectId)
            : this.db.prepare(`UPDATE episode_dream_jobs SET state = 'pending', attempts = 0, lease_id = NULL, lease_until = NULL, last_error = NULL, updated_at = ? WHERE state = 'failed'`).run(Date.now());
        return Number(result.changes || 0);
    }
    getDreamStatus(projectId) {
        const rows = (projectId
            ? this.db.prepare(`SELECT state, COUNT(*) AS count FROM episode_dream_jobs WHERE project_id = ? GROUP BY state`).all(projectId)
            : this.db.prepare(`SELECT state, COUNT(*) AS count FROM episode_dream_jobs GROUP BY state`).all());
        const status = { projectId, pending: 0, processing: 0, processed: 0, failed: 0, skipped: 0 };
        for (const row of rows)
            status[row.state] = row.count;
        return status;
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
        candidate_ids_json, status, duration_ms, error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.runId, input.projectId || null, input.requestedMode, input.selectedMode, input.reason, JSON.stringify(input.episodeIds), JSON.stringify(input.candidateIds), input.status, input.durationMs, input.error || null, input.createdAt);
    }
    getIngestedEvent(projectId, sourceAgent, sourceSessionId, externalMessageId) {
        const row = this.db.prepare(`
      SELECT event_id FROM episode_ingest_keys
      WHERE project_id = ? AND source_agent = ? AND source_session_id = ? AND external_message_id = ?
    `).get(projectId, sourceAgent, sourceSessionId, externalMessageId);
        return row?.event_id;
    }
    recordIngestKey(input) {
        this.db.prepare(`
      INSERT OR IGNORE INTO episode_ingest_keys (
        ingest_key, project_id, source_agent, source_session_id, external_message_id, event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(`${input.projectId}\u0000${input.sourceAgent}\u0000${input.sourceSessionId}\u0000${input.externalMessageId}`, input.projectId, input.sourceAgent, input.sourceSessionId, input.externalMessageId, input.eventId, input.now ?? Date.now());
    }
    deleteByProject(projectId) {
        let count = 0;
        const run = (sql) => { count += Number(this.db.prepare(sql).run(projectId).changes || 0); };
        run(`DELETE FROM episode_dream_runs WHERE project_id = ?`);
        run(`DELETE FROM episode_dream_jobs WHERE project_id = ?`);
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
      ON CONFLICT(episode_id) DO NOTHING
    `).run(episode.episodeId, episode.projectId, priority, modeHint, now, now);
    }
    initializeSchema() {
        // Migration 22 is authoritative. This keeps direct store construction compatible in tests and embeddings.
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_episodes (
        episode_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT NOT NULL, source_agent TEXT,
        topic_path TEXT, episode_type TEXT NOT NULL, status TEXT NOT NULL, importance REAL NOT NULL,
        summary TEXT, start_event_id TEXT NOT NULL, end_event_id TEXT NOT NULL, start_seq INTEGER, end_seq INTEGER,
        event_count INTEGER NOT NULL, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, sealed_at INTEGER
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
        dream_mode TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS episode_dream_jobs (
        episode_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, state TEXT NOT NULL, priority INTEGER NOT NULL,
        mode_hint TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lease_id TEXT, lease_until INTEGER,
        last_error TEXT, candidate_ids_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS episode_dream_runs (
        run_id TEXT PRIMARY KEY, project_id TEXT, requested_mode TEXT NOT NULL, selected_mode TEXT NOT NULL,
        reason TEXT NOT NULL, episode_ids_json TEXT NOT NULL, candidate_ids_json TEXT NOT NULL, status TEXT NOT NULL,
        duration_ms INTEGER NOT NULL, error TEXT, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS episode_ingest_keys (
        ingest_key TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_agent TEXT NOT NULL,
        source_session_id TEXT NOT NULL, external_message_id TEXT NOT NULL,
        event_id TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS episode_event_dispositions (
        event_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, disposition TEXT NOT NULL,
        reason TEXT NOT NULL, created_at INTEGER NOT NULL
      );
    `);
    }
}
function mapEpisode(row) {
    return {
        episodeId: row.episode_id, projectId: row.project_id, sessionId: row.session_id,
        sourceAgent: row.source_agent || undefined, topicPath: row.topic_path || undefined,
        episodeType: row.episode_type, status: row.status, importance: row.importance, summary: row.summary || undefined,
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
        sourceEventIds: JSON.parse(row.source_event_ids_json), startSeq: row.start_seq ?? undefined,
        endSeq: row.end_seq ?? undefined, topicPath: row.topic_path || undefined, episodeType: row.episode_type,
        importance: row.importance, dreamRecommended: row.dream_recommended === 1, dreamMode: row.dream_mode, createdAt: row.created_at,
    };
}
