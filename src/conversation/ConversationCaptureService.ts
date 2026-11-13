/**
 * The conversation capture face (#157): a turn is a first-class record, not a tool transcript.
 *
 * The kernel's existing write faces are an event log — a turn is a role, some text and a session, and
 * a shell that wants to say *who* spoke, *where* and *in which thread* has to invent its own encoding.
 * This face writes that meaning down where the ledger is appended, so a third party's words are not
 * the owner's, and neither is the agent's.
 *
 * It is additive by construction: it adds a method on the host API and a `captureLane` marker on the
 * rows it writes, and touches no existing write path. `__tests__/conversation-capture.contract.test.ts`
 * holds the frozen tables below, and the same file pins the old faces against drift.
 */
import type Database from 'bun:sqlite';

import { excludeExplicitSpans } from '../context/ExplicitExclusion.js';
import type { MemoryEvent, MemoryEventRole, IngestInput } from '../types/index.js';
import type { RawMemoryEventInput } from '../factory.js';

export const CONVERSATION_CAPTURE_CONTRACT_VERSION = 1;

/** The speaker value set, frozen by `docs/conversation-capture.md`. */
export const CONVERSATION_SPEAKERS = ['owner', 'other', 'agent'] as const;
export type ConversationSpeaker = (typeof CONVERSATION_SPEAKERS)[number];

/**
 * The capture lane every row this face writes carries.
 *
 * Tool capture is `tool_call`/`tool_result` rows; conversation is `message` rows carrying this
 * marker. Both are ledger rows — the lane is a fact on the row, not a second store.
 */
export const CONVERSATION_CAPTURE_LANE = 'conversation';

/**
 * Speaker → the ledger's coarse `role`.
 *
 * `owner` is the ledger's `user` everywhere else in the kernel (the silence signal, prospective
 * confirmation evidence, the social gate), so it stays `user`. `other` is deliberately neither
 * `user` nor `assistant`: a third party's turn must not read as the owner speaking, and it is not
 * the agent's own turn either — that is what makes the speaker filter discriminative rather than
 * decorative.
 */
export const CONVERSATION_SPEAKER_ROLES: Readonly<Record<ConversationSpeaker, MemoryEventRole>> = {
  owner: 'user',
  other: 'other',
  agent: 'assistant',
};

const SPEAKER_LABELS: Readonly<Record<ConversationSpeaker, string>> = {
  owner: 'Owner',
  other: 'Other',
  agent: 'Agent',
};

/** The record's field set, frozen by `docs/conversation-capture.md`. */
export const CONVERSATION_TURN_FIELDS = [
  'eventId', 'projectId', 'agentId', 'sessionId', 'threadId', 'turnId', 'turnSeq',
  'speaker', 'speakerLabel', 'channel', 'lane', 'role', 'text', 'occurredAt', 'compiledNeuronId',
] as const;

/** The refusals this face names, frozen by the contract document. */
export const CONVERSATION_CAPTURE_ERROR_CODES = [
  'project_id_required',
  'agent_id_required',
  'conversation_session_id_required',
  'conversation_channel_required',
  'conversation_text_required',
  'invalid_conversation_speaker',
  'invalid_limit',
] as const;

export interface ConversationTurnInput {
  projectId: string;
  /** The identity the turn is captured on behalf of; the same on every turn of one conversation. */
  agentId: string;
  /** The session the turn belongs to — the ledger's existing column. Required. */
  sessionId: string;
  /** The thread inside the session. Defaults to the session id, as every other turn write does. */
  threadId?: string;
  turnId?: string;
  speaker: ConversationSpeaker;
  /** The third party's own name, for `speaker: 'other'`. Display only; the filter reads `speaker`. */
  speakerLabel?: string;
  /** Where the turn was said, e.g. `terminal`, `telegram`. Required and non-empty. */
  channel: string;
  text: string;
  occurredAt?: number;
  metadata?: Record<string, unknown>;
}

export interface ConversationTurnRecord {
  eventId: string;
  projectId: string;
  agentId: string;
  sessionId: string;
  threadId: string;
  turnId: string;
  turnSeq: number;
  speaker: ConversationSpeaker;
  speakerLabel?: string;
  channel: string;
  lane: typeof CONVERSATION_CAPTURE_LANE;
  /** The ledger's own coarse role for this speaker (`CONVERSATION_SPEAKER_ROLES`). */
  role: MemoryEventRole;
  text: string;
  occurredAt: number;
  /** Set when the turn also reached the compile path; the ledger row exists either way. */
  compiledNeuronId?: string;
}

