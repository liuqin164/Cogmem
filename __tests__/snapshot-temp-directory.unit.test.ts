import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  describeSqliteTempDirectoryFailure,
  resolveSqliteTempDirectory,
  sqliteTempDirectoryIsWritable,
} from '../src/utils/SqliteTempDirectory.js';

/**
 * #64: when SQLite has no usable temporary directory, the operation that needed
 * one must not report a database failure.
 *
 * Nothing here depends on a permission bit being enforced. An earlier version
 * ran the export in a child whose `TMPDIR` was `chmod 500`, which passes on a
 * developer sandbox and fails on a CI runner running as root — where the owner
 * can write anyway, SQLite succeeds, and the assertion has nothing to see. The
 * classification is therefore driven through an injected environment, and "a
 * directory that cannot hold a file" is expressed as a regular file, which fails
 * for every user.
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

function makeDirs(): { root: string; writable: string; dbDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'cogmem-snapshot-temp-'));
  const writable = join(root, 'writable-temp');
  const dbDir = join(root, 'db');
  for (const dir of [writable, dbDir]) mkdirSync(dir, { recursive: true });
  return { root, writable, dbDir };
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
  test('a database error keeps its own message when the temp directory is usable', () => {
    const dirs = makeDirs();
    // The other direction matters as much: relabelling a real database problem
    // as a temp-directory one would be the same misattribution again.
    expect(describeSqliteTempDirectoryFailure(
      'exporting a snapshot',
      new Error('unable to open database file'),
      { TMPDIR: dirs.writable } as NodeJS.ProcessEnv,
    )).toBeUndefined();

    // A non-error, or an unrelated failure, is never relabelled.
    expect(describeSqliteTempDirectoryFailure('exporting a snapshot', new Error('no such table: neurons'), { TMPDIR: dirs.writable } as NodeJS.ProcessEnv)).toBeUndefined();
  });

  test('a temp directory that cannot hold a file is named in the error', () => {
    const dirs = makeDirs();
    // A regular file where a directory is expected: writing a probe inside it
    // fails for every user, root included, so this does not depend on the
    // permission bit doing the work.
    const notADirectory = join(dirs.root, 'not-a-directory');
    writeFileSync(notADirectory, '');

    const described = describeSqliteTempDirectoryFailure(
      'exporting a snapshot',
      new Error('unable to open database file'),
      { TMPDIR: notADirectory } as NodeJS.ProcessEnv,
    );

    expect(described?.message).toContain('sqlite_temp_directory_unusable');
    expect(described?.message).toContain('exporting a snapshot');
    expect(described?.message).toContain(notADirectory);
    expect(described?.message).toContain('TMPDIR');
    expect(described?.message).toContain('unable to open database file');
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
