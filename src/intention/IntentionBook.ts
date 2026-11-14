/**
 * The intention book (F22 of #216): the agent's own plans, tracked until they end.
 *
 * Its state is the ledger: an `OPENED` row is the plan, an `UPDATED` row is a self-correction, and
 * a `CLOSED` row is its ending. No table, no column, no migration.
 *
 * Recognition is deterministic (`IntentionRecognition.ts`); nothing on the hot path calls a model.
 * `compile` is incremental: it re-derives from the raw turns and appends only the rows that are
 * new, so running it at a turn boundary and again at the DREAMING boundary is safe.
 *
 * The two books stay isolated. A clause F16 recognizes as a promise is a commitment and is refused
 * here; this book writes only `INTENTION_*` rows, so an intention never enters F16. Conversion
 * links to a commitment that already exists and writes nothing on F16's side.
 *
 * The written contract is `docs/intentions.md`, held by
 * `__tests__/intention-book.contract.test.ts`.
 */
import { createHash } from 'node:crypto';

import type { CommitmentAuditEntry } from '../commitment/index.js';
import {
  completionEvidence,
  sharesCommitmentContent,
} from '../commitment/index.js';
import type { EventStore } from '../store/EventStore.js';
import type { RegisterWakeIntentionInput, WakeIntention } from '../temporal/index.js';
import type { MemoryEvent, MemorySourceRef } from '../types/index.js';
import {
  INTENTION_ORIGINS,
  recognizeIntentions,
  type IntentionOrigin,
} from './IntentionRecognition.js';

export const INTENTION_CONTRACT_VERSION = 1;

/** The life cycle the book exposes. Frozen; `active` is the absence of a closing row. */
export const INTENTION_STATUSES = ['active', 'done', 'abandoned', 'converted'] as const;
export type IntentionStatus = (typeof INTENTION_STATUSES)[number];

/** Why a row closed. Frozen; `vetoed` and `abandoned` share the `abandoned` status. */
export const INTENTION_CLOSE_REASONS = ['done', 'abandoned', 'vetoed', 'converted'] as const;
export type IntentionCloseReason = (typeof INTENTION_CLOSE_REASONS)[number];

/** The ledger event types this face writes. Frozen. */
export const INTENTION_EVENT_TYPES = [
  'INTENTION_OPENED',
  'INTENTION_UPDATED',
  'INTENTION_CLOSED',
] as const;
export type IntentionEventType = (typeof INTENTION_EVENT_TYPES)[number];

/** The face's methods. Frozen; adding one is additive, removing or renaming one is not. */
export const INTENTION_API_METHODS = [
  'compile',
  'propose',
  'list',
  'activeForAgent',
  'update',
  'close',
  'veto',
  'convert',
  'schedule',
  'audit',
] as const;

/** `IntentionEntry`'s field set, frozen by the contract document. */
export const INTENTION_ENTRY_FIELDS = [
  'intentionId',
  'agentId',
  'content',
  'origin',
  'status',
  'dueAt',
  'wakeIntentionId',
  'convertedTo',
  'sourceRefs',
  'openedAt',
  'updatedAt',
  'closedAt',
  'closeReason',
  'vetoEventId',
  'version',
] as const;

/** The refusals this face names, frozen. */
export const INTENTION_ERROR_CODES = [
  'project_id_required',
  'agent_id_required',
  'intention_id_required',
  'intention_unknown',
  'invalid_intention_evidence',
  'invalid_intention_status',
  'invalid_source_refs',
  'intention_due_required',
  'intention_content_required',
  'invalid_intention_at',
  'commitment_unknown',
  'invalid_limit',
] as const;
export type IntentionErrorCode = (typeof INTENTION_ERROR_CODES)[number];

export const INTENTION_DEFAULT_LIMIT = 20;
export const INTENTION_MAX_LIMIT = 100;

export interface IntentionEntry {
  intentionId: string;
  /** The agent whose plan this is; absent when the ledger named none (the single-agent case). */
  agentId?: string;
  content: string;
  origin: IntentionOrigin;
  status: IntentionStatus;
  dueAt?: number;
  wakeIntentionId?: string;
  convertedTo?: string;
  sourceRefs: MemorySourceRef[];
  openedAt: number;
  updatedAt?: number;
  closedAt?: number;
  closeReason?: IntentionCloseReason;
  vetoEventId?: string;
  version: number;
}