export interface ConversationTurnQuery {
  projectId: string;
  /** The discriminative filter: one speaker's turns, never another's. */
  speaker?: ConversationSpeaker;
  channel?: string;
  threadId?: string;
  sessionId?: string;
  limit?: number;
}

/**
 * What the face needs from the kernel. Passing closured kernel calls instead of the kernel keeps this
 * module out of `factory.ts`'s cycle and makes the service exercisable with fakes.
 */
export interface ConversationCapturePorts {
  recordTurn(input: RawMemoryEventInput): MemoryEvent;
  nextTurnSeq(threadId: string, projectId: string): number;
  /** Never throws: episode assembly is an organizational index, and the ledger row is authoritative. */
  assembleTurn(
    events: MemoryEvent[],
    context: { projectId: string; sessionId: string; sourceAgent: string; conversationThreadId: string; now: number },
  ): void;
  ingest(input: IngestInput): Promise<{ id: string }>;
}

export class ConversationCaptureService {
  constructor(private readonly db: Database, private readonly ports: ConversationCapturePorts) {}

  /**
   * Write the turn, then let the compile path see it.
   *
   * The ledger row is written first and is authoritative: if the compile below throws, the turn is
   * still captured and the caller sees the error (the same shape the tool-observation face has).
   * `ingest` is the kernel's one ingest entry point, so this face is on the same path #199 measured
   * rather than a second, slower one.
   */
  async captureTurn(input: ConversationTurnInput): Promise<ConversationTurnRecord> {
    const projectId = requireText(input.projectId, 'project_id_required');
    const agentId = requireText(input.agentId, 'agent_id_required');
    const sessionId = requireText(input.sessionId, 'conversation_session_id_required');
    const channel = requireText(input.channel, 'conversation_channel_required');
    // The body is stored exactly as written (minus exclusion and redaction below) — "verbatim" is the
    // acceptance, and trimming the ends would be a silent edit the reader cannot see. Only an empty
    // body is refused.
    const text = input.text ?? '';
    if (!text.trim()) throw new Error('conversation_text_required');
    const speaker = requireSpeaker(input.speaker);
    // Explicit exclusion (#133, #152): a passage the owner marked never becomes an event, and this is
    // the same pass every write path inside the kernel runs. What is written is the stripped text.
    const excluded = excludeExplicitSpans(text).text;
    const occurredAt = input.occurredAt ?? Date.now();
    const threadId = input.threadId?.trim() || sessionId;
    const turnSeq = this.ports.nextTurnSeq(threadId, projectId);
    const turnId = input.turnId?.trim() || `${agentId}:${sessionId}:${turnSeq}:${occurredAt}`;
    const speakerLabel = input.speakerLabel?.trim();

    const event = this.ports.recordTurn({
      projectId,
      threadId,
      sessionId,
      turnId,
      turnSeq,
      role: CONVERSATION_SPEAKER_ROLES[speaker],
      content: excluded,
      occurredAt,
      sourceId: `${agentId}:${sessionId}`,
      metadata: {
        ...(input.metadata ?? {}),
        sourceAgent: agentId,
        captureLane: CONVERSATION_CAPTURE_LANE,
        speaker,
        ...(speakerLabel ? { speakerLabel } : {}),
        channel,
      },
    });

    // What the ledger actually holds, not what the caller passed: the append also runs the PII
    // redactor, and the record this face returns has to be the row a later read returns.
    // `recordRawEvent` always writes `payload.text`; this is that field, typed.
    const written = (event.payload as { text: string }).text;

    this.ports.assembleTurn([event], {
      projectId,
      sessionId,
      sourceAgent: agentId,
      conversationThreadId: threadId,
      now: occurredAt,
    });

    const neuron = await this.ports.ingest({
      content: `${SPEAKER_LABELS[speaker]}: ${written}`,
      projectId,
      createdAt: occurredAt,
      source: `${agentId}:${sessionId}`,
      tags: [
        `agent:${agentId}`,
        `session:${sessionId}`,
        `channel:${channel}`,
        `speaker:${speaker}`,
        'record:conversation_turn',
      ],
    });

    return {
      eventId: event.eventId,
      projectId,
      agentId,
      sessionId,
      threadId,
      turnId,
      turnSeq,
      speaker,
      ...(speakerLabel ? { speakerLabel } : {}),
      channel,
      lane: CONVERSATION_CAPTURE_LANE,
      role: CONVERSATION_SPEAKER_ROLES[speaker],
      text: written,
      occurredAt,
      compiledNeuronId: neuron.id,
    };
  }

