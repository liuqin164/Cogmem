/**
 * Wake intentions: the agent's own "wake me at T because R, about X" (F2 of #156).
 *
 * A wake intention is a first-class ledger record, not a config value and not a scratch table. Its
 * whole lifecycle — set, cancelled, fired — is immutable rows in `memory_events`, so the audit is
 * the ledger, "fire once" is "no fired row exists yet", and a restart cannot forget either. The
 * record carries `sourceRefs` because it is the intention tier's first artifact and names what it
 * is about.
 *
 * Ledger rows are the state; this service only reads them and appends the next transition. It holds
 * no `Date.now()` and no timer — every call takes the instant from its caller.
 */

import { randomUUID } from 'node:crypto';

import type { EventStore } from '../store/EventStore.js';
import type { MemoryEvent, MemorySourceRef } from '../types/index.js';

export const WAKE_INTENTION_EVENT_TYPES = [
  'WAKE_INTENTION_SET',
  'WAKE_INTENTION_CANCELLED',
  'WAKE_INTENTION_FIRED',
] as const;
export type WakeIntentionEventType = (typeof WAKE_INTENTION_EVENT_TYPES)[number];

export const WAKE_INTENTION_STATUSES = ['pending', 'fired', 'cancelled'] as const;
export type WakeIntentionStatus = (typeof WAKE_INTENTION_STATUSES)[number];

/** One ledger row in an intention's audit, in the order it was written. */
export interface WakeIntentionAuditEntry {
  intentionId: string;
  projectId?: string;
  agentId?: string;
  eventType: WakeIntentionEventType;
  at: number;
  payload: Record<string, unknown>;
}

export interface WakeIntention {
  intentionId: string;
  projectId: string;
  agentId: string;
  /** The instant the agent asked to be woken at. */
  at: number;
  reason: string;
  sourceRefs: MemorySourceRef[];
  registeredAt: number;
  status: WakeIntentionStatus;
  firedAt?: number;
  cancelledAt?: number;
  /** How late the fire was: `firedAt - at`, 0 when it was on time. */
  missedByMs?: number;
}

export interface RegisterWakeIntentionInput {
  projectId: string;
  agentId: string;
  at: number;
  reason: string;
  sourceRefs: MemorySourceRef[];
  now: number;
  intentionId?: string;
}

export interface WakeIntentionListInput {
  projectId: string;
  agentId?: string;
  statuses?: readonly WakeIntentionStatus[];
}

export interface ClaimDueWakeIntentionsInput {
  projectId: string;
  agentId?: string;
  now: number;
  limit?: number;
}

/** The most intention rows one read walks; beyond it the caller pages, the way the ledger reads do. */
const MAX_INTENTION_LEDGER_ROWS = 2000;
const LEDGER_PAGE_SIZE = 500;

export class WakeIntentionService {
  constructor(private readonly eventStore: EventStore) {}

  /**
   * Register a wake intention. The next wake instant, the reason, and at least one reference to
   * what it is about are all required: an intention that names nothing is a heartbeat, which is the
   * thing this whole face exists to replace.
   */
  register(input: RegisterWakeIntentionInput): WakeIntention {
    const projectId = requireNonEmpty(input.projectId, 'project_id_required');
    const agentId = requireNonEmpty(input.agentId, 'agent_id_required');
    const reason = requireNonEmpty(input.reason, 'wake_intention_reason_required');
    if (!Number.isFinite(input.at)) throw new Error('invalid_wake_intention_at');
    if (!Number.isFinite(input.now)) throw new Error('invalid_wake_intention_now');
    if (!Array.isArray(input.sourceRefs) || input.sourceRefs.length === 0) throw new Error('wake_intention_source_refs_required');
    for (const ref of input.sourceRefs) {
      if (!ref || typeof ref !== 'object') throw new Error('invalid_wake_intention_source_ref');
    }
    const intentionId = input.intentionId?.trim() || `wake-${randomUUID()}`;
    const existing = this.get(intentionId, projectId);
    if (existing) throw new Error(`wake_intention_already_exists:${intentionId}`);

    this.append(intentionId, {
      eventType: 'WAKE_INTENTION_SET',
      projectId,
      agentId,
      now: input.now,
      payload: {
        intentionId,
        projectId,
        agentId,
        at: input.at,
        reason,
        sourceRefs: input.sourceRefs,
        registeredAt: input.now,
      },
    });
    return this.get(intentionId, projectId)!;
  }

