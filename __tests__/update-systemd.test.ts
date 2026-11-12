import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { processIsAlive, readResidentSessions } from '../src/install/ResidentSession.js';
import {
  BUN,
  cogmem,
  installedVersion,
  killTrackedServers,
  makeFixture,
  pretestInstall,
  recallViaCli,
  rememberViaCli,
  startServer,
  track,
  waitForSession,
  type Fixture,
} from './helpers/update-fixture.js';

/**
 * #150 against systemd, two ways.
 *
 * The first runs a real transient unit through `systemd-run --user`, so the unit
 * name comes from a real cgroup and `systemctl` is the real one. It covers
 * clauses ① and ② (staging leaves the service alone; doctor names both versions
 * and the unit).
 *
 * The second replaces `systemctl` with a shim that performs the stop and the start
 * for real — signalling the recorded pid, then relaunching the recorded command.
 * That is where the update's stop → swap → migrate → start path through
 * `systemctl` is asserted end to end, and unlike the real manager it runs in CI.
 * The cause is stated rather than hidden: a persistent unit file has to live in
 * the user manager's own unit directory, which is outside this repository and not
 * writable from here.
 */

afterAll(killTrackedServers);

const MEMORY = '归档保留期定成七年。';

function systemctl(args: string[]): { stdout: string; exitCode: number } {
  const proc = Bun.spawnSync({ cmd: ['systemctl', '--user', ...args], stdout: 'pipe', stderr: 'pipe' });
  return { stdout: proc.stdout.toString(), exitCode: proc.exitCode ?? 1 };
}

function realSystemdAvailable(): boolean {
  try {
    if (!Bun.which('systemd-run')) return false;
    return systemctl(['show-environment']).exitCode === 0;
  } catch {
    return false;
  }
}

const realSystemd = realSystemdAvailable();

describe('#150 a real systemd-managed service (transient unit)', () => {
  test.skipIf(!realSystemd)('a staged upgrade never restarts it, and doctor names the unit it must be restarted through', async () => {
    const f = makeFixture('cogmem-systemd-real-');
    await pretestInstall(f, '4.1.0');
    const unit = `cogmem-150-${process.pid}-${Math.floor(Math.random() * 1e6)}.service`;
    const running = (): void => {
      const proc = Bun.spawnSync({ cmd: ['systemctl', '--user', 'is-active', unit], stdout: 'pipe', stderr: 'pipe' });
      expect(proc.stdout.toString().trim()).toBe('active');
    };
    const launch = (): { exitCode: number | null; stderr: string } => {
      const proc = Bun.spawnSync({
        cmd: [
          'systemd-run', '--user', `--unit=${unit}`, '--quiet',
          '--setenv=COGMEM_UPDATE_CHECK=0',
          BUN, join(f.install, 'node_modules', 'cogmem', 'src', 'bin', 'observatory.ts'),
          '--port', String(f.port), '--config', f.configPath,
        ],
        stdout: 'pipe',
        stderr: 'pipe',
      });
      return { exitCode: proc.exitCode, stderr: proc.stderr.toString() };
    };
    try {
      const started = launch();
      expect(started.exitCode, started.stderr).toBe(0);

      const session = await waitForSession(f, (s) => s.version === '4.1.0', 30_000);
      // Read from the process's own cgroup: nothing configured the unit name.
      expect(session.systemdUnit).toBe(unit);
      const servingPid = session.pid;
      await rememberViaCli(f, MEMORY);

      const staged = await cogmem(f, ['update', '--yes', '--json', '--stage-only', '--install-home', f.install, '--manager', 'npm', '--from', '4.2.0', '--config', f.configPath]);
      expect(staged.exitCode, staged.stderr).toBe(0);
      const stagedDoc = JSON.parse(staged.stdout) as { lifecycle?: { stopped?: string; systemdUnit?: string } };
      expect(stagedDoc.lifecycle?.stopped).toBeUndefined();
      expect(stagedDoc.lifecycle?.systemdUnit).toBe(unit);
      running();
      expect(processIsAlive(servingPid)).toBe(true);
      expect((await waitForSession(f, (s) => s.pid === servingPid)).version).toBe('4.1.0');

      const doctor = await cogmem(f, ['doctor', '--json', '--config', f.configPath]);
      const report = JSON.parse(doctor.stdout) as {
        version?: { disk?: string; serving?: { version?: string; systemdUnit?: string } | null; skew?: boolean; restartRequired?: boolean };
      };
      expect(report.version?.disk).toBe('4.2.0');
      expect(report.version?.serving?.[0]?.version).toBe('4.1.0');
      expect(report.version?.serving?.[0]?.systemdUnit).toBe(unit);
      expect(report.version?.skew).toBe(true);
      expect(report.version?.restartRequired).toBe(true);

      // The human line names the exact command that converges the two versions.
      const human = await cogmem(f, ['doctor', '--config', f.configPath]);
      expect(human.stdout).toContain(`systemctl --user restart ${unit}`);

      // Clause ④, orchestration in systemd: stop the old unit, start the new one.
      systemctl(['stop', unit]);
      const restarted = launch();
      expect(restarted.exitCode, restarted.stderr).toBe(0);
      const converged = await waitForSession(f, (s) => s.pid !== servingPid, 30_000);
      expect(converged.version).toBe('4.2.0');
      running();
      // The memory written before the upgrade is recalled after it.
      expect(await recallViaCli(f, MEMORY.slice(0, 6))).toContain('归档保留期');
    } finally {
      systemctl(['stop', unit]);
    }
  }, 300_000);
});

