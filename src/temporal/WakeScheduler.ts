/**
 * The wake tick: what the kernel does when its clock moves, and nothing else (F2 of #156).
 *
 * It fires the self-set wake intentions whose instant arrived and announces every prospective
 * memory that just came due. Both leave as `prospective-due` events on the F1 stream — the kernel's
 * scheduler emits an event and never speaks, so the shell decides what a due thing means. It also
 * answers `nextWakeAt`, which is the whole anti-heartbeat story: a base timer that has nothing due
 * gets `null` and sleeps, instead of a fixed interval of indiscriminate wake-ups.
 *
 * It holds no timer and calls no clock. `now` is a parameter, so a test drives a month of behaviour
 * in milliseconds.
 */

import type { KernelEventStream } from '../events/index.js';
import type { ProspectiveMemoryRecord, ProspectiveMemoryStatus } from '../prospective/index.js';
import type { DreamWindow, DreamWindowEvaluation } from './TimeAwareness.js';
import { evaluateDreamWindow } from './TimeAwareness.js';
import type { WakeIntention, WakeIntentionService } from './WakeIntentionService.js';

export interface ProspectiveDueSource {
  listDue(input: { projectId: string; atTime?: number; limit?: number; excludeNotified?: boolean }): ProspectiveMemoryRecord[];
  list(input: { projectId: string; statuses?: ProspectiveMemoryStatus[]; limit?: number; excludeNotified?: boolean }): ProspectiveMemoryRecord[];
  /** Append the ledger's "announced" marker for this due instant (#213). Nothing else changes. */
  markNotified(candidateId: string, projectId: string, now: number): void;
}

export interface WakeTickInput {
  projectId: string;
  now: number;
  agentId?: string;
  /** The shell's dream window, evaluated but never decided on here. */
  dreamWindow?: DreamWindow;
  /** The project timezone, used to evaluate `dreamWindow`. Defaults to UTC. */
  timeZone?: string;
  prospectiveLimit?: number;
}

export interface WakeTickResult {
  now: number;
  firedWakeIntentions: WakeIntention[];
  prospectiveDue: Array<{ candidateId: string; candidateType: string; status: string; dueAt: number }>;
  /** `prospective-due` events emitted this tick. Zero means the clock moved and nothing was due. */
  emitted: number;
  dreamWindow?: DreamWindowEvaluation;
  /** The instant the shell should next wake for, or `null` when there is nothing to wake for. */
  nextWakeAt: number | null;
}

export interface WakeSchedulerDeps {
  events: KernelEventStream;
  wakeIntentions: WakeIntentionService;
  prospectiveMemories: ProspectiveDueSource;
}

/**
 * A prospective memory is a commitment only once confirmed; a pending candidate is not yet the
 * owner's, so it is neither an anchor nor a reason to wake.
 */
const PROSPECTIVE_ANCHOR_STATUSES: readonly ProspectiveMemoryStatus[] = ['confirmed', 'deferred'];

export class WakeScheduler {
  constructor(private readonly deps: WakeSchedulerDeps) {}

  tick(input: WakeTickInput): WakeTickResult {
    const firedWakeIntentions = this.deps.wakeIntentions.claimDue({
      projectId: input.projectId,
      agentId: input.agentId,
      now: input.now,
    });
    for (const intention of firedWakeIntentions) {
      this.deps.events.emit({
        type: 'prospective-due',
        at: input.now,
        projectId: input.projectId,
        agentIds: [intention.agentId],
        payload: {
          kind: 'wake-intention',
          intentionId: intention.intentionId,
          agentId: intention.agentId,
          dueAt: intention.at,
          firedAt: intention.firedAt,
          missedByMs: intention.missedByMs ?? 0,
          reason: intention.reason,
        },
      });
    }

    const prospectiveDue: WakeTickResult['prospectiveDue'] = [];
    for (const memory of this.deps.prospectiveMemories.listDue({
      projectId: input.projectId,
      atTime: input.now,
      limit: input.prospectiveLimit ?? 20,
      excludeNotified: true,
    })) {
      const dueAt = effectiveDueAt(memory);
      if (dueAt === undefined) continue;
      // The marker is the ledger row, not a process-local Set, and it is claimed before the event
      // leaves — the same order the wake-intention FIRED row uses, so a crash mid-emit replays
      // rather than drops (#213).
      this.deps.prospectiveMemories.markNotified(memory.candidateId, input.projectId, input.now);
      prospectiveDue.push({ candidateId: memory.candidateId, candidateType: memory.candidateType, status: memory.status, dueAt });
      this.deps.events.emit({
        type: 'prospective-due',
        at: input.now,
        projectId: input.projectId,
        payload: {
          kind: 'prospective-memory',
          candidateId: memory.candidateId,
          candidateType: memory.candidateType,
          status: memory.status,
          dueAt,
        },
      });
    }

    const dreamWindow = input.dreamWindow
      ? evaluateDreamWindow({ now: input.now, timeZone: input.timeZone ?? 'UTC', window: input.dreamWindow })
      : undefined;

    return {
      now: input.now,
      firedWakeIntentions,
      prospectiveDue,
      emitted: firedWakeIntentions.length + prospectiveDue.length,
      dreamWindow,
      nextWakeAt: this.nextWakeAt({ projectId: input.projectId, agentId: input.agentId, now: input.now }),
    };
  }

  /**
   * The earliest instant at or after `now` that has something waiting, or `null`.
   *
   * A pending intention whose instant already passed answers `now`: the caller should be awake
   * already, not asleep until tomorrow. Nothing pending anywhere — the normal state of a companion
   * with no intention registered — answers `null`, which is what lets a base timer stop polling.
   * An announced-but-overdue memory is not a reason to wake again, or the timer would answer `now`
   * forever; it stays an anchor in the context block, where the fact is still true (#213).
   */
  nextWakeAt(input: { projectId: string; agentId?: string; now: number }): number | null {
    const instants: number[] = [];
    for (const intention of this.deps.wakeIntentions.list({ projectId: input.projectId, agentId: input.agentId, statuses: ['pending'] })) {
      instants.push(intention.at);
    }
    for (const memory of this.deps.prospectiveMemories.list({
      projectId: input.projectId, statuses: [...PROSPECTIVE_ANCHOR_STATUSES], excludeNotified: true,
    })) {
      const dueAt = effectiveDueAt(memory);
      if (dueAt !== undefined) instants.push(dueAt);
    }
    if (instants.length === 0) return null;
    const earliest = Math.min(...instants);
    return Math.max(input.now, earliest);
  }
}

function effectiveDueAt(memory: ProspectiveMemoryRecord): number | undefined {
  if (memory.status === 'deferred') return memory.deferredUntil;
  return memory.dueAt;
}