  /** Cancel a pending intention. Cancelling an already-cancelled one is a no-op; a fired one cannot be undone. */
  cancel(intentionId: string, input: { projectId: string; now: number; reason?: string }): WakeIntention {
    const projectId = requireNonEmpty(input.projectId, 'project_id_required');
    const current = this.get(intentionId, projectId);
    if (!current) throw new Error(`wake_intention_not_found:${intentionId}`);
    if (current.status === 'cancelled') return current;
    if (current.status === 'fired') throw new Error(`wake_intention_already_fired:${intentionId}`);
    this.append(intentionId, {
      eventType: 'WAKE_INTENTION_CANCELLED',
      projectId,
      agentId: current.agentId,
      now: input.now,
      payload: {
        intentionId,
        cancelledAt: input.now,
        ...(input.reason ? { reason: input.reason } : {}),
      },
    });
    return this.get(intentionId, projectId)!;
  }

  get(intentionId: string, projectId?: string): WakeIntention | null {
    const rows = this.eventStore.getEventsByStreamId(streamIdOf(intentionId), projectId);
    return deriveIntention(rows);
  }

  list(input: WakeIntentionListInput): WakeIntention[] {
    const projectId = requireNonEmpty(input.projectId, 'project_id_required');
    const statuses = input.statuses;
    return this.loadProjectIntents(projectId)
      .filter((intention) => input.agentId === undefined || intention.agentId === input.agentId)
      .filter((intention) => !statuses || statuses.includes(intention.status));
  }

  /** Every transition row, oldest first. The audit is the ledger itself, not a derived summary. */
  audit(input: { projectId: string; intentionId?: string; agentId?: string }): WakeIntentionAuditEntry[] {
    const projectId = requireNonEmpty(input.projectId, 'project_id_required');
    const rows = input.intentionId
      ? this.eventStore.getEventsByStreamId(streamIdOf(input.intentionId), projectId)
      : this.loadProjectIntentionEvents(projectId);
    return rows
      .filter((event) => WAKE_INTENTION_EVENT_TYPES.includes(event.eventType as WakeIntentionEventType))
      .filter((event) => input.agentId === undefined || (event.payload as { agentId?: string }).agentId === input.agentId)
      .map((event) => {
        const payload = (event.payload ?? {}) as Record<string, unknown>;
        return {
          intentionId: typeof payload.intentionId === 'string' ? payload.intentionId : intentionIdOfStream(event.streamId),
          projectId: event.projectId,
          agentId: typeof payload.agentId === 'string' ? payload.agentId : undefined,
          eventType: event.eventType as WakeIntentionEventType,
          at: event.occurredAt,
          payload,
        };
      });
  }

  /**
   * Claim every pending intention whose instant has arrived, marking each fired in the same ledger
   * append that proves it. Calling this twice with the same `now` fires nothing the second time:
   * the fired row is the once-only guard, and it survives a restart.
   */
  claimDue(input: ClaimDueWakeIntentionsInput): WakeIntention[] {
    const projectId = requireNonEmpty(input.projectId, 'project_id_required');
    if (!Number.isFinite(input.now)) throw new Error('invalid_wake_intention_now');
    const limit = Math.max(1, Math.min(500, Math.trunc(input.limit ?? 50)));
    const due = this.list({ projectId, agentId: input.agentId, statuses: ['pending'] })
      .filter((intention) => intention.at <= input.now)
      .sort((a, b) => a.at - b.at || a.registeredAt - b.registeredAt || a.intentionId.localeCompare(b.intentionId))
      .slice(0, limit);
    const fired: WakeIntention[] = [];
    for (const intention of due) {
      this.append(intention.intentionId, {
        eventType: 'WAKE_INTENTION_FIRED',
        projectId,
        agentId: intention.agentId,
        now: input.now,
        payload: {
          intentionId: intention.intentionId,
          dueAt: intention.at,
          firedAt: input.now,
          missedByMs: Math.max(0, input.now - intention.at),
        },
      });
      const next = this.get(intention.intentionId, projectId);
      if (next) fired.push(next);
    }
    return fired;
  }

