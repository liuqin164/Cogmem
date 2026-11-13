/**
 * The outer lifecycle: five states, one declarative table, no transition decided anywhere else.
 *
 * The inner RUNNING cycle is Pi's turn loop (see agent-loop.ts); this file is the memory-native
 * skeleton around it — waking injects the time context, dreaming consolidates the day, and the
 * emergence decision point is a transition, not a plugin side effect.
 */
export const STATES = ['DORMANT', 'WAKING', 'IDLE', 'RUNNING', 'DREAMING'] as const;
export type State = (typeof STATES)[number];

export const TRIGGERS = [
  'boot',
  'message_received',
  'wake_intent_due',
  'emergence_due',
  'context_injected',
  'run_complete',
  'run_aborted',
  'run_error',
  'budget_exceeded',
  'dream_window_open',
  'dream_complete',
  'recovered_run',
  'shutdown',
] as const;
export type Trigger = (typeof TRIGGERS)[number];

export interface TransitionEdge {
  from: State;
  trigger: Trigger;
  to: State;
  note: string;
}

export const TRANSITION_TABLE: readonly TransitionEdge[] = [
  { from: 'DORMANT', trigger: 'boot', to: 'WAKING', note: 'process start injects the time context' },
  { from: 'DORMANT', trigger: 'message_received', to: 'WAKING', note: 'a message while asleep wakes the shell' },
  { from: 'DORMANT', trigger: 'wake_intent_due', to: 'WAKING', note: 'a persisted intent fires while asleep' },
  { from: 'DORMANT', trigger: 'emergence_due', to: 'WAKING', note: 'the emergence decision point is checked awake' },
  { from: 'DORMANT', trigger: 'shutdown', to: 'DORMANT', note: 'shutdown before the first wake is a no-op' },
  { from: 'WAKING', trigger: 'context_injected', to: 'IDLE', note: 'time context is in the state; waiting' },
  { from: 'WAKING', trigger: 'recovered_run', to: 'IDLE', note: 'a process killed mid-wake resumes at idle' },
  { from: 'WAKING', trigger: 'shutdown', to: 'DORMANT', note: 'shutdown during wake' },
  { from: 'IDLE', trigger: 'message_received', to: 'RUNNING', note: 'one message is one run' },
  { from: 'IDLE', trigger: 'wake_intent_due', to: 'WAKING', note: 'a due intent re-injects the time context first' },
  { from: 'IDLE', trigger: 'emergence_due', to: 'RUNNING', note: 'the decision point may speak one candidate' },
  { from: 'IDLE', trigger: 'dream_window_open', to: 'DREAMING', note: 'night consolidation, once per local day' },
  { from: 'IDLE', trigger: 'shutdown', to: 'DORMANT', note: 'shutdown from standby' },
  { from: 'RUNNING', trigger: 'run_complete', to: 'IDLE', note: 'the Pi loop drained every queue' },
  { from: 'RUNNING', trigger: 'run_aborted', to: 'IDLE', note: 'abort signal or shutdown' },
  { from: 'RUNNING', trigger: 'run_error', to: 'IDLE', note: 'provider or tool failure ended the run' },
  { from: 'RUNNING', trigger: 'budget_exceeded', to: 'IDLE', note: 'the cage forced the run out' },
  { from: 'RUNNING', trigger: 'recovered_run', to: 'IDLE', note: 'a run interrupted by a kill is not resumed as running' },
  { from: 'DREAMING', trigger: 'dream_complete', to: 'IDLE', note: 'the night integration is written' },
  { from: 'DREAMING', trigger: 'message_received', to: 'WAKING', note: 'a message during the night wakes the shell' },
  { from: 'DREAMING', trigger: 'run_error', to: 'IDLE', note: 'night consolidation failed; standby with the trace' },
  { from: 'DREAMING', trigger: 'recovered_run', to: 'IDLE', note: 'a killed dream resumes at idle' },
  { from: 'DREAMING', trigger: 'shutdown', to: 'DORMANT', note: 'shutdown during the night' },
] as const;

export class IllegalTransitionError extends Error {
  readonly code = 'illegal_transition';
  constructor(readonly from: State, readonly trigger: Trigger) {
    super(`illegal_transition: ${from} has no edge for trigger "${trigger}"`);
  }
}

export function nextState(from: State, trigger: Trigger): State | undefined {
  return TRANSITION_TABLE.find((edge) => edge.from === from && edge.trigger === trigger)?.to;
}

export function isState(value: string): value is State {
  return (STATES as readonly string[]).includes(value);
}
