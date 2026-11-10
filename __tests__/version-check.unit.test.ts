import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  appendUpdateTrace,
  AUTO_UPGRADE_LOCK_FILENAME,
  decideAutoUpgrade,
  readLastUpdateTrace,
  runAutoUpgrade,
  updateLogPath,
} from '../src/install/AutoUpgrade.js';
import {
  checkForUpdate,
  compareVersions,
  isNewerVersion,
  isSystemdManaged,
  isUpdateCacheFresh,
  loadUpdateSettings,
  maybeStartVersionCheck,
  readUpdateCache,
  refreshUpdateCache,
  renderUpdateNotice,
  UPDATE_CHECK_FAILURE_RETRY_MS,
} from '../src/install/VersionCheck.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #150. What is asserted here is the contract the ticket fixed: the check is
 * cached for about a day, silent when the registry cannot be reached, switchable
 * off, and the automatic upgrade is off until an operator says otherwise — and
 * stays off under systemd without a second, separate confirmation.
 */

function writeConfig(dir: string, body: string): string {
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(join(dir, '.cogmem'), { recursive: true });
  writeFileSync(configPath, body);
  return configPath;
}

const BASE_CONFIG = '[core]\ndb_path = "memory.db"\nvector_backend = "sqlite-vec"\n';

describe('version comparison', () => {
  test('compares numerically, not as strings', () => {
    expect(compareVersions('4.10.0', '4.9.0')).toBe(1);
    expect(compareVersions('4.2', '4.2.0')).toBe(0);
    expect(compareVersions('v4.2.1', '4.2.0')).toBe(1);
    // A pre-release suffix is not a newer stable release.
    expect(isNewerVersion('4.2.0-beta.1', '4.2.0')).toBe(false);
    expect(isNewerVersion('4.2.0', '4.1.9')).toBe(true);
    expect(isNewerVersion('4.1.0', '4.1.0')).toBe(false);
  });
});

describe('update settings', () => {
  test('the check is on by default and the automatic upgrade is off', () => {
    const home = makeTempDir('cogmem-update-settings-');
    writeConfig(home, BASE_CONFIG);
    const settings = loadUpdateSettings({ env: { HOME: home }, cwd: home });
    expect(settings.check).toBe(true);
    expect(settings.autoUpgrade).toBe(false);
    expect(settings.autoUpgradeInService).toBe(false);
    expect(settings.cachePath).toBe(join(home, '.cogmem', 'update-check.json'));
    expect(settings.homeDir).toBe(join(home, '.cogmem'));
  });

  test('the config switches the check off and the upgrade on, and the environment can switch it off', () => {
    const home = makeTempDir('cogmem-update-settings-');
    const configPath = writeConfig(home, `${BASE_CONFIG}[update]\ncheck = false\nauto_upgrade = true\nauto_upgrade_in_service = true\n`);
    const fromConfig = loadUpdateSettings({ env: { HOME: home }, configPath });
    expect(fromConfig.check).toBe(false);
    expect(fromConfig.autoUpgrade).toBe(true);
    expect(fromConfig.autoUpgradeInService).toBe(true);

    const enabled = writeConfig(join(home, 'other'), `${BASE_CONFIG}[update]\ncheck = true\n`);
    expect(loadUpdateSettings({ env: { HOME: home, COGMEM_UPDATE_CHECK: '0' }, configPath: enabled }).check).toBe(false);
    expect(loadUpdateSettings({ env: { HOME: home, COGMEM_UPDATE_CHECK: '1' }, configPath: enabled }).check).toBe(true);
  });

  test('an unreadable config is not this module failure to report', () => {
    const home = makeTempDir('cogmem-update-settings-');
    const broken = join(home, 'broken.toml');
    writeFileSync(broken, 'this is not = = toml\n');
    const settings = loadUpdateSettings({ env: { HOME: home }, configPath: broken });
    expect(settings.check).toBe(true);
  });
});

