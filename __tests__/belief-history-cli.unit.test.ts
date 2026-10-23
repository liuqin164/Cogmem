import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';

const memoryBin = join(import.meta.dir, '..', 'src', 'bin', 'memory.ts');

async function run(args: string[]): Promise<Record<string, unknown>> {
  const proc = Bun.spawn({ cmd: ['bun', memoryBin, ...args], stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(stderr).toBe('');
  expect(exitCode).toBe(0);
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function runHuman(args: string[]): Promise<string> {
  const proc = Bun.spawn({ cmd: ['bun', memoryBin, ...args], stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(stderr).toBe('');
  expect(exitCode).toBe(0);
  return stdout;
}

test('belief history returns the superseded version and names its replacement', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-belief-history-')), 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  const event = kernel.eventStore.append({
    eventId: 'evt-belief-history', streamId: 't', streamType: 'thread', eventType: 'MESSAGE',
    rawEventType: 'message', projectId: 'cogmem', role: 'user',
    occurredAt: Date.UTC(2026, 3, 1), payload: { text: '存储用 SQLite，后来改成 Postgres。' },
  });
  kernel.beliefGovernanceService.apply({
    projectId: 'cogmem', ownership: 'user', beliefType: 'decision', canonicalKey: 'storage',
    statement: 'We use SQLite', evidenceEventIds: [event.eventId],
  });
  const replacement = kernel.beliefGovernanceService.apply({
    projectId: 'cogmem', ownership: 'user', beliefType: 'decision', canonicalKey: 'storage',
    statement: 'We use Postgres', evidenceEventIds: [event.eventId], relation: 'correct',
  });
  kernel.close();

  const out = await run(['belief-history', '--key', 'storage', '--project', 'cogmem', '--db', dbPath, '--json']);
  const versions = out.versions as Array<Record<string, unknown>>;
  expect(versions.length).toBe(2);
  expect(versions[0]!.statement).toBe('We use SQLite');
  expect(versions[0]!.supersededByBeliefId).toBe(replacement.beliefId);
  expect(versions[1]!.statement).toBe('We use Postgres');

  const empty = await run(['belief-history', '--key', 'never-heard-of-it', '--project', 'cogmem', '--db', dbPath, '--json']);
  expect(empty.versions).toEqual([]);

  const human = await runHuman(['belief-history', '--key', 'storage', '--project', 'cogmem', '--db', dbPath]);
  expect(human).toContain('versions=2');
  expect(human).toContain('We use SQLite');
  expect(human).toContain(`supersededBy=${replacement.beliefId}`);
});
