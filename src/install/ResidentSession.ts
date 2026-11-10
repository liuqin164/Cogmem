import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The record a resident MCP process leaves of itself (#150, systemd clause 2).
 *
 * Two facts have to be separable after an upgrade: the version on disk, and the
 * version the *serving process* is still running. A resident process does not
 * hot-reload — it keeps the code it started with — so a staged upgrade leaves the
 * two disagreeing on purpose, and `doctor` can only say so if the process said
 * which version it is. That is all this file is: an address, a pid, a version,
 * and enough to stop and start the process again.
 */

export const RESIDENT_SESSION_FILENAME = 'mcp-http.json';

export interface ResidentSession {
  pid: number;
  /** The package version this process loaded, which is what it is serving. */
  version: string;
  transport: 'http';
  url?: string;
  port?: number;
  startedAt: number;
  /**
   * The systemd unit that started this process, read from its own cgroup. Present
   * only when systemd did start it, and it is what makes `update` stop and start
   * the service through `systemctl` rather than signalling a pid systemd owns.
   */
  systemdUnit?: string;
  /** How to start this process again when systemd is not the one managing it. */
  command: string[];
  cwd?: string;
  configPath?: string;
}

export interface ResidentSessionState {
  session?: ResidentSession;
  /** The recorded pid is still running as a cogmem process. */
  alive: boolean;
  /** What the serving process reports, when there is one. */
  servingVersion?: string;
}

/**
 * The record lives beside the config, in the Workspace's `.cogmem/` directory.
 *
 * Derived the same way the config itself is: `doctor`, `update` and the MCP server
 * must agree on the file, and one of them deriving a different directory is how
 * a skew goes unreported.
 */
export function resolveResidentSessionPath(input: { configPath?: string; workspaceRoot: string }): string {
  const home = input.configPath ? dirname(input.configPath) : join(input.workspaceRoot, '.cogmem');
  return join(home, RESIDENT_SESSION_FILENAME);
}

export function readResidentSession(path: string): ResidentSession | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ResidentSession;
    if (typeof parsed.pid !== 'number' || typeof parsed.version !== 'string') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeResidentSession(path: string, session: ResidentSession): void {
  try {
    writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  } catch {
    // A record that cannot be written costs the skew report, not the server.
  }
}

/** Remove the record, but only when it is this process's own — a restart must not clear its successor's. */
export function clearResidentSession(path: string, pid: number = process.pid): void {
  const session = readResidentSession(path);
  if (!session || session.pid !== pid) return;
  try {
    unlinkSync(path);
  } catch {
    // Already gone.
  }
}

export function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  // A recycled pid is not this process. Where /proc can answer, insist that the
  // command line is a cogmem one; where it cannot, a live pid is the best available.
  const commandLine = readProcessCommandLine(pid);
  if (commandLine === undefined) return true;
  return commandLine.join(' ').includes('cogmem');
}

/** `/proc/<pid>/cmdline`, or undefined on a platform that does not have it. */
export function readProcessCommandLine(pid: number): string[] | undefined {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    const parts = raw.split('\0').filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The systemd unit a process belongs to, from its cgroup.
 *
 * The last `.service` in the cgroup path is the unit; `user@1000.service` is the
 * user manager every login session already sits in, so it is not a unit this
 * process was started by and is skipped.
 */
export function detectSystemdUnit(pid: number = process.pid): string | undefined {
  let cgroup: string;
  try {
    cgroup = readFileSync(`/proc/${pid}/cgroup`, 'utf8');
  } catch {
    return undefined;
  }
  const units = cgroup
    .split('\n')
    .flatMap((line) => line.split('/'))
    .map((part) => part.trim())
    .filter((part) => part.endsWith('.service') && !/^user@\d+\.service$/u.test(part));
  return units.length > 0 ? units[units.length - 1] : undefined;
}

/** What `doctor` needs: the recorded process, whether it is alive, and what it serves. */
export function readResidentSessionState(path: string): ResidentSessionState {
  const session = readResidentSession(path);
  if (!session) return { alive: false };
  const alive = processIsAlive(session.pid);
  return alive
    ? { session, alive, servingVersion: session.version }
    : { session, alive };
}

/**
 * The version the installed package on disk reports.
 *
 * Read from the manifest next to the running entry point, because that is the tree
 * that was just replaced; the in-memory `CORE_VERSION` of a long-running process is
 * the old one by construction.
 */
export function readInstalledVersion(packageDir: string): string | undefined {
  const manifest = join(packageDir, 'package.json');
  if (!existsSync(manifest)) return undefined;
  try {
    const version = (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown }).version;
    return typeof version === 'string' && version.trim() ? version : undefined;
  } catch {
    return undefined;
  }
}

