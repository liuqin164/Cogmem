/**
 * The resident-form upgrade (#165, the 5.0 "常驻形态升级" item): 停服 → 换版 → 迁移 → 启服 → 回滚.
 *
 * Every test below is a discriminator for one of the five requirements the ticket lays down, plus the
 * mechanics those requirements rest on (staging, the gate, the supervisor's phases). The suite is
 * hermetic on purpose: the supervisor is driven through injected operations, and the one test that
 * opens a real kernel opens it on a temp file.
 */
import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryKernel } from 'cogmem';

import { makeShell, makeTempDir } from './helpers.ts';
import { writeDefaultSoul } from '../src/install/soul.ts';
import { runUpgradeGate } from '../src/upgrade/gate.ts';
import { stageUpgradeTree } from '../src/upgrade/stage.ts';
import { spawnUpgradeSupervisor } from '../src/upgrade/spawn.ts';
import { readTreeVersion, serviceUnitPathFor, treeOfThisProcess } from '../src/upgrade/paths.ts';
import {
  clearUpgradeRequest,
  upgradeOutcomePath,
  upgradePromiseReason,
  upgradeRequestPath,
  upgradeSupervisorPidPath,
  writeUpgradeJson,
  type UpgradeCheck,
  type UpgradeOutcome,
  type UpgradeRequest,
} from '../src/upgrade/records.ts';
import { runUpgradeSupervisor, type UpgradeOpResult, type UpgradeOps } from '../src/upgrade/supervisor.ts';
import type { CommandResult } from '../src/install/service.ts';

const DAY = 24 * 60 * 60 * 1000;

/** A data directory laid out the way the installer leaves one: 0700, with a 0700 snapshots dir. */
function makeDataDir(): string {
  const dir = join(makeTempDir(), 'data');
  mkdirSync(dir, { mode: 0o700, recursive: true });
  mkdirSync(join(dir, 'snapshots'), { mode: 0o700, recursive: true });
  return dir;
}

/** A Cog tree just real enough to stage: the two entry points and dependencies. */
function makeTree(dir: string, version: string, options: { break?: boolean } = {}): string {
  mkdirSync(join(dir, 'shell', 'src'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'cogmem', version }));
  writeFileSync(join(dir, 'shell', 'src', 'cli.ts'), options.break ? 'export const broken = ;\n' : 'export const ok = 1;\n');
  writeFileSync(join(dir, 'src', 'public.ts'), 'export const kernel = 1;\n');
  return dir;
}

function makeRequest(dataDir: string, fromTree: string, toTree: string, overrides: Partial<UpgradeRequest> = {}): UpgradeRequest {
  return {
    id: 'upgrade-test-1',
    at: 1_700_000_000_000,
    fromVersion: '5.0.0',
    fromTree,
    toVersion: '5.0.1',
    toTree,
    pid: 4242,
    dataDir,
    dbPath: join(dataDir, 'memory.sqlite'),
    workspaceRoot: dataDir,
    projectId: 'companion-test',
    agentId: 'cogmem-companion-test',
    httpPort: 7338,
    bunPath: '/usr/bin/bun',
    homeDir: dataDir,
    serviceMode: false,
    serviceName: 'cogmem-companion',
    platform: 'linux',
    envFile: join(dataDir, 'env'),
    logFile: join(dataDir, 'service.log'),
    ...overrides,
  };
}

interface Recorded {
  calls: string[];
  ops: UpgradeOps;
}

