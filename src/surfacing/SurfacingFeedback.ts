/**
 * Surfacing feedback (#161, F7): the owner's reaction to a surfaced candidate, and the
 * deterministic modulation it applies to the proactive channel.
 *
 * A reaction is a first-class ledger event on `surfacing-feedback:<projectId>`: `engaged`,
 * `ignored` or `stopped`. State is derived from those rows, the way F2 and F5 store their state —
 * **no table, no column, no migration**. The rules are fixed and call no model: consecutive
 * ignores raise a type's level, a level doubles the cooldown before that type may surface again,
 * a stop holds the type until the owner explicitly resumes it, and an engaged reaction clears the
 * counts so frequency can recover. The written contract is `docs/surfacing-feedback.md`, held by
 * `__tests__/surfacing-feedback.contract.test.ts`.
 */
import type { EventStore } from '../store/EventStore.js';
import type { MemoryEvent, MemorySourceRef } from '../types/index.js';
import type { SurfacingSource } from './SurfacingCandidates.js';

/** Bump when a field, type, outcome, rule or error meaning changes incompatibly. */
export const SURFACING_FEEDBACK_CONTRACT_VERSION = 1;

/**
 * The type dimension is F6's source dimension, frozen by the feedback contract. It is a literal
 * list rather than an import so this module stays free of a runtime cycle with the candidate
 * query; the contract test asserts it equals `SURFACING_SOURCES`.
 */
export const SURFACING_FEEDBACK_TYPES = ['wake-intention', 'prospective-memory', 'profile', 'procedure', 'commitment', 'ledger'] as const;

/** The owner's three reactions. Frozen. */
export const SURFACING_FEEDBACK_OUTCOMES = ['engaged', 'ignored', 'stopped'] as const;
export type SurfacingFeedbackOutcome = (typeof SURFACING_FEEDBACK_OUTCOMES)[number];

/** The ledger event types this face writes. Frozen. */
export const SURFACING_FEEDBACK_EVENT_TYPES = ['SURFACING_FEEDBACK_RECORDED', 'SURFACING_TYPE_RESUMED'] as const;
export type SurfacingFeedbackEventType = (typeof SURFACING_FEEDBACK_EVENT_TYPES)[number];

/** The face's methods. Frozen; adding one is additive, removing or renaming one is not. */
export const SURFACING_FEEDBACK_API_METHODS = ['record', 'state', 'resume', 'audit'] as const;

/**
 * The frozen rule parameters. `level` is `floor(consecutiveIgnored / ignoredThreshold)`, capped at
 * `maxLevel`; at level 1 or above the type is withheld until `lastIgnoredAt + baseCooldownMs ×
 * 2^(level - 1)`.
 */
export const SURFACING_FEEDBACK_RULES = {
  ignoredThreshold: 3,
  maxLevel: 3,
  baseCooldownMs: 6 * 60 * 60 * 1000,
} as const;

export const SURFACING_FEEDBACK_RULE_FIELDS = ['ignoredThreshold', 'maxLevel', 'baseCooldownMs'] as const;
export const SURFACING_FEEDBACK_EVENT_FIELDS = [
  'eventId',
  'projectId',
  'candidateId',
  'type',
  'outcome',
  'sourceRefs',
  'occurredAt',
] as const;
export const SURFACING_FEEDBACK_RESUME_FIELDS = ['eventId', 'projectId', 'type', 'occurredAt'] as const;
export const SURFACING_FEEDBACK_AUDIT_FIELDS = [
  'eventId',
  'eventType',
  'type',
  'candidateId',
  'outcome',
  'sourceRefs',
  'occurredAt',
] as const;
export const SURFACING_FEEDBACK_STATE_FIELDS = ['projectId', 'now', 'rules', 'types', 'stoppedTypes'] as const;
export const SURFACING_FEEDBACK_TYPE_FIELDS = [
  'type',
  'consecutiveIgnored',
  'level',
  'ignoredCount',
  'engagedCount',
  'stopped',
  'stoppedAt',
  'lastIgnoredAt',
  'cooldownUntil',
] as const;

