import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTempDir } from './helpers/tmp.js';
import { ensureUsableTempSpace } from '../src/utils/SqliteTempDirectory.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * #61 and #64 fixed two operations that needed temporary space; a third surfaced as a
 * plain event append failing with `unable to open database file` on a machine whose
 * temporary directory cannot be written — a message that blames the database.
 *
 * The fallback is conditional on purpose: on a machine where the directory works,
 * nothing changes, because a large sort belongs on disk rather than in RAM.
 */
function fakeDb(): { exec: (sql: string) => unknown; statements: string[] } {
  const statements: string[] = [];
  return { statements, exec: (sql: string) => statements.push(sql) };
}

test('a usable temporary directory leaves the connection alone', () => {
  const db = fakeDb();
  const writable = mkdtempSync(join(tmpdir(), 'cogmem-temp-ok-'));
  expect(ensureUsableTempSpace(db, { TMPDIR: writable } as NodeJS.ProcessEnv)).toBe(false);
  expect(db.statements).toEqual([]);
  rmSync(writable, { recursive: true, force: true });
});

test('an unusable temporary directory keeps this connection in memory', () => {
  const db = fakeDb();
  // A regular file where a directory is expected: unusable for every user, root
  // included, which is what makes this portable rather than sandbox-dependent.
  const notADirectory = join(makeTempDir('cogmem-temp-bad-'), 'not-a-directory');
  writeFileSync(notADirectory, '');
  expect(ensureUsableTempSpace(db, { TMPDIR: notADirectory } as NodeJS.ProcessEnv)).toBe(true);
  expect(db.statements).toEqual(['PRAGMA temp_store = MEMORY']);
});

test('an event append that needs temporary space survives without one', async () => {
  // The end-to-end version, in a child whose temporary directory cannot be used. 520
  // appends is where the real suite tripped, so it is the shape used here.
  // The same epoch the split-plan suite uses for that local date: a mismatch here is a
  // warning from the kernel, and asserting on stderr is worth keeping, so the fixture
  // has to be right rather than the warning tolerated.
  const july4 = Date.UTC(2026, 6, 4);
  const script = `
    import { createMemoryKernel } from ${JSON.stringify(join(coreRoot, 'src/factory.ts'))};
    const kernel = createMemoryKernel({ dbPath: ${JSON.stringify(join(makeTempDir('cogmem-append-'), 'memory.db'))} });
    for (let index = 0; index < 520; index += 1) {
      kernel.recordRawEvent({
        projectId: 'brain', workspaceId: 'brain', threadId: 'big', sessionId: 'big',
        role: 'assistant', content: 'big event ' + index, sourceId: 'test',
        occurredAt: ${july4} + index, eventOrdinal: index, localDate: '2026-07-04',
      });
    }
    console.log('RESULT:ok total=' + kernel.eventStore.getEventCount());
    kernel.close();
  `;
  const notADirectory = join(makeTempDir('cogmem-append-tmp-'), 'not-a-directory');
  writeFileSync(notADirectory, '');
  const proc = Bun.spawn({
    cmd: ['bun', '-e', script],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, TMPDIR: notADirectory, SQLITE_TMPDIR: notADirectory, NO_COLOR: '1' },
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;

  expect(stderr).toBe('');
  expect(exitCode).toBe(0);
  expect(stdout).toContain('RESULT:ok total=520');
}, 60000);
