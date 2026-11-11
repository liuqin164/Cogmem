import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The records resident processes leave of themselves (#150, systemd clause 2).
 *
 * Two facts have to be separable after an upgrade: the version on disk, and the
 * version the *serving* process is still running. A resident process does not
 * hot-reload — it keeps the code it started with — so a staged upgrade leaves the
 * two disagreeing on purpose, and `doctor` can only say so if each process said
 * which version it is.
 *
 * One file per pid in `sessions/`, rather than one file for "the server": several
 * hosts can have stdio sessions open at once, each is its own process, and a single
 * shared file would let the last writer hide the others. The pid names the file
 * because the process already has to be unique.
 */

const SESSIONS_DIRNAME = 'sessions';

export interface ResidentSession {
  pid: number;
  /** The package version this process loaded, which is what it is serving. */
  version: string;
  /**
   * `http` is the resident observatory an operator runs as a service; `stdio` is one
   * host's child, which that host owns and restarts. `update` stops and starts only
   * the first kind.
   */
  transport: 'http' | 'stdio';
  url?: string;
  port?: number;
  hostId?: string;
  projectId?: string;
  startedAt: number;
  /** The systemd unit that started this process, read from its own cgroup. */
  systemdUnit?: string;
  /** Which manager owns that unit: a user manager, or the system one. */
  systemdScope?: 'user' | 'system';
  /** How to start this process again when systemd is not the one managing it. */
  command: string[];
  cwd?: string;
  configPath?: string;
}

export interface ResidentSessionRecord {
  session: ResidentSession;
}

/** The directory the records live in, derived the same way the config itself is. */
export function resolveResidentSessionDir(input: { configPath?: string; workspaceRoot: string }): string {
  const home = input.configPath ? dirname(input.configPath) : join(input.workspaceRoot, '.cogmem');
  return join(home, SESSIONS_DIRNAME);
}

function sessionFile(dir: string, pid: number): string {
  return join(dir, `${pid}.json`);
}

function readResidentSession(path: string): ResidentSession | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ResidentSession;
    if (typeof parsed.pid !== 'number' || typeof parsed.version !== 'string') return undefined;
    if (parsed.transport !== 'http' && parsed.transport !== 'stdio') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeResidentSession(dir: string, session: ResidentSession): void {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(sessionFile(dir, session.pid), `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  } catch {
    // A record that cannot be written costs the skew report, not the process.
  }
}

/** Remove this process's record — a restart must not clear its successor's. */
export function clearResidentSession(dir: string, pid: number = process.pid): void {
  try {
    unlinkSync(sessionFile(dir, pid));
  } catch {
    // Already gone.
  }
}

/**
 * The processes serving right now, newest first.
 *
 * A record whose pid is gone is removed: the process is not coming back, and
 * leaving the file would let a reused pid read as a very old process. This is the
 * one place records are collected, so `doctor` and `update` see the same set.
 */
export function readResidentSessions(dir: string): ResidentSessionRecord[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const records: ResidentSessionRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const path = join(dir, entry);
    const session = readResidentSession(path);
    if (!session || !processIsAlive(session.pid)) {
      try { unlinkSync(path); } catch { /* another reader won the race */ }
      continue;
    }
    records.push({ session });
  }
  return records.sort((left, right) => right.session.startedAt - left.session.startedAt);
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
 * The parent's command name, from `/proc/<pid>/comm` via the parent id in `stat`.
 *
 * `stat`'s second field is the command in parentheses and may itself contain spaces
 * and parentheses, so the parent id is read after the *last* `)`.
 */
function parentProcessName(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/u);
    const ppid = Number.parseInt(fields[1] ?? '', 10);
    if (!Number.isInteger(ppid) || ppid <= 0) return undefined;
    return readFileSync(`/proc/${ppid}/comm`, 'utf8').trim();
  } catch {
    return undefined;
  }
}

function readCgroup(pid: number): string | undefined {
  try {
    return readFileSync(`/proc/${pid}/cgroup`, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * The systemd unit that started this process, when systemd is the one that did.
 *
 * The cgroup alone is not enough. A process can sit inside any unit without having
 * been started by it — a CI agent's job runs inside `hosted-compute-agent.service`,
 * and reading that as "the unit that owns me" made `update` try to restart the CI
 * agent. What makes a unit ours is that **systemd started this process**, and the
 * way to see that is the process's own parent: for `Type=simple` the manager is the
 * parent, so the parent's command name is `systemd`. A service that double-forks is
 * not claimed, which is the safe direction — its process is signalled by pid
 * instead of having a unit stopped that may not be the one that started it.
 *
 * `user@1000.service` is the user manager every login session already sits in, so it
 * is skipped for the same reason: it is the manager, not a unit of its own.
 */
export function detectSystemdUnit(pid: number = process.pid): string | undefined {
  if (parentProcessName(pid) !== 'systemd') return undefined;
  const cgroup = readCgroup(pid);
  if (!cgroup) return undefined;
  const units = cgroup
    .split('\n')
    .flatMap((line) => line.split('/'))
    .map((part) => part.trim())
    .filter((part) => part.endsWith('.service') && !/^user@\d+\.service$/u.test(part));
  return units.length > 0 ? units[units.length - 1] : undefined;
}

/**
 * Whether that unit belongs to the user manager or the system one.
 *
 * It decides the command: `systemctl --user stop X` against a system unit fails
 * with "Unit not found", so the end-to-end update would abort at the stop step for
 * a service it could have stopped with `systemctl stop X`.
 */
export function detectSystemdScope(pid: number = process.pid): 'user' | 'system' | undefined {
  // Scope describes a unit; a process with no unit of its own has none.
  if (!detectSystemdUnit(pid)) return undefined;
  const cgroup = readCgroup(pid);
  if (!cgroup) return undefined;
  return /\/user\.slice\/|user@\d+\.service/u.test(cgroup) ? 'user' : 'system';
}

/** Run one command and answer with its exit code. Injected so tests never need a real systemd. */
export type ResidentProcessRunner = (cmd: string[], cwd: string) => Promise<number>;

export interface ResidentActionResult {
  /** `systemctl` when systemd owns the process, `signal`/`spawn` when it does not. */
  method: 'systemctl' | 'signal' | 'spawn' | 'none';
  exitCode?: number;
  error?: string;
}

export interface ResidentActionOptions {
  run?: ResidentProcessRunner;
  cwd?: string;
  timeoutMs?: number;
}

const defaultRunner: ResidentProcessRunner = async (cmd, cwd) => {
  const proc = Bun.spawn({ cmd, cwd, stdout: 'inherit', stderr: 'inherit' });
  return proc.exited;
};

/** `systemctl` for the manager that owns the unit, `--user` only for a user unit. */
export function systemctlCommand(session: ResidentSession, ...args: string[]): string[] {
  return ['systemctl', ...(session.systemdScope === 'system' ? [] : ['--user']), ...args];
}

/**
 * Stop the resident process.
 *
 * Under systemd the stop is the manager's: signalling a pid systemd owns fights
 * `Restart=`, and the unit's own definition is the one that knows how the process
 * is meant to go down. Elsewhere it is a `SIGTERM` and a wait, because swapping the
 * package out from under a live process is how a half-upgraded service happens.
 */
export async function stopResidentProcess(session: ResidentSession, options: ResidentActionOptions = {}): Promise<ResidentActionResult> {
  const run = options.run ?? defaultRunner;
  const cwd = options.cwd ?? session.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (session.systemdUnit) {
    const command = systemctlCommand(session, 'stop', session.systemdUnit);
    const exitCode = await run(command, cwd);
    if (exitCode !== 0) return { method: 'systemctl', exitCode, error: `${command.join(' ')} exited ${exitCode}` };
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
 * `systemctl start` when systemd owns the unit (its `Restart=` policy then applies to
 * the process it starts, not to the stop that just happened), and the recorded argv
 * otherwise — never the old pid, which is gone. The spawn is detached from this
 * process's streams: inheriting them would make a long-running process hold
 * whatever pipe `update` was writing into, so `update --json | jq` would never
 * return. Only the HTTP transport is started this way; a stdio session belongs to
 * the host that spawned it.
 */
export async function startResidentProcess(session: ResidentSession, options: ResidentActionOptions = {}): Promise<ResidentActionResult> {
  if (session.transport !== 'http') {
    return { method: 'none', error: 'a stdio session is restarted by the host that owns it, not by update' };
  }
  const run = options.run ?? defaultRunner;
  const cwd = options.cwd ?? session.cwd ?? process.cwd();
  if (session.systemdUnit) {
    const command = systemctlCommand(session, 'start', session.systemdUnit);
    const exitCode = await run(command, cwd);
    return exitCode === 0
      ? { method: 'systemctl', exitCode }
      : { method: 'systemctl', exitCode, error: `${command.join(' ')} exited ${exitCode}` };
  }
  if (session.command.length === 0) return { method: 'none', error: 'no recorded command to start this process with' };
  try {
    const proc = Bun.spawn({
      cmd: session.command,
      cwd: session.cwd ?? process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'ignore', 'ignore'],
      detached: true,
    });
    (proc as { unref?: () => void }).unref?.();
    return { method: 'spawn', exitCode: 0 };
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