export interface IntentionCompileInput {
  projectId: string;
  now?: number;
}

export interface IntentionCompileResult {
  projectId: string;
  /** Rows appended this pass: an intention opened, an intention closed. */
  opened: number;
  closed: number;
  entries: number;
  compiledAt: number;
}

export interface ProposeIntentionInput {
  projectId: string;
  agentId: string;
  content: string;
  sourceRefs: MemorySourceRef[];
  dueAt?: number;
  now?: number;
}

export interface IntentionListInput {
  projectId: string;
  agentId?: string;
  statuses?: IntentionStatus[];
  limit?: number;
  now?: number;
}

export interface IntentionUpdateInput {
  projectId: string;
  intentionId: string;
  content?: string;
  /** `null` clears the target instant. */
  dueAt?: number | null;
  now?: number;
}

export interface IntentionCloseInput {
  projectId: string;
  intentionId: string;
  status: 'done' | 'abandoned';
  evidenceEventId: string;
  now?: number;
}

export interface IntentionVetoInput {
  projectId: string;
  intentionId: string;
  evidenceEventId: string;
  now?: number;
}

export interface IntentionConvertInput {
  projectId: string;
  intentionId: string;
  commitmentId: string;
  now?: number;
}

export interface IntentionScheduleInput {
  projectId: string;
  intentionId: string;
  /** Supplied only when the intention's own row named no agent. */
  agentId?: string;
  now?: number;
}

export interface IntentionAuditEntry {
  intentionId: string;
  eventType: IntentionEventType;
  payload: Record<string, unknown>;
  occurredAt: number;
}

export interface IntentionBookPorts {
  events: EventStore;
  /** F16's read face; conversion requires the named commitment to be real. */
  commitments: { audit(input: { projectId: string; commitmentId?: string }): CommitmentAuditEntry[] };
  /** F2's existing register; scheduling a plan is one wake intention. */
  wakeIntentions: { register(input: RegisterWakeIntentionInput): WakeIntention };
}

interface BaseIntention {
  intentionId: string;
  agentId?: string;
  content: string;
  origin: IntentionOrigin;
  dueAt?: number;
  wakeIntentionId?: string;
  sourceRefs: MemorySourceRef[];
  openedAt: number;
}

interface ClosedIntention {
  status: 'done' | 'abandoned' | 'converted';
  reason: IntentionCloseReason;
  at: number;
  sourceRefs: MemorySourceRef[];
  convertedTo?: string;
  vetoEventId?: string;
}

interface StoredIntention {
  base?: BaseIntention;
  updatedAt?: number;
  closed?: ClosedIntention;
  version: number;
}

interface DerivedIntention extends BaseIntention {
  closed?: ClosedIntention;
}

const MAX_TIME = 8_640_000_000_000_000;
const LEDGER_PAGE_SIZE = 500;
// ponytail: a project with more than 4000 intention rows reads the newest 4000; page the rest or
// add an event_type index when a project has years of plans.
const MAX_INTENTION_ROWS = 4000;
const MAX_RAW_EVENTS = 4000;

function intentionError(code: IntentionErrorCode, detail?: string): Error {
  return new Error(detail ? `${code}: ${detail}` : code);
}

function requiredText(value: string | undefined, code: IntentionErrorCode): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) throw intentionError(code);
  return trimmed;
}

function intentionIdOfConversation(projectId: string, eventId: string, index: number): string {
  const digest = createHash('sha256').update(`${projectId}\u0000${eventId}\u0000${index}`).digest('hex').slice(0, 20);
  return `intention-${digest}`;
}

function intentionIdOfDream(projectId: string, agentId: string, content: string, refs: MemorySourceRef[]): string {
  const evidence = refs.map((ref) => ref.eventId ?? '').filter(Boolean).sort().join('\u0001');
  const digest = createHash('sha256').update(`${projectId}\u0000${agentId}\u0000${content}\u0000${evidence}`).digest('hex').slice(0, 20);
  return `intention-${digest}`;
}

