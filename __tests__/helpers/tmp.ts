/**
 * Temporary directories for tests, in one place, so they are removed without
 * anyone remembering to (#70).
 *
 * Every directory this creates lives under a per-run root, `<tmpdir>/cogmem-run-<pid>`,
 * and that root is removed when the process exits — including when a test throws
 * or the run is killed by a signal it can handle. A test that never calls
 * `cleanup` still leaves nothing behind, which is the point: the accumulated
 * version of this reached 25 GB in one night and filled the disk.
 *
 * `makeTempDir()` replaces `mkdtempSync(join(tmpdir(), '...'))`:
 *
 * ```ts
 * import { makeTempDir } from './helpers/tmp.js';
 * const dir = makeTempDir('cogmem-thing-');
 * ```
 *
 * The fixed root is deliberate. Cleaning up per directory needs every test to
 * cooperate; cleaning up per run needs one hook.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUN_ROOT_PREFIX = 'cogmem-run-';

let runRoot: string | undefined;
let hooked = false;

/** The per-run root for this process, created on first use. */
export function tempRunRoot(): string {
  if (runRoot) return runRoot;
  runRoot = join(tmpdir(), `${RUN_ROOT_PREFIX}${process.pid}`);
  mkdirSync(runRoot, { recursive: true });
  if (!hooked) {
    hooked = true;
    // Synchronous on purpose: an exit hook may not await, and a directory this
    // small removes instantly.
    process.on('exit', () => {
      removeRunRoot(runRoot!);
    });
  }
  return runRoot;
}

/** A fresh directory under the run root. */
export function makeTempDir(prefix = 'cogmem-test-'): string {
  return mkdtempSync(join(tempRunRoot(), prefix));
}

/** Remove every directory this process created under its run root. */
export function cleanupTempDirs(): void {
  if (runRoot) removeRunRoot(runRoot);
}

function removeRunRoot(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // A test may hold a sqlite handle; the next run's sweep will catch it.
  }
}

/**
 * Remove run roots left by processes that are gone.
 *
 * Only ever touches names matching this module's own prefix inside the temporary
 * directory, so a test that points `TMPDIR` at a shared place cannot lose
 * anything that is not ours. A live pid is left alone: another `bun test` may be
 * running beside this one.
 */
export function sweepStaleRunRoots(root = tmpdir()): number {
  let removed = 0;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.startsWith(RUN_ROOT_PREFIX)) continue;
    const pid = Number(entry.slice(RUN_ROOT_PREFIX.length));
    if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) continue;
    try {
      rmSync(join(root, entry), { recursive: true, force: true });
      removed += 1;
    } catch {
      // Leave it for the next sweep rather than failing a test run over it.
    }
  }
  return removed;
}

/**
 * Empty the project's own temporary root, and only that.
 *
 * `TMPDIR` points at `.cogmem/tmp` for this suite, so every directory a test
 * forgets to remove lands there. Clearing it at the start of a run is what keeps
 * the disk flat while files are migrated one by one (#70, requirement 2).
 *
 * The guard is not decoration. On a shared machine `TMPDIR` is `/tmp`, and a test
 * run that empties `/tmp` would be far worse than the disk growth it prevents, so
 * this refuses unless the resolved root is inside the repository it was given.
 */
export function clearProjectTempRoot(repoRoot: string, root = tmpdir()): { cleared: boolean; entries: number } {
  const target = resolve(root);
  const repo = resolve(repoRoot);
  if (target !== repo && !target.startsWith(repo + sep)) return { cleared: false, entries: 0 };
  if (target === repo) return { cleared: false, entries: 0 };
  let entries: string[];
  try {
    entries = readdirSync(target);
  } catch {
    return { cleared: false, entries: 0 };
  }
  for (const entry of entries) {
    try {
      rmSync(join(target, entry), { recursive: true, force: true });
    } catch {
      // Leave what cannot be removed; the run still proceeds.
    }
  }
  return { cleared: true, entries: entries.length };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
