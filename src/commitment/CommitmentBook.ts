/**
 * The commitment book (F16 of #193): the promises said out loud, tracked until they close.
 *
 * The fourth compiled book. Its state is the ledger: an `OPENED` row is the promise, a `CLOSED` row
 * is its completion or cancellation, and `SURFACED` / `ASKED` / `DISMISSED` rows are the discipline
 * marks that make "announce once" and "ask once" survive a restart. No table, no column, no
 * migration.
 *
 * Recognition and completion are deterministic (`CommitmentRecognition.ts`); nothing on this path
 * calls a model. `compile` is incremental: it re-derives from the raw turns and appends only the
 * rows that are new, so running it at a turn boundary and again at the DREAMING boundary is safe.
 *
 * The state machine is derived, not written: `dueAt` decides `pending` / `due_soon` / `overdue`
 * against the read's `now`, and a closed row decides `completed` / `cancelled`. That is why a clock
 * alone never appends a row.
 *
 * The written contract is `docs/commitments.md`, held by
 * `__tests__/commitment-book.contract.test.ts`.
 */
import { createHash } from 'node:crypto';

import type { EventStore } from '../store/EventStore.js';
import type { MemoryEvent, MemorySourceRef } from '../types/index.js';
import {
  COMMITMENT_OWNERS,
  completionEvidence,
  recognizeCommitments,
  sharesCommitmentContent,
  type CommitmentConfidence,
  type CommitmentOwner,
} from './CommitmentRecognition.js';

export const COMMITMENT_CONTRACT_VERSION = 1;

/** The life cycle the book exposes. Frozen; `due_soon` and `overdue` are derived from the clock. */
export const COMMITMENT_STATUSES = ['pending', 'due_soon', 'overdue', 'completed', 'cancelled'] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

/** The ledger event types this face writes. Frozen. */
export const COMMITMENT_EVENT_TYPES = [
  'COMMITMENT_OPENED',
  'COMMITMENT_CLOSED',
  'COMMITMENT_SURFACED',
  'COMMITMENT_ASKED',
  'COMMITMENT_DISMISSED',
] as const;
export type CommitmentEventType = (typeof COMMITMENT_EVENT_TYPES)[number];

/** The face's methods. Frozen; adding one is additive, removing or renaming one is not. */
export const COMMITMENT_API_METHODS = [
  'compile',
  'list',
  'surfaceDue',
  'dueForAgent',
  'askOnce',
  'dismiss',
  'complete',
  'cancel',
  'audit',
] as const;

/** `CommitmentEntry`'s field set, frozen by the contract document. */
export const COMMITMENT_ENTRY_FIELDS = [
  'commitmentId',
  'owner',
  'agentId',
  'content',
  'dueAt',
  'dueCondition',
  'status',
  'confidence',
  'sourceRefs',
  'openedAt',
  'surfacedAt',
  'askedAt',
  'closedAt',
  'version',
] as const;

/** The refusals this face names, frozen. */
export const COMMITMENT_ERROR_CODES = [
  'project_id_required',
  'commitment_id_required',
  'commitment_unknown',
  'invalid_commitment_evidence',
  'invalid_limit',
] as const;
export type CommitmentErrorCode = (typeof COMMITMENT_ERROR_CODES)[number];

/** How long before a due instant the book calls it `due_soon`. Frozen. */
export const COMMITMENT_DUE_SOON_MS = 24 * 60 * 60 * 1000;
export const COMMITMENT_DEFAULT_LIMIT = 20;
export const COMMITMENT_MAX_LIMIT = 100;

export interface CommitmentEntry {
  commitmentId: string;
  owner: CommitmentOwner;
  /** The agent whose turn made an `agent` promise; absent when the ledger did not name one. */
  agentId?: string;
  content: string;
  dueAt?: number;
  dueCondition?: string;
  status: CommitmentStatus;
  confidence: CommitmentConfidence;
  sourceRefs: MemorySourceRef[];
  openedAt: number;
  surfacedAt?: number;
  askedAt?: number;
  closedAt?: number;
  version: number;
}

export interface CommitmentCompileInput {
  projectId: string;
  now?: number;
}

