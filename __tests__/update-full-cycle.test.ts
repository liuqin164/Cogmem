import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { processIsAlive } from '../src/install/ResidentSession.js';
import {
  BUN,
  cogmem,
  coreRoot,
  fixtureEnv,
  freePort,
  installedVersion,
  killTrackedServers,
  makeFixture,
  pretestInstall,
  recallThroughServer,
  rememberThroughServer,
  run,
  startServer,
  track,
  updateTrace,
  waitForSession,
  type Fixture,
} from './helpers/update-fixture.js';

/**
 * #150 on the box: the whole cycle with the real CLI, through the fixture the
 * systemd test shares. See `helpers/update-fixture.ts` for how a version is made
 * real without a registry.
 */

afterAll(killTrackedServers);

const MEMORY = '归档保留期定成七年。';

describe('#150 the update cycle on the box', () => {
  test('a manual update stops the old service, swaps, migrates, starts again, and the memory survives', async () => {
    const f = makeFixture('cogmem-cycle-');
    await pretestInstall(f, '4.1.0');
    const server = track(startServer(f));
    await waitForSession(f, (s) => s.version === '4.1.0');
    await rememberThroughServer(server.url, MEMORY);

    const update = await cogmem(f, ['update', '--yes', '--json', '--install-home', f.install, '--manager', 'npm', '--from', '4.2.0', '--config', f.configPath]);
    expect(update.exitCode, `${update.stdout}\n${update.stderr}`).toBe(0);
    const doc = JSON.parse(update.stdout) as { lifecycle?: { stopped?: string; started?: string; previousVersion?: string; to?: string } };
    // 停旧 → 换版 → 自动迁移 → 起新, in one command (Ryu, 2026-11-09).
    expect(doc.lifecycle?.stopped).toBe('signal');
    expect(doc.lifecycle?.started).toBe('spawn');
    expect(doc.lifecycle?.previousVersion).toBe('4.1.0');
    expect(doc.lifecycle?.to).toBe('4.2.0');

    // The old process is gone and the new one serves the new version.
    expect(processIsAlive(server.pid)).toBe(false);
    const restarted = await waitForSession(f, (s) => s.pid !== server.pid);
    expect(restarted.version).toBe('4.2.0');

    // Doctor: disk and serving agree, and it is the new package answering.
    const doctor = await cogmem(f, ['doctor', '--json', '--config', f.configPath]);
    const report = JSON.parse(doctor.stdout) as { version?: { disk?: string; serving?: { version?: string } | null; skew?: boolean } };
    expect(report.version?.disk).toBe('4.2.0');
    expect(report.version?.serving?.[0]?.version).toBe('4.2.0');
    expect(report.version?.skew).toBe(false);

    // The data written through the old service is still recalled by the new one.
    expect(await recallThroughServer(server.url, MEMORY.slice(0, 6))).toContain('归档保留期');
  }, 180_000);

  test('a staged update leaves the old process serving and doctor names the skew, then a second run converges', async () => {
    const f = makeFixture('cogmem-stage-');
    await pretestInstall(f, '4.1.0');
    const server = track(startServer(f));
    await waitForSession(f, (s) => s.version === '4.1.0');
    await rememberThroughServer(server.url, MEMORY);

    const staged = await cogmem(f, ['update', '--yes', '--json', '--stage-only', '--install-home', f.install, '--manager', 'npm', '--from', '4.2.0', '--config', f.configPath]);
    expect(staged.exitCode, staged.stderr).toBe(0);
    const stagedDoc = JSON.parse(staged.stdout) as { stageOnly?: boolean; lifecycle?: { stopped?: string; started?: string } };
    expect(stagedDoc.stageOnly).toBe(true);
    // Never a restart: the process that is serving was not touched.
    expect(stagedDoc.lifecycle?.stopped).toBeUndefined();
    expect(stagedDoc.lifecycle?.started).toBeUndefined();
    expect(processIsAlive(server.pid)).toBe(true);
    expect((await waitForSession(f, (s) => s.pid === server.pid)).version).toBe('4.1.0');

    // The new package's doctor reports both versions and says what to do.
    const doctor = await cogmem(f, ['doctor', '--json', '--config', f.configPath]);
    const report = JSON.parse(doctor.stdout) as {
      version?: { disk?: string; serving?: { version?: string } | null; skew?: boolean; restartRequired?: boolean; lastUpdate?: { status?: string; restartRequired?: boolean } };
      installGate?: { diagnostics?: Array<{ code?: string }> };
    };
    expect(report.version?.disk).toBe('4.2.0');
    expect(report.version?.serving?.[0]?.version).toBe('4.1.0');
    expect(report.version?.skew).toBe(true);
    expect(report.version?.restartRequired).toBe(true);
    expect(report.installGate?.diagnostics?.map((d) => d.code)).toContain('version_skew');
    // The governance trace says the same thing the report does.
    expect(report.version?.lastUpdate?.status).toBe('staged');
    expect(report.version?.lastUpdate?.restartRequired).toBe(true);

    // Running update again finishes the job the staged run deliberately left.
    const converged = await cogmem(f, ['update', '--yes', '--json', '--install-home', f.install, '--manager', 'npm', '--from', '4.2.0', '--config', f.configPath]);
    expect(converged.exitCode, converged.stderr).toBe(0);
    const after = await waitForSession(f, (s) => s.pid !== server.pid);
    expect(after.version).toBe('4.2.0');
    expect(processIsAlive(server.pid)).toBe(false);
  }, 180_000);

  test('a corrupt package stops at the install step, rolls back, and the old version serves again', async () => {
    const f = makeFixture('cogmem-corrupt-');
    await pretestInstall(f, '4.1.0');
    const server = track(startServer(f));
    await waitForSession(f, (s) => s.version === '4.1.0');
    await rememberThroughServer(server.url, MEMORY);

    const update = await cogmem(f, ['update', '--yes', '--json', '--install-home', f.install, '--manager', 'npm', '--from', '9.9.9-corrupt', '--config', f.configPath]);
    expect(update.exitCode).not.toBe(0);
    const doc = JSON.parse(update.stdout) as { status?: string; failedStep?: string; lifecycle?: { rollback?: string } };
    expect(doc.status).toBe('error');
    expect(doc.failedStep).toBe('install');
    expect(doc.lifecycle?.rollback).toContain('restored 4.1.0');
    // The previous version is back on disk and serving.
    expect(installedVersion(f)).toBe('4.1.0');
    const back = await waitForSession(f, (s) => s.pid !== server.pid);
    expect(back.version).toBe('4.1.0');
    expect(processIsAlive(server.pid)).toBe(false);

    // Explainable afterwards: the trace names the step it stopped at.
    expect(updateTrace(f).at(-1)).toMatchObject({ status: 'failed', step: 'install' });

    // And the memory written before the failure is still there.
    expect(await recallThroughServer(server.url, MEMORY.slice(0, 6))).toContain('归档保留期');
  }, 180_000);

  test('a failed migration gate stops the update and puts the previous version back', async () => {
    const f = makeFixture('cogmem-badgate-');
    await pretestInstall(f, '4.1.0');
    const server = track(startServer(f));
    await waitForSession(f, (s) => s.version === '4.1.0');
    await rememberThroughServer(server.url, MEMORY);

    // The installed package's doctor cannot answer, which is what a migration that
    // cannot open the database looks like to the update.
    const update = await cogmem(f, ['update', '--yes', '--json', '--install-home', f.install, '--manager', 'npm', '--from', '4.2.0-badgate', '--config', f.configPath]);
    expect(update.exitCode).not.toBe(0);
    const doc = JSON.parse(update.stdout) as { status?: string; failedStep?: string; lifecycle?: { rollback?: string } };
    expect(doc.status).toBe('error');
    expect(doc.failedStep).toBe('gate');
    expect(doc.lifecycle?.rollback).toContain('restored 4.1.0');
    expect(installedVersion(f)).toBe('4.1.0');

    const back = await waitForSession(f, (s) => s.pid !== server.pid);
    expect(back.version).toBe('4.1.0');
    expect(updateTrace(f).at(-1)).toMatchObject({ status: 'failed', step: 'gate' });

    expect(await recallThroughServer(server.url, MEMORY.slice(0, 6))).toContain('归档保留期');
  }, 180_000);

  test('updating when the release is already installed does nothing and touches no service', async () => {
    const f = makeFixture('cogmem-current-');
    await pretestInstall(f, '4.2.0');
    const server = track(startServer(f));
    await waitForSession(f, (s) => s.version === '4.2.0');

    const registry = Bun.serve({ port: 0, fetch: () => Response.json({ version: '4.2.0' }) });
    try {
      const update = await cogmem(
        f,
        ['update', '--yes', '--json', '--install-home', f.install, '--manager', 'npm', '--config', f.configPath],
        { COGMEM_UPDATE_REGISTRY: `http://127.0.0.1:${registry.port}`, COGMEM_UPDATE_CHECK: '1' },
      );
      expect(update.exitCode, update.stderr).toBe(0);
      const doc = JSON.parse(update.stdout) as { alreadyCurrent?: boolean; lifecycle?: { stopped?: string; started?: string } };
      expect(doc.alreadyCurrent).toBe(true);
      expect(doc.lifecycle?.stopped).toBeUndefined();
      expect(doc.lifecycle?.started).toBeUndefined();
      // Idempotent: the same release twice is not a reason to restart a working service.
      expect(processIsAlive(server.pid)).toBe(true);
      expect((await waitForSession(f, (s) => s.pid === server.pid)).version).toBe('4.2.0');

      // The standard's own shape: run it a second time and assert the no-op.
      const again = await cogmem(
        f,
        ['update', '--yes', '--json', '--install-home', f.install, '--manager', 'npm', '--config', f.configPath],
        { COGMEM_UPDATE_REGISTRY: `http://127.0.0.1:${registry.port}`, COGMEM_UPDATE_CHECK: '1' },
      );
      expect(again.exitCode, again.stderr).toBe(0);
      expect((JSON.parse(again.stdout) as { alreadyCurrent?: boolean }).alreadyCurrent).toBe(true);
      expect(processIsAlive(server.pid)).toBe(true);
      expect((await waitForSession(f, (s) => s.pid === server.pid)).version).toBe('4.2.0');
    } finally {
      registry.stop(true);
    }
  }, 120_000);
});

