/**
 * The health gate: what has to be true *before* the service is switched to the new tree.
 *
 * It runs in the staged tree's own process (`cogmem`'s upgrade drives `shell/src/cli.ts gate`), which
 * is what makes it evidence about *that* version rather than about the one already running:
 *
 *  1. the brain opens with the new code — that open is where an additive migration runs;
 *  2. the static half of the install doctor still holds (private data and snapshot directories);
 *  3. the soul is still readable out of the same database file;
 *  4. memory survives a write and comes back in a recall (the recall self-check).
 *
 * The *live* half of `runDoctor` (health face, attach socket, service unit) cannot run here: the
 * resident is stopped by design while the brain is migrated. It runs after the switch instead, and a
 * failure there rolls back. The split is stated in `shell/UPGRADE.md` rather than papered over.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMemoryKernel, KernelAgentMemoryBackend } from 'cogmem';

import { readSoul } from '../install/soul.ts';
import { readTreeVersion, treeOfThisProcess } from './paths.ts';
import type { UpgradeCheck } from './records.ts';

export interface UpgradeGateInput {
  dataDir: string;
  dbPath: string;
  agentId: string;
  projectId: string;
  /** Tests drive the token so the self-check is asserted, not inferred. */
  probeToken?: string;
}

export interface UpgradeGateResult {
  ok: boolean;
  checks: UpgradeCheck[];
  /** The version of the code that ran this gate — the tree being staged in. */
  treeVersion: string;
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

export async function runUpgradeGate(input: UpgradeGateInput): Promise<UpgradeGateResult> {
  const checks: UpgradeCheck[] = [];
  const treeVersion = readTreeVersion(treeOfThisProcess());

  try {
    checks.push({ id: 'data-dir', ok: mode(input.dataDir) === 0o700, detail: `${input.dataDir} mode ${mode(input.dataDir).toString(8)}` });
  } catch (error) {
    checks.push({ id: 'data-dir', ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  const snapshots = join(input.dataDir, 'snapshots');
  try {
    checks.push({ id: 'snapshot-dir', ok: existsSync(snapshots) && mode(snapshots) === 0o700, detail: `${snapshots} mode ${existsSync(snapshots) ? mode(snapshots).toString(8) : 'missing'}` });
  } catch (error) {
    checks.push({ id: 'snapshot-dir', ok: false, detail: error instanceof Error ? error.message : String(error) });
  }

  // Opening the kernel is the migration step. A database this version cannot open is the failure the
  // whole staged cycle exists to catch, so it is reported as a check rather than thrown out of here.
  let kernel: ReturnType<typeof createMemoryKernel> | undefined;
  try {
    kernel = createMemoryKernel({ dbPath: input.dbPath });
    const health = kernel.getHealthStatus();
    checks.push({
      id: 'kernel-migration',
      ok: health.status === 'ok' && health.package === 'cogmem' && health.dbPath === input.dbPath,
      detail: `status=${health.status} package=${health.package} db=${health.dbPath}`,
    });
  } catch (error) {
    // One check, one id: a second push from here is how a failed gate ended up reporting the same
    // check twice, once as ok and once as the error.
    checks.push({ id: 'kernel-migration', ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  if (kernel) {
    try {
      // A database with no `companion_soul` row is a shell data dir the installer never finished.
      const soul = readSoul(input.dbPath, input.agentId);
      checks.push({ id: 'soul', ok: soul !== undefined && soul.content.trim() !== '', detail: soul ? `v${soul.version} ${Buffer.byteLength(soul.content)} bytes` : 'no soul row' });
    } catch (error) {
      checks.push({ id: 'soul', ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }

  if (kernel) {
    const token = input.probeToken ?? `upgrade-probe-${randomUUID().slice(0, 8)}`;
    const backend = new KernelAgentMemoryBackend(kernel);
    try {
      // One deterministic write and one deterministic read: no model is involved, so a failure here
      // is the store's, not a provider's. The probe stays in the brain on success — the same shape
      // the installer's first-wake probe has, and the same reason: a migration nobody wrote through
      // has not been verified.
      await backend.rememberTurnWithResult({
        agentId: input.agentId,
        projectId: input.projectId,
        sessionId: `upgrade-gate-${input.probeToken ?? 'auto'}`,
        turnId: `upgrade-gate-${token}`,
        userText: `升级自检记忆：口令 ${token}。`,
      });
      const recalled = backend.recall({ agentId: input.agentId, projectId: input.projectId, query: token, limit: 5 });
      const hit = recalled.items.some((item) => item.text.includes(token));
      checks.push({ id: 'recall-self-check', ok: hit, detail: hit ? `${token} 写入后召回命中` : `${token} 写入后召回未命中（${recalled.items.length} 条）` });
    } catch (error) {
      checks.push({ id: 'recall-self-check', ok: false, detail: error instanceof Error ? error.message : String(error) });
    } finally {
      kernel.close();
    }
  }

  return { ok: checks.every((check) => check.ok), checks, treeVersion };
}
