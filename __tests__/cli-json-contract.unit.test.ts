import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';
import { formatCliJson } from '../src/bin/CliJson.js';
import { DeepWriteCandidateStore } from '../src/store/DeepWriteCandidateStore.js';
import { makeTempDir } from './helpers/tmp.js';

test('shared CLI JSON metadata cannot be overridden by command payloads', () => {
  expect(formatCliJson('memory.status', { command: 'spoofed', schemaVersion: 'old', value: 1 })).toEqual({
    command: 'memory.status', schemaVersion: 'cogmem.cli.v1', value: 1,
  });
});

const memoryBin = join(import.meta.dir, '..', 'src', 'bin', 'memory.ts');
const cogmemBin = join(import.meta.dir, '..', 'src', 'bin', 'cogmem.ts');

async function runMemory(args: string[]): Promise<Record<string, unknown>> {
  const proc = Bun.spawn({
    cmd: ['bun', memoryBin, ...args],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(stderr).toBe('');
  expect(exitCode).toBe(0);
  return JSON.parse(stdout) as Record<string, unknown>;
}

test('top-level help documents the machine-readable JSON shape', async () => {
  const proc = Bun.spawn({ cmd: ['bun', cogmemBin, '--help'], stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  expect(stdout).toContain('cogmem.cli.v1');
  expect(stdout).toContain('arrays use items');
  expect(stdout).toContain('needs_confirmation');
});

test('memory status --json exposes stable top-level queue counters', async () => {
  const dbPath = join(makeTempDir('cogmem-cli-json-'), 'memory.db');
  const output = await runMemory(['status', '--db', dbPath, '--project', 'demo', '--json']);

  expect(output.schemaVersion).toBe('cogmem.cli.v1');
  expect(output.command).toBe('memory.status');
  expect(output.candidate).toBe(0);
  expect(output.promoted).toBe(0);
  expect(output.needs_confirmation).toBe(0);
  expect(output.beliefs).toBe(0);
  expect(output.dreamCandidateQueue).toEqual(expect.objectContaining({ candidate: 0, promoted: 0 }));
});

test('memory list --since and --order expose exact source locators', async () => {
  const dbPath = join(makeTempDir('cogmem-cli-list-'), 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  const first = kernel.eventStore.append({
    eventId: 'evt-list-1', streamId: 'thread-list', streamType: 'thread',
    eventType: 'RAW_EVENT_RECORDED', rawEventType: 'message', projectId: 'demo',
    role: 'user', occurredAt: 1, payload: { text: 'old unrelated event' },
  });
  const second = kernel.eventStore.append({
    eventId: 'evt-list-2', streamId: 'thread-list', streamType: 'thread',
    eventType: 'RAW_EVENT_RECORDED', rawEventType: 'message', projectId: 'demo',
    role: 'user', occurredAt: 2, payload: { text: 'memory context black box anchor' },
  });
  const third = kernel.eventStore.append({
    eventId: 'evt-list-3', streamId: 'thread-list', streamType: 'thread',
    eventType: 'RAW_EVENT_RECORDED', rawEventType: 'message', projectId: 'demo',
    role: 'assistant', occurredAt: 3, payload: { text: 'assistant follow up' },
  });
  kernel.close();

  const output = await runMemory([
    'list', '--db', dbPath, '--project', 'demo', '--since', String(second.globalSeq),
    '--order', 'asc', '--limit', '10', '--json',
  ]);

  const events = output.events as Array<Record<string, any>>;
  expect(events.map((event) => event.eventId)).toEqual([second.eventId, third.eventId]);
  expect(events.every((event) => event.globalSeq >= second.globalSeq!)).toBe(true);
  expect(events[0].sourceLocator.command).toContain(`cogmem memory show --event ${second.eventId} --project demo`);
  expect(events[0].sourceLocator.command).toContain('--json');
  expect(events.map((event) => event.eventId)).not.toContain(first.eventId);
});

test('memory candidates default groups actionable and deferred queues and memory plan returns next actions', async () => {
  const dbPath = join(makeTempDir('cogmem-cli-plan-'), 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  const store = new DeepWriteCandidateStore(kernel.factStore.getDatabase());
  store.insertRun({
    runId: 'run-plan', projectId: 'demo', sourceNeuronIds: [], mode: 'test',
    promptHash: 'p', outputHash: 'o', status: 'succeeded',
  });
  store.insertCandidates([
    {
      candidateId: 'cand-actionable', runId: 'run-plan', candidateType: 'summary',
      status: 'candidate', confidence: 0.9, content: { text: 'promote me' }, evidence: [],
    },
    {
      candidateId: 'cand-deferred', runId: 'run-plan', candidateType: 'correction',
      status: 'needs_confirmation', confidence: 0.4, content: { text: 'needs source' }, evidence: [],
      reviewAfter: Date.now() + 60_000,
    },
  ]);
  kernel.close();

  const candidates = await runMemory(['candidates', '--db', dbPath, '--project', 'demo', '--json']);
  expect(candidates.status).toBe('grouped');
  expect(candidates.queueSummary).toEqual(expect.objectContaining({
    candidate: 1,
    needs_confirmation: 1,
    deferredNeedsConfirmation: 1,
  }));
  expect((candidates.groups as any).candidate[0].candidateId).toBe('cand-actionable');
  expect((candidates.groups as any).deferred[0].candidateId).toBe('cand-deferred');

  const plan = await runMemory(['plan', '--db', dbPath, '--project', 'demo', '--json']);
  expect(plan.command).toBe('memory.plan');
  expect((plan.nextActions as Array<Record<string, unknown>>).some((action) => action.type === 'govern')).toBe(true);
  expect((plan.nonBlocking as Array<Record<string, unknown>>).some((item) => item.type === 'deferred_confirmation')).toBe(true);
});

test('memory plan does not suggest dream tick for raw-only dream ledger lag', async () => {
  const dbPath = join(makeTempDir('cogmem-cli-plan-raw-lag-'), 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  kernel.recordRawEvent({
    eventId: 'evt-raw-lag-1',
    projectId: 'demo',
    threadId: 'thread-raw-lag',
    sessionId: 'session-raw-lag',
    role: 'user',
    content: 'This raw ledger event has not been curated yet.',
  });
  expect(kernel.getDreamBacklogStatus('demo').undreamedRawCount).toBe(1);
  expect(kernel.getEpisodeDreamStatus('demo').pending).toBe(0);
  kernel.close();

  const plan = await runMemory(['plan', '--db', dbPath, '--project', 'demo', '--json']);
  const nextActions = plan.nextActions as Array<Record<string, unknown>>;
  const nonBlocking = plan.nonBlocking as Array<Record<string, unknown>>;
  expect(nextActions.some((action) => action.type === 'dream_tick')).toBe(false);
  expect(nonBlocking).toContainEqual(expect.objectContaining({
    type: 'raw_dream_ledger_lag',
    count: 1,
    episodeDreamPending: 0,
    resolvableByDreamTick: false,
    safeForAutomation: false,
  }));
});

test('memory dream --promote --json exposes queue counters without requiring governance.queue paths', async () => {
  const dbPath = join(makeTempDir('cogmem-cli-json-'), 'memory.db');
  const output = await runMemory(['dream', '--promote', '--db', dbPath, '--project', 'demo', '--json']);

  expect(output.schemaVersion).toBe('cogmem.cli.v1');
  expect(output.command).toBe('memory.dream');
  expect(output.candidate).toBe(0);
  expect(output.promoted).toBe(0);
  expect(output.needs_confirmation).toBe(0);
  expect(output.beliefs).toBe(0);
});

/**
 * #83: `--out <path>` — a reliable JSON file, not a redirect the shell can truncate.
 *
 * The flag used to be accepted and silently ignored: `doctor --json --out f` exited 0,
 * printed to stdout, and created no file. These tests pin the contract that replaces it.
 */
test('#83 --out writes the same JSON the command prints, and says so on failure', async () => {
  const dir = makeTempDir('cogmem-cli-out-');
  const target = join(dir, 'report.json');
  const config = join(dir, 'config.toml');

  const written = Bun.spawnSync({
    cmd: ['bun', cogmemBin, 'doctor', '--json', '--config', config, '--out', target],
    cwd: join(import.meta.dir, '..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(written.exitCode).toBe(0);
  expect(existsSync(target)).toBe(true);
  // Same payload as stdout: the file is a convenience, not a different view.
  const fromStdout = JSON.parse(String(written.stdout)) as Record<string, unknown>;
  const fromFile = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
  expect(fromFile).toEqual(fromStdout);
  expect(fromFile.command).toBe('doctor');

  // A path that cannot be written is an error, not a silent success — and it must not
  // leave a half-written file where the caller asked for a report.
  const missingParent = join(dir, 'no-such-dir', 'report.json');
  const failed = Bun.spawnSync({
    cmd: ['bun', cogmemBin, 'doctor', '--json', '--config', config, '--out', missingParent],
    cwd: join(import.meta.dir, '..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(failed.exitCode).not.toBe(0);
  expect(String(failed.stderr)).toContain('no-such-dir');
  expect(existsSync(missingParent)).toBe(false);
});

test('#83 --out replaces an existing file whole, and a failed run leaves the old one intact', async () => {
  const dir = makeTempDir('cogmem-cli-out-atomic-');
  const target = join(dir, 'report.json');
  const config = join(dir, 'config.toml');
  writeFileSync(target, '{"previous":true}');

  const ok = Bun.spawnSync({
    cmd: ['bun', cogmemBin, 'doctor', '--json', '--config', config, '--out', target],
    cwd: join(import.meta.dir, '..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(ok.exitCode).toBe(0);
  // Replaced whole: the old document is gone, not merged or truncated mid-write.
  expect(readFileSync(target, 'utf8')).not.toContain('previous');
  expect(() => JSON.parse(readFileSync(target, 'utf8'))).not.toThrow();

  // Point the flag at a directory: the write must fail without destroying it, and the
  // report that was there must still parse.
  const before = readFileSync(target, 'utf8');
  const asDir = join(dir, 'a-directory');
  mkdirSync(asDir);
  const failed = Bun.spawnSync({
    cmd: ['bun', cogmemBin, 'doctor', '--json', '--config', config, '--out', asDir],
    cwd: join(import.meta.dir, '..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(failed.exitCode).not.toBe(0);
  expect(readFileSync(target, 'utf8')).toBe(before);
});

test('#83 snapshot export keeps --out meaning the snapshot, not the JSON', async () => {
  const dir = makeTempDir('cogmem-cli-out-snapshot-');
  const dbPath = join(dir, 'memory.db');
  const snapPath = join(dir, 'memory.snap');
  const kernel = createMemoryKernel({ dbPath });
  kernel.close();

  const snapshotBin = join(import.meta.dir, '..', 'src', 'bin', 'snapshot.ts');
  const exported = Bun.spawnSync({
    cmd: ['bun', snapshotBin, 'export', '--db', dbPath, '--out', snapPath, '--json'],
    cwd: join(import.meta.dir, '..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(exported.exitCode).toBe(0);
  expect(existsSync(snapPath)).toBe(true);
  // `snapshot export --out` is a snapshot path, so the JSON report must not be written
  // there: the file stays a snapshot, and the report still goes to stdout.
  expect(JSON.parse(String(exported.stdout))).toEqual(expect.objectContaining({ command: 'snapshot.export' }));
  expect(readFileSync(snapPath, 'utf8').startsWith('{')).toBe(false);
});

/**
 * #83 follow-up: the argument itself is validated, not just the write.
 *
 * `--out` with no value, `--out=`, and `--out --json` all used to be accepted: the flag
 * took the next token as a path whatever it was, so `--out --json` created a file named
 * `--json` in the working directory and exited 0. A missing value is a usage error.
 */
function runDoctorWith(dir: string, args: string[]) {
  const config = join(dir, 'config.toml');
  return Bun.spawnSync({
    cmd: ['bun', cogmemBin, 'doctor', '--json', '--config', config, ...args],
    cwd: join(import.meta.dir, '..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

test('#83 --out rejects a missing value, an empty value, and a following flag', () => {
  const dir = makeTempDir('cogmem-cli-out-args-');

  // `--out` last, with nothing after it.
  const missing = runDoctorWith(dir, ['--out']);
  expect(missing.exitCode).not.toBe(0);
  expect(String(missing.stderr)).toContain('--out');

  // `--out=` — present but empty.
  const empty = runDoctorWith(dir, ['--out=']);
  expect(empty.exitCode).not.toBe(0);
  expect(String(empty.stderr)).toContain('--out');

  // `--out --json`: the next token is an option, not a path. This is the case that wrote
  // a file literally named `--json` into the working directory.
  const flagAsPath = runDoctorWith(dir, ['--out', '--json']);
  expect(flagAsPath.exitCode).not.toBe(0);
  expect(String(flagAsPath.stderr)).toContain('--out');
  expect(existsSync(join(import.meta.dir, '..', '--json'))).toBe(false);

  // And no unexpected file appeared in the target directory either.
  expect(existsSync(join(dir, '--json'))).toBe(false);
});

test('#83 --out accepts both spellings and writes the same document either way', () => {
  const dir = makeTempDir('cogmem-cli-out-spellings-');
  const spaced = join(dir, 'spaced.json');
  const joined = join(dir, 'joined.json');

  const a = runDoctorWith(dir, ['--out', spaced]);
  expect(a.exitCode).toBe(0);
  const b = runDoctorWith(dir, [`--out=${joined}`]);
  expect(b.exitCode).toBe(0);

  for (const path of [spaced, joined]) {
    expect(existsSync(path)).toBe(true);
    expect(() => JSON.parse(readFileSync(path, 'utf8'))).not.toThrow();
  }
  // Same document as stdout, and identical to each other: the spelling is not a dialect.
  expect(JSON.parse(readFileSync(spaced, 'utf8'))).toEqual(JSON.parse(readFileSync(joined, 'utf8')));
  expect(JSON.parse(readFileSync(spaced, 'utf8'))).toEqual(JSON.parse(String(a.stdout)));
});
