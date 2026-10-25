/**
 * Registered as Bun's test preload, so the sweep happens before any test file
 * runs and cannot be forgotten by one of them (#70).
 *
 * It removes only `cogmem-run-*` entries inside the temporary directory — the
 * directories this suite creates — and leaves everything else, including
 * anything a test deliberately points `TMPDIR` at.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { clearProjectTempRoot, sweepStaleRunRoots } from './tmp.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Requirement 2 of #70: the test entry starts from a clean root, so growth cannot
// accumulate across runs even while files are still being migrated to the helper.
// The bound is deliberate — `clearProjectTempRoot` refuses to touch anything that
// is not inside this repository, because `TMPDIR` on a shared machine is /tmp and
// emptying that is not this suite's business.
const cleared = clearProjectTempRoot(repoRoot);
if (cleared.cleared) {
  console.error(`[cogmem tests] cleared ${cleared.entries} entr(ies) from the project temp root before the run`);
}
const removed = sweepStaleRunRoots();
if (removed > 0) {
  // Not silent: a run that starts by cleaning up is telling you the last one left
  // something behind.
  console.error(`[cogmem tests] removed ${removed} temp run root(s) left by earlier runs`);
}
