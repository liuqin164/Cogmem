/**
 * Kill-recovery fixture: starts the state machine on a data directory, prints one JSON line per
 * lifecycle event, and holds the process lock. The test SIGKILLs it mid-RUNNING and restarts it.
 */
import { ProcessLock } from '../../src/process-lock.ts';
import { CheckpointStore } from '../../src/state/checkpoint.ts';
import { StateMachine } from '../../src/state/machine.ts';
import { TraceLog } from '../../src/trace.ts';
import { RuntimeLockHeldError } from '../../src/process-lock.ts';

const dir = process.argv[2];
const mode = process.argv[3] ?? 'hold';
if (!dir) throw new Error('machine-process: a data directory is required');
const now = Date.now();
const trace = new TraceLog(dir);
const lock = new ProcessLock(dir);
try {
  const acquired = lock.acquire(process.pid, now);
  if (acquired.recoveredStalePid) trace.append('stale_lock_recovered', { pid: acquired.recoveredStalePid });
} catch (error) {
  if (error instanceof RuntimeLockHeldError) {
    process.stdout.write(`${JSON.stringify({ event: 'lock_held', pid: error.pid })}\n`);
    process.exit(1);
  }
  throw error;
}
const machine = new StateMachine({ checkpoint: new CheckpointStore(dir), trace, clock: () => now });
const restored = machine.restore();
if (restored.previous && ['RUNNING', 'DREAMING', 'WAKING'].includes(restored.previous)) {
  await machine.dispatch('recovered_run', { reason: `recovered_after_kill:${restored.previous}` });
  const intent = machine.wakeIntents.find((item) => !item.consumedAt);
  process.stdout.write(`${JSON.stringify({ event: 'recovered', previous: restored.previous, state: machine.state, runId: machine.activeRunId ?? null, intent: intent?.id ?? null })}\n`);
} else {
  await machine.dispatch('boot', {});
  await machine.dispatch('context_injected', {});
  const intent = machine.addWakeIntent({ at: now + 3_600_000, reason: 'survive_kill' });
  await machine.dispatch('message_received', { runId: 'run-kill' });
  process.stdout.write(`${JSON.stringify({ event: 'ready', pid: process.pid, state: machine.state, runId: machine.activeRunId, intent: intent.id })}\n`);
}
process.stdout.write(`${JSON.stringify({ event: 'holding', pid: process.pid, state: machine.state })}\n`);
await new Promise(() => {});