/** Run one command and answer with its exit code. Injected so tests never need a real systemd. */
export type ServiceRunner = (cmd: string[], cwd: string) => Promise<number>;

export interface ServiceActionResult {
  /** `systemctl` when systemd owns the process, `signal`/`spawn` when it does not. */
  method: 'systemctl' | 'signal' | 'spawn' | 'none';
  exitCode?: number;
  error?: string;
}

export interface ServiceActionOptions {
  run?: ServiceRunner;
  cwd?: string;
  timeoutMs?: number;
}

const defaultRunner: ServiceRunner = async (cmd, cwd) => {
  const proc = Bun.spawn({ cmd, cwd, stdout: 'inherit', stderr: 'inherit' });
  return proc.exited;
};

/**
 * Stop the resident process.
 *
 * Under systemd the stop is the service manager's: signalling a pid systemd owns
 * fights `Restart=`, and the unit's own definition is the one that knows how the
 * process is meant to go down. Elsewhere it is a `SIGTERM` and a wait, because
 * swapping the package out from under a live process is how a half-upgraded
 * service happens.
 */
export async function stopResidentService(session: ResidentSession, options: ServiceActionOptions = {}): Promise<ServiceActionResult> {
  const run = options.run ?? defaultRunner;
  const cwd = options.cwd ?? session.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (session.systemdUnit) {
    const exitCode = await run(['systemctl', '--user', 'stop', session.systemdUnit], cwd);
    if (exitCode !== 0) return { method: 'systemctl', exitCode, error: `systemctl --user stop ${session.systemdUnit} exited ${exitCode}` };
    if (!(await waitForExit(session.pid, timeoutMs))) {
      return { method: 'systemctl', exitCode, error: `${session.systemdUnit} was stopped but pid ${session.pid} is still running` };
    }
    return { method: 'systemctl', exitCode };
  }
  if (!processIsAlive(session.pid)) return { method: 'signal' };
  try {
    process.kill(session.pid, 'SIGTERM');
  } catch (error) {
    return { method: 'signal', error: error instanceof Error ? error.message : String(error) };
  }
  if (!(await waitForExit(session.pid, timeoutMs))) {
    return { method: 'signal', error: `pid ${session.pid} did not exit within ${timeoutMs} ms` };
  }
  return { method: 'signal' };
}

/**
 * Start the resident process again, the same way it was started before.
 *
 * `systemctl --user start` under systemd (the unit's `Restart=` policy then applies
 * to the process it starts, not to the stop that just happened), and the recorded
 * argv otherwise — never the old process's pid, which is gone.
 */
export async function startResidentService(session: ResidentSession, options: ServiceActionOptions = {}): Promise<ServiceActionResult> {
  const run = options.run ?? defaultRunner;
  const cwd = options.cwd ?? session.cwd ?? process.cwd();
  if (session.systemdUnit) {
    const exitCode = await run(['systemctl', '--user', 'start', session.systemdUnit], cwd);
    return exitCode === 0
      ? { method: 'systemctl', exitCode }
      : { method: 'systemctl', exitCode, error: `systemctl --user start ${session.systemdUnit} exited ${exitCode}` };
  }
  if (session.command.length === 0) return { method: 'none', error: 'no recorded command to start this service with' };
  try {
    const proc = Bun.spawn({
      cmd: session.command,
      cwd: session.cwd ?? process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: true,
    });
    (proc as { unref?: () => void }).unref?.();
    return { method: 'spawn' };
  } catch (error) {
    return { method: 'spawn', error: error instanceof Error ? error.message : String(error) };
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !processIsAlive(pid);
}
