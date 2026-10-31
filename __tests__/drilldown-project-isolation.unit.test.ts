import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

const memoryBin = join(import.meta.dir, '..', 'src', 'bin', 'memory.ts');
const SECRET = 'project-b secret words';

function show(dbPath: string, projectId: string) {
  return Bun.spawnSync({
    cmd: ['bun', memoryBin, 'show', '--event', 'evt-secret-b', '--project', projectId, '--db', dbPath, '--json'],
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

test('a project-bound drill-down cannot read another project\'s event', () => {
  const dbPath = join(makeTempDir('cogmem-drilldown-'), 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  kernel.eventStore.append({
    eventId: 'evt-secret-b', streamId: 's', streamType: 'thread', eventType: 'MESSAGE',
    rawEventType: 'message', projectId: 'project-b', sessionId: 's', threadId: 's',
    localDate: '2026-06-01', role: 'user', occurredAt: Date.UTC(2026, 5, 1),
    payload: { text: SECRET },
  });
  kernel.close();

  const foreign = show(dbPath, 'project-a');
  const foreignOut = foreign.stdout.toString() + foreign.stderr.toString();
  expect(foreign.exitCode).not.toBe(0);
  expect(foreignOut).not.toContain(SECRET);
  expect(foreignOut).toContain('No raw ledger event found');

  const own = show(dbPath, 'project-b');
  expect(own.exitCode).toBe(0);
  expect(own.stdout.toString()).toContain(SECRET);
});
