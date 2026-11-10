import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  clearResidentSession,
  detectSystemdUnit,
  processIsAlive,
  readInstalledVersion,
  readProcessCommandLine,
  readResidentSession,
  readResidentSessionState,
  resolveResidentSessionPath,
  startResidentService,
  stopResidentService,
  writeResidentSession,
  type ResidentSession,
} from '../src/install/ResidentSession.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #150 systemd clauses ① and ②: a resident process says which version it is
 * serving, and the stop and the start are the service manager's when systemd owns
 * the process. Both are asserted here without a real systemd; the real one is
 * exercised in `update-systemd.test.ts`.
 */

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A live process whose command line names cogmem, so the pid check accepts it. */
async function spawnCogmemish(): Promise<{ pid: number; stop: () => void }> {
  const proc = Bun.spawn([process.execPath, '-e', 'await new Promise(() => {});', 'cogmem'], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await waitForProcess(proc.pid);
  return { pid: proc.pid, stop: () => { try { proc.kill(); } catch { /* already gone */ } } };
}

/**
 * Wait until the child has exec'd.
 *
 * `processIsAlive` reports a live pid with no readable `/proc` entry as alive on
 * purpose — that is the safe answer for a service — so a check made in the instant
 * between `spawn` and `exec` is not what these tests are asking about.
 */
async function waitForProcess(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (readProcessCommandLine(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`process ${pid} never became visible`);
}

function session(overrides: Partial<ResidentSession>): ResidentSession {
  return {
    pid: process.pid,
    version: '4.1.0',
    transport: 'http',
    startedAt: 1,
    command: ['bun', 'mcp.ts'],
    ...overrides,
  };
}

describe('the resident session record', () => {
  test('it lives beside the config, so doctor and the server derive one file', () => {
    expect(resolveResidentSessionPath({ configPath: '/ws/.cogmem/config.toml', workspaceRoot: '/ws' }))
      .toBe('/ws/.cogmem/mcp-http.json');
    expect(resolveResidentSessionPath({ workspaceRoot: '/ws' })).toBe('/ws/.cogmem/mcp-http.json');
  });

  test('a clean stop clears only this process record', () => {
    const dir = makeTempDir('cogmem-session-');
    const path = join(dir, 'mcp-http.json');
    writeResidentSession(path, session({ pid: 4242 }));
    // A successor's record is not this process's to remove.
    clearResidentSession(path, process.pid);
    expect(existsSync(path)).toBe(true);
    clearResidentSession(path, 4242);
    expect(existsSync(path)).toBe(false);
  });

  test('a live record answers with the version the process is serving', async () => {
    const dir = makeTempDir('cogmem-session-');
    const path = join(dir, 'mcp-http.json');
    const child = await spawnCogmemish();
    try {
      writeResidentSession(path, session({ pid: child.pid, version: '4.1.0' }));
      const state = readResidentSessionState(path);
      expect(state.alive).toBe(true);
      expect(state.servingVersion).toBe('4.1.0');
    } finally {
      child.stop();
    }
  });

  test('a dead pid is a record without a service, not a serving version', () => {
    const dir = makeTempDir('cogmem-session-');
    const path = join(dir, 'mcp-http.json');
    writeResidentSession(path, session({ pid: 999_999_999 }));
    const state = readResidentSessionState(path);
    expect(state.alive).toBe(false);
    expect(state.servingVersion).toBeUndefined();
    expect(state.session?.pid).toBe(999_999_999);
  });

  test('a pid that is alive but is not cogmem is not the service', async () => {
    const proc = Bun.spawn([process.execPath, '-e', 'await new Promise(() => {});'], { stdout: 'ignore', stderr: 'ignore' });
    try {
      await waitForProcess(proc.pid);
      expect(processIsAlive(proc.pid)).toBe(false);
    } finally {
      proc.kill();
    }
  });

  test('the process this test runs in is under a user manager, not a unit of its own', () => {
    // `user@<uid>.service` is the manager every login session sits in; reporting it
    // as the unit would make `update` stop the whole session.
    expect(detectSystemdUnit()).toBeUndefined();
  });

  test('the installed version is read from the tree that was just replaced', () => {
    const dir = makeTempDir('cogmem-installed-');
    expect(readInstalledVersion(dir)).toBeUndefined();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'cogmem', version: '4.2.0' }));
    expect(readInstalledVersion(dir)).toBe('4.2.0');
    writeFileSync(join(dir, 'package.json'), '{ not json');
    expect(readInstalledVersion(dir)).toBeUndefined();
  });
});

