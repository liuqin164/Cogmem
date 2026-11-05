import { expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { removeOwnedFile, writeOwnedFiles } from '../src/host/InstalledArtifacts.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #116. Every host artifact this project writes goes through one contract: preflight it,
 * write it, and either all of it lands or none of it does.
 *
 * The adapters used to write `<path>.cogmem.bak-<timestamp>` beside each file they
 * replaced. That is a file per `connect` that nothing ever removed, and the copy holding
 * the content you wanted was indistinguishable from the other nine — a backup that is
 * not a rollback.
 */

test('a directory that cannot be written is found before a byte is written (#116)', () => {
  const dir = makeTempDir('cogmem-owned-preflight-');
  const locked = join(dir, 'locked');
  mkdirSync(locked, { recursive: true });
  chmodSync(locked, 0o500);
  try {
    expect(() => writeOwnedFiles([{ path: join(locked, 'artifact.txt'), content: 'x' }]))
      .toThrow(/install_preflight_failed/);
    // Nothing partially written, and nothing created to hold it.
    expect(readdirSync(locked)).toEqual([]);
  } finally {
    chmodSync(locked, 0o700);
  }
});

test('a write that fails partway restores what it replaced and takes away what it created (#116)', () => {
  const dir = makeTempDir('cogmem-owned-rollback-');
  const kept = join(dir, 'kept.txt');
  const fresh = join(dir, 'fresh.txt');
  const blocked = join(dir, 'blocked');
  writeFileSync(kept, 'the content that was here\n');
  mkdirSync(blocked);

  // Writing to a path that is a directory fails, which is the simplest way to fail the
  // second half of a transaction that has already touched a file.
  expect(() => writeOwnedFiles([
    { path: fresh, content: 'created by the failed install\n' },
    { path: kept, content: 'replacement that must not survive\n' },
    { path: blocked, content: 'x\n' },
  ])).toThrow(/install_write_failed/);

  expect(readFileSync(kept, 'utf8')).toBe('the content that was here\n');
  expect(existsSync(fresh)).toBe(false);
});

test('a file is only removed while it still holds what this project wrote (#116)', () => {
  const dir = makeTempDir('cogmem-owned-remove-');
  const ours = join(dir, 'ours.txt');
  const theirs = join(dir, 'theirs.txt');
  const missing = join(dir, 'missing.txt');
  writeFileSync(ours, '// cogmem auto memory\n');
  writeFileSync(theirs, 'a file the user wrote themselves\n');
  const looksOurs = (content: string) => content.includes('cogmem');

  expect(removeOwnedFile(ours, looksOurs)).toBe('removed');
  // The user's own file is left alone even though this call owns the path.
  expect(removeOwnedFile(theirs, looksOurs)).toBe('not_ours');
  expect(readFileSync(theirs, 'utf8')).toBe('a file the user wrote themselves\n');
  expect(removeOwnedFile(missing, looksOurs)).toBe('absent');
});

test('a successful write leaves no backup behind (#116)', () => {
  const dir = makeTempDir('cogmem-owned-no-backup-');
  const artifact = join(dir, 'artifact.txt');
  writeOwnedFiles([{ path: artifact, content: 'first\n' }]);
  writeOwnedFiles([{ path: artifact, content: 'second\n' }]);
  expect(readFileSync(artifact, 'utf8')).toBe('second\n');
  // One file, not a file plus a timestamped copy per install.
  expect(readdirSync(dir)).toEqual(['artifact.txt']);
});