describe('the registry read', () => {
  test('a successful read is cached, and the notice follows from the cache', async () => {
    const home = makeTempDir('cogmem-version-check-');
    const cachePath = join(home, 'cache.json');
    const cache = await refreshUpdateCache({
      cachePath,
      registryUrl: 'https://registry.invalid',
      now: 1_000,
      fetchImpl: async () => new Response(JSON.stringify({ version: '4.9.9' }), { status: 200 }),
    });
    expect(cache.latestVersion).toBe('4.9.9');
    expect(readUpdateCache(cachePath)?.latestVersion).toBe('4.9.9');

    const status = checkForUpdate({ env: { HOME: home }, cachePath, now: 2_000 });
    expect(status.updateAvailable).toBe(true);
    expect(status.stale).toBe(false);
    expect(renderUpdateNotice(status)).toContain('4.9.9');
  });

  test('a registry failure is silent, cached, and retried on the shorter cadence', async () => {
    const home = makeTempDir('cogmem-version-check-');
    const cachePath = join(home, 'cache.json');
    const cache = await refreshUpdateCache({
      cachePath,
      now: 1_000,
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });
    expect(cache.latestVersion).toBeUndefined();
    expect(cache.error).toBe('registry_unreachable');
    expect(readUpdateCache(cachePath)?.error).toBe('registry_unreachable');
    // Still fresh for an hour, then owed again; a failure does not poison a whole day.
    expect(isUpdateCacheFresh(cache, 1_000 + UPDATE_CHECK_FAILURE_RETRY_MS - 1)).toBe(true);
    expect(isUpdateCacheFresh(cache, 1_000 + UPDATE_CHECK_FAILURE_RETRY_MS + 1)).toBe(false);

    const status = checkForUpdate({ env: { HOME: home }, cachePath, now: 2_000 });
    expect(status.updateAvailable).toBe(false);
    expect(renderUpdateNotice(status)).toBeUndefined();
  });

  test('an HTTP error is a failure, not a version', async () => {
    const home = makeTempDir('cogmem-version-check-');
    const cachePath = join(home, 'cache.json');
    const cache = await refreshUpdateCache({
      cachePath,
      now: 1_000,
      fetchImpl: async () => new Response('nope', { status: 500 }),
    });
    expect(cache.latestVersion).toBeUndefined();
    expect(cache.error).toBeDefined();
  });

  test('the check starts nothing when it is off or today already answered', () => {
    const home = makeTempDir('cogmem-version-check-');
    writeConfig(home, `${BASE_CONFIG}[update]\ncheck = false\n`);
    expect(maybeStartVersionCheck({ env: { HOME: home }, cwd: home })).toEqual({ started: false, reason: 'check_disabled' });

    const fresh = join(home, 'cache.json');
    writeFileSync(fresh, JSON.stringify({ checkedAt: Date.now(), latestVersion: '4.9.9' }));
    expect(maybeStartVersionCheck({ env: { HOME: home, COGMEM_UPDATE_CHECK: '1' }, cwd: home, cachePath: fresh }))
      .toEqual({ started: false, reason: 'cache_fresh' });
  });

  test('switched off means no status to render at all', () => {
    const home = makeTempDir('cogmem-version-check-');
    writeConfig(home, `${BASE_CONFIG}[update]\ncheck = false\n`);
    const status = checkForUpdate({ env: { HOME: home }, cwd: home });
    expect(status.enabled).toBe(false);
    expect(status.updateAvailable).toBe(false);
    expect(renderUpdateNotice(status)).toBeUndefined();
  });
});

describe('systemd detection', () => {
  test('the manager marks its own children', () => {
    expect(isSystemdManaged({})).toBe(false);
    expect(isSystemdManaged({ INVOCATION_ID: 'abc' })).toBe(true);
    expect(isSystemdManaged({ NOTIFY_SOCKET: '/run/systemd/notify' })).toBe(true);
  });
});

describe('the automatic upgrade decision', () => {
  test('off by default, and nothing to do when the version is current', () => {
    expect(decideAutoUpgrade({ autoUpgrade: false, autoUpgradeInService: false }, '9.9.9', '4.1.0', {}).reason)
      .toBe('auto_upgrade_disabled');
    expect(decideAutoUpgrade({ autoUpgrade: true, autoUpgradeInService: false }, '4.1.0', '4.1.0', {}).reason)
      .toBe('up_to_date');
  });

  test('opted in, it is allowed — except under systemd, where it needs its own confirmation', () => {
    const optedIn = { autoUpgrade: true, autoUpgradeInService: false };
    expect(decideAutoUpgrade(optedIn, '9.9.9', '4.1.0', {}).allowed).toBe(true);
    const systemd = decideAutoUpgrade(optedIn, '9.9.9', '4.1.0', { INVOCATION_ID: 'abc' });
    expect(systemd.allowed).toBe(false);
    expect(systemd.reason).toBe('systemd_requires_explicit_opt_in');
    expect(decideAutoUpgrade({ autoUpgrade: true, autoUpgradeInService: true }, '9.9.9', '4.1.0', { INVOCATION_ID: 'abc' }).allowed)
      .toBe(true);
  });
});

