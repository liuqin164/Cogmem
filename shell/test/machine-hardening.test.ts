/**
 * Item one of the stage-1.5 round (#165): the state machine's boundaries, hardened.
 *
 * Three additions the stage-one suite did not have: a fuzz that bombards the transition table with
 * random triggers and checks the invariants after every step (one RUNNING at most, RUNNING and
 * DREAMING never both, disk and memory never disagree); the two collisions the guidance names
 * (a message mid-dream, a wake intent due mid-run); and fault injection into a *real* checkpoint
 * write, not a stubbed one, so the halt path is exercised by a genuine EISDIR rather than a promise.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { CheckpointStore, CheckpointWriteError, emptyCheckpoint } from '../src/state/checkpoint.ts';
import { StateMachine, StateMachineHaltedError } from '../src/state/machine.ts';
import { IllegalTransitionError, isState, nextState, TRIGGERS, type State } from '../src/state/table.ts';
import { TraceLog } from '../src/trace.ts';
import type { ModelCompletionInput, ModelProvider } from '../src/state/agent-loop.ts';
import { buildMachine, makeShell, makeTempDir, seedMachine } from './helpers.ts';

/** A deterministic LCG: a fuzz failure must be reproducible from the seed in the test name. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** The invariants every step must leave behind, on disk and in memory. */
async function assertInvariants(machine: StateMachine, dir: string, label: string): Promise<void> {
  const checkpoint = new CheckpointStore(dir).load();
  expect(checkpoint, `${label}: checkpoint readable`).toBeDefined();
  const loaded = checkpoint!;
  expect(loaded.version, label).toBe(1);
  expect(isState(machine.state), `${label}: state is one of five`).toBe(true);
  expect(machine.state, `${label}: memory and disk agree`).toBe(loaded.state);
  expect(machine.seq, `${label}: seq agrees`).toBe(loaded.seq);
  // At most one RUNNING: a run id exists exactly while the state is RUNNING, and it is a single value.
  expect(machine.activeRunId, `${label}: run id agrees with disk`).toBe(loaded.activeRunId);
  if (loaded.state === 'RUNNING') expect(machine.activeRunId, `${label}: RUNNING carries a run`).toBeTruthy();
  else expect(loaded.activeRunId, `${label}: not RUNNING carries no run`).toBeUndefined();
  if (loaded.seq > 0) {
    expect(loaded.lastTransition?.seq, `${label}: last transition is the seq`).toBe(loaded.seq);
    expect(loaded.lastTransition?.to, `${label}: last transition is the state`).toBe(loaded.state);
  }
  const seqs = loaded.history.map((record) => record.seq);
  expect(new Set(seqs).size, `${label}: history seqs are unique`).toBe(seqs.length);
  expect(seqs, `${label}: history is ordered`).toEqual([...seqs].sort((a, b) => a - b));
  if (seqs.length > 0) expect(seqs[seqs.length - 1], `${label}: history ends at the seq`).toBe(loaded.seq);
  expect(loaded.history.length, `${label}: history is bounded`).toBeLessThanOrEqual(200);

  // A second host reading the same checkpoint sees the same single lifecycle — never a second run.
  const twin = buildMachine(dir);
  expect(twin.state, `${label}: the twin reads the same state`).toBe(machine.state);
  expect(twin.activeRunId, `${label}: the twin reads the same run`).toBe(machine.activeRunId);
  if (twin.state === 'RUNNING') {
    await expect(twin.dispatch('message_received', { runId: 'run-twin' })).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(twin.activeRunId, `${label}: still the one recorded run`).toBe(machine.activeRunId);
  }
}

