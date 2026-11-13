/**
 * Shell-level kill fixture (#165 storage round): runs a real `CompanionShell` with a scripted
 * provider and blocks at a chosen point, so the test can SIGKILL it there and then ask the next
 * process what the disk says. Modes:
 *
 *   stream        a run whose provider never answers — killed mid-stream, after `message_start`
 *   stream-steer  the same run with two lines steered into it while it is going
 *   tool          a run whose `bash` tool never returns — the call recorded in flight
 *   dream         the IDLE→DREAMING transition landed, the nightly integration still in flight
 *   write         a RUNNING shell whose checkpoint is rewritten continuously — killed mid-write
 *   recover       a normal start, then report what the recovery path read back from the disk
 *   recover-steer a normal start, then consume the restored queue in order and report what the model saw
 *
 * One JSON line per step on stdout; the process holds until it is killed (or a `recover*` mode exits).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CompanionShell } from '../../src/app.ts';
import type { ModelCompletionInput, ModelProvider, ModelTurn } from '../../src/state/agent-loop.ts';

const dir = process.argv[2];
const mode = process.argv[3] ?? 'recover';
if (!dir) throw new Error('shell-kill-process: a data directory is required');

const workspace = join(dir, 'ws');
mkdirSync(workspace, { recursive: true });

// Long enough that the old 500-char checkpoint truncation cannot hold the tail; the marker only
// exists past the old ceiling, so "the whole prompt is back" is decidable.
const LONG_PROMPT = `stream a reply ${'A'.repeat(1200)} TAIL-MARKER-被打断的原话`;

function say(record: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

let onProviderEntered: (() => void) | undefined;
const providerEntered = new Promise<void>((resolvePromise) => {
  onProviderEntered = resolvePromise;
});

/** Every request the model saw, so a recovery test can ask what order the queue was delivered in. */
const providerCalls: ModelCompletionInput[] = [];

/** The scripted model: blocks exactly where the mode says, and never comes back on its own. */
function providerFor(currentMode: string): ModelProvider {
  return {
    name: 'kill-script',
    model: 'kill/script',
    async complete(input: ModelCompletionInput): Promise<ModelTurn> {
      providerCalls.push(input);
      if (currentMode === 'tool') return { text: '', toolCalls: [{ toolCallId: 'call-kill', toolName: 'bash', input: { command: 'sleep 5' } }] };
      if (['stream', 'stream-steer', 'write'].includes(currentMode)) {
        say({ event: 'streaming' });
        onProviderEntered?.();
        return await new Promise<ModelTurn>(() => {});
      }
      say({ event: 'provider_called' });
      return { text: '继续了。', toolCalls: [] };
    },
  };
}

const shell = new CompanionShell({
  config: {
    workspaceRoot: workspace,
    dataDir: dir,
    dbPath: join(dir, 'data', 'memory.sqlite'),
    timeZone: 'UTC',
    projectId: 'companion-kill',
    agentId: 'cogmem-companion-kill',
    sessionId: 'session-kill',
    terminalEnabled: false,
    http: { enabled: false, port: 0, hostname: '127.0.0.1' },
    pi: { adapterEnabled: false, plugins: [] },
    attach: { enabled: false },
  },
  modelProvider: providerFor(mode),
  tick: false,
});

function reportRecovered(): Record<string, unknown> {
  const trace = shell.trace.read();
  const interrupted = typeof (shell as { interruptedRun?: unknown }).interruptedRun === 'function'
    ? (shell as unknown as { interruptedRun(): { runId: string; chars: number; text: string } | undefined }).interruptedRun()
    : undefined;
  return {
    event: 'recovered',
    state: shell.state,
    seq: shell.machine.seq,
    activeRunId: shell.machine.activeRunId ?? null,
    inFlight: shell.machine.runtime.inFlightToolCalls?.length ?? 0,
    lastDreamDate: shell.machine.runtime.lastDreamDate ?? null,
    steering: shell.currentQueued(),
    steeringRestored: trace.filter((record) => record.kind === 'steering_restored').length,
    wakeIntents: shell.machine.wakeIntents.filter((intent) => !intent.consumedAt).map((intent) => intent.id),
    recoveryRecorded: trace.filter((record) => record.kind === 'recovery').length,
    noReplay: trace.filter((record) => record.kind === 'recovery_no_replay').length,
    corruptRecovered: trace.filter((record) => record.kind === 'checkpoint_corrupt_recovered').length,
    traceCorrupt: trace.filter((record) => record.kind === 'trace_corrupt').length,
    captureRuns: trace.filter((record) => record.kind === 'capture_run').length,
    promptRecovered: trace.filter((record) => record.kind === 'prompt_recovered').length,
    interrupted: interrupted ?? null,
  };
}

if (mode === 'recover' || mode === 'recover-steer') {
  try {
    await shell.start();
  } catch (error) {
    say({ event: 'refused', message: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
  say(reportRecovered());
  if (mode === 'recover-steer') {
    // The restored queue is consumed by the next run; record what the model actually saw, per request.
    await shell.submit('继续');
    const calls = providerCalls.map((call) => call.messages.filter((message) => message.role === 'user').map((message) => message.content));
    const injected = shell.trace.read().filter((record) => record.kind === 'steering_injected');
    say({
      event: 'drained',
      steering: shell.currentQueued(),
      calls,
      injected: injected.map((record) => ({ afterTurn: record.afterTurn, beforeTurn: record.beforeTurn, count: record.count })),
    });
  }
  await shell.stop();
  process.exit(0);
}

await shell.start();
// Registered after `start()` so the app's own `tool_execution_start` bookkeeping (the checkpoint write
// that records the call in flight) runs first; this listener only announces that it has landed.
shell.host.bus.on('tool_execution_start', (event: { toolName?: string }) => say({ event: 'tool_running', toolName: event.toolName }));
say({ event: 'idle', state: shell.state, lock: existsSync(join(dir, 'runtime.lock')) });

if (mode === 'dream') {
  // The app's own `runDream` dispatches exactly this before awaiting the integration; dispatching it
  // here lands the same durable state with the integration still in flight.
  await shell.machine.dispatch('dream_window_open', { reason: 'kill_fixture_dream' });
  say({ event: 'dreaming', state: shell.state });
} else {
  void shell.submit(mode === 'tool' ? 'run a tool' : LONG_PROMPT).catch((error) => say({ event: 'submit_failed', message: String(error) }));
}
say({ event: 'holding', state: shell.state });

if (mode === 'stream-steer') {
  await providerEntered;
  await shell.submit('撤回前先看一眼');
  await shell.submit('第二句排在后面');
  say({ event: 'steered', queued: shell.currentQueued() });
}
if (mode === 'write') {
  await providerEntered;
  // A checkpoint rewrite in flight, over and over: the kill has to land inside one of them. The
  // payload is large enough that the write window is real (the storage round measures it).
  for (let n = 0; ; n += 1) {
    shell.machine.updateRuntime({ lastTimeContext: `追写${n}：`.padEnd(60_000, '追') });
    say({ event: 'writing', n });
  }
}
await new Promise(() => {});
