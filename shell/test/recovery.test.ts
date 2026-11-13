import { describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { CheckpointStore } from '../src/state/checkpoint.ts';
import { makeTempDir } from './helpers.ts';

interface Harness {
  child: ChildProcess;
  lines: string[];
  waitFor: (event: string, timeoutMs?: number) => Promise<any>;
}

function startHarness(dir: string, mode = 'hold'): Harness {
  const child = spawn('bun', [join(import.meta.dir, 'fixtures', 'machine-process.ts'), dir, mode], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines: string[] = [];
  const waiters = new Map<string, (value: any) => void>();
  const reader = createInterface({ input: child.stdout! });
  reader.on('line', (line: string) => {
    lines.push(line);
    try {
      const parsed = JSON.parse(line) as { event: string };
      const waiter = waiters.get(parsed.event);
      if (waiter) {
        waiters.delete(parsed.event);
        waiter(parsed);
      }
    } catch {
      // stderr or a non-JSON banner; keep the raw line for diagnosis.
    }
  });
  return {
    child,
    lines,
    waitFor(event: string, timeoutMs = 15_000) {
      const seen = lines.map((line) => {
        try {
          return JSON.parse(line) as { event: string };
        } catch {
          return undefined;
        }
      }).find((entry) => entry?.event === event);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => rejectPromise(new Error(`timeout waiting for ${event}; saw ${lines.join(' | ')}`)), timeoutMs);
        waiters.set(event, (value) => {
          clearTimeout(timer);
          resolvePromise(value);
        });
      });
    },
  };
}

function exited(child: ChildProcess): Promise<number | null> {
  return new Promise((resolvePromise) => child.once('exit', (code) => resolvePromise(code)));
}

describe('kill recovery and the single-RUNNING rule', () => {
  test('SIGKILL mid-RUNNING recovers to IDLE, keeps the wake intent, and refuses a second host', async () => {
    const dir = makeTempDir('companion-kill-');
    const first = startHarness(dir, 'hold');
    const ready = await first.waitFor('ready');
    expect(ready.state).toBe('RUNNING');
    expect(ready.runId).toBe('run-kill');
    const before = new CheckpointStore(dir).load()!;
    expect(before.state).toBe('RUNNING');
    expect(before.activeRunId).toBe('run-kill');
    expect(before.wakeIntents).toHaveLength(1);

    first.child.kill('SIGKILL');
    await exited(first.child);
    const afterKill = new CheckpointStore(dir).load()!;
    expect(afterKill.state).toBe('RUNNING');
    expect(afterKill.wakeIntents[0].id).toBe(ready.intent);

    // Restart: the checkpoint's RUNNING is retired, not resumed.
    const second = startHarness(dir, 'hold');
    const recovered = await second.waitFor('recovered');
    expect(recovered.previous).toBe('RUNNING');
    expect(recovered.state).toBe('IDLE');
    expect(recovered.runId).toBeNull();
    expect(recovered.intent).toBe(ready.intent);
    const recoveredCheckpoint = new CheckpointStore(dir).load()!;
    expect(recoveredCheckpoint.state).toBe('IDLE');
    expect(recoveredCheckpoint.activeRunId).toBeUndefined();
    expect(recoveredCheckpoint.wakeIntents.map((intent) => intent.id)).toContain(ready.intent);

    // While the second host holds the lock, a third must not start a second RUNNING.
    const third = startHarness(dir, 'run');
    const held = await third.waitFor('lock_held');
    expect(held.pid).toBe(second.child.pid);
    expect(await exited(third.child)).toBe(1);
    expect(new CheckpointStore(dir).load()!.state).not.toBe('RUNNING');

    second.child.kill('SIGKILL');
    await exited(second.child);
  }, 30_000);
});
