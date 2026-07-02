import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';
import { formatCliJson } from '../src/bin/CliJson.js';
import { DeepWriteCandidateStore } from '../src/store/DeepWriteCandidateStore.js';

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
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-cli-json-')), 'memory.db');
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
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-cli-list-')), 'memory.db');
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
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-cli-plan-')), 'memory.db');
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
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-cli-plan-raw-lag-')), 'memory.db');
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
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-cli-json-')), 'memory.db');
  const output = await runMemory(['dream', '--promote', '--db', dbPath, '--project', 'demo', '--json']);

  expect(output.schemaVersion).toBe('cogmem.cli.v1');
  expect(output.command).toBe('memory.dream');
  expect(output.candidate).toBe(0);
  expect(output.promoted).toBe(0);
  expect(output.needs_confirmation).toBe(0);
  expect(output.beliefs).toBe(0);
});
