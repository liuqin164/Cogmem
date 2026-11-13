/**
 * Checkpoint kill-mid-write fixture: saves an at-capacity checkpoint in a tight loop and reports each
 * committed seq on stdout. The test SIGKILLs the process anywhere in the write and then asks the disk
 * which checkpoint it holds — the discriminating question for item one: a whole one, never a half.
 */
import { CheckpointStore, emptyCheckpoint, type CheckpointState, type TransitionRecord } from '../../src/state/checkpoint.ts';

const dir = process.argv[2];
if (!dir) throw new Error('checkpoint-writer-process: a data directory is required');
/** `big` inflates the checkpoint past a page-cache write's single dirtying pass (~850 KiB). */
const big = process.argv[3] === 'big';
const store = new CheckpointStore(dir);

/** A checkpoint at the persistence ceiling: 200 history records plus full runtime fields (~70 KiB). */
function atCapacity(seq: number): CheckpointState {
  const history: TransitionRecord[] = [];
  for (let i = 0; i < 200; i += 1) {
    history.push({
      seq: seq * 1000 + i,
      from: i % 2 === 0 ? 'IDLE' : 'RUNNING',
      to: i % 2 === 0 ? 'RUNNING' : 'IDLE',
      trigger: i % 3 === 0 ? 'message_received' : i % 3 === 1 ? 'run_complete' : 'wake_intent_due',
      reason: `kill-write:${seq}:${i}:a reason string long enough that a torn write is visible`,
      runId: `run-${seq}-${i}`,
      at: 1_760_000_000_000 + i,
    });
  }
  const running = seq % 2 === 1;
  return {
    ...emptyCheckpoint(1_760_000_000_000),
    state: running ? 'RUNNING' : 'IDLE',
    seq,
    activeRunId: running ? `run-${seq}` : undefined,
    wakeIntents: [{ id: `wake-${seq}`, at: 1_760_000_000_000, reason: 'kill_write', createdAt: 1_760_000_000_000 }],
    runtime: {
      // Every field carries the same seq, so a reader can tell a whole document from a mixture.
      lastInteractionText: big ? `${seq}:`.padEnd(200_000, 'x') : 'x'.repeat(500),
      lastTimeContext: big ? `${seq}:`.padEnd(600_000, 'y') : 'y'.repeat(400),
      declaredTools: ['bash', 'edit', 'propose_command', 'read', 'write'],
    },
    history,
  };
}

for (let seq = 1; ; seq += 1) {
  store.save(atCapacity(seq));
  process.stdout.write(`${JSON.stringify({ event: 'wrote', seq })}\n`);
}