export interface CommitmentCompileResult {
  projectId: string;
  /** Rows appended this pass: a promise opened, a promise closed. */
  opened: number;
  closed: number;
  entries: number;
  compiledAt: number;
}

export interface CommitmentListInput {
  projectId: string;
  owner?: CommitmentOwner;
  statuses?: CommitmentStatus[];
  limit?: number;
  now?: number;
}

export interface CommitmentSurfacing {
  commitmentId: string;
  owner: CommitmentOwner;
  content: string;
  status: 'due_soon' | 'overdue';
  dueAt: number;
  reason: string;
  sourceRefs: MemorySourceRef[];
}

export interface CommitmentQuestion {
  commitmentId: string;
  question: string;
  sourceRefs: MemorySourceRef[];
}

export interface CommitmentAuditEntry {
  commitmentId: string;
  eventType: CommitmentEventType;
  payload: Record<string, unknown>;
  occurredAt: number;
}

export interface CommitmentBookPorts {
  events: EventStore;
}

interface BasePromise {
  commitmentId: string;
  owner: CommitmentOwner;
  agentId?: string;
  content: string;
  dueAt?: number;
  dueCondition?: string;
  confidence: CommitmentConfidence;
  sourceRefs: MemorySourceRef[];
  openedAt: number;
}

interface StoredCommitment {
  base?: BasePromise;
  closed?: { status: 'completed' | 'cancelled'; at: number; sourceRefs: MemorySourceRef[] };
  surfacedDueKey?: number;
  surfacedAt?: number;
  askedAt?: number;
  dismissedDueKey?: number;
  version: number;
}

interface DerivedCommitment extends BasePromise {
  closed?: { status: 'completed' | 'cancelled'; at: number; sourceRefs: MemorySourceRef[] };
  ambiguousEvidenceEventId?: string;
}

const MAX_TIME = 8_640_000_000_000_000;
const LEDGER_PAGE_SIZE = 500;
// ponytail: a project with more than 4000 commitment rows reads the newest 4000; page the rest or
// add an event_type index when a project has years of promises.
const MAX_COMMITMENT_ROWS = 4000;
const MAX_RAW_EVENTS = 4000;

function commitmentError(code: CommitmentErrorCode, detail?: string): Error {
  return new Error(detail ? `${code}: ${detail}` : code);
}

function requiredText(value: string | undefined, code: CommitmentErrorCode): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) throw commitmentError(code);
  return trimmed;
}

