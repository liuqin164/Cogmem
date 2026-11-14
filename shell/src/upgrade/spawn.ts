/**
 * Handing the cycle to the supervisor.
 *
 * The supervisor must outlive the process it stops, which is the whole reason it is a separate
 * process. Two ways out, and they are not interchangeable:
 *
 *  - **No service manager** (`--skip-service`): a detached child. The stop is a `SIGTERM` to the
 *    resident's pid alone, so the supervisor survives it.
 *  - **A service manager owns the resident**: a `SIGTERM` would not be enough, because the supervisor
 *    sits in the unit's cgroup and `systemctl --user stop` takes the whole cgroup down with it — the
 *    upgrade would die silently at its own first step. So the supervisor is started as its own
 *    transient unit (`systemd-run --user --unit … --collect`), and if that cannot be done the upgrade
 *    is refused rather than run in the shape that fails silently.
 */
import { spawn } from 'node:child_process';

import type { Runner } from '../install/service.ts';
import { parseEnvFile } from './paths.ts';
import { supervisorEntryPath } from './supervisor.ts';
import type { UpgradeRequest } from './records.ts';

export interface SpawnSupervisorResult {
  ok: boolean;
  detail: string;
  pid?: number;
}

export interface SpawnSupervisorDeps {
  run: Runner;
  /** Detached spawn, injected by tests. Answers the pid, or undefined when it could not start. */
  spawnDetached?: (command: string[], options: { cwd: string; env: Record<string, string> }) => number | undefined;
}

export function upgradeUnitName(id: string): string {
  return `cogmem-upgrade-${id.replace(/^upgrade-/u, '').slice(0, 20)}`;
}

export async function spawnUpgradeSupervisor(
  request: UpgradeRequest,
  requestPath: string,
  deps: SpawnSupervisorDeps,
): Promise<SpawnSupervisorResult> {
  const entry = supervisorEntryPath(request.fromTree);
  const command = [request.bunPath, entry, '--request', requestPath];
  const env = { ...process.env, ...parseEnvFile(request.envFile) } as Record<string, string>;

  if (request.serviceMode) {
    const unit = upgradeUnitName(request.id);
    const result = await deps.run(
      'systemd-run',
      ['--user', `--unit=${unit}`, '--collect', ...command],
      { cwd: request.workspaceRoot },
    );
    if (result.code !== 0) {
      return {
        ok: false,
        detail: `cannot start the upgrade outside the service's cgroup (systemd-run exited ${result.code}: ${(result.stderr || result.stdout).trim().slice(0, 200)}); `
          + 'a supervisor inside the unit would be stopped by the stop it performs, so this upgrade is refused rather than run in a shape that dies silently',
      };
    }
    return { ok: true, detail: `transient unit ${unit}` };
  }

  const spawnDetached = deps.spawnDetached ?? defaultSpawnDetached;
  const pid = spawnDetached(command, { cwd: request.workspaceRoot, env });
  return pid === undefined
    ? { ok: false, detail: `could not spawn ${command.join(' ')}` }
    : { ok: true, detail: `detached pid ${pid}`, pid };
}

function defaultSpawnDetached(command: string[], options: { cwd: string; env: Record<string, string> }): number | undefined {
  const child = spawn(command[0]!, command.slice(1), { cwd: options.cwd, env: { ...options.env }, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}
