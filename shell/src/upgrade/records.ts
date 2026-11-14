/**
 * The resident-form upgrade's durable records (#165, the 5.0 "常驻形态升级" item).
 *
 * Two files in `<dataDir>/upgrade/`, and they are the whole handshake:
 *
 *  - `request.json` — written by the resident *before* it hands off. It names what to stop, what to
 *    stage to, where the brain is and how the service was installed. The supervisor reads it, so the
 *    handoff survives the resident's own death, which is the point.
 *  - `last.json` — written by the supervisor at the end of the cycle, whatever happened. The next
 *    resident start reads it and *reports it*; a request with no outcome is the loud case
 *    (`supervisor_gone`), because silence after an upgrade is the veto-level failure.
 *
 * Both are one JSON object, published the way the checkpoint is (temp + fsync + rename), so a kill
 * leaves the previous complete file or the new one.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type UpgradeStep = 'requested' | 'stop' | 'snapshot' | 'gate' | 'switch' | 'health' | 'done';
export type UpgradeStatus = 'completed' | 'rolled_back' | 'failed';

export interface UpgradeRequest {
  id: string;
  at: number;
  /** The version and tree serving when the request was made; also the rollback target. */
  fromVersion: string;
  fromTree: string;
  toVersion: string;
  toTree: string;
  /** The resident to stop. The supervisor stops it; the resident never stops itself mid-upgrade. */
  pid: number;
  dataDir: string;
  dbPath: string;
  workspaceRoot: string;
  projectId: string;
  agentId: string;
  httpPort: number;
  /** The attach control socket the live doctor checks for. */
  socketPath: string;
  bunPath: string;
  homeDir: string;
  /** Whether a service manager owns the process, and which unit; `false` is `--skip-service`. */
  serviceMode: boolean;
  serviceName: string;
  platform: string;
  envFile: string;
  logFile: string;
  /**
   * How long the supervisor waits before its first step, so the announcement's reply reaches the
   * socket before the stop that would cut it off. Zero in tests.
   */
  handoffGraceMs: number;
}

export interface UpgradeCheck {
  id: string;
  ok: boolean;
  detail: string;
  /**
   * Which half of the health gate produced this check. The two halves run at different moments (before
   * the switch, and after it) and a few ids are the same check done twice, so a report that only kept
   * `id` could not say which one failed.
   */
  phase?: 'pre-switch' | 'post-switch';
}

/**
 * Merge the pre-switch gate's checks with the live doctor's, one row per id, the later phase winning.
 *
 * `data-dir`, `snapshot-dir` and `soul` are checked on both sides on purpose — the pre-switch half is
 * what can be asked while nothing is serving, the doctor is the same install gate a fresh install ends
 * on — and a report that listed each of them twice read as four checks where there are two.
 */
export function mergeUpgradeChecks(preSwitch: readonly UpgradeCheck[], postSwitch: readonly UpgradeCheck[]): UpgradeCheck[] {
  const merged = new Map<string, UpgradeCheck>();
  for (const check of preSwitch) merged.set(check.id, { ...check, phase: 'pre-switch' });
  for (const check of postSwitch) merged.set(check.id, { ...check, phase: 'post-switch' });
  return [...merged.values()];
}

export interface UpgradeOutcome {
  id: string;
  fromVersion: string;
  toVersion: string;
  fromTree: string;
  toTree: string;
  status: UpgradeStatus;
  /** The last step reached: `done` on success, the failing step otherwise. */
  step: UpgradeStep;
  startedAt: number;
  finishedAt: number;
  snapshot?: string;
  snapshotBytes?: number;
  checks: UpgradeCheck[];
  rollback?: string;
  error?: string;
  /** Set by the resident when it has spoken the report; the promise is closed at the same moment. */
  reportedAt?: number;
}

export function upgradeDir(dataDir: string): string {
  return join(dataDir, 'upgrade');
}

export function upgradeRequestPath(dataDir: string): string {
  return join(upgradeDir(dataDir), 'request.json');
}

