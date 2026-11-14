/**
 * Session recall: the ledger, paged, verbatim (#191 primitive 2).
 *
 * This is recall in the session domain, not a second search engine. The scope is the agent's own
 * captured session; the answer is the ledger row's own text. A page is ordered newest first, so
 * "what did we just say" is the first page and the cursor walks backwards in time.
 *
 * Three modes, one shape:
 *
 * - `time` — no query; the cursor is the only filter.
 * - `keyword` — a case-insensitive substring match over the row's text. Substring, not FTS, because
 *   the acceptance is a literal word (including CJK) and FTS tokenisation is not the same question.
 * - `topic` — the session's episodes are the topic index; a turn belongs to the topic when its
 *   episode's `topic_path` contains the query.
 */
import type Database from 'bun:sqlite';

import type { ConversationSpeaker } from '../conversation/index.js';
import type { MemoryEventRole } from '../types/index.js';
import { requireSessionText, sessionError } from './SessionErrors.js';

/** The retrieval modes, frozen by `docs/session-context.md`. */
export const SESSION_RECALL_MODES = ['time', 'topic', 'keyword'] as const;
export type SessionRecallMode = (typeof SESSION_RECALL_MODES)[number];

export const SESSION_RECALL_DEFAULT_LIMIT = 20;
export const SESSION_RECALL_MAX_LIMIT = 200;

export interface SessionRecallInput {
  projectId: string;
  agentId: string;
  sessionId: string;
  mode: SessionRecallMode;
  /** Required for `keyword` and `topic`; ignored by `time`. */
  query?: string;
  /** The `nextCursor` of the previous page. Absent for the first page. */
  cursor?: string;
  limit?: number;
}

export interface SessionRecallItem {
  eventId: string;
  speaker: ConversationSpeaker;
  role: MemoryEventRole;
  occurredAt: number;
  /** The ledger's exact text. */
  text: string;
  sourceRefs: string[];
}

export interface SessionRecallPage {
  sessionId: string;
  mode: SessionRecallMode;
  items: SessionRecallItem[];
  /** The cursor for the next (older) page; null when this page is the last. */
  nextCursor: string | null;
  hasMore: boolean;
}

interface RecallRow {
  event_id: string;
  role: string | null;
  occurred_at: number;
  global_seq: number | null;
  text: string | null;
  payload_json: string;
}

interface Cursor {
  occurredAt: number;
  globalSeq: number;
}

const RECALL_LANE_SQL = `
  event_type = 'RAW_EVENT_RECORDED'
  AND COALESCE(project_id, '') = ?
  AND COALESCE(session_id, '') = ?
  AND COALESCE(source_id, '') = ?
  AND json_valid(payload_json)
  AND json_extract(payload_json, '$.metadata.captureLane') = 'conversation'
`;

export function recallSession(db: Database, input: SessionRecallInput): SessionRecallPage {
  const projectId = requireSessionText(input.projectId, 'project_id_required');
  const agentId = requireSessionText(input.agentId, 'agent_id_required');
  const sessionId = requireSessionText(input.sessionId, 'session_id_required');
  if (!(SESSION_RECALL_MODES as readonly unknown[]).includes(input.mode)) {
    throw sessionError('invalid_recall_mode', `expected one of ${SESSION_RECALL_MODES.join(', ')}`);
  }
  const limit = input.limit ?? SESSION_RECALL_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) throw sessionError('invalid_limit');
  const bounded = Math.min(limit, SESSION_RECALL_MAX_LIMIT);
  const query = input.query?.trim() ?? '';
  if (input.mode !== 'time' && !query) throw sessionError('recall_query_required');
  const cursor = input.cursor === undefined ? undefined : parseCursor(input.cursor);

  const conditions = [RECALL_LANE_SQL];
  const params: Array<string | number> = [projectId, sessionId, `${agentId}:${sessionId}`];
  if (input.mode === 'keyword') {
    conditions.push(`instr(lower(json_extract(payload_json, '$.text')), lower(?)) > 0`);
    params.push(query);
  }
  if (input.mode === 'topic') {
    conditions.push(`event_id IN (
      SELECT ee.event_id
      FROM memory_episode_events ee
      JOIN memory_episodes ep ON ep.episode_id = ee.episode_id
      WHERE COALESCE(ep.project_id, '') = ?
        AND ep.session_id = ?
        AND instr(lower(COALESCE(ep.topic_path, '')), lower(?)) > 0
    )`);
    params.push(projectId, sessionId, query);
  }
  if (cursor) {
    conditions.push(`(occurred_at < ? OR (occurred_at = ? AND COALESCE(global_seq, 0) < ?))`);
    params.push(cursor.occurredAt, cursor.occurredAt, cursor.globalSeq);
  }

  const rows = db
    .query(`
      SELECT event_id, role, occurred_at, global_seq, json_extract(payload_json, '$.text') AS text, payload_json
      FROM memory_events
      WHERE ${conditions.join(' AND ')}
      ORDER BY occurred_at DESC, COALESCE(global_seq, 0) DESC, event_id DESC
      LIMIT ?
    `)
    .all(...params, bounded + 1) as RecallRow[];

  const hasMore = rows.length > bounded;
  const page = hasMore ? rows.slice(0, bounded) : rows;
  const items = page.map(mapRecall);
  const last = page[page.length - 1];
  return {
    sessionId,
    mode: input.mode,
    items,
    nextCursor: hasMore && last ? `${Number(last.occurred_at ?? 0)}:${Number(last.global_seq ?? 0)}` : null,
    hasMore,
  };
}

function mapRecall(row: RecallRow): SessionRecallItem {
  const payload = JSON.parse(row.payload_json) as { metadata?: Record<string, unknown> };
  const metadata = payload.metadata ?? {};
  return {
    eventId: row.event_id,
    speaker: metadata.speaker as ConversationSpeaker,
    role: (row.role ?? 'user') as MemoryEventRole,
    occurredAt: Number(row.occurred_at ?? 0),
    text: row.text ?? '',
    sourceRefs: [row.event_id],
  };
}

function parseCursor(value: string): Cursor {
  const match = /^(\d+):(\d+)$/u.exec(value.trim());
  if (!match) throw sessionError('invalid_cursor');
  const occurredAt = Number(match[1]);
  const globalSeq = Number(match[2]);
  if (!Number.isSafeInteger(occurredAt) || !Number.isSafeInteger(globalSeq)) throw sessionError('invalid_cursor');
  return { occurredAt, globalSeq };
}
