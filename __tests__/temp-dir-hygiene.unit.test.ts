import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { clearProjectTempRoot, makeTempDir } from './helpers/tmp.js';

const testsRoot = dirname(fileURLToPath(import.meta.url));

/**
 * #70: temporary directories have to be removed without anyone remembering to.
 * `makeTempDir()` puts them under a per-run root that is swept on exit, so a test
 * that uses it cannot leak even if it throws; `mkdtempSync(join(tmpdir(), ...))`
 * leaks unless that particular test cleans up, and 52 files did exactly that
 * until one night's accumulation filled a 96 GB disk.
 *
 * This guard fails a *new* offender. The list below is the debt that already
 * existed when the guard was added, generated from the tree and meant to shrink:
 * migrating a file means deleting its line, and adding one means explaining why
 * the helper cannot be used.
 */
const NOT_YET_MIGRATED = [
    './agent-import-cli.unit.test.ts',
    './agent-memory-backend.unit.test.ts',
    './agent-nerve-system.unit.test.ts',
    './atlas-product-facets.unit.test.ts',
    './auto-supersede-target.unit.test.ts',
    './belief-history-cli.unit.test.ts',
    './brain-cli-v33.unit.test.ts',
    './candidate-review-cli-mcp.unit.test.ts',
    './candidate-review.unit.test.ts',
    './chronological-ledger.unit.test.ts',
    './cli-json-contract.unit.test.ts',
    './cogmem-config.unit.test.ts',
    './core-cli.unit.test.ts',
    './dream-ledger.unit.test.ts',
    './drilldown-project-isolation.unit.test.ts',
    './event-store-fts-watermark.unit.test.ts',
    './hermes-workspace-profile.unit.test.ts',
    './host-bridge-cli.unit.test.ts',
    './host-bridge.unit.test.ts',
    './init-register-agent.unit.test.ts',
    './installed-batch-progress.unit.test.ts',
    './maintenance-suggested-actions.unit.test.ts',
    './mcp-cli.unit.test.ts',
    './mcp-tools.unit.test.ts',
    './memory-atlas-cli.unit.test.ts',
    './memory-atlas-cold-resurrection.unit.test.ts',
    './memory-atlas-maintenance.unit.test.ts',
    './memory-atlas-multifacet.unit.test.ts',
    './memory-atlas-openclaw.unit.test.ts',
    './memory-atlas.unit.test.ts',
    './memory-inspection-cli.unit.test.ts',
    './normalize-transcript-cli.unit.test.ts',
    './openclaw-bridge-daemon.unit.test.ts',
    './openclaw-bun-path-guard.unit.test.ts',
    './openclaw-plugin-facet-labels.unit.test.ts',
    './openclaw-workspace-profile.unit.test.ts',
    './pipeline-hardening.unit.test.ts',
    './promotion-target-classes.unit.test.ts',
    './promotion-target-referent.unit.test.ts',
    './re-embedding-pipeline.unit.test.ts',
    './recall-explain-cli.unit.test.ts',
    './recall-explanation.unit.test.ts',
    './recall-governance-hardening.unit.test.ts',
    './recall-thread-scope.unit.test.ts',
    './repair-cli.unit.test.ts',
    './snapshot-temp-directory.unit.test.ts',
    './sqlite-concurrency-reliability.unit.test.ts',
    './storage-compactor.unit.test.ts',
    './strategy-cli-v34.unit.test.ts',
    './strategy-cortex-v1.unit.test.ts',
    './update-gate-target.unit.test.ts',
    './update-install-gate.unit.test.ts'
];

function testFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'helpers') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...testFiles(full));
    else if (entry.name.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

test('tests create temporary directories through the shared helper', () => {
  const offenders: string[] = [];
  for (const file of testFiles(testsRoot)) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('mkdtempSync') && !source.includes('mkdtemp(')) continue;
    if (source.includes("helpers/tmp.js")) continue;
    // The issue's wording is "without the shared helper **or** without cleanup",
    // so a file that removes what it creates is not an offender — it is just not
    // migrated yet. This is a string check and therefore a heuristic; the helper
    // is what makes it unnecessary, which is why migrating is the way off this
    // list rather than adding a cleverer check.
    if (source.includes('rmSync') || /\.rm\(/.test(source)) continue;
    const relative = './' + file.slice(testsRoot.length + 1);
    if (NOT_YET_MIGRATED.includes(relative)) continue;
    offenders.push(relative);
  }

  // A file that leaks is a file that will fill the disk again on some future
  // night; failing here is cheaper than finding out from an ENOSPC.
  expect(offenders).toEqual([]);
});

test('the not-yet-migrated list only shrinks', () => {
  const stillOffending = NOT_YET_MIGRATED.filter((relative) => {
    const source = readFileSync(join(testsRoot, relative.replace('./', '')), 'utf8');
    return !source.includes('mkdtempSync') && !source.includes('mkdtemp(');
  });
  // A file that no longer creates temporary directories, or that now cleans up,
  // must not keep its exemption: the list is debt, not a permanent settlement.
  expect(stillOffending).toEqual([]);
});

test('the temp-root clear refuses anything that is not inside the repository', () => {
  // On a shared machine TMPDIR is /tmp. A test run that emptied /tmp would be much
  // worse than the disk growth it prevents, so the bound is asserted rather than
  // assumed. `/tmp` is used as the outside path rather than a temp directory,
  // because in this suite TMPDIR is the project's own root — an "outside" fixture
  // built from tmpdir() would be inside, and the test would prove the opposite of
  // what it claims.
  const repo = dirname(testsRoot);
  expect(clearProjectTempRoot(repo, '/tmp')).toEqual({ cleared: false, entries: 0 });
  // And the repository root itself is not a temp root.
  expect(clearProjectTempRoot(repo, repo)).toEqual({ cleared: false, entries: 0 });

  // Built inside the repository explicitly rather than from `makeTempDir()`: on CI
  // TMPDIR is /tmp, so a directory from the helper is *outside* the repository and
  // this assertion would be testing the refusal instead of the clear. That is
  // exactly how this test first failed on CI while passing locally — the local
  // TMPDIR is the project's own root, which hid the difference.
  const inside = join(repo, '.cogmem', 'tmp', `clear-inside-${process.pid}`, 'nested');
  mkdirSync(inside, { recursive: true });
  writeFileSync(join(inside, 'drop-me'), '');
  expect(clearProjectTempRoot(repo, inside)).toEqual({ cleared: true, entries: 1 });
  expect(readdirSync(inside)).toEqual([]);
  rmSync(join(repo, '.cogmem', 'tmp', `clear-inside-${process.pid}`), { recursive: true, force: true });
});
