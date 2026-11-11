import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  clearResidentSession,
  detectSystemdScope,
  detectSystemdUnit,
  processIsAlive,
  readProcessCommandLine,
  readResidentSessions,
  resolveResidentSessionDir,
  startResidentProcess,
  stopResidentProcess,
  systemctlCommand,
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

describe('the resident session records', () => {
  test('they live beside the config, one file per pid', () => {
    expect(resolveResidentSessionDir({ configPath: '/ws/.cogmem/config.toml', workspaceRoot: '/ws' }))
      .toBe('/ws/.cogmem/sessions');
    expect(resolveResidentSessionDir({ workspaceRoot: '/ws' })).toBe('/ws/.cogmem/sessions');
  });

  test('a clean stop clears only this process record', () => {
    const dir = makeTempDir('cogmem-session-');
    writeResidentSession(dir, session({ pid: 4242 }));
    writeResidentSession(dir, session({ pid: 4243 }));
    clearResidentSession(dir, process.pid);
    expect(existsSync(join(dir, '4242.json'))).toBe(true);
    clearResidentSession(dir, 4242);
    expect(existsSync(join(dir, '4242.json'))).toBe(false);
    expect(existsSync(join(dir, '4243.json'))).toBe(true);
  });

  test('two hosts on different versions are both reported, not collapsed into one', async () => {
    const dir = makeTempDir('cogmem-session-');
    const first = await spawnCogmemish();
    const second = await spawnCogmemish();
    try {
      writeResidentSession(dir, session({ pid: first.pid, version: '4.1.0', transport: 'stdio', hostId: 'openclaw', startedAt: 10 }));
      writeResidentSession(dir, session({ pid: second.pid, version: '4.2.0', transport: 'http', startedAt: 20 }));
      const records = readResidentSessions(dir);
      expect(records.map((record) => [record.session.pid, record.session.version, record.session.transport]))
        .toEqual([[second.pid, '4.2.0', 'http'], [first.pid, '4.1.0', 'stdio']]);
    } finally {
      first.stop();
      second.stop();
    }
  });

  test('a dead pid is collected rather than reported as an old service', () => {
    const dir = makeTempDir('cogmem-session-');
    writeResidentSession(dir, session({ pid: 999_999_999 }));
    expect(readResidentSessions(dir)).toEqual([]);
    // And the file is gone, so a reused pid cannot read as a stale session.
    expect(existsSync(join(dir, '999999999.json'))).toBe(false);
  });

  test('a record that is not ours is ignored and removed', () => {
    const dir = makeTempDir('cogmem-session-');
    writeFileSync(join(dir, '7.json'), '{ not json');
    writeFileSync(join(dir, '8.json'), JSON.stringify({ pid: process.pid, version: '4.1.0' })); // no transport
    expect(readResidentSessions(dir)).toEqual([]);
    expect(existsSync(join(dir, '7.json'))).toBe(false);
    expect(existsSync(join(dir, '8.json'))).toBe(false);
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

  test('the process this test runs in has no unit of its own', () => {
    // Whatever started this test — a shell, a CI agent's job, a login session — it was
    // not systemd, and `user@<uid>.service` is the manager every session sits in.
    // Reporting either as the unit would make `update` stop the session or the agent.
    const unit = detectSystemdUnit();
    expect(unit === undefined || !/^user@\d+\.service$/u.test(unit)).toBe(true);
    // A scope describes a unit, so it is present exactly when a unit is.
    expect(detectSystemdScope() === undefined).toBe(unit === undefined);
  });
});

describe('stopping and starting the resident process', () => {
  test('systemd is the one that stops and starts a process it owns', async () => {
    const calls: string[][] = [];
    const run = async (cmd: string[]) => { calls.push(cmd); return 0; };
    const unit = session({ pid: 999_999_999, systemdUnit: 'cogmem-mcp.service', systemdScope: 'user' });
    expect(await stopResidentProcess(unit, { run, cwd: '/ws' })).toEqual({ method: 'systemctl', exitCode: 0 });
    expect(await startResidentProcess(unit, { run, cwd: '/ws' })).toEqual({ method: 'systemctl', exitCode: 0 });
    expect(calls).toEqual([
      ['systemctl', '--user', 'stop', 'cogmem-mcp.service'],
      ['systemctl', '--user', 'start', 'cogmem-mcp.service'],
    ]);
  });

  test('a system-scope unit is not asked of the user manager', () => {
    // `systemctl --user` against a system unit answers "Unit not found", which would
    // abort the update at the stop step for a service it could have stopped.
    const unit = session({ pid: 1, systemdUnit: 'cogmem-mcp.service', systemdScope: 'system' });
    expect(systemctlCommand(unit, 'stop', 'cogmem-mcp.service')).toEqual(['systemctl', 'stop', 'cogmem-mcp.service']);
  });

  test('a failed systemctl start is reported rather than claimed', async () => {
    const result = await startResidentProcess(session({ pid: 999_999_999, systemdUnit: 'cogmem-mcp.service' }), {
      run: async () => 5,
      cwd: '/ws',
    });
    expect(result.exitCode).toBe(5);
    expect(result.error).toContain('cogmem-mcp.service');
  });

  test('a stdio session is never started by update, because the host owns it', async () => {
    const result = await startResidentProcess(session({ transport: 'stdio', pid: 999_999_999, command: ['bun', 'mcp.ts'] }), {
      run: async () => { throw new Error('must not run'); },
      cwd: '/ws',
    });
    expect(result.method).toBe('none');
    expect(result.error).toContain('host');
  });

  test('without systemd the stop is a signal and a wait', async () => {
    const child = await spawnCogmemish();
    const result = await stopResidentProcess(session({ pid: child.pid, command: ['bun'] }), { timeoutMs: 5000 });
    expect(result).toEqual({ method: 'signal' });
    expect(processIsAlive(child.pid)).toBe(false);

    // Already gone: nothing to signal, and nothing to report.
    expect(await stopResidentProcess(session({ pid: child.pid }), { timeoutMs: 100 })).toEqual({ method: 'signal' });
  });

  test('stopping something that will not die is an error, so the update can abort before swapping', async () => {
    const proc = Bun.spawn([process.execPath, '-e', 'process.on("SIGTERM", () => {}); await new Promise(() => {});', 'cogmem'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    try {
      await waitForProcess(proc.pid);
      // ...and until the script inside it has run, so the SIGTERM handler is installed.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const result = await stopResidentProcess(session({ pid: proc.pid }), { timeoutMs: 400 });
      expect(result.method).toBe('signal');
      expect(result.error).toContain('did not exit');
    } finally {
      proc.kill('SIGKILL');
    }
  });
});

describe('doctor reports the skew between disk and serving process', () => {
  function doctorBin(): string {
    return join(coreRoot, 'src/bin/doctor.ts');
  }

  function makeWorkspace(): { dir: string; configPath: string } {
    const dir = makeTempDir('cogmem-doctor-skew-');
    const configPath = join(dir, '.cogmem', 'config.toml');
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, '[core]\ndb_path = "memory.db"\nvector_backend = "sqlite-vec"\n[memory_model]\nprovider = "rule_only"\nmodel = "rule_only"\n');
    return { dir, configPath };
  }

  async function runDoctor(dir: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
    const proc = Bun.spawn({
      cmd: [process.execPath, doctorBin(), ...args],
      cwd: dir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, HOME: dir, COGMEM_UPDATE_CHECK: '0', TMPDIR: join(coreRoot, '.cogmem/tmp') },
    });
    const [stdout, , exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, exitCode };
  }

  test('one version on disk and another serving is stated, not averaged away', async () => {
    const { dir, configPath } = makeWorkspace();
    const child = await spawnCogmemish();
    try {
      writeResidentSession(join(dir, '.cogmem', 'sessions'), session({
        pid: child.pid,
        version: '4.0.0',
        systemdUnit: 'cogmem-mcp.service',
        systemdScope: 'user',
      }));
      const result = await runDoctor(dir, ['--json', '--config', configPath]);
      expect(result.exitCode).toBe(0);
      const body = JSON.parse(result.stdout) as {
        version?: { disk?: string; serving?: Array<{ version?: string; systemdUnit?: string; pid?: number }>; skew?: boolean; restartRequired?: boolean };
        installGate?: { diagnostics?: Array<{ code?: string }> };
      };
      expect(body.version?.serving?.[0]?.version).toBe('4.0.0');
      expect(body.version?.serving?.[0]?.systemdUnit).toBe('cogmem-mcp.service');
      expect(body.version?.disk).not.toBe('4.0.0');
      expect(body.version?.skew).toBe(true);
      expect(body.version?.restartRequired).toBe(true);
      expect(body.installGate?.diagnostics?.map((d) => d.code)).toContain('version_skew');

      // The human line names the exact command that converges them.
      const human = Bun.spawnSync({
        cmd: [process.execPath, doctorBin(), '--config', configPath],
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, HOME: dir, COGMEM_UPDATE_CHECK: '0', TMPDIR: join(coreRoot, '.cogmem/tmp') },
      });
      expect(human.stdout.toString()).toContain('systemctl --user restart cogmem-mcp.service');
    } finally {
      child.stop();
    }
  });

  test('with nothing serving there is no skew and the disk version is the answer', async () => {
    const { dir, configPath } = makeWorkspace();
    const result = await runDoctor(dir, ['--json', '--config', configPath]);
    const body = JSON.parse(result.stdout) as { version?: { serving?: unknown; skew?: boolean; disk?: string } };
    expect(body.version?.serving).toEqual([]);
    expect(body.version?.skew).toBe(false);
    const manifest = JSON.parse(readFileSync(join(coreRoot, 'package.json'), 'utf8')) as { version: string };
    expect(body.version?.disk).toBe(manifest.version);
  });
});
