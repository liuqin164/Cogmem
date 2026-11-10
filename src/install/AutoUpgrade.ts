import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EnvLike } from '../config/ConfigPath.js';
import { CORE_VERSION } from '../version.js';
import { isNewerVersion, isSystemdManaged, type UpdateSettings } from './VersionCheck.js';

/**
 * The unattended upgrade, off unless an operator turns it on (#150).
 *
 * ADR-0003 says a consequential act is decided by a person, so this is not
 * "automatic by default with a kill switch" — it is off, and turning it on is the
 * person deciding in advance. Three more rules ride on that:
 *
 *  - **It never restarts anything.** The most this does is stage the package and
 *    leave the update log saying a restart is owed; the resident process keeps
 *    serving the version it loaded, and a service manager owns the restart. A
 *    process that kills and re-execs itself from inside an upgrade is how an
 *    upgrade leaves a service that is neither old nor new.
 *  - **A service manager needs a second, separate confirmation.** When the process
 *    was started by systemd, the ordinary opt-in is not enough: an operator has to
 *    say so again with `[update] auto_upgrade_in_service = true`. The default
 *    under systemd is check-and-report.
 *  - **It stops at the first failure.** No retries, no loop, no carrying on: the
 *    exit code and the step are written to the update log, the old version stays
 *    installed and serving, and the next check is tomorrow.
 */

export type AutoUpgradeReason =
  | 'allowed'
  | 'auto_upgrade_disabled'
  | 'up_to_date'
  | 'systemd_requires_explicit_opt_in'
  | 'lock_held'
  | 'cli_entrypoint_missing';

export interface AutoUpgradeDecision {
  allowed: boolean;
  reason: AutoUpgradeReason;
  from: string;
  to: string;
}

export interface AutoUpgradeOutcome {
  attempted: boolean;
  decision: AutoUpgradeDecision;
  exitCode?: number;
  status?: 'staged' | 'failed';
}