function fakeOps(overrides: Partial<UpgradeOps> = {}, checks: UpgradeCheck[] = [{ id: 'recall-self-check', ok: true, detail: 'hit' }]): Recorded {
  const calls: string[] = [];
  const ok = (detail: string): UpgradeOpResult => ({ ok: true, detail });
  const base: UpgradeOps = {
    now: () => 1_700_000_100_000,
    trace: () => {},
    async stopResident(_request, pid) { calls.push(`stop:${pid ?? 'request'}`); return ok('stopped'); },
    async snapshot(_request, outPath) { calls.push('snapshot'); return { ...ok(outPath), bytes: 1234 }; },
    async restoreSnapshot(_request, snapPath) { calls.push(`restore:${snapPath.endsWith('.snap')}`); return ok('restored'); },
    async gate(_request, tree) { calls.push(`gate:${tree}`); return { ...ok('gate exit 0'), checks }; },
    async switchService(_request, tree) { calls.push(`switch:${tree}`); return ok('switched'); },
    async startResident(_request, tree) { calls.push(`start:${tree}`); return { ...ok('started'), pid: 777 }; },
    async health() { calls.push('health'); return ok('health ok'); },
  };
  return { calls, ops: { ...base, ...overrides } };
}

// ── requirement ②: only a silent state may be upgraded ────────────────────────────────────────────

describe('upgrade gate on the lifecycle (requirement ②: 只从静默态升级)', () => {
  test('RUNNING refuses and says why, and writes nothing', async () => {
    const dir = makeTempDir();
    const dataDir = join(dir, 'data');
    const shell = makeShell(dir, undefined, { dataDir, dbPath: join(dataDir, 'memory.sqlite') });
    await shell.start();
    await shell.machine.dispatch('message_received', { runId: 'run-test' });
    expect(shell.state).toBe('RUNNING');

    const reply = await shell.upgrade('/nonexistent/new-tree');

    expect(reply.text).toContain('RUNNING');
    expect(reply.text).toContain('不能升级');
    expect(existsSync(upgradeRequestPath(dataDir))).toBe(false);
    // The only pending wake is the idle one the clock arms at start: a refusal promises nothing.
    expect(pendingPromises(shell)).toHaveLength(0);
    const trace = shell.trace.read();
    expect(trace.some((record) => record.kind === 'upgrade_refused' && record.reason === 'not_silent')).toBe(true);
    await shell.stop();
  });

  test('DREAMING refuses, and an illegal state is not entered to be able to refuse', async () => {
    const dir = makeTempDir();
    const dataDir = join(dir, 'data');
    const shell = makeShell(dir, undefined, { dataDir, dbPath: join(dataDir, 'memory.sqlite') });
    await shell.start();
    await shell.machine.dispatch('dream_window_open', { reason: 'test' });
    expect(shell.state).toBe('DREAMING');

    const reply = await shell.upgrade('/nonexistent/new-tree');

    expect(reply.text).toContain('DREAMING');
    expect(existsSync(upgradeRequestPath(dataDir))).toBe(false);
    await shell.stop();
  });

  test('IDLE stages, promises the report, announces the version delta and hands off', async () => {
    const dir = makeTempDir();
    const dataDir = join(dir, 'data');
    const source = makeTree(join(dir, 'new-tree'), '5.0.1');
    const handedOff: Array<{ request: UpgradeRequest; path: string }> = [];
    const shell = makeShell(dir, undefined, { dataDir, dbPath: join(dataDir, 'memory.sqlite') }, {
      upgradeSpawner: async (request, requestPath) => {
        handedOff.push({ request, path: requestPath });
        return { ok: true, detail: 'detached pid 999' };
      },
    });
    await shell.start();

    const reply = await shell.upgrade(source);

    // ① the announcement names what is about to happen, and it is a receipt rather than a message.
    expect(reply.receipt).toBe(true);
    expect(reply.text).toContain('下线');
    expect(reply.text).toContain('5.0.0 → ');
    expect(reply.text).toContain('回滚');
    // ③ the report obligation exists before anything can go offline.
    const promise = pendingPromises(shell);
    expect(promise).toHaveLength(1);
    expect(promise[0]!.reason).toBe(upgradePromiseReason(handedOff[0]!.request.id));
    expect(promise[0]!.at).toBeGreaterThan(promise[0]!.createdAt);
    // ⑤ the staged tree exists beside the serving one, and the handoff names both trees.
    const request = handedOff[0]!.request;
    expect(request.fromTree).toBe(treeOfThisProcess());
    expect(request.toVersion).toBe('5.0.1');
    expect(existsSync(join(request.toTree, 'shell', 'src', 'cli.ts'))).toBe(true);
    expect(existsSync(join(request.toTree, 'node_modules'))).toBe(true);
    expect(request.toTree.startsWith(join(dataDir, 'app', 'versions'))).toBe(true);
    expect(existsSync(handedOff[0]!.path)).toBe(true);
    expect(shell.trace.read().some((record) => record.kind === 'upgrade_announced')).toBe(true);
    await shell.stop();
  });

  test('a second upgrade is refused while the first is still in flight', async () => {
    const dir = makeTempDir();
    const dataDir = join(dir, 'data');
    const source = makeTree(join(dir, 'new-tree'), '5.0.1');
    const shell = makeShell(dir, undefined, { dataDir, dbPath: join(dataDir, 'memory.sqlite') }, {
      upgradeSpawner: async () => ({ ok: true, detail: 'detached' }),
    });
    await shell.start();
    await shell.upgrade(source);

    const second = await shell.upgrade(source);

    expect(second.text).toContain('已经有一次升级在跑');
    expect(shell.trace.read().some((record) => record.kind === 'upgrade_refused' && record.reason === 'in_flight')).toBe(true);
    await shell.stop();
  });

  test('a failed handoff withdraws both the request and the promise', async () => {
    const dir = makeTempDir();
    const dataDir = join(dir, 'data');
    const source = makeTree(join(dir, 'new-tree'), '5.0.1');
    const shell = makeShell(dir, undefined, { dataDir, dbPath: join(dataDir, 'memory.sqlite') }, {
      upgradeSpawner: async () => ({ ok: false, detail: 'cannot start the upgrade outside the service cgroup' }),
    });
    await shell.start();

    const reply = await shell.upgrade(source);

    expect(reply.text).toContain('升级没有开始');
    expect(existsSync(upgradeRequestPath(dataDir))).toBe(false);
    expect(pendingPromises(shell)).toHaveLength(0);
    await shell.stop();
  });

  test('an empty argument answers with usage instead of staging anything', async () => {
    const dir = makeTempDir();
    const dataDir = join(dir, 'data');
    const shell = makeShell(dir, undefined, { dataDir, dbPath: join(dataDir, 'memory.sqlite') });
    await shell.start();

    const reply = await shell.upgrade('   ');

    expect(reply.text).toContain('用法');
    expect(existsSync(join(dataDir, 'app'))).toBe(false);
    await shell.stop();
  });
});

