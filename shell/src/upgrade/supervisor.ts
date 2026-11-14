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
import { spawn } from 'node:child_process';
import { createMemoryKernel, SnapshotImporter } from 'cogmem';

import { launchdLabel, renderLaunchdPlist, renderSystemdUnit, type CommandResult, type Platform, type Runner } from '../install/service.ts';
import { TraceLog } from '../trace.ts';
import { parseEnvFile, residentArgsFor, serviceSpecFromRequest, shellDirOfTree, treeOfThisProcess } from './paths.ts';
import { clearUpgradeRequest, readSnapshotDimension, writeUpgradeJson, upgradeOutcomePath, upgradeSupervisorPidPath, type UpgradeCheck, type UpgradeOutcome, type UpgradeRequest, type UpgradeStep } from './records.ts';

export interface UpgradeOpResult {
  ok: boolean;
  detail: string;
  /** The pid a detached start produced, so a rollback can stop exactly what it started. */
  pid?: number;
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
  health(request: UpgradeRequest): Promise<UpgradeOpResult>;
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
  const finish = (status: UpgradeOutcome['status'], step: UpgradeStep, extra: Partial<UpgradeOutcome> = {}): UpgradeOutcome => {
    outcome = { ...phase(outcome, step, extra), status, finishedAt: ops.now() };
    writeUpgradeJson(upgradeOutcomePath(request.dataDir), outcome);
    // The cycle is over, so the request stops being "an upgrade in flight". What remains is the
    // outcome, which is the thing the next resident start owes the user a report about.
    clearUpgradeRequest(request.dataDir);
    record('upgrade_finished', { status, error: outcome.error, rollback: outcome.rollback });
    return outcome;
  };

  record('upgrade_started');

  // 1. Stop the serving process before anything under it is replaced.
  const stopped = await ops.stopResident(request);
  if (!stopped.ok) {
    // Nothing has changed yet: the package, the brain and the service are exactly as they were.
    return finish('failed', 'stop', { error: stopped.detail, rollback: '未改动：停服失败，旧版仍在服务' });
  }
  outcome = phase(outcome, 'stop');

  // 2. Snapshot the brain before the new code opens it.
  const snapPath = snapshotPath(request);
  const exported = await ops.snapshot(request, snapPath);
  outcome = phase(outcome, 'snapshot', exported.ok ? { snapshot: snapPath, snapshotBytes: exported.bytes } : {});
  if (!exported.ok) {
    const restarted = await ops.startResident(request, request.fromTree);
    return finish('failed', 'snapshot', {
      error: exported.detail,
      rollback: restarted.ok ? '快照失败，未迁移；旧版已重新拉起' : `快照失败，未迁移；旧版重启也失败：${restarted.detail}`,
    });
  }

  // 3. Migrate and gate with the staged tree's own code — in its own process, so the gate is evidence
  //    about that version and a staged tree that cannot run fails here instead of after the switch.
  const gated = await ops.gate(request, request.toTree);
  outcome = phase(outcome, 'gate', { checks: gated.checks });
  if (!gated.ok) {
    const rollback = await rollbackTo(request, ops, snapPath, '健康门未过');
    return finish('rolled_back', 'gate', { error: gated.detail, rollback });
  }

  // 4. Switch and start the new tree.
  const switched = await ops.switchService(request, request.toTree);
  if (!switched.ok) {
    const rollback = await rollbackTo(request, ops, snapPath, '切换失败');
    return finish('rolled_back', 'switch', { error: switched.detail, rollback });
  }
  const started = await ops.startResident(request, request.toTree);
  outcome = phase(outcome, 'switch');
  if (!started.ok) {
    const rollback = await rollbackTo(request, ops, snapPath, '启服失败', started.pid);
    return finish('rolled_back', 'switch', { error: started.detail, rollback });
  }