function refOf(event: MemoryEvent): MemorySourceRef {
  return {
    eventId: event.eventId,
    eventType: event.rawEventType || event.eventType,
    sourceId: event.sourceId,
    role: event.role,
    threadId: event.threadId,
    sessionId: event.sessionId,
    turnId: event.turnId,
    threadSeq: event.threadSeq,
    turnSeq: event.turnSeq,
    eventOrdinal: event.eventOrdinal,
  };
}

function uniqRefs(refs: MemorySourceRef[]): MemorySourceRef[] {
  const seen = new Set<string>();
  const out: MemorySourceRef[] = [];
  for (const ref of refs) {
    if (!ref.eventId || seen.has(ref.eventId)) continue;
    seen.add(ref.eventId);
    out.push(ref);
    if (out.length >= 16) break;
  }
  return out;
}

function textOf(event: MemoryEvent): string {
  const text = (event.payload as { text?: unknown } | undefined)?.text;
  return typeof text === 'string' ? text : '';
}

function metadataOf(event: MemoryEvent): Record<string, unknown> {
  const metadata = (event.payload as { metadata?: unknown } | undefined)?.metadata;
  return metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {};
}

/** The agent a turn belongs to, when the ledger named one. */
function agentIdOf(event: MemoryEvent): string | undefined {
  const named = metadataOf(event).sourceAgent;
  if (typeof named === 'string' && named.trim()) return named.trim();
  const sourceId = event.sourceId ?? '';
  const match = /^([A-Za-z][\w-]*):/.exec(sourceId);
  return match?.[1];
}

function isOrigin(value: unknown): value is IntentionOrigin {
  return (INTENTION_ORIGINS as readonly string[]).includes(String(value));
}

function isCloseReason(value: unknown): value is IntentionCloseReason {
  return (INTENTION_CLOSE_REASONS as readonly string[]).includes(String(value));
}

function isAgentTurn(event: MemoryEvent): boolean {
  return event.role === 'assistant' || event.role === 'agent';
}

function toEntry(state: StoredIntention): IntentionEntry | null {
  const base = state.base;
  if (!base) return null;
  return {
    intentionId: base.intentionId,
    agentId: base.agentId,
    content: base.content,
    origin: base.origin,
    status: state.closed?.status ?? 'active',
    dueAt: base.dueAt,
    wakeIntentionId: base.wakeIntentionId,
    convertedTo: state.closed?.convertedTo,
    // A closed entry carries the evidence that closed it, not only the turn that opened it.
    sourceRefs: [...(state.closed?.sourceRefs ?? base.sourceRefs)],
    openedAt: base.openedAt,
    updatedAt: state.updatedAt,
    closedAt: state.closed?.at,
    closeReason: state.closed?.reason,
    vetoEventId: state.closed?.vetoEventId,
    version: state.version,
  };
}

export class IntentionBook {
  private readonly events: EventStore;
  private readonly commitments: IntentionBookPorts['commitments'];
  private readonly wakeIntentions: IntentionBookPorts['wakeIntentions'];

  constructor(ports: IntentionBookPorts) {
    this.events = ports.events;
    this.commitments = ports.commitments;
    this.wakeIntentions = ports.wakeIntentions;
  }

  /**
   * Incremental maintenance: re-derive conversation intentions from the raw turns, open the new
   * ones and close the ones with completion evidence. Called at a turn boundary and at the
   * DREAMING boundary alike; the second call with no new evidence is a no-op.
   */
  compile(input: IntentionCompileInput): IntentionCompileResult {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const now = input.now ?? Date.now();
    const derived = this.derive(projectId);
    const stored = this.states(projectId);
    let opened = 0;
    let closed = 0;
    for (const intention of derived) {
      const state = stored.get(intention.intentionId);
      if (!state?.base) {
        this.appendOpened(projectId, intention, now);
        opened += 1;
      }
      if (intention.closed && !state?.closed) {
        this.appendClosed(projectId, intention, intention.closed, now);
        closed += 1;
      }
    }
    // A dream candidate is not derived from the raw turns, so its completion evidence is read
    // here. Conversation intentions were already handled by the derivation pass.
    const derivedIds = new Set(derived.map((intention) => intention.intentionId));
    for (const state of stored.values()) {
      if (!state.base || state.closed || derivedIds.has(state.base.intentionId)) continue;
      const close = this.evidenceFor(projectId, state.base);
      if (!close) continue;
      this.appendClosed(projectId, state.base, close, now);
      state.closed = close;
      state.version += 1;
      closed += 1;
    }
    return { projectId, opened, closed, entries: this.states(projectId).size, compiledAt: now };
  }