/** The refusals this face names. Frozen. */
export const SURFACING_FEEDBACK_ERROR_CODES = [
  'project_id_required',
  'surfacing_candidate_id_required',
  'invalid_surfacing_feedback_type',
  'invalid_surfacing_feedback_outcome',
  'invalid_surfacing_feedback_now',
  'invalid_surfacing_feedback_source_refs',
] as const;
export type SurfacingFeedbackErrorCode = (typeof SURFACING_FEEDBACK_ERROR_CODES)[number];

export interface RecordSurfacingFeedbackInput {
  projectId: string;
  /** `surfacing:<type>:<sourceId>`; the type is the candidate's F6 source. */
  candidateId: string;
  outcome: SurfacingFeedbackOutcome;
  /** The candidate's source refs, carried into the event so the reaction is replayable. */
  sourceRefs?: MemorySourceRef[];
  now?: number;
}

export interface SurfacingFeedbackRecord {
  eventId: string;
  projectId: string;
  candidateId: string;
  type: SurfacingSource;
  outcome: SurfacingFeedbackOutcome;
  sourceRefs: MemorySourceRef[];
  occurredAt: number;
}

export interface ResumeSurfacingTypeInput {
  projectId: string;
  type: SurfacingSource;
  now?: number;
}

export interface SurfacingResumeRecord {
  eventId: string;
  projectId: string;
  type: SurfacingSource;
  occurredAt: number;
}

export interface SurfacingTypeState {
  type: SurfacingSource;
  /** Ignores since the last engaged reaction or resume. */
  consecutiveIgnored: number;
  /** `min(floor(consecutiveIgnored / ignoredThreshold), maxLevel)`. */
  level: number;
  /** Total ignores, for audit. */
  ignoredCount: number;
  /** Total engaged reactions, for audit. */
  engagedCount: number;
  stopped: boolean;
  stoppedAt: number | null;
  lastIgnoredAt: number | null;
  /** `lastIgnoredAt + baseCooldownMs × 2^(level - 1)`, or `null` at level 0. */
  cooldownUntil: number | null;
}

export interface SurfacingFeedbackState {
  projectId: string;
  now: number;
  rules: typeof SURFACING_FEEDBACK_RULES;
  /** Every type, zeroed when it has no feedback; no hidden state. */
  types: SurfacingTypeState[];
  stoppedTypes: SurfacingSource[];
}

export interface SurfacingFeedbackAuditEntry {
  eventId: string;
  eventType: SurfacingFeedbackEventType;
  type: SurfacingSource;
  candidateId?: string;
  outcome?: SurfacingFeedbackOutcome;
  sourceRefs: MemorySourceRef[];
  occurredAt: number;
}

export type SurfacingModulationOutcome = 'none' | 'throttled' | 'stopped' | 'not-applicable';

export interface SurfacingFeedbackPorts {
  events: EventStore;
}

const LEDGER_PAGE_SIZE = 500;
// ponytail: a project with more than 4000 feedback rows reads the newest 4000; page the rest or
// add an event_type index when a companion has years of them.
const MAX_FEEDBACK_ROWS = 4000;

function feedbackError(code: SurfacingFeedbackErrorCode, detail?: string): Error {
  return new Error(detail ? `${code}: ${detail}` : code);
}

function requireText(value: unknown, code: SurfacingFeedbackErrorCode): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw feedbackError(code);
  return text;
}

function isType(value: unknown): value is SurfacingSource {
  return (SURFACING_FEEDBACK_TYPES as readonly string[]).includes(String(value));
}

/** `surfacing:<type>:<sourceId>` → its type. The candidate id is the one classification input. */
function typeOfCandidate(candidateId: string): SurfacingSource {
  const [prefix, type, ...rest] = candidateId.split(':');
  if (prefix !== 'surfacing' || !isType(type) || rest.join(':').length === 0) {
    throw feedbackError('invalid_surfacing_feedback_type', candidateId);
  }
  return type;
}

function requireNow(value: unknown): number {
  const now = value ?? Date.now();
  if (typeof now !== 'number' || !Number.isFinite(now)) throw feedbackError('invalid_surfacing_feedback_now');
  return now;
}