  // 5. The live half of the health gate: the new version is only "in service" once it answers.
  const healthy = await ops.health(request);
  if (!healthy.ok) {
    const rollback = await rollbackTo(request, ops, snapPath, '启动后健康检查未过', started.pid);
    return finish('rolled_back', 'health', { error: healthy.detail, rollback });
  }
  outcome = phase(outcome, 'health');
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
  await ops.stopResident(request, servingPid);
  const restored = await ops.restoreSnapshot(request, snapPath);
  parts.push(restored.ok ? `快照已恢复（${snapPath}）` : `快照恢复失败：${restored.detail}`);
  const switchedBack = await ops.switchService(request, request.fromTree);
  parts.push(switchedBack.ok ? '服务指回旧版' : `指回旧版失败：${switchedBack.detail}`);
  const started = await ops.startResident(request, request.fromTree);
  parts.push(started.ok ? `旧版已重新服务（pid ${started.pid ?? '?'}）` : `旧版重启失败：${started.detail}`);
  ops.trace('upgrade_rolled_back', { upgradeId: request.id, rollback: parts.join('；') });
  return parts.join('；');
}

// ── The real operations ───────────────────────────────────────────────────────────────────────────

export interface DefaultOpsOptions {
  run: Runner;
  /** Spawn a detached resident for a tree with no service manager. Injected by tests. */
  spawnDetached?: (command: string[], options: { cwd: string; env: Record<string, string>; shellDir: string }) => number | undefined;
  fetchHealth?: (url: string) => Promise<{ status?: string }>;
  log?: (kind: string, record: Record<string, unknown>) => void;
  now?: () => number;
  /** How long to wait for a stop, a start's health, and the gate. */
  stopTimeoutMs?: number;
  healthTimeoutMs?: number;
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
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
    const target = pid ?? request.pid;
    if (request.serviceMode && pid === undefined) {
      const unit = `${request.serviceName}.service`;
      const result: CommandResult = platformOf(request) === 'darwin'
        ? await options.run('launchctl', ['kill', 'SIGTERM', `gui/${process.getuid?.() ?? 501}/${launchdLabel(request.serviceName)}`])
        : await options.run('systemctl', ['--user', 'stop', unit]);
      if (result.code !== 0) return { ok: false, detail: `stop ${unit} exited ${result.code}: ${result.stderr.trim()}` };
      const gone = await pollUntil(async () => !isAlive(target), options.stopTimeoutMs ?? 10_000);
      return gone ? { ok: true, detail: `systemctl stop ${unit}` } : { ok: false, detail: `${unit} stopped but pid ${target} is still running` };
    }
    if (!isAlive(target)) return { ok: true, detail: `pid ${target} was already gone` };
    try {
      process.kill(target, 'SIGTERM');
    } catch (error) {
      return { ok: false, detail: `SIGTERM ${target} failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    const gone = await pollUntil(async () => !isAlive(target), options.stopTimeoutMs ?? 10_000);
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
      return result.code === 0 ? { ok: true, detail: `systemctl start ${unit}` } : { ok: false, detail: `systemctl start ${unit} exited ${result.code}: ${result.stderr.trim()}` };
    }
    const command = residentArgsFor(request, shellDir);
    const env = { ...process.env, ...parseEnvFile(request.envFile), COGMEM_SHELL_ATTACH: 'on' } as Record<string, string>;
    const spawn = options.spawnDetached ?? defaultSpawnDetached;
    const pid = spawn([request.bunPath, ...command.slice(1)], { cwd: request.workspaceRoot, env, shellDir });
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
        return { ok: payload.ok === true && result.code === 0, detail: `gate exit ${result.code}`, checks: payload.checks };
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
    async health(request) {
      const fetchHealth = options.fetchHealth ?? (async (url: string) => (await fetch(url, { signal: AbortSignal.timeout(2_000) })).json() as Promise<{ status?: string }>);
      const ok = await pollUntil(async () => {
        try {
          return (await fetchHealth(healthUrl(request)))?.status === 'ok';
        } catch {
          return false;
        }
      }, options.healthTimeoutMs ?? 45_000, 500);
      return ok ? { ok: true, detail: `${healthUrl(request)} answered ok` } : { ok: false, detail: `${healthUrl(request)} did not answer ok in time` };
    },
  };
}

function defaultSpawnDetached(command: string[], options: { cwd: string; env: Record<string, string>; shellDir: string }): number | undefined {
  const child = spawn(command[0]!, command.slice(1), { cwd: options.cwd, env: { ...process.env, ...options.env }, detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

// ── Entry point ───────────────────────────────────────────────────────────────────────────────────

export function supervisorEntryPath(tree: string = treeOfThisProcess()): string {
  return join(shellDirOfTree(tree), 'src', 'upgrade', 'supervisor.ts');
}

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