describe('state machine fuzz', () => {
  test('400 random triggers leave every invariant standing (seed 0x1655)', async () => {
    const dir = makeTempDir();
    const machine = seedMachine(dir, 'DORMANT');
    const random = lcg(0x1655);
    const visited = new Set<State>();
    let legal = 0;
    let illegal = 0;
    for (let step = 0; step < 400; step += 1) {
      const from: State = machine.state;
      const choices = TRIGGERS.filter((trigger) => nextState(from, trigger) !== undefined);
      // Bias toward the legal edge so the machine actually walks; the remainder keeps the refusal
      // path hot, because a fuzz that only ever walks never tests the table's missing rows.
      const trigger = random() < 0.7 && choices.length > 0 ? choices[Math.floor(random() * choices.length)] : TRIGGERS[Math.floor(random() * TRIGGERS.length)];
      const before = machine.seq;
      let thrown: unknown;
      try {
        await machine.dispatch(trigger, { runId: `run-fuzz-${step}`, reason: `fuzz:${step}` });
      } catch (error) {
        thrown = error;
      }
      const label = `step ${step}: ${from}--${trigger}`;
      if (thrown) {
        expect(thrown, label).toBeInstanceOf(IllegalTransitionError);
        expect(machine.state, `${label}: refusal does not move the state`).toBe(from);
        expect(machine.seq, `${label}: refusal does not move the seq`).toBe(before);
        illegal += 1;
      } else {
        expect(machine.seq, `${label}: a legal edge advances the seq by one`).toBe(before + 1);
        const to = nextState(from, trigger);
        expect(to, `${label}: a dispatch that returned walked a table edge`).toBeDefined();
        expect(machine.state, `${label}: only a table edge was taken`).toBe(to!);
        legal += 1;
      }
      visited.add(machine.state);
      await assertInvariants(machine, dir, label);
    }
    expect(legal, 'the fuzz walked the table, it did not only refuse').toBeGreaterThan(100);
    expect(illegal, 'the fuzz also hit missing rows').toBeGreaterThan(0);
    // The invariants are about RUNNING and DREAMING, so the walk has to have been in them: without
    // this the "one run at a time, and no run while dreaming" checks could hold vacuously.
    for (const state of ['WAKING', 'IDLE', 'RUNNING', 'DREAMING'] as State[]) {
      expect(visited, `the walk visited ${state}`).toContain(state);
    }
  }, 30_000);

  test('a second seed still ends in the state the table says', async () => {
    const dir = makeTempDir();
    const machine = seedMachine(dir, 'DORMANT');
    const random = lcg(0x5a17);
    let expected: State = 'DORMANT';
    for (let step = 0; step < 200; step += 1) {
      const trigger = random() < 0.5 ? TRIGGERS[Math.floor(random() * TRIGGERS.length)] : TRIGGERS[0];
      const to = nextState(machine.state, trigger);
      let threw = false;
      try {
        await machine.dispatch(trigger, { runId: `run-seed-${step}` });
      } catch {
        threw = true;
      }
      if (to) {
        expect(threw, `step ${step}: ${machine.state}--${trigger} is in the table`).toBe(false);
        expected = to;
      } else {
        expect(threw, `step ${step}: ${machine.state}--${trigger} is not in the table`).toBe(true);
      }
      expect(machine.state, `step ${step}`).toBe(expected);
    }
    await assertInvariants(machine, dir, 'second seed');
  }, 30_000);
});