  /**
   * Record a dream candidate. The caller may have used a model offline; this face requires the
   * experience events it came from, so a candidate cannot enter without evidence. The same
   * candidate proposed twice is one row.
   */
  propose(input: ProposeIntentionInput): IntentionEntry {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const agentId = requiredText(input.agentId, 'agent_id_required');
    const content = requiredText(input.content, 'intention_content_required');
    const now = input.now ?? Date.now();
    const refs = this.validatedRefs(projectId, input.sourceRefs);
    if (input.dueAt !== undefined && !Number.isFinite(input.dueAt)) throw intentionError('invalid_intention_at');
    const intentionId = intentionIdOfDream(projectId, agentId, content, refs);
    const existing = this.states(projectId).get(intentionId);
    if (existing?.base) return toEntry(existing)!;
    this.appendOpened(projectId, {
      intentionId,
      agentId,
      content,
      origin: 'dream',
      dueAt: input.dueAt,
      sourceRefs: refs,
      openedAt: now,
    }, now);
    return toEntry(this.states(projectId).get(intentionId)!)!;
  }

  /** The book, filtered by agent and derived status. */
  list(input: IntentionListInput): IntentionEntry[] {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const limit = this.limitOf(input.limit);
    const wanted = input.statuses ? new Set(input.statuses) : null;
    return this.entries(projectId)
      .filter((entry) => input.agentId === undefined || entry.agentId === undefined || entry.agentId === input.agentId)
      .filter((entry) => wanted === null || wanted.has(entry.status))
      .slice(0, limit);
  }

  /**
   * The agent's active intentions, for its wake assembly. A pure read: the session face consumes
   * it through F14's open-loop port, and reading the wake context changes no row.
   */
  activeForAgent(input: { projectId: string; agentId?: string; now?: number; limit?: number }): IntentionEntry[] {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const limit = this.limitOf(input.limit);
    return this.entries(projectId)
      .filter((entry) => entry.status === 'active')
      // A plan whose ledger names no agent is the single-agent case and stays visible; a named one
      // wakes only the agent that made it.
      .filter((entry) => !input.agentId || !entry.agentId || entry.agentId === input.agentId)
      .sort((a, b) => (a.dueAt ?? MAX_TIME) - (b.dueAt ?? MAX_TIME) || b.openedAt - a.openedAt)
      .slice(0, limit);
  }

  /** The agent corrects its own content or target time. A closed plan cannot be edited. */
  update(input: IntentionUpdateInput): IntentionEntry {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const intentionId = requiredText(input.intentionId, 'intention_id_required');
    const now = input.now ?? Date.now();
    const state = this.states(projectId).get(intentionId);
    if (!state?.base) throw intentionError('intention_unknown', intentionId);
    if (state.closed) throw intentionError('invalid_intention_status', 'closed');
    const content = input.content === undefined ? undefined : requiredText(input.content, 'intention_content_required');
    if (content === undefined && input.dueAt === undefined) throw intentionError('invalid_intention_status', 'no fields');
    if (input.dueAt !== undefined && input.dueAt !== null && !Number.isFinite(input.dueAt)) {
      throw intentionError('invalid_intention_at');
    }
    const version = state.version + 1;
    this.appendUpdated(projectId, intentionId, {
      ...(content === undefined ? {} : { content }),
      ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
      updatedAt: now,
    }, version, now);
    if (content !== undefined) state.base.content = content;
    if (input.dueAt !== undefined) state.base.dueAt = input.dueAt === null ? undefined : input.dueAt;
    state.updatedAt = now;
    state.version = version;
    return toEntry(state)!;
  }