export interface AutoUpgradeOptions {
  settings: UpdateSettings;
  latestVersion: string;
  currentVersion?: string;
  env?: EnvLike;
  cwd?: string;
  cliEntry?: string;
  run?: CommandRunner;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (cmd: string[], cwd: string, env: EnvLike) => Promise<CommandResult>;

/** One hour: a lock older than any plausible package install is abandoned. */
const LOCK_STALE_MS = 60 * 60 * 1000;
export const AUTO_UPGRADE_LOCK_FILENAME = 'update.lock';

/** The pure half: whether this machine, right now, is allowed to upgrade itself. */
export function decideAutoUpgrade(
  settings: Pick<UpdateSettings, 'autoUpgrade' | 'autoUpgradeInService'>,
  latestVersion: string,
  currentVersion = CORE_VERSION,
  env: EnvLike = process.env,
): AutoUpgradeDecision {
  const from = currentVersion;
  const to = latestVersion;
  if (!settings.autoUpgrade) return { allowed: false, reason: 'auto_upgrade_disabled', from, to };
  if (!isNewerVersion(to, from)) return { allowed: false, reason: 'up_to_date', from, to };
  if (isSystemdManaged(env) && !settings.autoUpgradeInService) {
    return { allowed: false, reason: 'systemd_requires_explicit_opt_in', from, to };
  }
  return { allowed: true, reason: 'allowed', from, to };
}

/**
 * Stage the new version when the decision allows it.
 *
 * The actual work is `cogmem update --yes --stage-only`, deliberately the same
 * command an operator runs — the ticket asks for the existing update flow, not a
 * second one written for automation. `--stage-only` is the part that keeps this
 * process out of the restart business.
 */
export async function runAutoUpgrade(options: AutoUpgradeOptions): Promise<AutoUpgradeOutcome> {
  const env = options.env ?? process.env;
  const decision = decideAutoUpgrade(options.settings, options.latestVersion, options.currentVersion, env);
  if (!decision.allowed) return { attempted: false, decision };

  const cliEntry = options.cliEntry ?? resolveDispatchEntrypoint();
  if (!cliEntry) return { attempted: false, decision: { ...decision, allowed: false, reason: 'cli_entrypoint_missing' } };

  const lockPath = join(options.settings.homeDir, AUTO_UPGRADE_LOCK_FILENAME);
  if (!acquireLock(lockPath)) return { attempted: false, decision: { ...decision, allowed: false, reason: 'lock_held' } };

  try {
    const run = options.run ?? spawnRunner;
    const result = await run(
      [process.execPath || 'bun', cliEntry, 'update', '--yes', '--stage-only', '--json'],
      options.cwd ?? process.cwd(),
      env,
    );
    return {
      attempted: true,
      decision,
      exitCode: result.exitCode,
      // The exit code is the answer: the update command has already written its own
      // step and gate result to the update log, so there is nothing to re-derive.
      status: result.exitCode === 0 ? 'staged' : 'failed',
    };
  } finally {
    releaseLock(lockPath);
  }
}

/** `cogmem.js`/`cogmem.ts` beside this module's bin directory, whichever the build has. */
export function resolveDispatchEntrypoint(fromUrl: string = import.meta.url): string | undefined {
  const binDir = resolve(dirname(fileURLToPath(fromUrl)), '..', 'bin');
  const compiled = join(binDir, 'cogmem.js');
  if (existsSync(compiled)) return compiled;
  const source = join(binDir, 'cogmem.ts');
  return existsSync(source) ? source : undefined;
}

/**
 * One upgrade at a time for this install.
 *
 * Two commands can start a check at once, and two `npm install`s into one tree
 * corrupt it. An exclusive create is the whole mechanism; a lock left by a killed
 * process is cleared after an hour.
 */
// ponytail: one lock per config directory, no pid ownership; a machine-wide lock if
// two installs on one machine ever upgrade concurrently.
function acquireLock(lockPath: string): boolean {
  try {
    closeSync(openSync(lockPath, 'wx'));
    return true;
  } catch {
    try {
      const age = Date.now() - statSync(lockPath).mtimeMs;
      if (age < 0 || age > LOCK_STALE_MS) {
        unlinkSync(lockPath);
        closeSync(openSync(lockPath, 'wx'));
        return true;
      }
    } catch {
      // Gone or unreadable: treat as not held.
      return true;
    }
    return false;
  }
}

function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Already gone, or never ours to remove.
  }
}

async function spawnRunner(cmd: string[], cwd: string, env: EnvLike): Promise<CommandResult> {
  const proc = Bun.spawn({ cmd, cwd, env: { ...env }, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/**
 * The governance trace: one appended line per update, automatic or operator-run.
 *
 * Appendix-only and never rewritten, so "which version did this machine come
 * from, when, and did the gate pass" is a question the file answers rather than a
 * question the current state has overwritten. `cogmem update` is the only writer;
 * everything else reads the last line.
 */
export interface UpdateTraceEntry {
  at: number;
  command: 'update';
  mode: 'stage_only' | 'end_to_end';
  from?: string;
  to?: string;
  status: 'staged' | 'completed' | 'failed';
  /** The step the update stopped at, when it stopped. */
  step?: string;
  gateLevel?: string;
  restartRequired?: boolean;
  error?: string;
}

export function updateLogPath(homeDir: string): string {
  return join(homeDir, 'logs', 'update.jsonl');
}

export function appendUpdateTrace(homeDir: string, entry: UpdateTraceEntry): void {
  try {
    const path = updateLogPath(homeDir);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // The trace is diagnostic: an unwritable log must not fail the update it records.
  }
}

export function readLastUpdateTrace(homeDir: string): UpdateTraceEntry | undefined {
  const path = updateLogPath(homeDir);
  if (!existsSync(path)) return undefined;
  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter((line) => line.trim());
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]!) as UpdateTraceEntry;
      } catch {
        // Skip a torn line rather than losing the whole trace.
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}
