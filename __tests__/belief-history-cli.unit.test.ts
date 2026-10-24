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
  const candidate = {
    projectId: 'cogmem', scope: 'project' as const, subject: 'storage', predicate: 'uses',
    confidence: 0.5, sourceType: 'user' as const, extractionReason: 'explicit_user_statement' as const,
    sourceEventId: event.eventId,
  };
  const first = kernel.beliefStore.upsert({ ...candidate, objectValue: { raw: 'SQLite', type: 'string' }, validFrom: 1000 });
  const replacement = kernel.beliefStore.upsert({
    ...candidate, confidence: 0.99, objectValue: { raw: 'Postgres', type: 'string' }, validFrom: 2000,
  });
  expect(replacement.decision.action).toBe('supersede_existing');
  const canonicalKey = first.belief!.canonicalKey;
  kernel.close();

  const out = await run(['belief-history', '--key', canonicalKey, '--project', 'cogmem', '--db', dbPath, '--json']);
  const versions = out.versions as Array<Record<string, unknown>>;
  expect(versions.length).toBe(2);
  expect(versions[0]!.value).toBe('SQLite');
  expect(versions[0]!.status).toBe('superseded');
  expect(versions[0]!.supersededByBeliefId).toBe(replacement.belief!.id);
  expect(versions[0]!.validFrom).toBe(1000);
  expect(versions[1]!.value).toBe('Postgres');

  const empty = await run(['belief-history', '--key', 'no-such-key', '--project', 'cogmem', '--db', dbPath, '--json']);
  expect(empty.versions).toEqual([]);

  const human = await runHuman(['belief-history', '--key', canonicalKey, '--project', 'cogmem', '--db', dbPath]);
  expect(human).toContain('versions=2');
  expect(human).toContain('SQLite');
  expect(human).toContain(`supersededBy=${replacement.belief!.id}`);
});