describe('the automatic upgrade run', () => {
  const settings = (home: string) => ({
    check: true,
    autoUpgrade: true,
    autoUpgradeInService: false,
    registryUrl: 'https://registry.invalid',
    packageName: 'cogmem',
    cachePath: join(home, 'cache.json'),
    homeDir: join(home, '.cogmem'),
  });

  test('it runs the existing update command in its staged form, and never a restart', async () => {
    const home = makeTempDir('cogmem-auto-upgrade-');
    const calls: string[][] = [];
    const outcome = await runAutoUpgrade({
      settings: settings(home),
      latestVersion: '9.9.9',
      currentVersion: '4.1.0',
      env: {},
      cliEntry: '/fake/cogmem.ts',
      run: async (cmd) => { calls.push(cmd); return { exitCode: 0, stdout: '{}', stderr: '' }; },
    });
    expect(outcome).toMatchObject({ attempted: true, status: 'staged', exitCode: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.slice(1)).toEqual(['/fake/cogmem.ts', 'update', '--yes', '--stage-only', '--json']);
    // The lock is released, so the next day's check can run.
    expect(existsSync(join(home, '.cogmem', AUTO_UPGRADE_LOCK_FILENAME))).toBe(false);
  });

  test('under systemd the ordinary opt-in is not enough, so nothing runs', async () => {
    const home = makeTempDir('cogmem-auto-upgrade-');
    const calls: string[][] = [];
    const outcome = await runAutoUpgrade({
      settings: settings(home),
      latestVersion: '9.9.9',
      currentVersion: '4.1.0',
      env: { INVOCATION_ID: 'abc' },
      cliEntry: '/fake/cogmem.ts',
      run: async (cmd) => { calls.push(cmd); return { exitCode: 0, stdout: '{}', stderr: '' }; },
    });
    expect(outcome.attempted).toBe(false);
    expect(outcome.decision.reason).toBe('systemd_requires_explicit_opt_in');
    expect(calls).toHaveLength(0);
  });

  test('a failed update is reported as failed and stops there', async () => {
    const home = makeTempDir('cogmem-auto-upgrade-');
    let runs = 0;
    const outcome = await runAutoUpgrade({
      settings: settings(home),
      latestVersion: '9.9.9',
      currentVersion: '4.1.0',
      env: {},
      cliEntry: '/fake/cogmem.ts',
      run: async () => { runs += 1; return { exitCode: 1, stdout: '', stderr: 'gate failed' }; },
    });
    expect(outcome).toMatchObject({ attempted: true, status: 'failed', exitCode: 1 });
    // No retry loop: the failure is the end of this check.
    expect(runs).toBe(1);
  });

  test('one upgrade at a time: a held lock refuses the second', async () => {
    const home = makeTempDir('cogmem-auto-upgrade-');
    const lockDir = join(home, '.cogmem');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, AUTO_UPGRADE_LOCK_FILENAME), '');
    const outcome = await runAutoUpgrade({
      settings: settings(home),
      latestVersion: '9.9.9',
      currentVersion: '4.1.0',
      env: {},
      cliEntry: '/fake/cogmem.ts',
      run: async () => { throw new Error('must not run'); },
    });
    expect(outcome.attempted).toBe(false);
    expect(outcome.decision.reason).toBe('lock_held');
  });
});

describe('the governance trace', () => {  test('each update appends one line, and the last one is the state', () => {
    const home = makeTempDir('cogmem-update-trace-');
    appendUpdateTrace(home, { at: 1, command: 'update', mode: 'stage_only', from: '4.1.0', to: '4.2.0', status: 'staged', gateLevel: 'ok', restartRequired: true });
    appendUpdateTrace(home, { at: 2, command: 'update', mode: 'end_to_end', from: '4.1.0', to: '4.2.0', status: 'completed' });
    expect(readFileSync(updateLogPath(home), 'utf8').trim().split('\n')).toHaveLength(2);
    expect(readLastUpdateTrace(home)).toMatchObject({ at: 2, status: 'completed', from: '4.1.0', to: '4.2.0' });
  });

  test('a trace that cannot be written does not fail the update', () => {
    expect(() => appendUpdateTrace('/proc/nope/not-a-dir', {
      at: 1, command: 'update', mode: 'end_to_end', status: 'completed',
    })).not.toThrow();
    expect(readLastUpdateTrace('/proc/nope/not-a-dir')).toBeUndefined();
  });
});

describe('the one-line notice on a command', () => {
  const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

  async function runCli(args: string[], home: string) {
    const proc = Bun.spawn({
      cmd: [process.execPath, join(coreRoot, 'src', 'bin', 'cogmem.ts'), ...args],
      cwd: coreRoot,
      stdout: 'pipe',
      stderr: 'pipe',
      // The switch is on for this test, and only for this test.
      env: { ...process.env, HOME: home, COGMEM_UPDATE_CHECK: '1', NO_COLOR: '1' },
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  }

  test('a normal command adds it, and update does not announce the release it just installed', async () => {
    const home = makeTempDir('cogmem-notice-');
    mkdirSync(join(home, '.cogmem'), { recursive: true });
    writeFileSync(join(home, '.cogmem', 'update-check.json'), JSON.stringify({ checkedAt: Date.now(), latestVersion: '9.9.9' }));

    const normal = await runCli(['cleanup', '--dry-run'], home);
    expect(normal.stderr).toContain('A new cogmem is available: 9.9.9');

    // The process running `update` is the one that was just replaced, so its own
    // version is the old one; announcing the release it installed would be wrong.
    const update = await runCli(['update', '--dry-run'], home);
    expect(update.stderr).not.toContain('A new cogmem is available');
  }, 60_000);
});