  /** The agent ends its own plan as done or abandoned, with a real event as evidence. */
  close(input: IntentionCloseInput): IntentionEntry {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const intentionId = requiredText(input.intentionId, 'intention_id_required');
    if (input.status !== 'done' && input.status !== 'abandoned') {
      throw intentionError('invalid_intention_status', String(input.status));
    }
    const now = input.now ?? Date.now();
    const state = this.states(projectId).get(intentionId);
    if (!state?.base) throw intentionError('intention_unknown', intentionId);
    const evidence = this.evidenceEvent(projectId, input.evidenceEventId);
    if (state.closed) return toEntry(state)!;
    const close: ClosedIntention = {
      status: input.status,
      reason: input.status,
      at: now,
      sourceRefs: uniqRefs([...state.base.sourceRefs, refOf(evidence)]),
    };
    this.appendClosed(projectId, state.base, close, now);
    state.closed = close;
    state.version += 1;
    return toEntry(state)!;
  }

  /**
   * The owner vetoes a plan. It closes as `abandoned` with `closeReason: vetoed` and the owner's
   * turn in `sourceRefs`; every read in the project sees it closed.
   */
  veto(input: IntentionVetoInput): IntentionEntry {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const intentionId = requiredText(input.intentionId, 'intention_id_required');
    const now = input.now ?? Date.now();
    const state = this.states(projectId).get(intentionId);
    if (!state?.base) throw intentionError('intention_unknown', intentionId);
    const evidence = this.evidenceEvent(projectId, input.evidenceEventId);
    if (state.closed) return toEntry(state)!;
    const close: ClosedIntention = {
      status: 'abandoned',
      reason: 'vetoed',
      at: now,
      sourceRefs: uniqRefs([...state.base.sourceRefs, refOf(evidence)]),
      vetoEventId: evidence.eventId,
    };
    this.appendClosed(projectId, state.base, close, now);
    state.closed = close;
    state.version += 1;
    return toEntry(state)!;
  }

  /**
   * Link the plan to a commitment that F16 already holds. The intention side closes as
   * `converted`; no `COMMITMENT_*` row is written and the commitment stays a single entry.
   */
  convert(input: IntentionConvertInput): IntentionEntry {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const intentionId = requiredText(input.intentionId, 'intention_id_required');
    const commitmentId = requiredText(input.commitmentId, 'commitment_unknown');
    const now = input.now ?? Date.now();
    const states = this.states(projectId);
    const state = states.get(intentionId);
    if (!state?.base) throw intentionError('intention_unknown', intentionId);
    if (state.closed) {
      if (state.closed.reason === 'converted' && state.closed.convertedTo === commitmentId) return toEntry(state)!;
      throw intentionError('invalid_intention_status', 'closed');
    }
    // The debt is one commitment: a second intention cannot point at the same one.
    for (const other of states.values()) {
      if (other.base?.intentionId !== intentionId && other.closed?.convertedTo === commitmentId) {
        throw intentionError('invalid_intention_status', 'commitment already converted');
      }
    }
    const rows = this.commitments.audit({ projectId, commitmentId });
    if (rows.length === 0) throw intentionError('commitment_unknown', commitmentId);
    const opened = rows.find((row) => row.eventType === 'COMMITMENT_OPENED');
    const commitmentRefs = Array.isArray(opened?.payload.sourceRefs)
      ? opened.payload.sourceRefs as MemorySourceRef[]
      : [];
    const close: ClosedIntention = {
      status: 'converted',
      reason: 'converted',
      at: now,
      sourceRefs: uniqRefs([...state.base.sourceRefs, ...commitmentRefs]),
      convertedTo: commitmentId,
    };
    this.appendClosed(projectId, state.base, close, now);
    state.closed = close;
    state.version += 1;
    return toEntry(state)!;
  }