function emptyTypeState(type: SurfacingSource): SurfacingTypeState {
  return {
    type,
    consecutiveIgnored: 0,
    level: 0,
    ignoredCount: 0,
    engagedCount: 0,
    stopped: false,
    stoppedAt: null,
    lastIgnoredAt: null,
    cooldownUntil: null,
  };
}

/** The one place the modulation rule is read. Deterministic; no clock, no model. */
export function surfacingModulationOutcome(typeState: SurfacingTypeState, now: number): SurfacingModulationOutcome {
  if (typeState.stopped) return 'stopped';
  if (typeState.cooldownUntil !== null && now < typeState.cooldownUntil) return 'throttled';
  return 'none';
}

export class SurfacingFeedback {
  private readonly events: EventStore;

  constructor(ports: SurfacingFeedbackPorts) {
    this.events = ports.events;
  }

  /** Record one owner reaction as a ledger row. `sourceRefs` ride along so it can be replayed. */
  record(input: RecordSurfacingFeedbackInput): SurfacingFeedbackRecord {
    const projectId = requireText(input.projectId, 'project_id_required');
    const candidateId = requireText(input.candidateId, 'surfacing_candidate_id_required');
    const type = typeOfCandidate(candidateId);
    if (!(SURFACING_FEEDBACK_OUTCOMES as readonly unknown[]).includes(input.outcome)) {
      throw feedbackError('invalid_surfacing_feedback_outcome', String(input.outcome));
    }
    if (input.sourceRefs !== undefined && !Array.isArray(input.sourceRefs)) {
      throw feedbackError('invalid_surfacing_feedback_source_refs');
    }
    const now = requireNow(input.now);
    const sourceRefs = input.sourceRefs ?? [];
    const event = this.events.append({
      streamId: `surfacing-feedback:${projectId}`,
      streamType: 'system',
      eventType: 'SURFACING_FEEDBACK_RECORDED',
      projectId,
      sourceId: 'surfacing-feedback',
      occurredAt: now,
      payload: { projectId, candidateId, type, outcome: input.outcome, sourceRefs, occurredAt: now },
    });
    return { eventId: event.eventId, projectId, candidateId, type, outcome: input.outcome, sourceRefs, occurredAt: now };
  }

  /** The owner explicitly restarts a stopped type: the only way out of a stop. */
  resume(input: ResumeSurfacingTypeInput): SurfacingResumeRecord {
    const projectId = requireText(input.projectId, 'project_id_required');
    if (!isType(input.type)) throw feedbackError('invalid_surfacing_feedback_type', String(input.type));
    const now = requireNow(input.now);
    const event = this.events.append({
      streamId: `surfacing-feedback:${projectId}`,
      streamType: 'system',
      eventType: 'SURFACING_TYPE_RESUMED',
      projectId,
      sourceId: 'surfacing-feedback',
      occurredAt: now,
      payload: { projectId, type: input.type, occurredAt: now },
    });
    return { eventId: event.eventId, projectId, type: input.type, occurredAt: now };
  }

