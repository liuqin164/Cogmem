/**
 * The upgrade supervisor: the out-of-process half of the resident-form upgrade (#165).
 *
 * A resident must not swap the package it is running from and restart itself — the process that
 * stops itself mid-upgrade is how a service ends up neither old nor new (`docs/install.md`,
 * `src/install/AutoUpgrade.ts`). So the resident writes a request, hands off to this process, and
 * this process owns the whole cycle:
 *
 *   stop → snapshot → migrate+gate → switch → start → health, and the report at the end, whatever
 *   happened.
 *
 * It is started from the *serving* tree, not the staged one: the code driving a rollback must be code
 * that is known to work. The staged tree is exercised as a foreign artifact (the gate runs in its own
 * process), which is also what makes a broken staged tree fail safely.
 *
 * The brain is snapshotted *before* the new code opens it, because that open is the migration. If any
 * check fails after that point, the snapshot is restored and the old tree is put back — a rolled-back
 * upgrade leaves the previous version serving its own, pre-migration brain.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryKernel, SnapshotImporter } from 'cogmem';

import { launchdLabel, renderLaunchdPlist, renderSystemdUnit, serviceStatus, type Platform, type Runner } from '../install/service.ts';
import { defaultFetchHealth, parseEnvFile } from '../install/installer.ts';
import { DEFAULT_SOUL, readSoul } from '../install/soul.ts';
import { runDoctor, type HealthPayload } from '../install/doctor.ts';
import { TraceLog } from '../trace.ts';
import { residentArgsFor, serviceSpecFromRequest, shellDirOfTree, supervisorEntryPath } from './paths.ts';
import { spawnDetached, systemdStartedThisProcess } from './spawn.ts';
import { processAlive } from './records.ts';
import { clearUpgradeRequest, mergeUpgradeChecks, readSnapshotDimension, writeUpgradeJson, upgradeOutcomePath, upgradeSupervisorPidPath, type UpgradeCheck, type UpgradeOutcome, type UpgradeRequest, type UpgradeStep } from './records.ts';

export interface UpgradeOpResult {
  ok: boolean;
  detail: string;
  /** The pid a detached start produced, so a rollback can stop exactly what it started. */
  pid?: number;
  /** The live doctor's per-check account, when the op was the post-switch gate. */
  checks?: UpgradeCheck[];
}

export interface UpgradeOps {
  /** Stop the resident. `pid` overrides the request's, for a process a rollback just started. */
  stopResident(request: UpgradeRequest, pid?: number): Promise<UpgradeOpResult>;
  snapshot(request: UpgradeRequest, outPath: string): Promise<UpgradeOpResult & { bytes?: number }>;
  restoreSnapshot(request: UpgradeRequest, snapPath: string): Promise<UpgradeOpResult>;
  gate(request: UpgradeRequest, tree: string): Promise<UpgradeOpResult & { checks: UpgradeCheck[] }>;
  /** Point the service at `tree`. Without a service manager this is a no-op; the start names the tree. */
  switchService(request: UpgradeRequest, tree: string): Promise<UpgradeOpResult>;
  startResident(request: UpgradeRequest, tree: string): Promise<UpgradeOpResult>;
  health(request: UpgradeRequest, pid?: number): Promise<UpgradeOpResult>;
  trace(kind: string, record: Record<string, unknown>): void;
  now(): number;
}

function snapshotPath(request: UpgradeRequest): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(request.dataDir, 'snapshots', `pre-upgrade-${request.fromVersion}-${stamp}.snap`);
}

function phase(outcome: UpgradeOutcome, step: UpgradeStep, extra: Partial<UpgradeOutcome> = {}): UpgradeOutcome {
  return { ...outcome, step, ...extra };
}

/**
 * The whole cycle. Every exit path writes an outcome: there is no branch that ends in silence, which
 * is the one outcome the ticket calls a veto-level failure.
 */
