/**
 * The kill matrix, widened (#165, round 14).
 *
 * Stage one proved one kill point (a process killed while RUNNING and holding). The storage round
 * adds the three places the write path itself can be caught plus the nightly transition, and asks
 * each one the same three questions with evidence rather than a summary:
 *
 *   - lifecycle: what state comes back, and is there ever a second RUNNING?
 *   - steering: what happened to a line the user typed while the run was going?
 *   - continuity: what survived in the session (the checkpoint's runtime, the trace, the ledger)?
 *
 * Each case SIGKILLs a real process at a point it announces on stdout, then starts a second process
 * on the same data dir and asserts on the JSON it reports back.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CheckpointStore } from '../src/state/checkpoint.ts';
import { TraceLog } from '../src/trace.ts';
import { makeTempDir, spawnFixture } from './helpers.ts';

async function recover(dir: string, mode = 'recover') {
  const harness = spawnFixture('shell-kill-process.ts', [dir, mode]);
  const recovered = await harness.waitFor('recovered');
  const drained = mode === 'recover-steer' ? await harness.waitFor('drained') : undefined;
  await harness.exited();
  return { recovered, drained, stderr: harness.stderr };
}

describe('kill matrix: every kill point comes back to one IDLE state', () => {
  test('killed mid-stream (provider never answered): RUNNING is retired, and the turn left no memory', async () => {
    const dir = makeTempDir('companion-kill-');
    const first = spawnFixture('shell-kill-process.ts', [dir, 'stream']);
    try {
      await first.waitFor('idle');
      await first.waitFor('streaming');
      const atKill = new CheckpointStore(dir).load()!;
      // Evidence at the kill: RUNNING with a run id, and the trace says the assistant message started.
      expect(atKill.state).toBe('RUNNING');
      expect(atKill.activeRunId).toBeTruthy();

      first.child.kill('SIGKILL');
      await first.exited();

      const { recovered } = await recover(dir);
      expect(recovered.state, 'a killed run is retired, not resumed').toBe('IDLE');
      expect(recovered.activeRunId).toBeNull();
      expect(recovered.recoveryRecorded).toBe(1);
      // Continuity: the streaming turn never reached `agent_end`, so nothing was captured and the
      // ledger has no half turn. The last prompt is still in the checkpoint's runtime, truncated to
      // its 500-char ceiling — that ceiling is a finding, not a refusal.
      expect(recovered.captureRuns).toBe(0);
      const runtime = new CheckpointStore(dir).load()!.runtime;
      expect(runtime.lastInteractionText).toContain('stream a reply');
    } finally {
      if (!first.child.killed) first.child.kill('SIGKILL');
    }
  }, 60_000);

  test('killed during a tool call: the call is judged for replay, refused, and cleared', async () => {
    const dir = makeTempDir('companion-kill-');
    const first = spawnFixture('shell-kill-process.ts', [dir, 'tool']);
    try {
      await first.waitFor('idle');
      await first.waitFor('tool_running');
      const atKill = new CheckpointStore(dir).load()!;
      expect(atKill.state).toBe('RUNNING');
      // Evidence at the kill: the call is on disk as in flight, written before the tool executed.
      expect(atKill.runtime.inFlightToolCalls?.map((call) => call.toolName)).toEqual(['bash']);

      first.child.kill('SIGKILL');
      await first.exited();

      const { recovered } = await recover(dir);
      expect(recovered.state).toBe('IDLE');
      expect(recovered.inFlight, 'the judgment runs and the list is cleared').toBe(0);
      expect(recovered.noReplay, 'the unknown-outcome call is refused, loudly, in the trace').toBe(1);
      const judged = new TraceLog(dir).read().find((record) => record.kind === 'recovery_no_replay')!;
      expect(judged.inFlight).toEqual([{ toolCallId: 'call-kill', toolName: 'bash', replay: 'never' }]);
      expect(judged.refused).toEqual(['bash']);
    } finally {
      if (!first.child.killed) first.child.kill('SIGKILL');
    }
  }, 60_000);

  test('killed mid-stream: the whole prompt is in the session log, so the interrupted turn rebuilds', async () => {
    const dir = makeTempDir('companion-kill-');
    const first = spawnFixture('shell-kill-process.ts', [dir, 'stream']);
    try {
      await first.waitFor('idle');
      await first.waitFor('streaming');
      const atKill = new CheckpointStore(dir).load()!;
      expect(atKill.state).toBe('RUNNING');
      expect(atKill.activeRunId).toBeTruthy();

      first.child.kill('SIGKILL');
      await first.exited();

      const { recovered } = await recover(dir);
      expect(recovered.state).toBe('IDLE');
      // The display copy in the checkpoint is still the 500-char ceiling; the storage layer is not,
      // and that is the difference #210 asked for.
      const runtime = new CheckpointStore(dir).load()!.runtime;
      expect(runtime.lastInteractionText!.length).toBe(500);
      expect(runtime.lastInteractionText).not.toContain('TAIL-MARKER');

      // The session log holds the full prompt from before the model call, and recovery says so.
      const trace = new TraceLog(dir).read();
      const prompt = trace.find((record) => record.kind === 'run_prompt' && record.runId === atKill.activeRunId)!;
      expect(prompt, 'the prompt was persisted before the model call').toBeDefined();
      expect(prompt.chars).toBeGreaterThan(1200);
      expect(String(prompt.text)).toContain('TAIL-MARKER-被打断的原话');
      expect(recovered.promptRecovered, 'recovery writes the fact down, not silently').toBe(1);
      // Rebuilt from the log: same run, whole text, tail included.
      expect(recovered.interrupted).toBeTruthy();
      expect(recovered.interrupted.runId).toBe(atKill.activeRunId);
      expect(recovered.interrupted.chars).toBe(prompt.chars);
      expect(recovered.interrupted.text).toContain('TAIL-MARKER-被打断的原话');
      expect(recovered.interrupted.text.length).toBe(prompt.chars);
    } finally {
      if (!first.child.killed) first.child.kill('SIGKILL');
    }
  }, 60_000);

  test('killed while a checkpoint write is in flight: the shell comes back to one IDLE state', async () => {
    const dir = makeTempDir('companion-kill-');
    const first = spawnFixture('shell-kill-process.ts', [dir, 'write']);
    try {
      await first.waitFor('idle');
      await first.waitFor('streaming');
      await first.waitForCount('writing', 3);
      // The kill lands inside the write loop: a checkpoint rewrite is in flight most of the time.
      first.child.kill('SIGKILL');
      await first.exited();
      const writes = first.events.filter((event) => event.event === 'writing').length;
      expect(writes, 'the shell really was rewriting its checkpoint').toBeGreaterThanOrEqual(3);

      // Item one's question, asked from the matrix side: a whole file, not a half one.
      const loaded = new CheckpointStore(dir).load()!;
      expect(loaded.state).toBe('RUNNING');
      expect(loaded.history.length).toBeLessThanOrEqual(200);
      expect(loaded.runtime.lastTimeContext ?? '').not.toHaveLength(0);

      const { recovered } = await recover(dir);
      expect(recovered.state, 'a kill in the write path still recovers to one IDLE').toBe('IDLE');
      expect(recovered.activeRunId).toBeNull();
      expect(recovered.recoveryRecorded).toBe(1);
    } finally {
      if (!first.child.killed) first.child.kill('SIGKILL');
    }
  }, 60_000);

  test('killed in DREAMING: the night resumes as IDLE and is not marked as dreamt', async () => {
    const dir = makeTempDir('companion-kill-');
    const first = spawnFixture('shell-kill-process.ts', [dir, 'dream']);
    try {
      await first.waitFor('idle');
      await first.waitFor('dreaming');
      const atKill = new CheckpointStore(dir).load()!;
      expect(atKill.state).toBe('DREAMING');
      expect(atKill.runtime.lastDreamDate, 'the integration never finished, so no day is claimed').toBeUndefined();

      first.child.kill('SIGKILL');
      await first.exited();

      const { recovered } = await recover(dir);
      expect(recovered.state).toBe('IDLE');
      expect(recovered.lastDreamDate, 'the next dream window can still run tonight').toBeNull();
      expect(recovered.recoveryRecorded).toBe(1);
      // The wake intent the idle scheduler persisted before the dream is not lost to the night.
      expect(recovered.wakeIntents.length).toBeGreaterThanOrEqual(1);
    } finally {
      if (!first.child.killed) first.child.kill('SIGKILL');
    }
  }, 60_000);

  test('steering typed during the run survives the kill, item by item, and is consumed in order', async () => {
    const dir = makeTempDir('companion-kill-');
    // The stream mode holds RUNNING; the parent queues two lines into the running shell through the
    // same path the TUI uses, then kills without the queue ever draining.
    const first = spawnFixture('shell-kill-process.ts', [dir, 'stream-steer']);
    try {
      await first.waitFor('idle');
      await first.waitFor('streaming');
      await first.waitFor('steered');
      const steering = first.events.find((event) => event.event === 'steered');
      expect(steering.queued, 'the shell reports both lines as queued while RUNNING').toEqual(['撤回前先看一眼', '第二句排在后面']);

      first.child.kill('SIGKILL');
      await first.exited();

      const { recovered, drained } = await recover(dir, 'recover-steer');
      expect(recovered.state).toBe('IDLE');
      // The fix, stated as evidence: the queue was in the checkpoint, so it comes back in order.
      expect(recovered.steering).toEqual(['撤回前先看一眼', '第二句排在后面']);
      expect(recovered.steeringRestored, 'the recovery fact is in the trace, not silent').toBe(1);
      const trace = new TraceLog(dir).read();
      const restored = trace.find((record) => record.kind === 'steering_restored')!;
      expect(restored.steering).toBe(2);
      expect(restored.followUps).toBe(0);
      // And they are consumed in order by the next run: the model's second request sees them FIFO.
      expect(drained.steering).toEqual([]);
      expect(drained.calls[1], 'the restored lines reach the next request in order').toEqual(['继续', '撤回前先看一眼', '第二句排在后面']);
      expect(drained.injected).toEqual([{ afterTurn: 1, beforeTurn: 2, count: 2 }]);
      // The typed text never was the display copy; the display copy is the previous turn's mark.
      const runtime = new CheckpointStore(dir).load()!.runtime;
      expect(runtime.lastInteractionText ?? '').not.toContain('撤回前先看一眼');
    } finally {
      if (!first.child.killed) first.child.kill('SIGKILL');
    }
  }, 60_000);
});

describe('the live process is the only writer', () => {
  test('a second host is refused while the first holds the lock, and the checkpoint keeps one RUNNING', async () => {
    const dir = makeTempDir('companion-kill-');
    const first = spawnFixture('shell-kill-process.ts', [dir, 'stream']);
    try {
      await first.waitFor('streaming');
      const second = spawnFixture('shell-kill-process.ts', [dir, 'recover']);
      try {
        const refused = await second.waitFor('refused');
        expect(refused.message).toContain('runtime_lock_held');
        expect(await second.exited(), 'the second host refuses to start').toBe(1);
        // The refused process wrote nothing: state on disk is still the first process's RUNNING.
        expect(new CheckpointStore(dir).load()!.state).toBe('RUNNING');
      } finally {
        if (!second.child.killed && second.child.exitCode === null) second.child.kill('SIGKILL');
      }
    } finally {
      first.child.kill('SIGKILL');
      await first.exited();
    }
  }, 60_000);
});