describe('stopping and starting the resident service', () => {
  test('systemd is the one that stops and starts a process it owns', async () => {
    const calls: string[][] = [];
    const run = async (cmd: string[]) => { calls.push(cmd); return 0; };
    const unit = session({ pid: 999_999_999, systemdUnit: 'cogmem-mcp.service' });
    expect(await stopResidentService(unit, { run, cwd: '/ws' })).toEqual({ method: 'systemctl', exitCode: 0 });
    expect(await startResidentService(unit, { run, cwd: '/ws' })).toEqual({ method: 'systemctl', exitCode: 0 });
    expect(calls).toEqual([
      ['systemctl', '--user', 'stop', 'cogmem-mcp.service'],
      ['systemctl', '--user', 'start', 'cogmem-mcp.service'],
    ]);
  });

  test('a failed systemctl start is reported rather than claimed', async () => {
    const result = await startResidentService(session({ pid: 999_999_999, systemdUnit: 'cogmem-mcp.service' }), {
      run: async () => 5,
      cwd: '/ws',
    });
    expect(result.exitCode).toBe(5);
    expect(result.error).toContain('cogmem-mcp.service');
  });

  test('without systemd the stop is a signal and a wait', async () => {
    const child = await spawnCogmemish();
    const result = await stopResidentService(session({ pid: child.pid, command: ['bun'] }), { timeoutMs: 5000 });
    expect(result).toEqual({ method: 'signal' });
    expect(processIsAlive(child.pid)).toBe(false);

    // Already gone: nothing to signal, and nothing to report.
    expect(await stopResidentService(session({ pid: child.pid }), { timeoutMs: 100 })).toEqual({ method: 'signal' });
  });

  test('stopping something that will not die is an error, so the update can abort before swapping', async () => {
    // This test process is alive and its command line names the test runner, not
    // cogmem — so point at a real, unkillable-by-SIGTERM stand-in instead: our own
    // pid would be killed by the stop, so use a child that ignores SIGTERM.
    const proc = Bun.spawn([process.execPath, '-e', 'process.on("SIGTERM", () => {}); await new Promise(() => {});', 'cogmem'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    try {
      await waitForProcess(proc.pid);
      // ...and until the script inside it has run, so the SIGTERM handler is installed.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const result = await stopResidentService(session({ pid: proc.pid }), { timeoutMs: 400 });
      expect(result.method).toBe('signal');
      expect(result.error).toContain('did not exit');
    } finally {
      proc.kill('SIGKILL');
    }
  });
});

describe('doctor reports the skew between disk and serving process', () => {
  function runDoctor(dir: string, args: string[] = []) {
    const proc = Bun.spawn({
      cmd: [process.execPath, join(coreRoot, 'src/bin/doctor.ts'), '--json', ...args],
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, HOME: dir, COGMEM_UPDATE_CHECK: '0', TMPDIR: join(coreRoot, '.cogmem/tmp') },
    });
    return Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
      .then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
  }

  test('one version on disk and another serving is stated, not averaged away', async () => {
    const dir = makeTempDir('cogmem-doctor-skew-');
    const configPath = join(dir, '.cogmem', 'config.toml');
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, '[core]\ndb_path = "memory.db"\nvector_backend = "sqlite-vec"\n[memory_model]\nprovider = "rule_only"\nmodel = "rule_only"\n');
    const child = await spawnCogmemish();
    try {
      writeResidentSession(join(dir, '.cogmem', 'mcp-http.json'), session({ pid: child.pid, version: '4.0.0', systemdUnit: 'cogmem-mcp.service' }));
      const result = await runDoctor(dir, ['--config', configPath]);
      expect(result.exitCode).toBe(0);
      const body = JSON.parse(result.stdout) as {
        version?: { disk?: string; serving?: { version?: string; systemdUnit?: string } | null; skew?: boolean; restartRequired?: boolean };
        installGate?: { level?: string; diagnostics?: Array<{ code?: string }> };
      };
      expect(body.version?.serving?.version).toBe('4.0.0');
      expect(body.version?.serving?.systemdUnit).toBe('cogmem-mcp.service');
      expect(body.version?.disk).not.toBe('4.0.0');
      expect(body.version?.skew).toBe(true);
      expect(body.version?.restartRequired).toBe(true);
      expect(body.installGate?.diagnostics?.map((d) => d.code)).toContain('version_skew');
    } finally {
      child.stop();
    }
  });

  test('with no resident process there is no serving version and no skew', async () => {
    const dir = makeTempDir('cogmem-doctor-noservice-');
    const configPath = join(dir, '.cogmem', 'config.toml');
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, '[core]\ndb_path = "memory.db"\nvector_backend = "sqlite-vec"\n[memory_model]\nprovider = "rule_only"\nmodel = "rule_only"\n');
    const result = await runDoctor(dir, ['--config', configPath]);
    const body = JSON.parse(result.stdout) as { version?: { serving?: unknown; skew?: boolean; disk?: string } };
    expect(body.version?.serving).toBeNull();
    expect(body.version?.skew).toBe(false);
    expect(body.version?.disk).toBe(JSON.parse(readFileSync(join(coreRoot, 'package.json'), 'utf8')).version);
  });
});