export async function runUpgradeSupervisor(request: UpgradeRequest, ops: UpgradeOps): Promise<UpgradeOutcome> {
  const startedAt = ops.now();
  let outcome: UpgradeOutcome = {
    id: request.id,
    fromVersion: request.fromVersion,
    toVersion: request.toVersion,
    fromTree: request.fromTree,
    toTree: request.toTree,
    status: 'failed',
    step: 'requested',
    startedAt,
    finishedAt: 0,
    checks: [],
  };
  const record = (kind: string, extra: Record<string, unknown> = {}): void => {
    ops.trace(kind, { upgradeId: request.id, from: request.fromVersion, to: request.toVersion, step: outcome.step, ...extra });
  };
  /**
   * One failed step, never an escape. An op that throws — an unreadable unit file, a full disk, a
   * `systemctl` that never spawned — would otherwise leave the cycle without an outcome *and* with the
   * resident it just stopped still stopped, which is the one state the ticket forbids.
   */
  const attempt = async <T extends UpgradeOpResult>(what: string, call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      const detail = `${what} threw: ${error instanceof Error ? error.message : String(error)}`;
      record('upgrade_op_threw', { op: what, message: detail });
      return { ok: false, detail } as T;
    }
  };
  const finish = (status: UpgradeOutcome['status'], step: UpgradeStep, extra: Partial<UpgradeOutcome> = {}): UpgradeOutcome => {
    outcome = { ...phase(outcome, step, extra), status, finishedAt: ops.now() };
    try {
      writeUpgradeJson(upgradeOutcomePath(request.dataDir), outcome);
    } catch (error) {
      // The report is the point of the file; a write that fails cannot be silent about itself.
      record('upgrade_outcome_write_failed', { message: error instanceof Error ? error.message : String(error) });
    }
    // The cycle is over, so the request stops being "an upgrade in flight". What remains is the
    // outcome, which is the thing the next resident start owes the user a report about.
    clearUpgradeRequest(request.dataDir);
    record('upgrade_finished', { status, error: outcome.error, rollback: outcome.rollback });
    return outcome;
  };

  record('upgrade_started');

  // 1. Stop the serving process before anything under it is replaced.
  const stopped = await attempt('stop', () => ops.stopResident(request));
  if (!stopped.ok) {
    // Nothing has changed yet: the package, the brain and the service are exactly as they were.
    return finish('failed', 'stop', { error: stopped.detail, rollback: '未改动：停服失败，旧版仍在服务' });
  }
  outcome = phase(outcome, 'stop');

  // 2. Snapshot the brain before the new code opens it.
  const snapPath = snapshotPath(request);
  const exported = await attempt('snapshot', () => ops.snapshot(request, snapPath));
  outcome = phase(outcome, 'snapshot', exported.ok ? { snapshot: snapPath, snapshotBytes: exported.bytes } : {});
  if (!exported.ok) {
    const restarted = await attempt('start', () => ops.startResident(request, request.fromTree));
    return finish('failed', 'snapshot', {
      error: exported.detail,
      rollback: restarted.ok ? '快照失败，未迁移；旧版已重新拉起' : `快照失败，未迁移；旧版重启也失败：${restarted.detail}`,
    });
  }

  // 3. Migrate and gate with the staged tree's own code — in its own process, so the gate is evidence
  //    about that version and a staged tree that cannot run fails here instead of after the switch.
  const gated = await attempt('gate', () => ops.gate(request, request.toTree));
  outcome = phase(outcome, 'gate', { checks: gated.checks });
  if (!gated.ok) {
    const rollback = await rollbackTo(request, ops, snapPath, '健康门未过');
    return finish('rolled_back', 'gate', { error: gated.detail, rollback });
  }

  // 4. Switch and start the new tree.
  const switched = await attempt('switch', () => ops.switchService(request, request.toTree));
  if (!switched.ok) {
    const rollback = await rollbackTo(request, ops, snapPath, '切换失败');
    return finish('rolled_back', 'switch', { error: switched.detail, rollback });
  }
  const started = await attempt('start', () => ops.startResident(request, request.toTree));
  outcome = phase(outcome, 'switch');
  if (!started.ok) {
    const rollback = await rollbackTo(request, ops, snapPath, '启服失败', started.pid);
    return finish('rolled_back', 'switch', { error: started.detail, rollback });
  }

  // 5. The live half of the health gate: the new version is only "in service" once it answers.
  const healthy = await attempt('doctor', () => ops.health(request, started.pid));
  const allChecks = mergeUpgradeChecks(outcome.checks, healthy.checks ?? []);
  if (!healthy.ok) {
    const rollback = await rollbackTo(request, ops, snapPath, '启动后健康门未过', started.pid);
    return finish('rolled_back', 'health', { error: healthy.detail, rollback, checks: allChecks });
  }
  outcome = phase(outcome, 'health', { checks: allChecks });
  return finish('completed', 'done');
}