describe('the two collisions', () => {
  test('a message that lands mid-dream moves DREAMING to WAKING and then refuses dream_complete', async () => {
    const dir = makeTempDir();
    const machine = seedMachine(dir, 'DREAMING');
    await machine.dispatch('message_received', { reason: 'message_while_dreaming' });
    expect(machine.state).toBe('WAKING');
    // The in-flight integration is no longer allowed to close the state it no longer owns.
    await expect(machine.dispatch('dream_complete', { reason: 'dream:late' })).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(machine.state).toBe('WAKING');
    const checkpoint = new CheckpointStore(dir).load()!;
    expect(checkpoint.state).toBe('WAKING');
    expect(checkpoint.history.map((record) => record.trigger)).toEqual(['message_received']);
    const trace = new TraceLog(dir).read();
    expect(trace.some((record) => record.kind === 'illegal_transition' && record.trigger === 'dream_complete')).toBe(true);
    // The wake path then completes normally; nothing was lost to the collision.
    await machine.dispatch('context_injected', { reason: 'message_while_dreaming_time_context' });
    expect(machine.state).toBe('IDLE');
    await assertInvariants(machine, dir, 'mid-dream message');
  });

  test('a wake intent that comes due mid-run waits for IDLE instead of interrupting RUNNING', async () => {
    const dir = makeTempDir();
    // 12:00 UTC: outside the 2–5 dream window, so the tick after the run has one job to do.
    const fixedNow = Date.UTC(2026, 10, 10, 12, 0, 0);
    let release!: () => void;
    const gate = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const calls: ModelCompletionInput[] = [];
    const provider: ModelProvider = {
      name: 'gated',
      model: 'gated/test',
      async complete(input) {
        calls.push(input);
        if (calls.length === 1) await gate;
        return { text: 'done', toolCalls: [] };
      },
    };
    const shell = makeShell(dir, provider, {}, { now: () => fixedNow });
    await shell.start();
    try {
      const intent = shell.machine.addWakeIntent({ at: 1, reason: 'mid_run_checkin' });
      const running = shell.submit('long one');
      const started = Date.now();
      while (calls.length === 0) {
        if (Date.now() - started > 5_000) throw new Error('the run never reached the provider');
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
      }
      expect(shell.state).toBe('RUNNING');

      await shell.tick(fixedNow);
      expect(shell.state, 'the scheduler does not move a RUNNING machine').toBe('RUNNING');
      expect(shell.machine.wakeIntents.find((item) => item.id === intent.id)?.consumedAt).toBeUndefined();
      expect(shell.trace.read().some((record) => record.kind === 'illegal_transition')).toBe(false);

      release();
      const summary = await running;
      expect(summary!.stopReason).toBe('run_complete');
      expect(shell.state).toBe('IDLE');

      // The intent was delayed, not dropped: the next tick fires it from IDLE along the legal edge.
      await shell.tick(fixedNow);
      expect(shell.machine.wakeIntents.find((item) => item.id === intent.id)?.consumedAt).toBeDefined();
      expect(shell.state).toBe('IDLE');
      expect(shell.trace.read().some((record) => record.kind === 'wake_intent_consumed' && record.id === intent.id)).toBe(true);
      expect(shell.trace.read().some((record) => record.kind === 'illegal_transition')).toBe(false);
    } finally {
      release();
      await shell.stop();
    }
  }, 30_000);
});

describe('checkpoint failure injection (a real write, not a stub)', () => {
  test('an unwritable checkpoint halts the machine, keeps the old state, and alarms once', async () => {
    const dir = makeTempDir();
    const now = Date.UTC(2026, 10, 10, 9, 0, 0);
    const store = new CheckpointStore(dir);
    store.save({ ...emptyCheckpoint(now), state: 'IDLE' });
    const alarms: string[] = [];
    const machine = new StateMachine({
      checkpoint: store,
      trace: new TraceLog(dir),
      clock: () => now,
      onAlarm: (error) => alarms.push(error.message),
    });
    machine.restore();
    // Fault injection at the filesystem, not at the type: the atomic write cannot even create its
    // temp file, so `save` fails exactly the way a full or unwritable data directory makes it fail.
    mkdirSync(`${store.path}.tmp`, { recursive: true });

    await expect(machine.dispatch('message_received', { runId: 'run-fault' })).rejects.toBeInstanceOf(CheckpointWriteError);
    expect(machine.state, 'a failed write leaves the old in-memory state').toBe('IDLE');
    expect(machine.seq).toBe(0);
    expect(machine.isHalted).toBe(true);
    expect(alarms).toHaveLength(1);

    const durable = new CheckpointStore(dir).load()!;
    expect(durable.state, 'the durable checkpoint is the pre-failure one').toBe('IDLE');
    expect(durable.seq).toBe(0);
    const trace = new TraceLog(dir).read();
    expect(trace.filter((record) => record.kind === 'alarm')).toHaveLength(1);
    expect(trace.some((record) => record.kind === 'transition'), 'no transition was traced').toBe(false);

    await expect(machine.dispatch('message_received', { runId: 'run-fault' })).rejects.toBeInstanceOf(StateMachineHaltedError);
    expect(alarms, 'a halted machine does not alarm again').toHaveLength(1);
  });
});