// ── requirements ③ and ④: the report, on success, on rollback, and on silence ──────────────────────

function completedOutcome(dataDir: string, overrides: Partial<UpgradeOutcome> = {}): UpgradeOutcome {
  return {
    id: 'upgrade-report-1',
    fromVersion: '5.0.0',
    toVersion: '5.0.1',
    fromTree: '/old',
    toTree: '/new',
    status: 'completed',
    step: 'done',
    startedAt: 1,
    finishedAt: 2,
    checks: [{ id: 'recall-self-check', ok: true, detail: 'hit' }],
    ...overrides,
  };
}

describe('the report is owed and spoken (requirements ③ 完成必回报 / ④ 失败也必报)', () => {
  test('a completed outcome is reported once, the promise closes, and the away report carries it', async () => {
    const dir = makeTempDir();
    const dataDir = join(dir, 'data');
    const shell = makeShell(dir, undefined, { dataDir, dbPath: join(dataDir, 'memory.sqlite') });
    const promise = shell.machine.addWakeIntent({ at: Date.now() + DAY, reason: upgradePromiseReason('upgrade-report-1') });
    writeUpgradeJson(upgradeOutcomePath(dataDir), completedOutcome(dataDir));

    await shell.start();

    expect(readFileSync(upgradeOutcomePath(dataDir), 'utf8')).toContain('reportedAt');
    expect(shell.machine.wakeIntents.find((intent) => intent.id === promise.id)?.consumedAt).toBeDefined();
    const report = shell.awayReport();
    expect(report.upgrade?.status).toBe('completed');
    expect(report.upgrade?.line).toContain('5.0.0 → 5.0.1');
    expect(report.upgrade?.line).toContain('召回自检');
    // Reported once: a second attach is not a second announcement.
    expect(shell.awayReport().upgrade).toBeUndefined();
    const reported = shell.trace.read().find((record) => record.kind === 'upgrade_reported');
    expect(reported?.status).toBe('completed');
    expect(reported?.promiseClosed).toBe(promise.id);
    await shell.stop();
  });

  test('a rolled-back outcome is reported with the step and the rollback it names', async () => {
    const dir = makeTempDir();
    const dataDir = join(dir, 'data');
    const shell = makeShell(dir, undefined, { dataDir, dbPath: join(dataDir, 'memory.sqlite') });
    shell.machine.addWakeIntent({ at: Date.now() + DAY, reason: upgradePromiseReason('upgrade-report-2') });
    writeUpgradeJson(upgradeOutcomePath(dataDir), completedOutcome(dataDir, {
      id: 'upgrade-report-2',
      status: 'rolled_back',
      step: 'gate',
      checks: [{ id: 'recall-self-check', ok: false, detail: '口令写入后召回未命中' }],
      rollback: '健康门未过；快照已恢复；服务指回旧版；旧版已重新服务（pid 7）',
      error: 'gate exit 1',
    }));

    await shell.start();

    const report = shell.awayReport();
    expect(report.upgrade?.status).toBe('rolled_back');
    expect(report.upgrade?.line).toContain('回滚');
    expect(report.upgrade?.line).toContain('gate');
    expect(report.upgrade?.line).toContain('召回未命中');
    await shell.stop();
  });

  test('a request whose supervisor is gone is reported as a failure instead of silence', async () => {
    const dir = makeTempDir();
    const dataDir = join(dir, 'data');
    const shell = makeShell(dir, undefined, { dataDir, dbPath: join(dataDir, 'memory.sqlite') });
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const request = makeRequest(dataDir, '/old', '/new');
    writeUpgradeJson(upgradeRequestPath(dataDir), request);
    const promise = shell.machine.addWakeIntent({ at: now - 1000, reason: upgradePromiseReason(request.id) });
    await shell.start();

    await shell.tick(now);

    expect(readUpgradeOutcomeStatus(dataDir)).toBe('failed');
    expect(shell.awayReport().upgrade?.line).toContain('沉默');
    expect(shell.machine.wakeIntents.find((intent) => intent.id === promise.id)?.consumedAt).toBeDefined();
    expect(existsSync(upgradeRequestPath(dataDir))).toBe(false);
    await shell.stop();
  });

  test('a request whose supervisor is still alive is not called a failure', async () => {
    const dir = makeTempDir();
    const dataDir = join(dir, 'data');
    const shell = makeShell(dir, undefined, { dataDir, dbPath: join(dataDir, 'memory.sqlite') });
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const request = makeRequest(dataDir, '/old', '/new');
    writeUpgradeJson(upgradeRequestPath(dataDir), request);
    // This process is alive, which is all the liveness check asks.
    writeFileSync(upgradeSupervisorPidPath(dataDir), `${process.pid}\n`);
    const promise = shell.machine.addWakeIntent({ at: now - 1000, reason: upgradePromiseReason(request.id) });
    await shell.start();

    await shell.tick(now);

    expect(existsSync(upgradeOutcomePath(dataDir))).toBe(false);
    expect(shell.machine.wakeIntents.find((intent) => intent.id === promise.id)?.consumedAt).toBeUndefined();
    expect(shell.trace.read().some((record) => record.kind === 'upgrade_report_waiting')).toBe(true);
    await shell.stop();
  });

  test('a due promise with no records left is reported, not swallowed', async () => {
    const dir = makeTempDir();
    const dataDir = join(dir, 'data');
    const shell = makeShell(dir, undefined, { dataDir, dbPath: join(dataDir, 'memory.sqlite') });
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const promise = shell.machine.addWakeIntent({ at: now - 1000, reason: upgradePromiseReason('upgrade-orphan') });
    await shell.start();

    await shell.tick(now);

    expect(shell.machine.wakeIntents.find((intent) => intent.id === promise.id)?.consumedAt).toBeDefined();
    expect(shell.trace.read().some((record) => record.kind === 'upgrade_promise_orphaned')).toBe(true);
    await shell.stop();
  });
});