  /**
   * Register the plan's target time as an F2 wake intention. The ledger row records the wake id,
   * so scheduling twice is one wake intention.
   */
  schedule(input: IntentionScheduleInput): IntentionEntry {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const intentionId = requiredText(input.intentionId, 'intention_id_required');
    const now = input.now ?? Date.now();
    const state = this.states(projectId).get(intentionId);
    if (!state?.base) throw intentionError('intention_unknown', intentionId);
    if (state.closed) throw intentionError('invalid_intention_status', 'closed');
    if (state.base.wakeIntentionId) return toEntry(state)!;
    if (state.base.dueAt === undefined) throw intentionError('intention_due_required', intentionId);
    const agentId = state.base.agentId ?? input.agentId;
    if (!agentId) throw intentionError('agent_id_required');
    const wake = this.wakeIntentions.register({
      projectId,
      agentId,
      at: state.base.dueAt,
      reason: state.base.content,
      sourceRefs: state.base.sourceRefs,
      now,
    });
    const version = state.version + 1;
    this.appendUpdated(projectId, intentionId, { wakeIntentionId: wake.intentionId, updatedAt: now }, version, now);
    state.base.wakeIntentionId = wake.intentionId;
    state.updatedAt = now;
    state.version = version;
    return toEntry(state)!;
  }

  /** Every intention row for the project, oldest first. */
  audit(input: { projectId: string; intentionId?: string }): IntentionAuditEntry[] {
    const projectId = requiredText(input.projectId, 'project_id_required');
    return this.loadProjectRows(projectId)
      .filter((row) => input.intentionId === undefined || row.payload.intentionId === input.intentionId)
      .map((row) => ({
        intentionId: String(row.payload.intentionId ?? ''),
        eventType: row.event.eventType as IntentionEventType,
        payload: row.payload,
        occurredAt: row.event.occurredAt,
      }));
  }

  private entries(projectId: string): IntentionEntry[] {
    const out: IntentionEntry[] = [];
    for (const state of this.states(projectId).values()) {
      const entry = toEntry(state);
      if (entry) out.push(entry);
    }
    return out.sort((a, b) => b.openedAt - a.openedAt || b.version - a.version);
  }

  /**
   * Re-derive conversation intentions from the raw turns, in order. Closing is evaluated before
   * opening, so a turn that reports a finished plan cannot also be read as its opening.
   */
  private derive(projectId: string): DerivedIntention[] {
    const derived: DerivedIntention[] = [];
    const byId = new Map<string, DerivedIntention>();
    for (const event of this.messageEvents(projectId)) {
      const text = textOf(event).trim();
      if (!text) continue;
      if (isAgentTurn(event) && completionEvidence(text) === 'completed') {
        for (const intention of derived) {
          if (intention.closed || !sharesCommitmentContent(intention.content, text)) continue;
          intention.closed = {
            status: 'done',
            reason: 'done',
            at: event.occurredAt,
            sourceRefs: uniqRefs([...intention.sourceRefs, refOf(event)]),
          };
        }
      }
      const completes = metadataOf(event).completesIntention;
      if (typeof completes === 'string') {
        const target = byId.get(completes);
        if (target && !target.closed) {
          target.closed = {
            status: 'done',
            reason: 'done',
            at: event.occurredAt,
            sourceRefs: uniqRefs([...target.sourceRefs, refOf(event)]),
          };
        }
      }
      const signals = recognizeIntentions({ text, role: event.role ?? 'user', occurredAt: event.occurredAt });
      signals.forEach((signal, index) => {
        const intentionId = intentionIdOfConversation(projectId, event.eventId, index);
        if (byId.has(intentionId)) return;
        const intention: DerivedIntention = {
          intentionId,
          agentId: agentIdOf(event),
          content: signal.content,
          origin: 'conversation',
          dueAt: signal.dueAt,
          sourceRefs: [refOf(event)],
          openedAt: event.occurredAt,
        };
        derived.push(intention);
        byId.set(intentionId, intention);
      });
    }
    return derived;
  }