/**
 * The manager stand-in: it really stops and really starts the recorded process.
 *
 * It is deliberately the only piece faked — the unit name on the session record,
 * the update's decision to call `systemctl` instead of signalling a pid, and the
 * process that comes back are all the product's.
 */
const SYSTEMCTL_SHIM = `#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const action = args[args.length - 2];
const unit = args[args.length - 1];
const sessionDir = process.env.COGMEM_TEST_SESSION_DIR!;
const statePath = process.env.COGMEM_TEST_SYSTEMCTL_STATE!;
appendFileSync(process.env.COGMEM_TEST_SYSTEMCTL_LOG!, JSON.stringify({ action, unit }) + '\\n');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const records = () => (existsSync(sessionDir) ? readdirSync(sessionDir).filter((f) => f.endsWith('.json')) : []);

if (action === 'stop' && records().length > 0) {
  const session = JSON.parse(readFileSync(join(sessionDir, records()[0]!), 'utf8')) as { pid: number; command: string[]; cwd: string };
  writeFileSync(statePath, JSON.stringify(session));
  try { process.kill(session.pid, 'SIGTERM'); } catch { /* already gone */ }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { process.kill(session.pid, 0); } catch { break; }
    await sleep(50);
  }
  process.exit(0);
}
if (action === 'start' && existsSync(statePath)) {
  const session = JSON.parse(readFileSync(statePath, 'utf8')) as { command: string[]; cwd: string };
  const child = Bun.spawn({ cmd: session.command, cwd: session.cwd, env: { ...process.env }, stdio: ['ignore', 'ignore', 'ignore'], detached: true });
  child.unref();
  process.exit(0);
}
process.exit(0);
`;

function recordAsSystemdManaged(f: Fixture, unit: string): void {
  const session = readResidentSessions(f.sessionDir)[0]?.session;
  expect(session).toBeDefined();
  writeFileSync(join(f.sessionDir, `${session!.pid}.json`), `${JSON.stringify({ ...session, systemdUnit: unit, systemdScope: 'user' }, null, 2)}\n`);
}

function installSystemctlShim(f: Fixture, body: string = SYSTEMCTL_SHIM): void {
  writeFileSync(join(f.binDir, 'systemctl'), body);
  const proc = Bun.spawnSync({ cmd: ['chmod', '755', join(f.binDir, 'systemctl')] });
  expect(proc.exitCode).toBe(0);
}

describe('#150 the update driven through systemctl', () => {
  test('stop and start are the manager commands, and the process that comes back is the new version', async () => {
    const f = makeFixture('cogmem-systemctl-');
    await pretestInstall(f, '4.1.0');
    const server = track(startServer(f));
    await waitForSession(f, (s) => s.version === '4.1.0');
    await rememberViaCli(f, MEMORY);

    const unit = 'cogmem-observatory.service';
    recordAsSystemdManaged(f, unit);
    installSystemctlShim(f);
    const systemctlLog = join(f.root, 'systemctl.log');
    const statePath = join(f.root, 'systemctl-state.json');

    const update = await cogmem(
      f,
      ['update', '--yes', '--json', '--install-home', f.install, '--manager', 'npm', '--from', '4.2.0', '--config', f.configPath],
      { COGMEM_TEST_SESSION_DIR: f.sessionDir, COGMEM_TEST_SYSTEMCTL_LOG: systemctlLog, COGMEM_TEST_SYSTEMCTL_STATE: statePath },
    );
    expect(update.exitCode, `${update.stdout}\n${update.stderr}`).toBe(0);
    const doc = JSON.parse(update.stdout) as { lifecycle?: { stopped?: string; started?: string; systemdUnit?: string } };
    expect(doc.lifecycle?.stopped).toBe('systemctl');
    expect(doc.lifecycle?.started).toBe('systemctl');
    expect(doc.lifecycle?.systemdUnit).toBe(unit);

    // The manager was asked for exactly those two commands, in that order.
    const commands = readFileSync(systemctlLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { action: string; unit: string });
    expect(commands).toEqual([{ action: 'stop', unit }, { action: 'start', unit }]);

    // And the service that came back is the new version, with the old one gone.
    const restarted = await waitForSession(f, (s) => s.pid !== server.pid);
    expect(restarted.version).toBe('4.2.0');
    expect(processIsAlive(server.pid)).toBe(false);
    expect(installedVersion(f)).toBe('4.2.0');
    expect(await recallViaCli(f, MEMORY.slice(0, 6))).toContain('归档保留期');
  }, 180_000);

  test('a stop the manager refuses aborts before anything is swapped', async () => {
    const f = makeFixture('cogmem-systemctl-fail-');
    await pretestInstall(f, '4.1.0');
    const server = track(startServer(f));
    await waitForSession(f, (s) => s.version === '4.1.0');

    recordAsSystemdManaged(f, 'cogmem-observatory.service');
    // A manager whose `stop` fails: systemd could not take the unit down.
    installSystemctlShim(f, '#!/bin/sh\necho "Failed to stop: Access denied" >&2\nexit 1\n');

    const update = await cogmem(f, ['update', '--yes', '--json', '--install-home', f.install, '--manager', 'npm', '--from', '4.2.0', '--config', f.configPath]);
    expect(update.exitCode).not.toBe(0);
    const doc = JSON.parse(update.stdout) as { failedStep?: string };
    expect(doc.failedStep).toBe('stop');
    // Nothing was swapped: the old version is still installed and still serving.
    expect(installedVersion(f)).toBe('4.1.0');
    expect(processIsAlive(server.pid)).toBe(true);
  }, 120_000);
});
