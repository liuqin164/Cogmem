/**
 * The checkpoint's half of the storage round (#165, round 14): the two ways a resident fails to come
 * back from its own state file.
 *
 * 1. A kill in the middle of a checkpoint write may leave the previous complete checkpoint or the new
 *    complete one — never a mixture that parses as state.
 * 2. A damaged checkpoint falls back one generation and says so, or refuses loudly with the machine
 *    left in DORMANT. Nothing here trusts a damaged byte.
 *
 * The kill tests cross a real process boundary; the rest are in-process. The session log's half lives
 * in `session-log-recovery.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CheckpointCorruptError, CheckpointStore, emptyCheckpoint } from '../src/state/checkpoint.ts';
import { StateMachine } from '../src/state/machine.ts';
import { TraceLog } from '../src/trace.ts';
import { ScriptedProvider, makeShell, makeTempDir, spawnFixture } from './helpers.ts';

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

describe('checkpoint write atomicity', () => {
  test('publish is a rename: the live path is a whole checkpoint and the temp path is never it', () => {
    const dir = makeTempDir();
    const store = new CheckpointStore(dir);
    store.save({ ...emptyCheckpoint(), state: 'IDLE', seq: 1 });
    expect(readFileSync(store.path, 'utf8').endsWith('}\n')).toBe(true);
    store.save({ ...emptyCheckpoint(), state: 'RUNNING', seq: 2, activeRunId: 'run-2' });
    expect(JSON.parse(readFileSync(store.path, 'utf8')).seq).toBe(2);

    // A killed write can leave a torn temp file behind; it must never be read as state.
    writeFileSync(`${store.path}.tmp`, '{"version":1,"state":"RUN');
    expect(store.load()!.seq).toBe(2);
    expect(store.loadRecovered()!.state.seq).toBe(2);
  });

  test('SIGKILL anywhere in the write loop leaves a whole checkpoint, on every iteration', async () => {
    const dir = makeTempDir('companion-kill-');
    const store = new CheckpointStore(dir);
    let rounds = 0;
    // Different kill delays land the signal in different phases of the ~5ms write (between writes, in
    // the temp write, after the rename); each round asks the same discriminating question.
    for (const delay of [0, 1, 3, 6]) {
      const harness = spawnFixture('checkpoint-writer-process.ts', [dir]);
      try {
        await harness.waitForCount('wrote', 3);
        await sleep(delay);
        harness.child.kill('SIGKILL');
        await harness.exited();
        rounds += 1;

        // Every seq the writer reported before the signal; the file may also hold one more, published
        // but not printed when the kill landed.
        const written = harness.events.filter((event) => event.event === 'wrote').map((event) => event.seq);
        const last = written[written.length - 1];

        const raw = readFileSync(store.path, 'utf8');
        // Completeness: a torn file does not end on the record's closing brace and newline.
        expect(raw.endsWith('}\n'), `round ${rounds}: the checkpoint file is complete (${raw.slice(-40)})`).toBe(true);
        const loaded = JSON.parse(raw) as { version: number; seq: number; state: string; activeRunId?: string; history: unknown[] };
        expect(loaded.version, `round ${rounds}`).toBe(1);
        // The file is one of the committed states, or the one the writer was committing when it died.
        expect(written, `round ${rounds}: the writer reported committed seqs`).toContain(last);
        expect(loaded.seq, `round ${rounds}: not an older generation`).toBeGreaterThanOrEqual(1);
        expect(loaded.seq, `round ${rounds}: never ahead of the write in flight`).toBeLessThanOrEqual(last + 1);
        // Internal consistency: seq, state and run id were written by the same save or none of them were.
        expect(loaded.state, `round ${rounds}: state matches its seq`).toBe(loaded.seq % 2 === 1 ? 'RUNNING' : 'IDLE');
        expect(loaded.activeRunId, `round ${rounds}`).toBe(loaded.seq % 2 === 1 ? `run-${loaded.seq}` : undefined);
        expect(loaded.history, `round ${rounds}`).toHaveLength(200);
        // Either generation is loadable, and recovery never has to guess.
        const recovered = store.loadRecovered();
        expect(recovered?.state.seq, `round ${rounds}`).toBeLessThanOrEqual(loaded.seq);
        if (existsSync(store.previousPath)) {
          const previous = JSON.parse(readFileSync(store.previousPath, 'utf8')) as { seq: number };
          expect(previous.seq, `round ${rounds}: the fallback is a whole, older checkpoint`).toBeLessThanOrEqual(loaded.seq);
        }
      } finally {
        if (harness.child.exitCode === null && !harness.child.killed) harness.child.kill('SIGKILL');
      }
    }
    expect(rounds).toBe(4);
  }, 60_000);

  test('the fallback generation is only rotated forward: a kill between link and rename cannot lose the live file', () => {
    const dir = makeTempDir();
    const store = new CheckpointStore(dir);
    // First publish has no previous generation; the second links the first and then publishes.
    store.save({ ...emptyCheckpoint(), state: 'IDLE', seq: 1 });
    expect(existsSync(store.previousPath)).toBe(false);
    store.save({ ...emptyCheckpoint(), state: 'IDLE', seq: 2 });
    expect(existsSync(store.path)).toBe(true);
    expect(JSON.parse(readFileSync(store.path, 'utf8')).seq).toBe(2);
    expect(JSON.parse(readFileSync(store.previousPath, 'utf8')).seq).toBe(1);
  });
  test('a reader watching the file never catches a mixture, however often the writer republishes', async () => {
    // The discriminating test for "写一半被杀": a kill cannot be aimed inside a single write(2), so the
    // question is asked the way the recovery path asks it — what can a reader *observe*? A concurrent
    // reader samples the live path while the writer republishes an ~850 KiB checkpoint in a tight loop;
    // every sample must be one whole document. An in-place overwrite is caught here, because the page
    // cache is updated across many pages and a reader sees a mixture of the old and the new seq.
    const dir = makeTempDir('companion-kill-');
    const store = new CheckpointStore(dir);
    const harness = spawnFixture('checkpoint-writer-process.ts', [dir, 'big']);
    try {
      await harness.waitForCount('wrote', 3);
      const deadline = Date.now() + 2_000;
      let samples = 0;
      const seqs = new Set<number>();
      while (Date.now() < deadline) {
        const raw = readFileSync(store.path, 'utf8');
        const loaded = JSON.parse(raw) as {
          version: number;
          seq: number;
          state: string;
          activeRunId?: string;
          wakeIntents: Array<{ id: string }>;
          runtime: { lastInteractionText: string; lastTimeContext: string };
          history: Array<{ reason: string }>;
        };
        const where = `sample ${samples} (seq ${loaded.seq})`;
        expect(loaded.version, where).toBe(1);
        // One save writes every field, so every field must name the same seq.
        expect(loaded.runtime.lastInteractionText.startsWith(`${loaded.seq}:`), `${where}: runtime names its seq`).toBe(true);
        expect(loaded.runtime.lastTimeContext.startsWith(`${loaded.seq}:`), `${where}: the second runtime field agrees`).toBe(true);
        expect(loaded.history.every((record) => record.reason.startsWith(`kill-write:${loaded.seq}:`)), `${where}: history agrees`).toBe(true);
        expect(loaded.wakeIntents[0].id, where).toBe(`wake-${loaded.seq}`);
        expect(loaded.state, where).toBe(loaded.seq % 2 === 1 ? 'RUNNING' : 'IDLE');
        seqs.add(loaded.seq);
        samples += 1;
      }
      harness.child.kill('SIGKILL');
      await harness.exited();
      // A test that sampled once would pass by luck; a few hundred samples over a moving file is the point.
      expect(samples, 'the reader really sampled while the writer was running').toBeGreaterThan(50);
      expect(seqs.size, 'and saw the writer publish more than one document').toBeGreaterThan(1);
    } finally {
      if (!harness.child.killed) harness.child.kill('SIGKILL');
    }
  }, 60_000);
});

describe('a damaged checkpoint never becomes a guessed state', () => {
  test('a damaged live checkpoint falls back one generation, records it, and the damage is not inherited', async () => {
    const dir = makeTempDir();
    const store = new CheckpointStore(dir);
    const trace = new TraceLog(dir);
    store.save({ ...emptyCheckpoint(), state: 'IDLE', seq: 1 });
    store.save({ ...emptyCheckpoint(), state: 'RUNNING', seq: 2, activeRunId: 'run-2' });
    // External damage: the publish itself is atomic, so this is bit rot / a hand edit / a truncated copy.
    writeFileSync(store.path, '{"version":1,"state":"RUN');

    const machine = new StateMachine({ checkpoint: store, trace, clock: () => 1_760_000_000_000 });
    const restored = machine.restore();
    expect(restored.previous).toBe('IDLE');
    expect(machine.state).toBe('IDLE');
    expect(machine.seq).toBe(1);

    const records = trace.read();
    const recorded = records.find((record) => record.kind === 'checkpoint_corrupt_recovered');
    expect(recorded, 'the damage is in the trace, not hidden').toBeDefined();
    expect(recorded!.recoveredSeq).toBe(1);
    expect(recorded!.recoveredState).toBe('IDLE');
    expect(String(recorded!.damaged)).toBe(store.path);
    // The damaged bytes are kept for post-mortem and out of the publish path.
    expect(existsSync(`${store.path}.corrupt`)).toBe(true);
    expect(readFileSync(`${store.path}.corrupt`, 'utf8')).toBe('{"version":1,"state":"RUN');

    // The next save writes a fresh generation; the poisoned file is gone from the live path.
    await machine.dispatch('message_received', { runId: 'run-3' });
    expect(store.load()!.state).toBe('RUNNING');
    expect(store.load()!.seq).toBe(2);
    expect(JSON.parse(readFileSync(store.previousPath, 'utf8')).seq).toBe(1);
  });

  test('two damaged generations are a loud CheckpointCorruptError with the machine left in DORMANT', () => {
    const dir = makeTempDir();
    const store = new CheckpointStore(dir);
    const trace = new TraceLog(dir);
    store.save({ ...emptyCheckpoint(), state: 'IDLE', seq: 1 });
    store.save({ ...emptyCheckpoint(), state: 'IDLE', seq: 2 });
    writeFileSync(store.path, 'not json at all');
    writeFileSync(store.previousPath, '{"version":9}');

    const machine = new StateMachine({ checkpoint: store, trace });
    expect(() => machine.restore()).toThrow(CheckpointCorruptError);
    // Safe state: nothing was adopted and no edge was walked.
    expect(machine.state).toBe('DORMANT');
    expect(machine.seq).toBe(0);
    expect(machine.activeRunId).toBeUndefined();
    expect(trace.read().some((record) => record.kind === 'checkpoint_corrupt_recovered')).toBe(false);
    expect(new TraceLog(dir).read().some((record) => record.kind === 'transition')).toBe(false);
  });

  test('a shell that cannot recover its checkpoint fails loud, stays DORMANT, and leaves no host lock', async () => {
    const dir = makeTempDir();
    const dataDir = join(dir, 'data');
    mkdirSync(dataDir, { recursive: true });
    const store = new CheckpointStore(dataDir);
    store.save({ ...emptyCheckpoint(), state: 'IDLE', seq: 1 });
    store.save({ ...emptyCheckpoint(), state: 'IDLE', seq: 2 });
    writeFileSync(store.path, '{"broken":');
    writeFileSync(store.previousPath, '{"broken":');

    const shell = makeShell(dir, new ScriptedProvider([{ text: 'x', toolCalls: [] }]));
    await expect(shell.start()).rejects.toBeInstanceOf(CheckpointCorruptError);
    expect(shell.state, 'the machine never left its safe state').toBe('DORMANT');
    expect(existsSync(join(dataDir, 'runtime.lock')), 'a refusing process does not hold the host lock').toBe(false);
    // Nothing was started: no plugin ran and no transition was traced.
    expect(shell.trace.read().some((record) => record.kind === 'transition')).toBe(false);
  });

  test('deleting the checkpoint is still a reset, not a resurrection of the previous generation', () => {
    const dir = makeTempDir();
    const store = new CheckpointStore(dir);
    store.save({ ...emptyCheckpoint(), state: 'RUNNING', seq: 1, activeRunId: 'run-1' });
    store.save({ ...emptyCheckpoint(), state: 'IDLE', seq: 2 });
    rmSync(store.path);
    expect(store.loadRecovered()).toBeUndefined();
    expect(new StateMachine({ checkpoint: store, trace: new TraceLog(dir) }).restore()).toEqual({ recovered: false });
    // The previous generation is still there for the operator, it just does not override a deletion.
    expect(JSON.parse(readFileSync(store.previousPath, 'utf8')).seq).toBe(1);
  });
});