/**
 * Put the previous version back, brain first.
 *
 * The order matters: the snapshot is restored while nothing is serving, then the old tree is pointed
 * back at and started. A rollback whose restore fails is still reported as a rollback — with the
 * failure named in it — because "the old version serves a migrated brain" is a different (and worse)
 * fact than "the old version serves its own brain", and the report has to tell them apart.
 */
async function rollbackTo(
  request: UpgradeRequest,
  ops: UpgradeOps,
  snapPath: string,
  reason: string,
  servingPid?: number,
): Promise<string> {
  const parts: string[] = [reason];
  const safely = async <T extends UpgradeOpResult>(what: string, call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      return { ok: false, detail: `${what} threw: ${error instanceof Error ? error.message : String(error)}` } as T;
    }
  };
  await safely('stop', () => ops.stopResident(request, servingPid));
  const restored = await safely('restore', () => ops.restoreSnapshot(request, snapPath));
  parts.push(restored.ok ? `快照已恢复（${snapPath}）` : `快照恢复失败：${restored.detail}`);
  const switchedBack = await safely('switch-back', () => ops.switchService(request, request.fromTree));
  parts.push(switchedBack.ok ? '服务指回旧版' : `指回旧版失败：${switchedBack.detail}`);
  const started = await safely('start-old', () => ops.startResident(request, request.fromTree));
  parts.push(started.ok ? `旧版已重新服务（pid ${started.pid ?? '?'}）` : `旧版重启失败：${started.detail}`);
  ops.trace('upgrade_rolled_back', { upgradeId: request.id, rollback: parts.join('；') });
  return parts.join('；');
}

// ── The real operations ───────────────────────────────────────────────────────────────────────────

export interface DefaultOpsOptions {
  run: Runner;
  /** Spawn a detached resident for a tree with no service manager. Injected by tests. */
  spawnDetached?: (command: string[], options: { cwd: string; env: Record<string, string> }) => number | undefined;
  fetchHealth?: (url: string) => Promise<HealthPayload>;
  log?: (kind: string, record: Record<string, unknown>) => void;
  now?: () => number;
  /** How long to wait for a stop, a start's health, and the gate. */
  stopTimeoutMs?: number;
  healthTimeoutMs?: number;
}

async function pollUntil(check: () => Promise<boolean>, timeoutMs: number, intervalMs = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
}

function platformOf(request: UpgradeRequest): Platform {
  return request.platform === 'darwin' ? 'darwin' : 'linux';
}