  /** Completion evidence for a proposed intention, which the raw-turn derivation cannot see. */
  private evidenceFor(projectId: string, base: BaseIntention): ClosedIntention | undefined {
    for (const event of this.messageEvents(projectId)) {
      if (event.occurredAt < base.openedAt) continue;
      const completes = metadataOf(event).completesIntention;
      if (typeof completes === 'string' && completes === base.intentionId) {
        return {
          status: 'done',
          reason: 'done',
          at: event.occurredAt,
          sourceRefs: uniqRefs([...base.sourceRefs, refOf(event)]),
        };
      }
      if (isAgentTurn(event) && completionEvidence(textOf(event)) === 'completed'
        && sharesCommitmentContent(base.content, textOf(event))) {
        return {
          status: 'done',
          reason: 'done',
          at: event.occurredAt,
          sourceRefs: uniqRefs([...base.sourceRefs, refOf(event)]),
        };
      }
    }
    return undefined;
  }

  private messageEvents(projectId: string): MemoryEvent[] {
    const out: MemoryEvent[] = [];
    const filters = { projectId: [projectId], eventType: ['RAW_EVENT_RECORDED' as const], order: 'asc' as const };
    for (let page = 1; out.length < MAX_RAW_EVENTS; page += 1) {
      const result = this.events.queryEvents(page, LEDGER_PAGE_SIZE, filters);
      if (result.records.length === 0) break;
      out.push(...result.records);
      if (out.length >= result.total) break;
    }
    return out
      .filter((event) => event.rawEventType === undefined
        || event.rawEventType === 'message'
        || event.rawEventType === 'task_event'
        // An artifact row may close a plan by naming it, and that rule must see the row.
        || typeof metadataOf(event).completesIntention === 'string')
      .slice(0, MAX_RAW_EVENTS);
  }

  private states(projectId: string): Map<string, StoredIntention> {
    const states = new Map<string, StoredIntention>();
    for (const row of this.loadProjectRows(projectId)) {
      const intentionId = typeof row.payload.intentionId === 'string' ? row.payload.intentionId : '';
      if (!intentionId) continue;
      const state = states.get(intentionId) ?? { version: 0 };
      const eventType = row.event.eventType as IntentionEventType;
      if (eventType === 'INTENTION_OPENED') {
        state.base = baseFromPayload(row.payload);
        state.version = Number(row.payload.version ?? state.version + 1);
      } else if (eventType === 'INTENTION_UPDATED') {
        applyUpdate(state, row.payload);
        state.version = Number(row.payload.version ?? state.version + 1);
      } else if (eventType === 'INTENTION_CLOSED') {
        state.closed = closedFromPayload(row.payload);
        state.version = Number(row.payload.version ?? state.version + 1);
      }
      states.set(intentionId, state);
    }
    return states;
  }

  private validatedRefs(projectId: string, refs: MemorySourceRef[] | undefined): MemorySourceRef[] {
    const unique = uniqRefs(Array.isArray(refs) ? refs : []);
    if (unique.length === 0) throw intentionError('invalid_source_refs');
    for (const ref of unique) {
      const event = this.events.getEvent(ref.eventId!);
      if (!event || (event.projectId ?? '') !== projectId) throw intentionError('invalid_source_refs', ref.eventId);
    }
    return unique;
  }

  private evidenceEvent(projectId: string, eventId: string): MemoryEvent {
    const id = requiredText(eventId, 'invalid_intention_evidence');
    const event = this.events.getEvent(id);
    if (!event || (event.projectId ?? '') !== projectId) throw intentionError('invalid_intention_evidence', id);
    return event;
  }

  private appendOpened(projectId: string, intention: BaseIntention, now: number): void {
    this.events.append({
      streamId: `intention:${intention.intentionId}`,
      streamType: 'system',
      eventType: 'INTENTION_OPENED',
      projectId,
      sourceId: 'intention',
      occurredAt: now,
      payload: { ...intention, projectId, version: 1 },
    });
  }

  private appendUpdated(
    projectId: string,
    intentionId: string,
    patch: { content?: string; dueAt?: number | null; wakeIntentionId?: string; updatedAt: number },
    version: number,
    now: number,
  ): void {
    this.events.append({
      streamId: `intention:${intentionId}`,
      streamType: 'system',
      eventType: 'INTENTION_UPDATED',
      projectId,
      sourceId: 'intention',
      occurredAt: now,
      payload: { intentionId, projectId, ...patch, version },
    });
  }

