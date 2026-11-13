/**
 * The install's own doctor: the checks that decide whether the six steps actually produced a living
 * companion, run against the running resident rather than a second kernel.
 *
 * It asks the resident's loopback `/health` for kernel state on purpose. Opening a second
 * `MemoryKernel` on the same database file to ask how the first one is doing would be two writers on
 * one path, which CONCURRENT_ACCESS.md forbids — the health face is the surface that exists so this
 * command does not have to.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SOUL, readSoul } from './soul.ts';
import { serviceStatus, type Platform, type Runner, type ServiceSpec } from './service.ts';

export interface HealthPayload {
  status: string;
  bind: string;
  port?: number;
  dbPath?: string;
  state?: string;
  kernel?: { status?: string; package?: string; dbPath?: string };
}

export interface DoctorContext {
  dataDir: string;
  dbPath: string;
  agentId: string;
  socketPath: string;
  healthUrl: string;
  fetchHealth: () => Promise<HealthPayload>;
  spec: ServiceSpec;
  platform: Platform;
  run: Runner;
  /** `service` checks the unit; `process` checks the pid an install without a manager left behind. */
  mode: 'service' | 'process';
  pid?: number;
  /** The soul that should be readable back; defaults to the shipped v0. */
  expectedSoul?: string;
}

export interface DoctorCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export async function runDoctor(ctx: DoctorContext): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  // 1. The data directory is the private one the installer made.
  try {
    const dirMode = mode(ctx.dataDir);
    checks.push({
      id: 'data-dir',
      ok: dirMode === 0o700,
      detail: `${ctx.dataDir} mode ${dirMode.toString(8)}`,
    });
  } catch (error) {
    checks.push({ id: 'data-dir', ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  // 2. Snapshot output is private too (the security posture printed at install time).
  const snapshots = join(ctx.dataDir, 'snapshots');
  checks.push({
    id: 'snapshot-dir',
    ok: existsSync(snapshots) && mode(snapshots) === 0o700,
    detail: existsSync(snapshots) ? `${snapshots} mode ${mode(snapshots).toString(8)}` : `${snapshots} missing`,
  });

  // 3. The resident is up and its kernel says ok; the payload also carries the bind address.
  try {
    const health = await ctx.fetchHealth();
    const kernelOk = health.kernel?.status === 'ok' && health.kernel?.package === 'cogmem';
    checks.push({
      id: 'resident-health',
      ok: health.status === 'ok' && kernelOk && health.kernel?.dbPath === ctx.dbPath,
      detail: `${ctx.healthUrl} state=${health.state ?? '?'} kernel=${health.kernel?.status ?? '?'}/${health.kernel?.package ?? '?'} db=${health.kernel?.dbPath ?? '?'}`,
    });
    checks.push({
      id: 'loopback-only',
      ok: LOOPBACK.has(health.bind),
      detail: `bind=${health.bind}`,
    });
  } catch (error) {
    checks.push({ id: 'resident-health', ok: false, detail: error instanceof Error ? error.message : String(error) });
    checks.push({ id: 'loopback-only', ok: false, detail: 'resident unreachable, bind unknown' });
  }

  // 4. The control socket `cog` attaches to.
  checks.push({ id: 'attach-socket', ok: existsSync(ctx.socketPath), detail: ctx.socketPath });

  // 5. The soul is readable back, byte for byte.
  try {
    const row = readSoul(ctx.dbPath, ctx.agentId);
    const expected = ctx.expectedSoul ?? DEFAULT_SOUL;
    checks.push({
      id: 'soul',
      ok: row !== undefined && row.content === expected,
      detail: row ? `v${row.version} ${Buffer.byteLength(row.content)} bytes` : 'no soul row',
    });
  } catch (error) {
    checks.push({ id: 'soul', ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  // 6. The service manager knows the unit (or the process an install without one left behind).
  if (ctx.mode === 'process') {
    let alive = false;
    try {
      if (ctx.pid) process.kill(ctx.pid, 0);
      alive = Boolean(ctx.pid);
    } catch {
      alive = false;
    }
    checks.push({ id: 'resident-process', ok: alive, detail: ctx.pid ? `pid ${ctx.pid}` : 'no pid recorded' });
  } else {
    try {
      const status = await serviceStatus(ctx.run, ctx.spec, ctx.platform);
      checks.push({ id: 'service', ok: status === 'active' || status === 'loaded', detail: status });
    } catch (error) {
      checks.push({ id: 'service', ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }

  return { ok: checks.every((check) => check.ok), checks };
}