export function defaultUpgradeOps(options: DefaultOpsOptions): UpgradeOps {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  const healthUrl = (request: UpgradeRequest): string => `http://127.0.0.1:${request.httpPort}/health`;

  const stopResident = async (request: UpgradeRequest, pid?: number): Promise<UpgradeOpResult> => {
    if (request.serviceMode || systemdStartedThisProcess()) {
      // The manager's stop, always — not a signal to the pid, even when a rollback is stopping a
      // process it started itself. The unit carries `Restart=always`, so a SIGTERM to a
      // systemd-owned pid is followed by systemd starting the unit again, which would race the very
      // rollback the stop is making room for. `is-active`/`print` is the evidence, not the pid.
      const spec = serviceSpecFromRequest(request, request.fromTree);
      const platform = platformOf(request);
      const unit = `${request.serviceName}.service`;
      const result = platform === 'darwin'
        ? await options.run('launchctl', ['kill', 'SIGTERM', `gui/${process.getuid?.() ?? 501}/${launchdLabel(request.serviceName)}`])
        : await options.run('systemctl', ['--user', 'stop', unit]);
      if (result.code !== 0) {
        // No manager actually owns this process after all: a plain signal is the fallback, and a
        // missing unit is not a reason to abort an upgrade the resident already announced.
        if (!systemdStartedThisProcess()) return { ok: false, detail: `stop ${unit} exited ${result.code}: ${result.stderr.trim()}` };
        return signalStop(request, pid);
      }
      const running = platform === 'darwin' ? 'loaded' : 'active';
      const down = await pollUntil(async () => (await serviceStatus(options.run, spec, platform)) !== running, options.stopTimeoutMs ?? 10_000, 200);
      return down ? { ok: true, detail: `systemctl stop ${unit}` } : { ok: false, detail: `${unit} is still ${running} after stop` };
    }
    return signalStop(request, pid);
  };

  const signalStop = async (request: UpgradeRequest, pid?: number): Promise<UpgradeOpResult> => {
    const target = pid ?? request.pid;
    if (!processAlive(target)) return { ok: true, detail: `pid ${target} was already gone` };
    try {
      process.kill(target, 'SIGTERM');
    } catch (error) {
      return { ok: false, detail: `SIGTERM ${target} failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    const gone = await pollUntil(async () => !processAlive(target), options.stopTimeoutMs ?? 10_000);
    return gone ? { ok: true, detail: `SIGTERM pid ${target}` } : { ok: false, detail: `pid ${target} did not exit in time` };
  };

  const startResident = async (request: UpgradeRequest, tree: string): Promise<UpgradeOpResult> => {
    const shellDir = shellDirOfTree(tree);
    if (request.serviceMode) {
      const unit = `${request.serviceName}.service`;
      if (platformOf(request) === 'darwin') {
        const uid = process.getuid?.() ?? 501;
        const result = await options.run('launchctl', ['kickstart', '-k', `gui/${uid}/${launchdLabel(request.serviceName)}`]);
        return result.code === 0 ? { ok: true, detail: `launchctl kickstart ${request.serviceName}` } : { ok: false, detail: `launchctl kickstart exited ${result.code}: ${result.stderr.trim()}` };
      }
      const result = await options.run('systemctl', ['--user', 'start', unit]);
      if (result.code !== 0) return { ok: false, detail: `systemctl start ${unit} exited ${result.code}: ${result.stderr.trim()}` };
      // The manager owns the pid, so the report asks it rather than guessing: a rollback's report that
      // says which process is serving the old version is the difference between evidence and a claim.
      const show = await options.run('systemctl', ['--user', 'show', '-p', 'MainPID', '--value', unit]);
      const pid = Number.parseInt(show.stdout.trim(), 10);
      return { ok: true, detail: `systemctl start ${unit}`, ...(Number.isInteger(pid) && pid > 0 ? { pid } : {}) };
    }
    const command = residentArgsFor(request, shellDir);
    const env = { ...process.env, ...parseEnvFile(request.envFile), COGMEM_SHELL_ATTACH: 'on' } as Record<string, string>;
    const pid = (options.spawnDetached ?? spawnDetached)([request.bunPath, ...command.slice(1)], { cwd: request.workspaceRoot, env });
    return pid === undefined ? { ok: false, detail: `could not start ${command.join(' ')}` } : { ok: true, detail: `spawned pid ${pid}`, pid };
  };

  return {
    now,
    trace: (kind, record) => log(kind, record),
    stopResident,
    startResident,
    async snapshot(request, outPath) {
      // The serving tree's own kernel exports the brain: known-good code, and it runs while nothing
      // else holds the database open.
      const kernel = createMemoryKernel({ dbPath: request.dbPath });
      try {
        const meta = await kernel.exportSnapshot(outPath);
        return { ok: true, detail: `${meta.snapshotPath}（${meta.byteLength} 字节，sha256 ${meta.header.checksum.slice(0, 12)}）`, bytes: meta.byteLength };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      } finally {
        kernel.close();
      }
    },
    async restoreSnapshot(request, snapPath) {
      if (!existsSync(snapPath)) return { ok: false, detail: `snapshot ${snapPath} is gone` };
      const dimension = readSnapshotDimension(snapPath);
      if (dimension === undefined) return { ok: false, detail: `snapshot ${snapPath} has no readable header` };
      // The WAL and SHM beside a replaced database file belong to the file that was replaced. SQLite
      // usually refuses a WAL whose salt no longer matches; removing them makes that certain.
      for (const suffix of ['-wal', '-shm']) rmSync(`${request.dbPath}${suffix}`, { force: true });
      try {
        const result = await new SnapshotImporter({ expectedEmbeddingDimension: dimension }).import(snapPath, request.dbPath, { overwrite: true });
        return { ok: true, detail: `restored ${result.header.neuronCount} neurons from ${snapPath}` };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
    async gate(request, tree) {
      const entry = join(shellDirOfTree(tree), 'src', 'cli.ts');
      if (!existsSync(entry)) return { ok: false, detail: `staged tree has no ${entry}`, checks: [] };
      const result = await options.run(
        request.bunPath,
        [entry, 'gate', '--data', request.dataDir, '--db', request.dbPath, '--agent', request.agentId, '--project', request.projectId, '--json'],
        { cwd: tree },
      );
      try {
        const payload = JSON.parse(result.stdout.trim().split('\n').pop() ?? '') as { ok?: boolean; checks?: UpgradeCheck[] };
        if (!Array.isArray(payload.checks)) throw new Error('gate JSON has no checks');
        const failed = payload.checks.filter((check) => !check.ok).map((check) => check.id);
        return {
          ok: payload.ok === true && result.code === 0,
          // The failing check names itself, so the report's one-line failure says what failed rather
          // than only that something did.
          detail: `gate exit ${result.code}${failed.length > 0 ? `：未过 ${failed.join(', ')}` : ''}`,
          checks: payload.checks,
        };
      } catch (error) {
        return {
          ok: false,
          detail: `gate in ${tree} produced no readable result (exit ${result.code}): ${(result.stderr || result.stdout).trim().slice(0, 300) || (error instanceof Error ? error.message : String(error))}`,
          checks: [],
        };
      }
    },
    async switchService(request, tree) {
      if (!request.serviceMode) return { ok: true, detail: 'no service manager: the start names the tree' };
      const spec = serviceSpecFromRequest(request, shellDirOfTree(tree));
      if (platformOf(request) === 'darwin') {
        const path = join(request.homeDir, 'Library', 'LaunchAgents', `${launchdLabel(request.serviceName)}.plist`);
        writeFileSync(path, renderLaunchdPlist(spec), { mode: 0o600 });
        return { ok: true, detail: `plist points at ${tree}` };
      }
      const path = join(request.homeDir, '.config', 'systemd', 'user', `${request.serviceName}.service`);
      writeFileSync(path, renderSystemdUnit(spec), { mode: 0o644 });
      const reload = await options.run('systemctl', ['--user', 'daemon-reload']);
      return reload.code === 0
        ? { ok: true, detail: `unit points at ${tree}` }
        : { ok: false, detail: `daemon-reload exited ${reload.code}: ${reload.stderr.trim()}` };
    },
    /**
     * The live half of the gate: the install's own `runDoctor`, once the new version is serving.
     *
     * It is the whole six-check doctor — health face, loopback-only bind, attach socket, kernel
     * identity and dbPath, soul, unit/process — because that is the check a real install ends on, and
     * the upgrade's claim is exactly "this install is as healthy as a fresh one". It runs *after* the
     * switch rather than before it because every one of those checks needs a process to ask.
     */
    async health(request, pid) {
      const fetchHealth = options.fetchHealth ?? defaultFetchHealth;
      const platform = platformOf(request);
      const expectedSoul = (() => {
        try {
          return readSoul(request.dbPath, request.agentId)?.content ?? DEFAULT_SOUL;
        } catch {
          return DEFAULT_SOUL;
        }
      })();
      let report: Awaited<ReturnType<typeof runDoctor>> | undefined;
      const ok = await pollUntil(async () => {
        try {
          report = await runDoctor({
            dataDir: request.dataDir,
            dbPath: request.dbPath,
            agentId: request.agentId,
            socketPath: request.socketPath,
            healthUrl: healthUrl(request),
            fetchHealth: () => fetchHealth(healthUrl(request)),
            spec: serviceSpecFromRequest(request, request.toTree),
            platform,
            run: options.run,
            mode: request.serviceMode ? 'service' : 'process',
            pid: pid ?? request.pid,
            expectedSoul,
          });
        } catch (error) {
          report = undefined;
          log('upgrade_doctor_threw', { message: error instanceof Error ? error.message : String(error) });
        }
        return report?.ok === true;
      }, options.healthTimeoutMs ?? 45_000, 500);
      if (!report) return { ok: false, detail: `${healthUrl(request)} did not answer in time`, checks: [] };
      const failed = report.checks.filter((check) => !check.ok);
      return {
        ok,
        detail: ok ? 'doctor ok' : failed.map((check) => `${check.id}: ${check.detail}`).join('; '),
        checks: report.checks,
      };
    },
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────────────────────────

/** The supervisor's own log line, on the resident's evidence file rather than a private one. */
export function supervisorTraceFor(dataDir: string): (kind: string, record: Record<string, unknown>) => void {
  const trace = new TraceLog(dataDir);
  return (kind, record) => trace.append(kind, record);
}

async function main(argv: string[]): Promise<number> {
  const requestIndex = argv.indexOf('--request');
  const requestPath = requestIndex >= 0 ? argv[requestIndex + 1] : undefined;
  if (!requestPath) {
    process.stderr.write('usage: supervisor.ts --request <upgrade/request.json>\n');
    return 2;
  }
  const { readFileSync } = await import('node:fs');
  const request = JSON.parse(readFileSync(requestPath, 'utf8')) as UpgradeRequest;
  const { defaultRunner } = await import('../install/installer.ts');
  // First act: say which process owns this cycle, so the resident that comes back can tell "still
  // working" from "gone silent". Removed in the same breath as the outcome is written.
  writeFileSync(upgradeSupervisorPidPath(request.dataDir), `${process.pid}\n`, { mode: 0o600 });
  // The announcement's receipt is written by the resident right after it starts this process. Give it
  // a moment to reach the socket before the first step stops the process that is writing it, or the
  // 预告 the ticket asks for would arrive after the disconnection it announces.
  if (request.handoffGraceMs > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, request.handoffGraceMs));
  let outcome: UpgradeOutcome;
  try {
    outcome = await runUpgradeSupervisor(request, defaultUpgradeOps({
      run: defaultRunner(),
      log: supervisorTraceFor(request.dataDir),
    }));
  } finally {
    rmSync(upgradeSupervisorPidPath(request.dataDir), { force: true });
  }
  // The exit code is the outcome, so a service manager (or the operator) can act on it without
  // parsing the JSON. The durable report is the file either way.
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  return outcome.status === 'completed' ? 0 : 1;
}

// Bun runs the file as a script when it is the entry point; importing it in tests must not.
if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(`[cogmem-upgrade] fatal: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