  private append(
    intentionId: string,
    input: { eventType: WakeIntentionEventType; projectId: string; agentId: string; now: number; payload: Record<string, unknown> },
  ): MemoryEvent {
    return this.eventStore.append({
      streamId: streamIdOf(intentionId),
      streamType: 'system',
      eventType: input.eventType,
      projectId: input.projectId,
      sourceId: input.agentId,
      occurredAt: input.now,
      payload: {
        ...input.payload,
        // The scope rule reads a name from the payload's metadata, and the event stream's agent
        // dimension reads the same metadata, so one field keeps both faces scoped to the agent.
        metadata: { sourceAgent: input.agentId, tags: [`agent:${input.agentId}`] },
      },
    });
  }

  private loadProjectIntents(projectId: string): WakeIntention[] {
    const byStream = new Map<string, MemoryEvent[]>();
    for (const event of this.loadProjectIntentionEvents(projectId)) {
      const rows = byStream.get(event.streamId) ?? [];
      rows.push(event);
      byStream.set(event.streamId, rows);
    }
    return Array.from(byStream.values())
      .map((rows) => deriveIntention(rows))
      .filter((intention): intention is WakeIntention => intention !== null);
  }

  private loadProjectIntentionEvents(projectId: string): MemoryEvent[] {
    const eventTypes = [...WAKE_INTENTION_EVENT_TYPES];
    const filters = { projectId: [projectId], eventType: eventTypes, order: 'asc' as const };
    const rows: MemoryEvent[] = [];
    for (let page = 1; rows.length < MAX_INTENTION_LEDGER_ROWS; page += 1) {
      const result = this.eventStore.queryEvents(page, LEDGER_PAGE_SIZE, filters);
      rows.push(...result.records);
      if (result.records.length === 0 || rows.length >= result.total) break;
    }
    // ponytail: a project with more than 2000 intention rows reads the newest 2000; page the rest
    // or add an index on event_type when a companion has years of them.
    return rows.slice(0, MAX_INTENTION_LEDGER_ROWS);
  }
}

function streamIdOf(intentionId: string): string {
  return `wake-intention:${intentionId}`;
}

function intentionIdOfStream(streamId: string): string {
  return streamId.startsWith('wake-intention:') ? streamId.slice('wake-intention:'.length) : streamId;
}

/** Fold one intention's transition rows into its current state. Rows must be oldest first. */
function deriveIntention(rows: MemoryEvent[]): WakeIntention | null {
  let intention: WakeIntention | null = null;
  for (const event of rows) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (event.eventType === 'WAKE_INTENTION_SET') {
      intention = {
        intentionId: typeof payload.intentionId === 'string' ? payload.intentionId : intentionIdOfStream(event.streamId),
        projectId: typeof payload.projectId === 'string' ? payload.projectId : event.projectId ?? '',
        agentId: typeof payload.agentId === 'string' ? payload.agentId : '',
        at: Number(payload.at),
        reason: typeof payload.reason === 'string' ? payload.reason : '',
        sourceRefs: Array.isArray(payload.sourceRefs) ? payload.sourceRefs as MemorySourceRef[] : [],
        registeredAt: Number(payload.registeredAt ?? event.occurredAt),
        status: 'pending',
      };
    } else if (event.eventType === 'WAKE_INTENTION_CANCELLED' && intention) {
      intention.status = 'cancelled';
      intention.cancelledAt = Number(payload.cancelledAt ?? event.occurredAt);
    } else if (event.eventType === 'WAKE_INTENTION_FIRED' && intention) {
      intention.status = 'fired';
      intention.firedAt = Number(payload.firedAt ?? event.occurredAt);
      intention.missedByMs = Number(payload.missedByMs ?? 0);
    }
  }
  return intention;
}

function requireNonEmpty(value: string, error: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(error);
  return normalized;
}
