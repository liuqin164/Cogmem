import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #117, 2026-11-01. `CODING_STANDARDS.md` held rules a reader had to interpret; the four
 * merge gates make a diff decidable without asking its author. They exist because this
 * project answered three issues that share one root cause (#86, #94, #96) by noticing the
 * failure and surviving it — a warning, a resolved path, an extra `--config` — instead of
 * removing the baked path. A standard nobody checks is a wish, and the failure mode here is
 * a reviewer reading past it, so each gate is pinned by the sentence that gives it teeth.
 */
test('CODING_STANDARDS.md carries the four merge gates, each with its teeth', () => {
  const standards = readFileSync(join(import.meta.dir, '..', 'CODING_STANDARDS.md'), 'utf8');
  expect(standards).toContain('## A fix, not a way to survive the failure');

  // Gate 1: it must name behaviour a user hits today, and exclude the near-misses.
  expect(standards).toContain('fixes incorrect behaviour that exists today');
  expect(standards).toContain('armour for a wound nobody has');

  // Gate 2: the one that rejects the guard, the fallback and the warning. Its test sentence
  // and its list of costumes are both load-bearing.
  expect(standards).toContain('not built out of failure-tolerance machinery');
  expect(standards).toContain('does it correct the logic at the root cause, or does it notice a failure and arrange to');
  expect(standards).toContain('the failure still exists and is now quieter');

  // Gate 3 and 4 keep the fix inside the system that has the bug, at its size.
  expect(standards).toContain('not a second system');
  expect(standards).toContain('size is proportional to the defect');

  // The boundary matters: these judge bug fixes, not documentation or ledger work, and a
  // reader who applies them to everything will start refusing honest release work.
  expect(standards).toContain('Documentation, ledger and release work are not in');
});