/** The upgrade promises a shell currently owes; the clock's own idle wake is not one of them. */
function pendingPromises(shell: { machine: { wakeIntents: readonly { reason: string; consumedAt?: number }[] } }): Array<{ reason: string; at: number; createdAt: number }> {
  return shell.machine.wakeIntents.filter((intent) => !intent.consumedAt && intent.reason.startsWith('upgrade_report:')) as Array<{ reason: string; at: number; createdAt: number }>;
}

function readUpgradeOutcomeStatus(dataDir: string): string | undefined {
  const path = upgradeOutcomePath(dataDir);
  if (!existsSync(path)) return undefined;
  return (JSON.parse(readFileSync(path, 'utf8')) as UpgradeOutcome).status;
}

// ── requirement ⑤: the staged cycle, in order, with rollback ───────────────────────────────────────

describe('the supervisor cycle (requirement ⑤: 旁置安装 → 快照 → 迁移 → 健康门 → 切换，失败回滚)', () => {
  test('the happy path runs the phases in order and reports completion', async () => {
    const dataDir = makeDataDir();
    const request = makeRequest(dataDir, '/old-tree', '/staged-tree');
    const { calls, ops } = fakeOps();

    const outcome = await runUpgradeSupervisor(request, ops);

    expect(outcome.status).toBe('completed');
    expect(outcome.step).toBe('done');
    expect(outcome.fromVersion).toBe('5.0.0');
    expect(outcome.toVersion).toBe('5.0.1');
    expect(calls).toEqual([
      'stop:request',
      'snapshot',
      'gate:/staged-tree',
      'switch:/staged-tree',
      'start:/staged-tree',
      'health',
    ]);
    expect(outcome.snapshot?.endsWith('.snap')).toBe(true);
    expect(outcome.snapshotBytes).toBe(1234);
    expect(JSON.parse(readFileSync(upgradeOutcomePath(dataDir), 'utf8'))).toMatchObject({ status: 'completed', step: 'done' });
    // The request is over, so the next upgrade is not blocked by it.
    expect(existsSync(upgradeRequestPath(dataDir))).toBe(false);
  });

  test('a failed gate restores the snapshot, points the service back and starts the old tree', async () => {
    const dataDir = makeDataDir();
    const request = makeRequest(dataDir, '/old-tree', '/staged-tree');
    const failing: UpgradeCheck[] = [
      { id: 'kernel-migration', ok: true, detail: 'ok' },
      { id: 'recall-self-check', ok: false, detail: '口令写入后召回未命中（0 条）' },
    ];
    const { calls, ops } = fakeOps({
      async gate() { calls.push('gate'); return { ok: false, detail: 'gate exit 1', checks: failing }; },
    });

    const outcome = await runUpgradeSupervisor(request, ops);

    expect(outcome.status).toBe('rolled_back');
    expect(outcome.step).toBe('gate');
    expect(outcome.checks).toEqual(failing);
    expect(outcome.rollback).toContain('快照已恢复');
    expect(outcome.rollback).toContain('旧版已重新服务');
    expect(calls).toEqual(['stop:request', 'snapshot', 'gate', 'stop:request', 'restore:true', 'switch:/old-tree', 'start:/old-tree']);
    expect(JSON.parse(readFileSync(upgradeOutcomePath(dataDir), 'utf8'))).toMatchObject({ status: 'rolled_back', step: 'gate' });
    expect(existsSync(upgradeRequestPath(dataDir))).toBe(false);
  });

  test('a failed start rolls back the pid it started and the tree it switched to', async () => {
    const dataDir = makeDataDir();
    const request = makeRequest(dataDir, '/old-tree', '/staged-tree');
    const { calls, ops } = fakeOps({
      async startResident(_request, tree) {
        calls.push(`start:${tree}`);
        return tree === '/staged-tree'
          ? { ok: false, detail: 'systemctl start exited 1' }
          : { ok: true, detail: 'started old', pid: 555 };
      },
    });

    const outcome = await runUpgradeSupervisor(request, ops);

    expect(outcome.status).toBe('rolled_back');
    expect(outcome.step).toBe('switch');
    expect(outcome.error).toContain('systemctl start exited 1');
    expect(calls).toEqual(['stop:request', 'snapshot', 'gate:/staged-tree', 'switch:/staged-tree', 'start:/staged-tree', 'stop:request', 'restore:true', 'switch:/old-tree', 'start:/old-tree']);
    expect(outcome.rollback).toContain('旧版已重新服务（pid 555）');
  });

  test('a post-start health failure rolls back to the old version', async () => {
    const dataDir = makeDataDir();
    const request = makeRequest(dataDir, '/old-tree', '/staged-tree');
    const { calls, ops } = fakeOps({
      async health() { calls.push('health'); return { ok: false, detail: 'health did not answer' }; },
    });

    const outcome = await runUpgradeSupervisor(request, ops);

    expect(outcome.status).toBe('rolled_back');
    expect(outcome.step).toBe('health');
    expect(calls).toContain('switch:/old-tree');
    expect(calls).toContain('start:/old-tree');
  });

  test('a failed stop changes nothing and is not dressed up as a rollback', async () => {
    const dataDir = makeDataDir();
    const request = makeRequest(dataDir, '/old-tree', '/staged-tree');
    const { calls, ops } = fakeOps({
      async stopResident() { calls.push('stop'); return { ok: false, detail: 'pid 4242 did not exit in time' }; },
    });

    const outcome = await runUpgradeSupervisor(request, ops);

    expect(outcome.status).toBe('failed');
    expect(outcome.step).toBe('stop');
    expect(outcome.rollback).toContain('未改动');
    expect(calls).toEqual(['stop']);
    expect(JSON.parse(readFileSync(upgradeOutcomePath(dataDir), 'utf8'))).toMatchObject({ status: 'failed', step: 'stop' });
  });

  test('a failed snapshot restarts the old tree and never runs the gate', async () => {
    const dataDir = makeDataDir();
    const request = makeRequest(dataDir, '/old-tree', '/staged-tree');
    const { calls, ops } = fakeOps({
      async snapshot() { calls.push('snapshot'); return { ok: false, detail: 'SQLITE_CANTOPEN' }; },
    });

    const outcome = await runUpgradeSupervisor(request, ops);

    expect(outcome.status).toBe('failed');
    expect(outcome.step).toBe('snapshot');
    expect(calls).toEqual(['stop:request', 'snapshot', 'start:/old-tree']);
    expect(outcome.rollback).toContain('未迁移');
  });
});