export function upgradeOutcomePath(dataDir: string): string {
  return join(upgradeDir(dataDir), 'last.json');
}

export function upgradeVersionsDir(dataDir: string): string {
  return join(dataDir, 'app', 'versions');
}

/**
 * The supervisor's own pid, written as its first act and removed when it is done.
 *
 * It is what lets a booting resident tell "the supervisor is still working on me" from "the
 * supervisor is gone and this upgrade is silent", which is the difference between waiting and
 * raising the veto-level failure.
 */
export function upgradeSupervisorPidPath(dataDir: string): string {
  return join(upgradeDir(dataDir), 'supervisor.pid');
}

export function readUpgradeSupervisorPid(dataDir: string): number | undefined {
  if (!existsSync(upgradeSupervisorPidPath(dataDir))) return undefined;
  try {
    const pid = Number.parseInt(readFileSync(upgradeSupervisorPidPath(dataDir), 'utf8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a pid is a live process; `EPERM` means it exists but belongs to someone else. */
export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function supervisorIsAlive(dataDir: string): boolean {
  const pid = readUpgradeSupervisorPid(dataDir);
  return pid !== undefined && processAlive(pid);
}

/** Temp + fsync + rename, the same durability contract the checkpoint publishes under. */
export function writeUpgradeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const fd = openSync(temp, 'w', 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  try {
    const dir = openSync(dirname(path), 'r');
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } catch {
    // A directory fsync is not available everywhere; the rename is the load-bearing half.
  }
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export function readUpgradeRequest(dataDir: string): UpgradeRequest | undefined {
  return readJson<UpgradeRequest>(upgradeRequestPath(dataDir));
}

export function readUpgradeOutcome(dataDir: string): UpgradeOutcome | undefined {
  return readJson<UpgradeOutcome>(upgradeOutcomePath(dataDir));
}

export function clearUpgradeRequest(dataDir: string): void {
  rmSync(upgradeRequestPath(dataDir), { force: true });
}

export function newUpgradeId(now: number): string {
  return `upgrade-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The promise the resident makes before it goes offline, as F2's wake intention.
 *
 * It is the obligation "report the upgrade outcome", it is durable in the checkpoint, it carries a
 * due instant so a resident that never comes back still owes the report at the next boot, and it is
 * closed by consumption when the report is spoken — F2's own auto-close, not a new flag.
 */
export function upgradePromiseReason(id: string): string {
  return `upgrade_report:${id}`;
}

export function isUpgradePromise(reason: string): boolean {
  return reason.startsWith('upgrade_report:');
}

/** The report line a reader sees, wherever it is rendered. One wording, one place. */
export function describeUpgradeOutcome(outcome: UpgradeOutcome): string {
  const versions = `${outcome.fromVersion} → ${outcome.toVersion}`;
  const failedCheck = outcome.checks.find((check) => !check.ok);
  switch (outcome.status) {
    case 'completed':
      return `升级完成：${versions}；健康门两半都过（迁移后 doctor + 召回自检；切换后 doctor 全检）。`;
    case 'rolled_back':
      return `升级未成功，已回滚到 ${outcome.fromVersion}（卡在「${outcome.step}」${failedCheck ? `：${failedCheck.detail}` : ''}）；旧版仍在服务。`;
    default:
      return `升级失败（${outcome.step}）：${outcome.error ?? '未说明原因'}；旧版状态见回滚栏「${outcome.rollback ?? '无'}」。`;
  }
}

/** The snapshot header's dimension, read without loading the kernel: 4-byte LE length then JSON. */
export function readSnapshotDimension(path: string): number | undefined {
  try {
    const bytes = readFileSync(path);
    if (bytes.byteLength < 5) return undefined;
    const headerLength = bytes.readUInt32LE(0);
    const header = JSON.parse(bytes.subarray(4, 4 + headerLength).toString('utf8')) as { embeddingDimension?: number };
    return typeof header.embeddingDimension === 'number' ? header.embeddingDimension : undefined;
  } catch {
    return undefined;
  }
}
