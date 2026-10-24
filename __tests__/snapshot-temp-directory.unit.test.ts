import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveSqliteTempDirectory, sqliteTempDirectoryIsWritable } from '../src/utils/SqliteTempDirectory.js';

/**
 * #64: when SQLite has no usable temporary directory, the operation that needed
 * one must not report a database failure.
 *
 * `VACUUM` needs a real temp file, SQLite picks the directory before any
 * application code runs, and when it cannot write there it says
 * `unable to open database file` — naming the database, which is fine. That
 * misattribution sent two separate investigations after the database path in
 * #61, so the message is pinned here on the real operations.
 *
 * The child process points `TMPDIR` and `SQLITE_TMPDIR` at a directory that
 * exists and cannot be written, so the failure is deterministic rather than
 * dependent on how this machine's `/var/tmp` happens to be mounted.
 */

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function makeDirs(): { root: string; unusable: string; writable: string; dbDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-snapshot-temp-'));
  const unusable = join(root, 'unusable-temp');
  const writable = join(root, 'writable-temp');
  const dbDir = join(root, 'db');
  for (const dir of [unusable, writable, dbDir]) mkdirSync(dir, { recursive: true });
  chmodSync(unusable, 0o500);
  return { root, unusable, writable, dbDir };
}

/** Create a kernel and export a snapshot, in a child with the given environment. */
async function exportSnapshotInChild(dirs: { root: string; dbDir: string }, tempDir: string) {
  const dbPath = join(dirs.dbDir, 'memory.db');
  const snapshotPath = join(dirs.root, 'snapshot.bin');
  const script = `
    import { createMemoryKernel } from ${JSON.stringify(join(coreRoot, 'src/factory.ts'))};
    const kernel = createMemoryKernel({ dbPath: ${JSON.stringify(dbPath)} });
    try {
      await kernel.exportSnapshot(${JSON.stringify(snapshotPath)});
      console.log('RESULT:ok');
    } catch (error) {
      console.log('RESULT:' + (error instanceof Error ? error.message : String(error)));
    }
    kernel.close();
  `;
  const proc = Bun.spawn({
    cmd: ['bun', '-e', script],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, TMPDIR: tempDir, SQLITE_TMPDIR: tempDir, NO_COLOR: '1' },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const line = stdout.split('\n').find((item) => item.startsWith('RESULT:')) ?? '';
  return { exitCode, stderr, result: line.slice('RESULT:'.length) };
}

describe('#64 an unusable SQLite temp directory is named, not blamed on the database', () => {
  test('exporting a snapshot on an unwritable temp directory says which directory', async () => {
    const dirs = makeDirs();

    // The scenario has to actually hold, or the test proves nothing.
    expect(sqliteTempDirectoryIsWritable(dirs.unusable)).toBe(false);
    expect(resolveSqliteTempDirectory({ TMPDIR: dirs.unusable } as NodeJS.ProcessEnv)).toBe(dirs.unusable);

    const run = await exportSnapshotInChild(dirs, dirs.unusable);

    expect(run.exitCode).toBe(0);
    expect(run.result).toContain('sqlite_temp_directory_unusable');
    expect(run.result).toContain('exporting a snapshot');
    expect(run.result).toContain(dirs.unusable);
    expect(run.result).toContain('TMPDIR');
  });

  test('a writable temp directory still exports the snapshot', async () => {
    const dirs = makeDirs();
    const run = await exportSnapshotInChild(dirs, dirs.writable);

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    // The control: the same operation, the same child, one variable changed.
    expect(run.result).toBe('ok');
    expect(statSync(join(dirs.root, 'snapshot.bin')).size).toBeGreaterThan(0);
  });
});
