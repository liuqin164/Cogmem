/**
 * The shell's baseline measurement (#165 item five): how long a cold process takes to reach IDLE and
 * how big the checkpoint it leaves behind is. Not part of the test suite.
 *
 * Usage: `bun scripts/measure-baseline.ts` — prints one JSON line. README.md's baseline table records
 * the medians of a handful of runs; run it a few times rather than trusting one number.
 *
 * `startToIdleMs` is measured with `process.uptime()`, so it includes bun's own start-up and the
 * module graph, not just `shell.start()`.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanionShell } from '../src/app.ts';
import type { ModelProvider } from '../src/state/agent-loop.ts';

const httpEnabled = !process.argv.includes('--no-http');
const dir = mkdtempSync(join(tmpdir(), 'companion-shell-baseline-'));
const provider: ModelProvider = {
  name: 'baseline',
  model: 'baseline/none',
  async complete() {
    return { text: '', toolCalls: [] };
  },
};
const shell = new CompanionShell({
  config: {
    workspaceRoot: join(dir, 'ws'),
    dataDir: join(dir, 'data'),
    dbPath: join(dir, 'data', 'memory.sqlite'),
    timeZone: 'UTC',
    projectId: 'baseline',
    agentId: 'cogmem-companion-baseline',
    sessionId: 'baseline',
    terminalEnabled: false,
    http: { enabled: httpEnabled, port: 0, hostname: '127.0.0.1' },
    pi: { adapterEnabled: false, plugins: [] },
  },
  modelProvider: provider,
  tick: false,
});
const checkpointPath = join(dir, 'data', 'checkpoint.json');
try {
  await shell.start();
  const startToIdleMs = process.uptime() * 1000;
  const bootCheckpointBytes = statSync(checkpointPath).size;
  const bootTransitions = shell.machine.seq;

  // Drive the history to its cap so the number is the ceiling an operator would actually see, not the
  // two-transition boot file.
  for (let index = 0; index < 120; index += 1) {
    await shell.machine.dispatch('message_received', { runId: `baseline-${index}` });
    await shell.machine.dispatch('run_complete', {});
  }
  const cappedCheckpointBytes = statSync(checkpointPath).size;
  const cappedTransitions = shell.machine.seq;
  const historyRecords = (JSON.parse(readFileSync(checkpointPath, 'utf8')) as { history: unknown[] }).history.length;
  await shell.stop();
  console.log(
    JSON.stringify({
      http: httpEnabled,
      startToIdleMs: Math.round(startToIdleMs),
      bootCheckpointBytes,
      bootTransitions,
      cappedCheckpointBytes,
      cappedTransitions,
      historyRecords,
    }),
  );
} finally {
  // A failure still cleans up: the preload sweep covers this prefix too, but only when the shell
  // suite runs next.
  rmSync(dir, { recursive: true, force: true });
}
