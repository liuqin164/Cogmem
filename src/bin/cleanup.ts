#!/usr/bin/env bun
/**
 * Remove the managed launcher once the installation it points at is gone.
 *
 * `npm uninstall` cannot run our code, so the launcher that `init` wrote stays behind,
 * pointing at a directory that no longer exists. That is inert — it is not on PATH — but it
 * is the kind of leftover this project has spent several rounds deleting, and `doctor`
 * already reports it as `launcher_target_missing`.
 *
 * It refuses to remove a launcher whose installation is still there: that would break a
 * working install, and the point of the launcher is to survive upgrades, not to be cleaned
 * up while it is doing its job.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';

import { cogmemLauncherPath, cogmemLauncherRecordPath } from '../install/InstallSteps.js';
import { assertCliArgs, parseCliArgs } from './CliArgs.js';

function usage(): string {
  return [
    'Usage: cogmem cleanup [--dry-run] [--json]',
    '',
    'Removes the managed launcher and its record when the installation they name is gone',
    '(the state an uninstall leaves). A launcher whose installation still exists is left',
    'alone, because removing it would break that installation.',
    '--dry-run reports what would be removed and removes nothing.',
    '--json emits cogmem.cli.v1.',
  ].join('\n');
}

type CleanupResult = {
  status: 'nothing_to_clean' | 'installation_present' | 'cleaned';
  launcher: string;
  record: string;
  target?: string;
  removed: string[];
  dryRun: boolean;
};

function readRecordedTarget(record: string): string | undefined {
  try {
    return readFileSync(record, 'utf8').split('\n')[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function main(): void {
  assertCliArgs(process.argv.slice(2), { usage: usage(), extraFlags: ['dry-run', 'json'] });
  if (process.argv.slice(2).some((item) => item === '--help' || item === '-h')) {
    console.log(usage());
    return;
  }
  const args = parseCliArgs(process.argv.slice(2), { usage: usage(), extraFlags: ['dry-run', 'json'] });
  const dryRun = args['dry-run'] === true;
  const launcher = cogmemLauncherPath();
  const record = cogmemLauncherRecordPath();
  const target = readRecordedTarget(record);

  const present = [launcher, record].filter((path) => existsSync(path));
  const result: CleanupResult = { status: 'nothing_to_clean', launcher, record, removed: [], dryRun, ...(target ? { target } : {}) };

  if (present.length === 0) {
    emit(result);
    return;
  }
  // The installation is still there: this launcher is doing its job.
  if (target && existsSync(target)) {
    result.status = 'installation_present';
    emit(result);
    return;
  }

  result.status = 'cleaned';
  if (!dryRun) for (const path of present) rmSync(path, { force: true });
  result.removed = present;
  emit(result);
}

function emit(result: CleanupResult): void {
  const human = result.status === 'cleaned'
    ? `removed ${result.removed.join(', ')}${result.dryRun ? ' (dry run: nothing was removed)' : ''}`
    : result.status === 'installation_present'
      ? `kept ${result.launcher}: its installation is still present (${result.target})`
      : 'nothing to clean: no managed launcher here';
  const { status, launcher, record, target, removed, dryRun } = result;
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ schemaVersion: 'cogmem.cli.v1', command: 'cleanup', status, launcher, record, ...(target ? { target } : {}), removed, dryRun }, null, 2));
    return;
  }
  console.log(human);
}

main();
