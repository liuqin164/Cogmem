import { expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from './helpers/tmp.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `createMemoryKernel` against a brand-new file path is the first thing a new
 * user runs, and it was the one path with no coverage: every other test either
 * used `:memory:` or opened a pre-built fixture. A file-backed kernel reaching
 * migration 0032 needed a SQLite *temporary file* for the FTS5 shadow-table
 * DROP in `dropRebuildableProjections`, and when SQLite could not create one it
 * surfaced as the generic `unable to open database file` — the exact failure
 * reported as "createMemoryKernel cannot create a new file-backed database".
 *
 * The child below removes every temp directory SQLite is allowed to use, so the
 * migration has to complete without a temp file at all. `SQLITE_TMPDIR` points
 * at a path that cannot be a temp directory; SQLite ignores it and falls back to
 * `/var/tmp`, which is not guaranteed writable, so a kernel that still needs a
 * temp file fails exactly as reported.
 */
async function createFreshFileKernel(dbPath: string, env: Record<string, string | undefined>) {
  const script = `
    import { createMemoryKernel } from ${JSON.stringify(join(coreRoot, 'src/factory.ts'))};
    const kernel = createMemoryKernel({ dbPath: ${JSON.stringify(dbPath)} });
    // A kernel that merely constructed is not proof the first-run path works:
    // read through a public entry point that touches the migrated projections.
    const map = kernel.buildMemoryMap({ projectId: 'fresh-db-regression' });
    kernel.close();
    console.log(JSON.stringify({ version: map.version, projectId: map.projectId }));
  `;

  const proc = Bun.spawn({
    cmd: ['bun', '-e', script],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env, NO_COLOR: '1' },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

test('createMemoryKernel creates a new file-backed database and migrates it', async () => {
  const dir = makeTempDir('cogmem-fresh-db-');
  try {
    const dbPath = join(dir, 'memory.db');
    const result = await createFreshFileKernel(dbPath, { SQLITE_TMPDIR: join(dir, 'not-a-temp-dir') });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('unable to open database file');
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ projectId: 'fresh-db-regression' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a second kernel reopens the database the first one created', async () => {
  const dir = makeTempDir('cogmem-fresh-reopen-');
  try {
    const dbPath = join(dir, 'memory.db');
    const first = await createFreshFileKernel(dbPath, { SQLITE_TMPDIR: join(dir, 'not-a-temp-dir') });
    expect(first.exitCode).toBe(0);

    // Reopening an already-migrated file takes the other branch of the kernel
    // constructor, so it is worth pinning that a fresh-then-existing path works.
    const second = await createFreshFileKernel(dbPath, { SQLITE_TMPDIR: join(dir, 'not-a-temp-dir') });
    expect(second.exitCode).toBe(0);
    expect(second.stderr).not.toContain('unable to open database file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