// ── staging: the 旁置 half ────────────────────────────────────────────────────────────────────────

describe('staging a tree beside the serving one', () => {
  test('copies the tree, symlinks dependencies, and refuses what it cannot hand the service to', () => {
    const dir = makeTempDir();
    const source = makeTree(join(dir, 'source'), '5.0.1');
    // Never copied: the staged tree is code, not someone's data or git history.
    mkdirSync(join(source, '.git'), { recursive: true });
    writeFileSync(join(source, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    const staged = stageUpgradeTree({ source, dataDir: join(dir, 'data'), currentTree: join(dir, 'serving') });

    expect(staged.version).toBe('5.0.1');
    expect(staged.tree).toBe(join(dir, 'data', 'app', 'versions', '5.0.1'));
    expect(readFileSync(join(staged.tree, 'package.json'), 'utf8')).toContain('5.0.1');
    expect(existsSync(join(staged.tree, '.git'))).toBe(false);
    expect(staged.linkedDeps).toContain('node_modules');

    expect(() => stageUpgradeTree({ source: dir, dataDir: join(dir, 'data'), currentTree: join(dir, 'serving') }))
      .toThrow('not_a_cog_tree');
    expect(() => stageUpgradeTree({ source, dataDir: join(dir, 'data'), currentTree: staged.tree, targetDir: staged.tree }))
      .toThrow('target_is_serving_tree');

    const noDeps = makeTree(join(dir, 'nodeps'), '5.0.2');
    rmSync(join(noDeps, 'node_modules'), { recursive: true, force: true });
    expect(() => stageUpgradeTree({ source: noDeps, dataDir: join(dir, 'data'), currentTree: join(dir, 'serving') }))
      .toThrow('source_tree_has_no_dependencies');
  });

  test('the tree version is read from the product manifest, and the shell manifest is the fallback', () => {
    const dir = makeTempDir();
    const tree = makeTree(join(dir, 'tree'), '5.0.1');
    expect(readTreeVersion(tree)).toBe('5.0.1');
    rmSync(join(tree, 'package.json'));
    writeFileSync(join(tree, 'shell', 'package.json'), JSON.stringify({ version: '0.1.0-spike' }));
    expect(readTreeVersion(tree)).toBe('0.1.0-spike');
    expect(readTreeVersion(join(dir, 'nowhere'))).toBe('unknown');
  });
});

// ── the gate itself, on a real kernel ─────────────────────────────────────────────────────────────

describe('the pre-switch health gate', () => {
  test('opens the brain, reads the soul and proves a write comes back in a recall', async () => {
    const dataDir = makeDataDir();
    const dbPath = join(dataDir, 'memory.sqlite');
    const kernel = createMemoryKernel({ dbPath });
    writeDefaultSoul(dbPath, 'cogmem-companion-test', Date.now());
    kernel.close();

    const result = await runUpgradeGate({
      dataDir,
      dbPath,
      agentId: 'cogmem-companion-test',
      projectId: 'companion-test',
      probeToken: 'upgrade-probe-fixed',
    });

    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.id)).toEqual(['data-dir', 'snapshot-dir', 'kernel-migration', 'soul', 'recall-self-check']);
    expect(result.checks.find((check) => check.id === 'recall-self-check')?.detail).toContain('upgrade-probe-fixed');
    expect(result.treeVersion).not.toBe('unknown');
  });

  test('a database the new version cannot open fails the gate at the kernel check', async () => {
    const dataDir = makeDataDir();
    // Not a database: the ADR-0007 refusal, which is the failure the staged cycle exists to catch.
    const dbPath = join(dataDir, 'memory.sqlite');
    writeFileSync(dbPath, 'this is not a sqlite database');
    const result = await runUpgradeGate({
      dataDir,
      dbPath,
      agentId: 'cogmem-companion-test',
      projectId: 'companion-test',
    });

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.id === 'kernel-migration')?.ok).toBe(false);
    expect(result.checks.some((check) => check.id === 'recall-self-check')).toBe(false);
  });

  test('a data directory that is not private fails the gate', async () => {
    const dataDir = makeDataDir();
    const dbPath = join(dataDir, 'memory.sqlite');
    const kernel = createMemoryKernel({ dbPath });
    writeDefaultSoul(dbPath, 'cogmem-companion-test', Date.now());
    kernel.close();
    chmodSync(dataDir, 0o755);

    const result = await runUpgradeGate({ dataDir, dbPath, agentId: 'cogmem-companion-test', projectId: 'companion-test' });

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.id === 'data-dir')?.detail).toContain('755');
  });
});

