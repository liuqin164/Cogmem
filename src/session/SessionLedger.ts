/**
 * The session's ledger rows, read.
 *
 * A session is not a second store: it is the conversation lane of `memory_events`, scoped by
 * project, session and the agent that captured it. Every read here is verbatim — the row's own
 * `payload.text`, after exclusion and redaction, never a re-rendering of it.
 *
 * The write side is `ConversationCaptureService` (#157); this module only reads.
 */
import type Database from 'bun:sqlite';

import type { ConversationSpeaker } from '../conversation/index.js';
import type { MemoryEventRole } from '../types/index.js';

/** The most turns one assembly reads. Beyond it the digest says it is truncated rather than lying. */
export const SESSION_LEDGER_MAX_TURNS = 5000;

export interface SessionTurn {
  eventId: string;
  projectId: string;
  sessionId: string;
  threadId: string;
  agentId: string;
  speaker: ConversationSpeaker;
  role: MemoryEventRole;
  channel: string;
  /** The ledger's own text: never trimmed, never paraphrased. */
  text: string;
  occurredAt: number;
  globalSeq: number;
}

export interface SessionTurnRead {
  turns: SessionTurn[];
  /** True when the read hit `SESSION_LEDGER_MAX_TURNS`; older turns exist and are not in `turns`. */
  truncated: boolean;
}

export interface SessionTurnReadInput {
  projectId: string;
  agentId: string;
  sessionId: string;
  limit?: number;
}

interface TurnRow {
  event_id: string;
  project_id: string | null;
  session_id: string | null;
  thread_id: string | null;
  role: string | null;
  occurred_at: number;
  global_seq: number | null;
  text: string | null;
  payload_json: string;
}

const TURN_COLUMNS = `
  event_id, project_id, session_id, thread_id, role, occurred_at, global_seq,
  json_extract(payload_json, '$.text') AS text, payload_json
`;

/**
 * The lane predicate: a captured conversation turn, scoped to the agent's own session.
 *
 * `source_id` is the capture face's `${agentId}:${sessionId}`. Requiring it is what keeps a second
 * agent's turns in the same session id out of this session's view, and keeps tool rows (which never
 * carry the lane marker) out of the digest.
 */
const LANE_SQL = `
  event_type = 'RAW_EVENT_RECORDED'
  AND COALESCE(project_id, '') = ?
  AND COALESCE(session_id, '') = ?
  AND COALESCE(source_id, '') = ?
  AND json_valid(payload_json)
  AND json_extract(payload_json, '$.metadata.captureLane') = 'conversation'
`;

export function readSessionTurns(db: Database, input: SessionTurnReadInput): SessionTurnRead {
  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? SESSION_LEDGER_MAX_TURNS), SESSION_LEDGER_MAX_TURNS));
  const rows = db
    .query(`
      SELECT * FROM (
        SELECT ${TURN_COLUMNS}
        FROM memory_events
        WHERE ${LANE_SQL}
        ORDER BY occurred_at DESC, COALESCE(global_seq, 0) DESC, event_id DESC
        LIMIT ?
      )
      ORDER BY occurred_at ASC, COALESCE(global_seq, 0) ASC, event_id ASC
    `)
    .all(input.projectId, input.sessionId, `${input.agentId}:${input.sessionId}`, limit + 1) as TurnRow[];
  const truncated = rows.length > limit;
  // The newest window is the one the tail must come from; the extra row is the oldest of the
  // fetched window, so drop that one rather than the newest.
  return { turns: (truncated ? rows.slice(rows.length - limit) : rows).map(mapTurn), truncated };
}

function mapTurn(row: TurnRow): SessionTurn {
  const payload = JSON.parse(row.payload_json) as { metadata?: Record<string, unknown> };
  const metadata = payload.metadata ?? {};
  return {
    eventId: row.event_id,
    projectId: row.project_id ?? '',
    sessionId: row.session_id ?? '',
    threadId: row.thread_id ?? '',
    agentId: typeof metadata.sourceAgent === 'string' ? metadata.sourceAgent : '',
    speaker: metadata.speaker as ConversationSpeaker,
    role: (row.role ?? 'user') as MemoryEventRole,
    channel: typeof metadata.channel === 'string' ? metadata.channel : '',
    text: row.text ?? '',
    occurredAt: Number(row.occurred_at ?? 0),
    globalSeq: Number(row.global_seq ?? 0),
  };
}