  /** One speaker's turns, or every speaker's, in ledger order. Tool rows are never in this lane. */
  listTurns(query: ConversationTurnQuery): ConversationTurnRecord[] {
    // ponytail: the lane marker lives in the payload, so this reads the project's rows and filters
    // them; there is no expression index on `$.metadata.captureLane`. Fine for a session-sized read
    // and for the contract's discrimination tests. If a shell polls this per turn on a large
    // database, add an expression index on (project_id, json_extract(payload_json,'$.metadata.captureLane'))
    // — the lane is written on every row this face creates, so the index would cover it.
    const projectId = requireText(query.projectId, 'project_id_required');
    const speaker = query.speaker === undefined ? undefined : requireSpeaker(query.speaker);
    const conditions = [
      `event_type = 'RAW_EVENT_RECORDED'`,
      `COALESCE(project_id, '') = ?`,
      `json_valid(payload_json)`,
      `json_extract(payload_json, '$.metadata.captureLane') = ?`,
    ];
    const params: Array<string | number> = [projectId, CONVERSATION_CAPTURE_LANE];
    if (speaker !== undefined) {
      conditions.push(`json_extract(payload_json, '$.metadata.speaker') = ?`);
      params.push(speaker);
    }
    if (query.channel !== undefined) {
      conditions.push(`json_extract(payload_json, '$.metadata.channel') = ?`);
      params.push(query.channel);
    }
    if (query.threadId !== undefined) {
      conditions.push(`COALESCE(thread_id, '') = ?`);
      params.push(query.threadId);
    }
    if (query.sessionId !== undefined) {
      conditions.push(`COALESCE(session_id, '') = ?`);
      params.push(query.sessionId);
    }
    params.push(boundedLimit(query.limit));
    const rows = this.db.prepare(`
      SELECT event_id, project_id, session_id, thread_id, turn_id, turn_seq, role, occurred_at,
             json_extract(payload_json, '$.text') AS text, payload_json
      FROM memory_events
      WHERE ${conditions.join(' AND ')}
      ORDER BY occurred_at ASC, global_seq ASC
      LIMIT ?
    `).all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const payload = JSON.parse(String(row.payload_json)) as { metadata?: Record<string, unknown> };
      const metadata = payload.metadata ?? {};
      return {
        eventId: String(row.event_id),
        projectId: String(row.project_id ?? ''),
        agentId: String(metadata.sourceAgent ?? ''),
        sessionId: String(row.session_id ?? ''),
        threadId: String(row.thread_id ?? ''),
        turnId: String(row.turn_id ?? ''),
        turnSeq: Number(row.turn_seq ?? 0),
        speaker: metadata.speaker as ConversationSpeaker,
        ...(metadata.speakerLabel ? { speakerLabel: String(metadata.speakerLabel) } : {}),
        channel: String(metadata.channel ?? ''),
        lane: CONVERSATION_CAPTURE_LANE,
        role: row.role as MemoryEventRole,
        text: String(row.text ?? ''),
        occurredAt: Number(row.occurred_at ?? 0),
      };
    });
  }
}

function requireSpeaker(value: ConversationSpeaker): ConversationSpeaker {
  if (!CONVERSATION_SPEAKERS.includes(value)) {
    throw new Error(`invalid_conversation_speaker: expected one of ${CONVERSATION_SPEAKERS.join(', ')}`);
  }
  return value;
}

function requireText(value: string | undefined, code: string): string {
  const normalized = (value ?? '').trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function boundedLimit(value: number | undefined): number {
  const limit = value ?? 50;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('invalid_limit');
  return Math.min(500, limit);
}
