/**
 * Time perception, shell-side until F2 (#156) lands the kernel version.
 *
 * Waking injects a time context block; the companion's next wake intent is persistent runtime state
 * (the state machine's checkpoint), not a kernel row — the kernel has prospective memories with a
 * `dueAt`, but no wake-intent registration, no due-time event and no time-context builder. Probing
 * that boundary is part of this stage; the gaps are recorded in `probes/gaps.ts`.
 */
import type { StateMachine } from '../state/machine.ts';
import { isUpgradePromise } from '../upgrade/records.ts';
import type { WakeIntent } from '../state/checkpoint.ts';
import type { NativePlugin } from './host.ts';

export interface ClockConfig {
  timeZone: string;
  idleWakeIntervalMs: number;
  dreamWindow: { startHour: number; endHour: number };
}

export interface TimeContext {
  now: number;
  iso: string;
  timeZone: string;
  localDate: string;
  weekday: string;
  hour: number;
  dayPart: 'morning' | 'afternoon' | 'evening' | 'night';
  lastInteractionAt?: number;
  silentForMs?: number;
  nextWakeAt?: number;
  nextWakeReason?: string;
}

export class ClockService {
  constructor(private readonly machine: StateMachine, private readonly config: ClockConfig, private clock: () => number = Date.now) {}

  now(): number {
    return this.clock();
  }

  localDate(at = this.now()): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
  }

  timeContext(at = this.now()): TimeContext {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: this.config.timeZone, hour: '2-digit', hour12: false, weekday: 'short' }).formatToParts(new Date(at));
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
    const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
    const dayPart = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : hour < 23 ? 'evening' : 'night';
    const runtime = this.machine.runtime;
    const next = this.nextPendingIntent();
    return {
      now: at,
      iso: new Date(at).toISOString(),
      timeZone: this.config.timeZone,
      localDate: this.localDate(at),
      weekday,
      hour,
      dayPart,
      lastInteractionAt: runtime.lastInteractionAt,
      silentForMs: runtime.lastInteractionAt === undefined ? undefined : Math.max(0, at - runtime.lastInteractionAt),
      nextWakeAt: next?.at,
      nextWakeReason: next?.reason,
    };
  }

  /** The block the model sees in place of "I do not know what time it is". */
  timeContextBlock(at = this.now()): string {
    const context = this.timeContext(at);
    const silence = context.silentForMs === undefined ? 'no recorded contact yet' : formatDuration(context.silentForMs);
    const next = context.nextWakeAt === undefined ? 'none scheduled' : `${new Date(context.nextWakeAt).toISOString()} (${context.nextWakeReason})`;
    return [
      '<time-context>',
      `now: ${context.iso} (${context.timeZone}, ${context.weekday} ${context.dayPart})`,
      `local date: ${context.localDate}`,
      `since last contact: ${silence}`,
      `next wake intent: ${next}`,
      '</time-context>',
    ].join('\n');
  }

  markInteraction(text: string, at = this.now()): void {
    this.machine.updateRuntime({ lastInteractionAt: at, lastInteractionText: text.slice(0, 500) });
  }

  setWakeIntent(at: number, reason: string): WakeIntent {
    return this.machine.addWakeIntent({ at, reason });
  }

  /** Persist the next wake even when nothing else does: standby is not a heartbeat, it is an intent. */
  scheduleIdleWake(reason = 'idle_checkin'): WakeIntent {
    const pending = this.nextPendingIntent();
    if (pending) return pending;
    return this.setWakeIntent(this.now() + this.config.idleWakeIntervalMs, reason);
  }

  nextPendingIntent(): WakeIntent | undefined {
    return this.machine.wakeIntents.filter((intent) => !intent.consumedAt).sort((a, b) => a.at - b.at)[0];
  }

  dueWakeIntent(at = this.now()): WakeIntent | undefined {
    // `StateMachine.dueWakeIntent` with one exclusion: the upgrade's report promise (#165) is settled
    // by the upgrade path itself, and firing it as an idle wake would consume the obligation without
    // ever speaking the report it exists for. Same order (`wakeIntents` order), same selection.
    return this.machine.wakeIntents.find((intent) => !intent.consumedAt && intent.at <= at && !isUpgradePromise(intent.reason));
  }

  consumeWakeIntent(id: string): void {
    this.machine.consumeWakeIntent(id);
  }

  dreamWindowOpen(at = this.now()): boolean {
    const hour = this.timeContext(at).hour;
    const { startHour, endHour } = this.config.dreamWindow;
    return hour >= startHour && hour < endHour;
  }

  dreamedToday(at = this.now()): boolean {
    return this.machine.runtime.lastDreamDate === this.localDate(at);
  }

  markDreamed(at = this.now()): void {
    this.machine.updateRuntime({ lastDreamDate: this.localDate(at) });
  }
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hours`;
  return `${Math.round(hours / 24)} days`;
}

export function clockPlugin(config: ClockConfig): NativePlugin {
  return {
    name: 'clock',
    provide: ['clock'],
    apply(ctx) {
      const machine = ctx.getService<StateMachine>('stateMachine');
      ctx.provide('clock', new ClockService(machine, config));
    },
  };
}