  private appendClosed(projectId: string, intention: BaseIntention, close: ClosedIntention, now: number): void {
    this.events.append({
      streamId: `intention:${intention.intentionId}`,
      streamType: 'system',
      eventType: 'INTENTION_CLOSED',
      projectId,
      sourceId: 'intention',
      occurredAt: now,
      payload: {
        intentionId: intention.intentionId,
        projectId,
        status: close.status,
        closeReason: close.reason,
        closedAt: close.at,
        sourceRefs: close.sourceRefs,
        ...(close.convertedTo ? { convertedTo: close.convertedTo } : {}),
        ...(close.vetoEventId ? { vetoEventId: close.vetoEventId } : {}),
        version: (this.states(projectId).get(intention.intentionId)?.version ?? 1) + 1,
      },
    });
  }

  private limitOf(value: number | undefined): number {
    const limit = value ?? INTENTION_DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0) throw intentionError('invalid_limit', String(value));
    return Math.min(limit, INTENTION_MAX_LIMIT);
  }

  private loadProjectRows(projectId: string): Array<{ event: MemoryEvent; payload: Record<string, unknown> }> {
    const rows: Array<{ event: MemoryEvent; payload: Record<string, unknown> }> = [];
    const filters = { projectId: [projectId], eventType: [...INTENTION_EVENT_TYPES], order: 'asc' as const };
    for (let page = 1; rows.length < MAX_INTENTION_ROWS; page += 1) {
      const result = this.events.queryEvents(page, LEDGER_PAGE_SIZE, filters);
      if (result.records.length === 0) break;
      for (const event of result.records) rows.push({ event, payload: (event.payload ?? {}) as Record<string, unknown> });
      if (rows.length >= result.total) break;
    }
    return rows.slice(0, MAX_INTENTION_ROWS);
  }
}

function baseFromPayload(payload: Record<string, unknown>): BaseIntention | undefined {
  const intentionId = typeof payload.intentionId === 'string' ? payload.intentionId : '';
  const content = typeof payload.content === 'string' ? payload.content : '';
  if (!intentionId || !content || !isOrigin(payload.origin)) return undefined;
  return {
    intentionId,
    agentId: typeof payload.agentId === 'string' ? payload.agentId : undefined,
    content,
    origin: payload.origin,
    dueAt: typeof payload.dueAt === 'number' ? payload.dueAt : undefined,
    wakeIntentionId: typeof payload.wakeIntentionId === 'string' ? payload.wakeIntentionId : undefined,
    sourceRefs: Array.isArray(payload.sourceRefs) ? payload.sourceRefs as MemorySourceRef[] : [],
    openedAt: Number(payload.openedAt ?? 0),
  };
}

function applyUpdate(state: StoredIntention, payload: Record<string, unknown>): void {
  if (!state.base) return;
  if (typeof payload.content === 'string' && payload.content.trim()) state.base.content = payload.content;
  if (payload.dueAt === null) state.base.dueAt = undefined;
  else if (typeof payload.dueAt === 'number') state.base.dueAt = payload.dueAt;
  if (typeof payload.wakeIntentionId === 'string') state.base.wakeIntentionId = payload.wakeIntentionId;
  state.updatedAt = Number(payload.updatedAt ?? state.updatedAt ?? 0) || undefined;
}

function closedFromPayload(payload: Record<string, unknown>): ClosedIntention | undefined {
  const status = payload.status;
  const reason = payload.closeReason;
  if (status !== 'done' && status !== 'abandoned' && status !== 'converted') return undefined;
  if (!isCloseReason(reason)) return undefined;
  return {
    status,
    reason,
    at: Number(payload.closedAt ?? 0),
    sourceRefs: Array.isArray(payload.sourceRefs) ? payload.sourceRefs as MemorySourceRef[] : [],
    convertedTo: typeof payload.convertedTo === 'string' ? payload.convertedTo : undefined,
    vetoEventId: typeof payload.vetoEventId === 'string' ? payload.vetoEventId : undefined,
  };
}
