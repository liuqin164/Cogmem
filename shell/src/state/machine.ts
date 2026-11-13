/**
 * The one place the lifecycle state changes.
 *
 * A transition is looked up in the table; a trigger with no edge throws `IllegalTransitionError` and
 * leaves a trace. The checkpoint is written *before* the in-memory state changes, so a failed write
 * halts the machine with the old state rather than continuing from a state the disk never saw.
 */
import { IllegalTransitionError, nextState, type State, type Trigger } from './table.ts';
import {
  CheckpointStore,
  CheckpointWriteError,
  emptyCheckpoint,
  type CheckpointState,
  type ShellRuntimeState,
  type TransitionRecord,
  type WakeIntent,
} from './checkpoint.ts';
import { TraceLog } from '../trace.ts';

export interface DispatchContext {
  reason?: string;
  runId?: string;
  now?: number;
}

export interface StateMachineOptions {
  checkpoint: CheckpointStore;
  trace: TraceLog;
  clock?: () => number;
  /** Called when a checkpoint write fails; the CLI turns this into a non-zero exit. */
  onAlarm?: (error: CheckpointWriteError) => void;
}

export class StateMachineHaltedError extends Error {
  readonly code = 'state_machine_halted';
}

export class StateMachine {
  private checkpointState: CheckpointState;
  private halted = false;
  private readonly listeners: Array<(record: TransitionRecord, state: State) => void> = [];
  private readonly clock: () => number;

  constructor(private readonly options: StateMachineOptions) {
    this.clock = options.clock ?? Date.now;
    this.checkpointState = emptyCheckpoint(this.clock());
  }

  get state(): State {
    return this.checkpointState.state;
  }

  get seq(): number {
    return this.checkpointState.seq;
  }

  get activeRunId(): string | undefined {
    return this.checkpointState.activeRunId;
  }

  get runtime(): ShellRuntimeState {
    return this.checkpointState.runtime;
  }

  get wakeIntents(): readonly WakeIntent[] {
    return this.checkpointState.wakeIntents;
  }

  get isHalted(): boolean {
    return this.halted;
  }

  onTransition(listener: (record: TransitionRecord, state: State) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  restore(): { previous?: State; recovered: boolean } {
    const loaded = this.options.checkpoint.loadRecovered();
    if (!loaded) return { recovered: false };
    if (loaded.fallback) {
      // Recovered from the previous generation: the fact is written down before the state is adopted,
      // so the trace names the damage even if the process dies again a moment later.
      this.options.trace.append('checkpoint_corrupt_recovered', {
        reason: loaded.fallback.reason,
        from: loaded.fallback.from,
        damaged: loaded.fallback.damaged,
        recoveredState: loaded.state.state,
        recoveredSeq: loaded.state.seq,
      });
    }
    this.checkpointState = loaded.state;
    return { previous: loaded.state.state, recovered: loaded.state.state !== 'DORMANT' };
  }

  /** Persist a runtime-only change (interaction time, dream day). Fails loudly like a transition. */
  updateRuntime(patch: Partial<ShellRuntimeState>): void {
    this.commit(this.nextCheckpoint({ runtime: { ...this.checkpointState.runtime, ...patch } }));
  }

  addWakeIntent(input: { at: number; reason: string }): WakeIntent {
    const intent: WakeIntent = {
      id: `wake-${this.clock().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: input.at,
      reason: input.reason,
      createdAt: this.clock(),
    };
    const next = this.nextCheckpoint({ wakeIntents: [...this.checkpointState.wakeIntents, intent] });
    this.commit(next);
    this.options.trace.append('wake_intent_added', { id: intent.id, scheduledAt: intent.at, reason: intent.reason }, this.clock());
    return intent;
  }

  consumeWakeIntent(id: string): void {
    const now = this.clock();
    const wakeIntents = this.checkpointState.wakeIntents.map((intent) =>
      intent.id === id ? { ...intent, consumedAt: now } : intent,
    );
    this.commit(this.nextCheckpoint({ wakeIntents }));
    this.options.trace.append('wake_intent_consumed', { id }, now);
  }

  dueWakeIntent(now = this.clock()): WakeIntent | undefined {
    return this.checkpointState.wakeIntents.find((intent) => !intent.consumedAt && intent.at <= now);
  }

  async dispatch(trigger: Trigger, context: DispatchContext = {}): Promise<State> {
    if (this.halted) throw new StateMachineHaltedError('state_machine_halted: a failed checkpoint write stops the machine');
    const from = this.checkpointState.state;
    const to = nextState(from, trigger);
    if (!to) {
      const error = new IllegalTransitionError(from, trigger);
      this.options.trace.append('illegal_transition', { from, trigger, reason: context.reason }, context.now ?? this.clock());
      throw error;
    }
    const now = context.now ?? this.clock();
    const record: TransitionRecord = {
      seq: this.checkpointState.seq + 1,
      from,
      to,
      trigger,
      reason: context.reason,
      runId: context.runId,
      at: now,
    };
    const next: CheckpointState = this.nextCheckpoint({
      state: to,
      seq: record.seq,
      activeRunId: to === 'RUNNING' ? context.runId : undefined,
      lastTransition: record,
      history: this.options.checkpoint.trimHistory([...this.checkpointState.history, record]),
      updatedAt: now,
    });
    if (to === 'RUNNING' && !context.runId) {
      throw new Error(`running_requires_run_id: ${from} -> RUNNING without a run id`);
    }
    this.commit(next);
    this.options.trace.append('transition', { ...record }, now);
    for (const listener of [...this.listeners]) listener(record, to);
    return to;
  }

  private nextCheckpoint(patch: Partial<CheckpointState>): CheckpointState {
    return { ...this.checkpointState, ...patch, version: 1 };
  }

  private commit(next: CheckpointState): void {
    try {
      this.options.checkpoint.save(next);
    } catch (error) {
      this.halted = true;
      if (error instanceof CheckpointWriteError) {
        this.options.trace.append('alarm', { code: error.code, path: error.path, message: error.message }, this.clock());
        this.options.onAlarm?.(error);
        throw error;
      }
      throw error;
    }
    this.checkpointState = next;
  }
}