function commitmentIdOf(projectId: string, eventId: string, index: number): string {
  const digest = createHash('sha256').update(`${projectId}\u0000${eventId}\u0000${index}`).digest('hex').slice(0, 20);
  return `commitment-${digest}`;
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

function isOwner(value: unknown): value is CommitmentOwner {
  return (COMMITMENT_OWNERS as readonly string[]).includes(String(value));
}

function isOpenStatus(status: CommitmentStatus): status is 'pending' | 'due_soon' | 'overdue' {
  return status === 'pending' || status === 'due_soon' || status === 'overdue';
}

function statusOf(state: StoredCommitment, now: number): CommitmentStatus | null {
  const base = state.base;
  if (!base) return null;
  if (state.closed) return state.closed.status;
  if (base.dueAt === undefined) return 'pending';
  if (now > base.dueAt) return 'overdue';
  if (now >= base.dueAt - COMMITMENT_DUE_SOON_MS) return 'due_soon';
  return 'pending';
}

function toEntry(state: StoredCommitment, now: number): CommitmentEntry | null {
  const base = state.base;
  const status = statusOf(state, now);
  if (!base || !status) return null;
  return {
    commitmentId: base.commitmentId,
    owner: base.owner,
    agentId: base.agentId,
    content: base.content,
    dueAt: base.dueAt,
    dueCondition: base.dueCondition,
    status,
    confidence: base.confidence,
    // A closed entry carries the evidence that closed it, not only the turn that opened it.
    sourceRefs: [...(state.closed?.sourceRefs ?? base.sourceRefs)],
    openedAt: base.openedAt,
    surfacedAt: state.surfacedAt,
    askedAt: state.askedAt,
    closedAt: state.closed?.at,
    version: state.version,
  };
}

/** A promise is completed by its own speaker, or by a report naming the third party. */
function ownerMatches(owner: CommitmentOwner, event: MemoryEvent): boolean {
  const role = event.role;
  if (owner === 'user') return role === 'user';
  if (owner === 'agent') return role === 'assistant' || role === 'agent';
  return role === 'other' || role === 'user' || role === 'assistant';
}

export class CommitmentBook {
  private readonly events: EventStore;

  constructor(ports: CommitmentBookPorts) {
    this.events = ports.events;
  }

  /**
   * Incremental maintenance: re-derive from the raw turns and append only what is new. Called at a
   * turn boundary and at the DREAMING boundary alike; the second call with no new evidence is a
   * no-op.
   */
  compile(input: CommitmentCompileInput): CommitmentCompileResult {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const now = input.now ?? Date.now();
    const derived = this.derive(projectId);
    const stored = this.states(projectId);
    let opened = 0;
    let closed = 0;
    for (const promise of derived) {
      const state = stored.get(promise.commitmentId);
      if (!state?.base) {
        this.appendOpened(projectId, promise, now);
        opened += 1;
      }
      if (promise.closed && !state?.closed) {
        this.appendClosed(projectId, promise, promise.closed, now);
        closed += 1;
      }
    }
    return { projectId, opened, closed, entries: derived.length, compiledAt: now };
  }

  /** The visible book. `statuses` filters the derived status, not a stored one. */
  list(input: CommitmentListInput): CommitmentEntry[] {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const now = input.now ?? Date.now();
    const limit = this.limitOf(input.limit);
    const wanted = input.statuses ? new Set(input.statuses) : null;
    return this.entries(projectId, now)
      .filter((entry) => input.owner === undefined || entry.owner === input.owner)
      .filter((entry) => wanted === null || wanted.has(entry.status))
      .slice(0, limit);
  }

  /**
   * The commitments whose instant has arrived, announced once per due occurrence. This is a pull
   * query with one write: the `SURFACED` row is what makes a second query silent, so the once-only
   * rule survives a restart. Dismissing a reminder silences that occurrence too (F7's feedback
   * loop, read here as a book mark until F7 lands).
   */
  surfaceDue(input: { projectId: string; owner?: CommitmentOwner; now?: number; limit?: number }): CommitmentSurfacing[] {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const now = input.now ?? Date.now();
    const limit = this.limitOf(input.limit);
    const out: CommitmentSurfacing[] = [];
    for (const [commitmentId, state] of this.states(projectId)) {
      const entry = toEntry(state, now);
      if (!entry || !isOpenStatus(entry.status)) continue;
      if (entry.status !== 'due_soon' && entry.status !== 'overdue') continue;
      if (input.owner !== undefined && entry.owner !== input.owner) continue;
      const dueKey = entry.dueAt ?? 0;
      if (state.surfacedDueKey === dueKey || state.dismissedDueKey === dueKey) continue;
      this.appendMark(projectId, commitmentId, 'COMMITMENT_SURFACED', { dueKey, at: now }, now);
      state.surfacedDueKey = dueKey;
      state.surfacedAt = now;
      out.push({
        commitmentId,
        owner: entry.owner,
        content: entry.content,
        status: entry.status,
        dueAt: entry.dueAt!,
        reason: `due:${entry.status}:${entry.dueAt}`,
        sourceRefs: entry.sourceRefs,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * The agent's own due promises, for its wake assembly. A pure read: the session face consumes it
   * through F14's open-loop port, and reading the wake context must not consume the announce-once
   * mark.
   */
  dueForAgent(input: { projectId: string; agentId?: string; owner?: CommitmentOwner; now?: number; limit?: number }): CommitmentEntry[] {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const now = input.now ?? Date.now();
    const owner = input.owner ?? 'agent';
    const limit = this.limitOf(input.limit);
    const states = this.states(projectId);
    return this.entries(projectId, now)
      .filter((entry) => entry.owner === owner && isOpenStatus(entry.status) && entry.dueAt !== undefined)
      // A promise whose ledger names no agent is the single-agent case and stays visible; a named
      // one wakes only the agent that made it.
      .filter((entry) => !input.agentId || !entry.agentId || entry.agentId === input.agentId)
      .filter((entry) => {
        const state = states.get(entry.commitmentId);
        return !state || state.dismissedDueKey !== (entry.dueAt ?? 0);
      })
      .slice(0, limit);
  }

  /**
   * Ambiguous completion evidence gets exactly one question, ever. The `ASKED` row is the mark;
   * a second call returns nothing for that promise.
   */
  askOnce(input: { projectId: string; now?: number; limit?: number }): CommitmentQuestion[] {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const now = input.now ?? Date.now();
    const limit = this.limitOf(input.limit);
    const states = this.states(projectId);
    const out: CommitmentQuestion[] = [];
    for (const promise of this.derive(projectId)) {
      if (!promise.ambiguousEvidenceEventId || promise.closed) continue;
      const state = states.get(promise.commitmentId);
      if (!state?.base || state.closed || state.askedAt !== undefined) continue;
      const question = `「${promise.content}」这件事完成了吗？`;
      this.appendMark(projectId, promise.commitmentId, 'COMMITMENT_ASKED', { question, at: now }, now);
      state.askedAt = now;
      out.push({ commitmentId: promise.commitmentId, question, sourceRefs: promise.sourceRefs });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Silence one reminder for its current due instant. It stays in the book. */
  dismiss(input: { projectId: string; commitmentId: string; now?: number }): CommitmentEntry {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const commitmentId = requiredText(input.commitmentId, 'commitment_id_required');
    const now = input.now ?? Date.now();
    const state = this.states(projectId).get(commitmentId);
    const entry = state ? toEntry(state, now) : null;
    if (!entry) throw commitmentError('commitment_unknown', commitmentId);
    this.appendMark(projectId, commitmentId, 'COMMITMENT_DISMISSED', { dueKey: entry.dueAt ?? 0, at: now }, now);
    return entry;
  }

  /** Completion by the owner's word or by a recorded artifact. The evidence must be a real event. */
  complete(input: { projectId: string; commitmentId: string; evidenceEventId: string; now?: number }): CommitmentEntry {
    return this.close(input, 'completed');
  }

  /** Cancellation by the owner. Goes through the same closed state as completion. */
  cancel(input: { projectId: string; commitmentId: string; evidenceEventId: string; now?: number }): CommitmentEntry {
    return this.close(input, 'cancelled');
  }

  /** Every commitment row for the project, oldest first. */
  audit(input: { projectId: string; commitmentId?: string }): CommitmentAuditEntry[] {
    const projectId = requiredText(input.projectId, 'project_id_required');
    return this.loadProjectRows(projectId)
      .filter((row) => input.commitmentId === undefined || row.payload.commitmentId === input.commitmentId)
      .map((row) => ({
        commitmentId: String(row.payload.commitmentId ?? ''),
        eventType: row.event.eventType as CommitmentEventType,
        payload: row.payload,
        occurredAt: row.event.occurredAt,
      }));
  }

  private close(
    input: { projectId: string; commitmentId: string; evidenceEventId: string; now?: number },
    status: 'completed' | 'cancelled',
  ): CommitmentEntry {
    const projectId = requiredText(input.projectId, 'project_id_required');
    const commitmentId = requiredText(input.commitmentId, 'commitment_id_required');
    const evidenceEventId = requiredText(input.evidenceEventId, 'invalid_commitment_evidence');
    const now = input.now ?? Date.now();
    const state = this.states(projectId).get(commitmentId);
    if (!state?.base) throw commitmentError('commitment_unknown', commitmentId);
    const evidence = this.events.getEvent(evidenceEventId);
    if (!evidence || (evidence.projectId ?? '') !== projectId) {
      throw commitmentError('invalid_commitment_evidence', evidenceEventId);
    }
    if (state.closed) return toEntry(state, now)!;
    this.appendClosed(projectId, state.base, {
      status,
      at: now,
      sourceRefs: uniqRefs([...state.base.sourceRefs, refOf(evidence)]),
    }, now);
    state.closed = { status, at: now, sourceRefs: uniqRefs([...state.base.sourceRefs, refOf(evidence)]) };
    state.version += 1;
    return toEntry(state, now)!;
  }

  private entries(projectId: string, now: number): CommitmentEntry[] {
    const out: CommitmentEntry[] = [];
    for (const state of this.states(projectId).values()) {
      const entry = toEntry(state, now);
      if (entry) out.push(entry);
    }
    return out.sort((a, b) => (a.dueAt ?? MAX_TIME) - (b.dueAt ?? MAX_TIME) || b.openedAt - a.openedAt);
  }

  /**
   * Re-derive the book from the raw turns, in order. Closing is evaluated before opening, so a turn
   * that reports a finished promise cannot also be read as its opening.
   */
  private derive(projectId: string): DerivedCommitment[] {
    const derived: DerivedCommitment[] = [];
    const byId = new Map<string, DerivedCommitment>();
    for (const event of this.messageEvents(projectId)) {
      const text = textOf(event).trim();
      if (!text) continue;
      const completion = completionEvidence(text);
      if (completion) {
        for (const promise of derived) {
          if (promise.closed || !ownerMatches(promise.owner, event)) continue;
          if (!sharesCommitmentContent(promise.content, text)) continue;
          if (completion === 'completed') {
            promise.closed = {
              status: 'completed',
              at: event.occurredAt,
              sourceRefs: uniqRefs([...promise.sourceRefs, refOf(event)]),
            };
          } else if (!promise.closed) {
            promise.ambiguousEvidenceEventId = event.eventId;
          }
        }
      }
      const completes = metadataOf(event).completesCommitment;
      if (typeof completes === 'string') {
        const target = byId.get(completes);
        if (target && !target.closed) {
          target.closed = {
            status: 'completed',
            at: event.occurredAt,
            sourceRefs: uniqRefs([...target.sourceRefs, refOf(event)]),
          };
        }
      }
      const signals = recognizeCommitments({ text, role: event.role ?? 'user', occurredAt: event.occurredAt });
      signals.forEach((signal, index) => {
        const commitmentId = commitmentIdOf(projectId, event.eventId, index);
        if (byId.has(commitmentId)) return;
        const promise: DerivedCommitment = {
          commitmentId,
          owner: signal.owner,
          agentId: signal.owner === 'agent' ? agentIdOf(event) : undefined,
          content: signal.content,
          dueAt: signal.dueAt,
          dueCondition: signal.dueCondition,
          confidence: signal.confidence,
          sourceRefs: [refOf(event)],
          openedAt: event.occurredAt,
        };
        derived.push(promise);
        byId.set(commitmentId, promise);
      });
    }
    return derived;
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
        // An artifact row may close a promise by naming it, and that rule must see the row.
        || typeof metadataOf(event).completesCommitment === 'string')
      .slice(0, MAX_RAW_EVENTS);
  }

  private states(projectId: string): Map<string, StoredCommitment> {
    const states = new Map<string, StoredCommitment>();
    for (const row of this.loadProjectRows(projectId)) {
      const commitmentId = typeof row.payload.commitmentId === 'string' ? row.payload.commitmentId : '';
      if (!commitmentId) continue;
      const state = states.get(commitmentId) ?? { version: 0 };
      const eventType = row.event.eventType as CommitmentEventType;
      if (eventType === 'COMMITMENT_OPENED') {
        state.base = baseFromPayload(row.payload);
        state.version = Number(row.payload.version ?? state.version + 1);
      } else if (eventType === 'COMMITMENT_CLOSED') {
        state.closed = {
          status: row.payload.status === 'cancelled' ? 'cancelled' : 'completed',
          at: Number(row.payload.closedAt ?? row.event.occurredAt),
          sourceRefs: Array.isArray(row.payload.sourceRefs) ? row.payload.sourceRefs as MemorySourceRef[] : [],
        };
        state.version = Number(row.payload.version ?? state.version + 1);
      } else if (eventType === 'COMMITMENT_SURFACED') {
        state.surfacedDueKey = Number(row.payload.dueKey ?? 0);
        state.surfacedAt = Number(row.payload.at ?? row.event.occurredAt);
      } else if (eventType === 'COMMITMENT_ASKED') {
        state.askedAt = Number(row.payload.at ?? row.event.occurredAt);
      } else if (eventType === 'COMMITMENT_DISMISSED') {
        state.dismissedDueKey = Number(row.payload.dueKey ?? 0);
      }
      states.set(commitmentId, state);
    }
    return states;
  }

  private appendOpened(projectId: string, promise: DerivedCommitment, now: number): void {
    this.events.append({
      streamId: `commitment:${promise.commitmentId}`,
      streamType: 'system',
      eventType: 'COMMITMENT_OPENED',
      projectId,
      sourceId: 'commitment',
      occurredAt: now,
      payload: { ...promise, projectId, version: 1 },
    });
  }

  private appendClosed(
    projectId: string,
    promise: BasePromise,
    closed: { status: 'completed' | 'cancelled'; at: number; sourceRefs: MemorySourceRef[] },
    now: number,
  ): void {
    const version = (this.states(projectId).get(promise.commitmentId)?.version ?? 1) + 1;
    this.events.append({
      streamId: `commitment:${promise.commitmentId}`,
      streamType: 'system',
      eventType: 'COMMITMENT_CLOSED',
      projectId,
      sourceId: 'commitment',
      occurredAt: now,
      payload: {
        commitmentId: promise.commitmentId,
        projectId,
        status: closed.status,
        closedAt: closed.at,
        sourceRefs: closed.sourceRefs,
        version,
      },
    });
  }

  private appendMark(
    projectId: string,
    commitmentId: string,
    eventType: 'COMMITMENT_SURFACED' | 'COMMITMENT_ASKED' | 'COMMITMENT_DISMISSED',
    payload: Record<string, unknown>,
    now: number,
  ): void {
    this.events.append({
      streamId: `commitment:${commitmentId}`,
      streamType: 'system',
      eventType,
      projectId,
      sourceId: 'commitment',
      occurredAt: now,
      payload: { commitmentId, projectId, ...payload },
    });
  }

  private limitOf(value: number | undefined): number {
    const limit = value ?? COMMITMENT_DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0) throw commitmentError('invalid_limit', String(value));
    return Math.min(limit, COMMITMENT_MAX_LIMIT);
  }

  private loadProjectRows(projectId: string): Array<{ event: MemoryEvent; payload: Record<string, unknown> }> {
    const rows: Array<{ event: MemoryEvent; payload: Record<string, unknown> }> = [];
    const filters = { projectId: [projectId], eventType: [...COMMITMENT_EVENT_TYPES], order: 'asc' as const };
    for (let page = 1; rows.length < MAX_COMMITMENT_ROWS; page += 1) {
      const result = this.events.queryEvents(page, LEDGER_PAGE_SIZE, filters);
      if (result.records.length === 0) break;
      for (const event of result.records) rows.push({ event, payload: (event.payload ?? {}) as Record<string, unknown> });
      if (rows.length >= result.total) break;
    }
    return rows.slice(0, MAX_COMMITMENT_ROWS);
  }
}

function baseFromPayload(payload: Record<string, unknown>): BasePromise | undefined {
  const commitmentId = typeof payload.commitmentId === 'string' ? payload.commitmentId : '';
  const content = typeof payload.content === 'string' ? payload.content : '';
  if (!commitmentId || !content || !isOwner(payload.owner)) return undefined;
  return {
    commitmentId,
    owner: payload.owner,
    agentId: typeof payload.agentId === 'string' ? payload.agentId : undefined,
    content,
    dueAt: typeof payload.dueAt === 'number' ? payload.dueAt : undefined,
    dueCondition: typeof payload.dueCondition === 'string' ? payload.dueCondition : undefined,
    confidence: payload.confidence === 'tentative' ? 'tentative' : 'explicit',
    sourceRefs: Array.isArray(payload.sourceRefs) ? payload.sourceRefs as MemorySourceRef[] : [],
    openedAt: Number(payload.openedAt ?? 0),
  };
}