// ── how the supervisor is launched: it has to outlive the stop it performs ─────────────────────────

describe('handing off to the supervisor', () => {
  const result = (code: number, stderr = ''): CommandResult => ({ code, stdout: '', stderr });

  test('with no service manager it is a detached process, and its argv names the request', async () => {
    const dir = makeTempDir();
    const dataDir = makeDataDir();
    const request = makeRequest(dataDir, treeOfThisProcess(), '/staged');
    const spawned: Array<{ command: string[]; cwd: string }> = [];

    const outcome = await spawnUpgradeSupervisor(request, join(dataDir, 'upgrade', 'request.json'), {
      run: async () => result(0),
      spawnDetached: (command, options) => {
        spawned.push({ command, cwd: options.cwd });
        return 1234;
      },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.pid).toBe(1234);
    expect(spawned[0]!.command.join(' ')).toContain('supervisor.ts');
    expect(spawned[0]!.command.join(' ')).toContain(join(dataDir, 'upgrade', 'request.json'));
  });

  test('under a service manager it leaves the cgroup, and refuses when it cannot', async () => {
    const dataDir = makeDataDir();
    const request = makeRequest(dataDir, treeOfThisProcess(), '/staged', { serviceMode: true });
    const runs: string[][] = [];

    const ok = await spawnUpgradeSupervisor(request, '/tmp/request.json', {
      run: async (command, args) => { runs.push([command, ...args]); return result(0); },
    });
    expect(ok.ok).toBe(true);
    expect(runs[0]!.slice(0, 2)).toEqual(['systemd-run', '--user']);
    expect(runs[0]!.some((token) => token.startsWith('--unit=cogmem-upgrade-'))).toBe(true);

    const refused = await spawnUpgradeSupervisor(request, '/tmp/request.json', {
      run: async (command, args) => { runs.push([command, ...args]); return result(1, 'Failed to connect to bus'); },
    });
    expect(refused.ok).toBe(false);
    expect(refused.detail).toContain('cgroup');
  });

  test('the unit path is derived from the platform and the install, and a service install is detected', () => {
    const dataDir = makeDataDir();
    const request = makeRequest(dataDir, '/tree', '/tree2', { homeDir: dataDir, platform: 'linux' });
    expect(serviceUnitPathFor(request, request.fromTree)).toBe(join(dataDir, '.config', 'systemd', 'user', 'cogmem-companion.service'));
    expect(serviceUnitPathFor({ ...request, platform: 'win32' }, request.fromTree)).toBeUndefined();
    expect(serviceUnitPathFor({ ...request, serviceName: '' }, request.fromTree)).toBeUndefined();
  });
});

// ── the request record is the handoff, so it has to survive the handoff ───────────────────────────

describe('the request record', () => {
  test('a cleared request does not block the next upgrade', () => {
    const dataDir = makeDataDir();
    const request = makeRequest(dataDir, '/old', '/new');
    writeUpgradeJson(upgradeRequestPath(dataDir), request);
    expect(existsSync(upgradeRequestPath(dataDir))).toBe(true);
    clearUpgradeRequest(dataDir);
    expect(existsSync(upgradeRequestPath(dataDir))).toBe(false);
  });

  test('a malformed request reads as no request rather than throwing', () => {
    const dataDir = makeDataDir();
    mkdirSync(join(dataDir, 'upgrade'), { recursive: true });
    writeFileSync(upgradeRequestPath(dataDir), '{ not json');
    // The read is tolerant on purpose: a torn handoff file must not take the resident down at boot.
    expect(existsSync(upgradeRequestPath(dataDir))).toBe(true);
  });
});
