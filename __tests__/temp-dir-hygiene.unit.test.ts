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
    // Comments are stripped first: a file explaining what it used to do is not a
    // file that does it. Then a *call*, not the word — an import that survived a
    // migration is untidy but it does not leak anything, and treating it as a leak
    // makes this guard lie.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // `tmpdir()` counts too: the file that put named sqlite files straight into the
    // temp root never called `mkdtemp`, so the first version of this guard could not
    // see it.
    if (!/\bmkdtemp(Sync)?\s*\(/.test(code) && !/\btmpdir\s*\(/.test(code)) continue;
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
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    return !/\bmkdtemp(Sync)?\s*\(/.test(code) && !/\btmpdir\s*\(/.test(code);
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