describe('#150 the automatic upgrade in the refresh child', () => {
  const refreshBin = join(coreRoot, 'src', 'bin', 'version-check-refresh.ts');

  function versionRegistry(version: string): { port: number; stop: () => void } {
    const server = Bun.serve({
      port: 0,
      fetch: (request) => (new URL(request.url).pathname.endsWith('/cogmem/latest')
        ? Response.json({ version })
        : new Response('not found', { status: 404 })),
    });
    return { port: server.port, stop: () => server.stop(true) };
  }

  function writeAutoUpgradeConfig(f: Fixture, options: { inService?: boolean } = {}): void {
    writeFileSync(f.configPath, [
      '[core]',
      'db_path = "memory.db"',
      'vector_backend = "sqlite-vec"',
      '[memory_model]',
      'provider = "rule_only"',
      'model = "rule_only"',
      '[update]',
      'auto_upgrade = true',
      ...(options.inService ? ['auto_upgrade_in_service = true'] : []),
    ].join('\n'));
  }

  test('opted in, it stages the new version and never restarts the service', async () => {
    const f = makeFixture('cogmem-auto-');
    await pretestInstall(f, '4.1.0');
    writeAutoUpgradeConfig(f);
    const server = track(startServer(f));
    await waitForSession(f, (s) => s.version === '4.1.0');

    const registry = versionRegistry('4.2.0');
    try {
      const check = await run([BUN, refreshBin], {
        cwd: f.install,
        env: fixtureEnv(f, {
          COGMEM_UPDATE_CHECK: '1',
          COGMEM_UPDATE_REGISTRY: `http://127.0.0.1:${registry.port}`,
          COGMEM_PACKAGE_SPEC: '4.2.0',
          COGMEM_INSTALL_HOME: f.install,
        }),
      });
      // Silent by contract, and the staging happened.
      expect(check.exitCode, check.stderr).toBe(0);
      expect(check.stdout).toBe('');
      expect(check.stderr).toBe('');
      expect(existsSync(join(f.home, '.cogmem', 'update-check.json'))).toBe(true);
      expect(installedVersion(f)).toBe('4.2.0');
      expect(updateTrace(f).at(-1)).toMatchObject({ status: 'staged', stageOnly: true, trigger: 'auto', restartRequired: true });
      // The resident process was never restarted: the whole point of staging.
      expect(processIsAlive(server.pid)).toBe(true);
      expect((await waitForSession(f, (s) => s.pid === server.pid)).version).toBe('4.1.0');
    } finally {
      registry.stop();
    }
  }, 180_000);

  test('under systemd the ordinary opt-in is not enough; the second confirmation turns it on', async () => {
    const f = makeFixture('cogmem-auto-systemd-');
    await pretestInstall(f, '4.1.0');
    writeAutoUpgradeConfig(f);
    const registry = versionRegistry('4.2.0');
    try {
      const blocked = await run([BUN, refreshBin], {
        cwd: f.install,
        env: fixtureEnv(f, {
          COGMEM_UPDATE_CHECK: '1',
          COGMEM_UPDATE_REGISTRY: `http://127.0.0.1:${registry.port}`,
          COGMEM_PACKAGE_SPEC: '4.2.0',
          COGMEM_INSTALL_HOME: f.install,
          INVOCATION_ID: 'systemd-invocation',
        }),
      });
      expect(blocked.exitCode).toBe(0);
      // Check and report only: the package is untouched.
      expect(installedVersion(f)).toBe('4.1.0');
      expect(updateTrace(f)).toEqual([]);
      expect(JSON.parse(readFileSync(join(f.home, '.cogmem', 'update-check.json'), 'utf8'))).toMatchObject({ latestVersion: '4.2.0' });
    } finally {
      registry.stop();
    }

    // With the separate in-service confirmation, the same run stages it.
    writeAutoUpgradeConfig(f, { inService: true });
    const registry2 = versionRegistry('4.2.0');
    try {
      const allowed = await run([BUN, refreshBin], {
        cwd: f.install,
        env: fixtureEnv(f, {
          COGMEM_UPDATE_CHECK: '1',
          COGMEM_UPDATE_REGISTRY: `http://127.0.0.1:${registry2.port}`,
          COGMEM_PACKAGE_SPEC: '4.2.0',
          COGMEM_INSTALL_HOME: f.install,
          INVOCATION_ID: 'systemd-invocation',
        }),
      });
      expect(allowed.exitCode).toBe(0);
      expect(installedVersion(f)).toBe('4.2.0');
      expect(updateTrace(f).at(-1)).toMatchObject({ status: 'staged', stageOnly: true, trigger: 'auto' });
    } finally {
      registry2.stop();
    }
  }, 180_000);

  test('a registry that answers nothing usable is silent, not an error', async () => {
    const f = makeFixture('cogmem-refresh-silent-');
    await pretestInstall(f, '4.1.0');
    const broken = Bun.serve({ port: 0, fetch: () => new Response('server error', { status: 500 }) });
    const unreachablePort = freePort();
    try {
      for (const registryUrl of [`http://127.0.0.1:${broken.port}`, `http://127.0.0.1:${unreachablePort}`]) {
        const check = await run([BUN, refreshBin], {
          cwd: f.install,
          env: fixtureEnv(f, { COGMEM_UPDATE_CHECK: '1', COGMEM_UPDATE_REGISTRY: registryUrl, COGMEM_PACKAGE_SPEC: '4.2.0', COGMEM_INSTALL_HOME: f.install }),
        });
        expect(check.exitCode).toBe(0);
        expect(check.stdout).toBe('');
        expect(check.stderr).toBe('');
      }
      // The failure is cached, so the next command does not hammer a dead registry.
      const cache = JSON.parse(readFileSync(join(f.home, '.cogmem', 'update-check.json'), 'utf8')) as { error?: string; latestVersion?: string };
      expect(cache.latestVersion).toBeUndefined();
      expect(cache.error).toBe('registry_unreachable');
      expect(installedVersion(f)).toBe('4.1.0');
    } finally {
      broken.stop(true);
    }
  }, 120_000);
});