  /** Every type's counts and current level, derived from the ledger at an injected instant. */
  state(input: { projectId: string; now?: number }): SurfacingFeedbackState {
    const projectId = requireText(input.projectId, 'project_id_required');
    const now = requireNow(input.now);
    const types = new Map<SurfacingSource, SurfacingTypeState>(
      SURFACING_FEEDBACK_TYPES.map((type) => [type, emptyTypeState(type)]),
    );
    for (const row of this.loadRows(projectId)) {
      const type = row.type;
      if (!type) continue;
      const entry = types.get(type);
      if (!entry) continue;
      if (row.eventType === 'SURFACING_TYPE_RESUMED') {
        entry.stopped = false;
        entry.stoppedAt = null;
        entry.consecutiveIgnored = 0;
        entry.lastIgnoredAt = null;
        continue;
      }
      if (row.outcome === 'engaged') {
        entry.engagedCount += 1;
        entry.consecutiveIgnored = 0;
        entry.lastIgnoredAt = null;
      } else if (row.outcome === 'ignored') {
        entry.ignoredCount += 1;
        entry.consecutiveIgnored += 1;
        entry.lastIgnoredAt = row.occurredAt;
      } else if (row.outcome === 'stopped') {
        entry.stopped = true;
        entry.stoppedAt = row.occurredAt;
      }
    }
    const out: SurfacingTypeState[] = [];
    for (const entry of types.values()) {
      entry.level = Math.min(
        Math.floor(entry.consecutiveIgnored / SURFACING_FEEDBACK_RULES.ignoredThreshold),
        SURFACING_FEEDBACK_RULES.maxLevel,
      );
      entry.cooldownUntil = entry.level > 0 && entry.lastIgnoredAt !== null
        ? entry.lastIgnoredAt + SURFACING_FEEDBACK_RULES.baseCooldownMs * 2 ** (entry.level - 1)
        : null;
      out.push(entry);
    }
    return {
      projectId,
      now,
      rules: SURFACING_FEEDBACK_RULES,
      types: out,
      stoppedTypes: out.filter((entry) => entry.stopped).map((entry) => entry.type),
    };
  }

  /** Every feedback and resume row for the project, oldest first: the audit and replay source. */
  audit(input: { projectId: string }): SurfacingFeedbackAuditEntry[] {
    const projectId = requireText(input.projectId, 'project_id_required');
    return this.loadRows(projectId).filter((row) => row.type !== null).map((row) => ({
      eventId: row.eventId,
      eventType: row.eventType,
      type: row.type!,
      ...(row.candidateId !== undefined ? { candidateId: row.candidateId } : {}),
      ...(row.outcome !== undefined ? { outcome: row.outcome } : {}),
      sourceRefs: row.sourceRefs,
      occurredAt: row.occurredAt,
    }));
  }

  private loadRows(projectId: string): Array<{
    eventId: string;
    eventType: SurfacingFeedbackEventType;
    type: SurfacingSource | null;
    candidateId?: string;
    outcome?: SurfacingFeedbackOutcome;
    sourceRefs: MemorySourceRef[];
    occurredAt: number;
  }> {
    const rows: Array<{
      eventId: string;
      eventType: SurfacingFeedbackEventType;
      type: SurfacingSource | null;
      candidateId?: string;
      outcome?: SurfacingFeedbackOutcome;
      sourceRefs: MemorySourceRef[];
      occurredAt: number;
    }> = [];
    const filters = {
      projectId: [projectId],
      eventType: [...SURFACING_FEEDBACK_EVENT_TYPES] as MemoryEvent['eventType'][],
      order: 'asc' as const,
    };
    for (let page = 1; rows.length < MAX_FEEDBACK_ROWS; page += 1) {
      const result = this.events.queryEvents(page, LEDGER_PAGE_SIZE, filters);
      if (result.records.length === 0) break;
      for (const event of result.records) rows.push(rowOf(event));
      if (rows.length >= result.total) break;
    }
    return rows.slice(0, MAX_FEEDBACK_ROWS);
  }
}

function rowOf(event: MemoryEvent): {
  eventId: string;
  eventType: SurfacingFeedbackEventType;
  type: SurfacingSource | null;
  candidateId?: string;
  outcome?: SurfacingFeedbackOutcome;
  sourceRefs: MemorySourceRef[];
  occurredAt: number;
} {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const type = isType(payload.type) ? payload.type : null;
  const outcome = (SURFACING_FEEDBACK_OUTCOMES as readonly unknown[]).includes(payload.outcome)
    ? payload.outcome as SurfacingFeedbackOutcome
    : undefined;
  return {
    eventId: event.eventId,
    eventType: event.eventType as SurfacingFeedbackEventType,
    type,
    candidateId: typeof payload.candidateId === 'string' ? payload.candidateId : undefined,
    outcome,
    sourceRefs: Array.isArray(payload.sourceRefs) ? payload.sourceRefs as MemorySourceRef[] : [],
    occurredAt: event.occurredAt,
  };
}
