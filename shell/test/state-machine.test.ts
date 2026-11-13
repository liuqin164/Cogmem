import { describe, expect, test } from 'bun:test';
import { StateMachine, StateMachineHaltedError } from '../src/state/machine.ts';
import { CheckpointStore, CheckpointWriteError, emptyCheckpoint } from '../src/state/checkpoint.ts';
import { IllegalTransitionError, TRANSITION_TABLE, TRIGGERS, type State, type Trigger } from '../src/state/table.ts';
import { TraceLog } from '../src/trace.ts';
import { buildMachine, seedMachine, makeTempDir } from './helpers.ts';

function isLegal(from: State, trigger: Trigger): boolean {
  return TRANSITION_TABLE.some((edge) => edge.from === from && edge.trigger === trigger);
}

describe('transition table', () => {
  // Acceptance: every legal edge has a test. One iteration per row, no hand-picked subset.
  for (const edge of TRANSITION_TABLE) {
    test(`legal ${edge.from} --${edge.trigger}--> ${edge.to}`, async () => {
      const dir = makeTempDir();
      const machine = seedMachine(dir, edge.from);
      const next = await machine.dispatch(edge.trigger, edge.to === 'RUNNING' ? { runId: 'run-test' } : {});
      expect(next).toBe(edge.to);
      expect(machine.state).toBe(edge.to);
      const checkpoint = new CheckpointStore(dir).load()!;
      expect(checkpoint.state).toBe(edge.to);
      expect(checkpoint.seq).toBe(1);
      expect(checkpoint.lastTransition?.from).toBe(edge.from);
      if (edge.to === 'RUNNING') expect(checkpoint.activeRunId).toBe('run-test');
      else expect(checkpoint.activeRunId).toBeUndefined();
    });
  }

  // Acceptance: sampled illegal transitions are refused loudly and leave a trace.
  test('every state/trigger pair not in the table throws IllegalTransitionError', async () => {
    let checked = 0;
    for (const from of ['DORMANT', 'WAKING', 'IDLE', 'RUNNING', 'DREAMING'] as State[]) {
      for (const trigger of TRIGGERS) {
        if (isLegal(from, trigger)) continue;
        const dir = makeTempDir();
        const machine = seedMachine(dir, from);
        let thrown: unknown;
        try {
          await machine.dispatch(trigger, { runId: 'run-test' });
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(IllegalTransitionError);
        expect(machine.state).toBe(from);
        expect(new CheckpointStore(dir).load()?.state).toBe(from);
        const trace = new TraceLog(dir).read().find((record) => record.kind === 'illegal_transition');
        expect(trace).toBeDefined();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  test('RUNNING requires a run id and refuses without one', async () => {
    const dir = makeTempDir();
    const machine = seedMachine(dir, 'IDLE');
    await expect(machine.dispatch('message_received')).rejects.toThrow('running_requires_run_id');
    expect(machine.state).toBe('IDLE');
    expect(new CheckpointStore(dir).load()!.seq).toBe(0);
  });

  test('a failed checkpoint write halts the machine and alarms, leaving the old state', async () => {
    const dir = makeTempDir();
    const store = new CheckpointStore(dir);
    store.save({ ...emptyCheckpoint(), state: 'IDLE' });
    const alarms: string[] = [];
    const machine = new StateMachine({
      checkpoint: {
        load: () => store.load(),
        // The recovery load is the same file here: this stub exists to fail the *write*, not the read.
        loadRecovered: () => {
          const state = store.load();
          return state ? { state } : undefined;
        },
        save: () => {
          throw new CheckpointWriteError(store.path, new Error('disk full'));
        },
        trimHistory: (history: unknown[]) => history,
      } as unknown as CheckpointStore,
      trace: new TraceLog(dir),
      onAlarm: (error) => alarms.push(error.message),
    });
    machine.restore();
    await expect(machine.dispatch('message_received', { runId: 'run-x' })).rejects.toBeInstanceOf(CheckpointWriteError);
    expect(machine.state).toBe('IDLE');
    expect(machine.isHalted).toBe(true);
    expect(alarms.length).toBe(1);
    await expect(machine.dispatch('message_received', { runId: 'run-x' })).rejects.toBeInstanceOf(StateMachineHaltedError);
    expect(new TraceLog(dir).read().some((record) => record.kind === 'alarm')).toBe(true);
  });

  test('wake intents persist through a transition and survive a reload', async () => {
    const dir = makeTempDir();
    const machine = seedMachine(dir, 'IDLE');
    const intent = machine.addWakeIntent({ at: Date.now() + 60_000, reason: 'check_in' });
    await machine.dispatch('message_received', { runId: 'run-1' });
    await machine.dispatch('run_complete', {});
    const reloaded = buildMachine(dir);
    expect(reloaded.wakeIntents.map((item) => item.id)).toContain(intent.id);
    expect(reloaded.dueWakeIntent(Date.now() + 120_000)?.reason).toBe('check_in');
  });

  test('checkpoint history is bounded and ordered', async () => {
    const dir = makeTempDir();
    const machine = seedMachine(dir, 'IDLE');
    for (let index = 0; index < 3; index += 1) {
      await machine.dispatch('message_received', { runId: `run-${index}` });
      await machine.dispatch('run_complete', {});
    }
    const checkpoint = new CheckpointStore(dir).load()!;
    expect(checkpoint.history.map((record) => record.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
