import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installOpenClawAutoMemoryPlugin } from '../src/host/openclaw/AutoMemoryPluginInstaller.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #81: the Install gate converges, and the Host it names is the Host that is
 * actually outstanding.
 *
 * A step list that names finished work never converges: an operator following it
 * does the step, re-runs the gate, and is told to do it again. And a list that
 * hardcodes one Host tells a Hermes-only Workspace to connect OpenClaw.
 *
 * The switch stays Human-required (ADR-0003) — an unattended `init --yes` still
 * enables no Host. What this pins is that the gate reads the *fact* `connect`
 * established (ADR-0010) and recommends only what is left.
 */
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const doctorBin = join(coreRoot, 'src/bin/doctor.ts');
const updateBin = join(coreRoot, 'src/bin/update.ts');
const initBin = join(coreRoot, 'src/bin/init.ts');
const connectBin = join(coreRoot, 'src/bin/connect.ts');
const BUN_DIR = dirname(process.execPath);

function run(cmd: string[], options: { cwd: string; env?: Record<string, string> }) {
  const env = { ...process.env, NO_COLOR: '1', ...options.env };
  env.PATH = [BUN_DIR, env.PATH].filter(Boolean).join(':');
  const proc = Bun.spawn({ cmd, cwd: options.cwd, stdout: 'pipe', stderr: 'pipe', env });
  return Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
}

function writeConfig(dir: string, body: string): string {
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, body);
  return configPath;
}

async function doctor(dir: string, configPath: string, env: Record<string, string> = {}) {
  const result = await run(['bun', doctorBin, '--config', configPath, '--json'], { cwd: dir, env: { HOME: join(dir, 'home'), ...env } });
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as {
    nextConnectHost?: string;
    nextSteps: Array<{ id: string; command: string; actor: string }>;
  };
}

async function update(dir: string, configPath: string, env: Record<string, string> = {}) {
  const result = await run(['bun', updateBin, '--dry-run', '--json', '--config', configPath], { cwd: dir, env: { HOME: join(dir, 'home'), ...env } });
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as { openclawRepairCommand?: string; openclawRepairSkippedReason?: string; hermesMaintenanceSkippedReason?: string; nextSteps: Array<{ id: string; command: string }> };
}

/** The files `connect <host> --auto` writes, without going through the CLI. */
function wireOpenClaw(dir: string, configPath: string): void {
  const openclawConfigPath = join(dir, 'openclaw.json');
  writeFileSync(openclawConfigPath, '{}\n');
  installOpenClawAutoMemoryPlugin({
    workspaceRoot: dir,
    configPath,
    openclawConfigPath,
    bunPath: process.execPath,
    force: true,
  });
}

describe('the gate recommends only what is outstanding', () => {
  test('names the Host that has no integration, and stops once it is wired', async () => {
    const dir = makeTempDir('cogmem-gate-converge-');
    const configPath = writeConfig(dir, '[core]\ndb_path = "memory.db"\n');

    // Neither Host asked for: the primary is still named, so a fresh install is
    // told what to do rather than left guessing.
    const before = await doctor(dir, configPath);
    expect(before.nextConnectHost).toBe('openclaw');
    expect(before.nextSteps.find((step) => step.id === 'connect_host')!.command).toContain('connect openclaw');

    // Wire it the way `connect openclaw --auto` does, then ask again.
    wireOpenClaw(dir, configPath);
    const after = await doctor(dir, configPath);
    expect(after.nextConnectHost).toBeUndefined();
    expect(after.nextSteps.some((step) => step.id === 'connect_host')).toBe(false);
    // Nothing changed host-side, so there is nothing to restart either.
    expect(after.nextSteps.some((step) => step.id === 'restart_host')).toBe(false);

    // And the human-readable run says so: an empty `nextSteps` with no line at all
    // reads as "the gate forgot", so the README quotes this sentence.
    const human = await run(['bun', doctorBin, '--config', configPath], { cwd: dir, env: { HOME: join(dir, 'home') } });
    expect(human.stdout).toContain('Next steps: none — nothing is outstanding.');
  });

  test('an integration that exists is enough, even when no switch was set', async () => {
    const dir = makeTempDir('cogmem-gate-artifact-');
    // Nothing asked for, Hermes wired on disk — the state ADR-0010 calls "a fact on
    // disk": the gate decides from the artifact, so it does not tell a Hermes user
    // to connect OpenClaw.
    const configPath = writeConfig(dir, '[core]\ndb_path = "memory.db"\n');
    const hermesConfig = join(dir, 'home', '.hermes', 'config.yaml');
    mkdirSync(dirname(hermesConfig), { recursive: true });
    writeFileSync(hermesConfig, 'mcp_servers:\n  cogmem:\n    command: "cogmem"\n');

    const parsed = await doctor(dir, configPath);
    expect(parsed.nextConnectHost).toBeUndefined();
    expect(parsed.nextSteps.some((step) => step.id === 'connect_host')).toBe(false);
  });

  test('a Hermes integration written to a named path reads back as wired', async () => {
    const dir = makeTempDir('cogmem-gate-hermes-path-');
    const configPath = writeConfig(dir, '[core]\ndb_path = "memory.db"\n\n[integrations.hermes]\nenabled = true\n');
    const hermesConfig = join(dir, 'elsewhere', 'config.yaml');

    const connected = await run(
      ['bun', connectBin, 'hermes', '--auto', '--json', '--workspace', dir, '--hermes-config', hermesConfig],
      { cwd: dir, env: { HOME: join(dir, 'home') } },
    );
    expect(connected.exitCode).toBe(0);

    // Without `--hermes-config` the gate looks at the default path and cannot see it;
    // with the same flag the reader agrees with the writer instead of recommending
    // the step that was just done — which would write a second integration.
    const blind = await doctor(dir, configPath);
    expect(blind.nextConnectHost).toBe('hermes');
    const withFlag = await run(
      ['bun', doctorBin, '--config', configPath, '--hermes-config', hermesConfig, '--json'],
      { cwd: dir, env: { HOME: join(dir, 'home') } },
    );
    expect((JSON.parse(withFlag.stdout) as { nextConnectHost?: string }).nextConnectHost).toBeUndefined();
  });

  test('the report and the verdict read the same installation', async () => {
    const dir = makeTempDir('cogmem-gate-one-root-');
    const configPath = writeConfig(dir, '[core]\ndb_path = "memory.db"\n');
    wireOpenClaw(dir, configPath);
    const other = makeTempDir('cogmem-gate-other-root-');

    // `--workspace <other>` moves what the report inspects; the verdict has to move
    // with it, or one document says "not installed" and "nothing outstanding".
    const result = await run(
      ['bun', doctorBin, '--config', configPath, '--workspace', other, '--json'],
      { cwd: dir, env: { HOME: join(dir, 'home') } },
    );
    const parsed = JSON.parse(result.stdout) as { nextConnectHost?: string; openclaw: { plugin: { installed: boolean } }; nextSteps: Array<{ id: string; command: string }> };
    expect(parsed.openclaw.plugin.installed).toBe(false);
    expect(parsed.nextConnectHost).toBe('openclaw');
    expect(parsed.nextSteps.find((step) => step.id === 'connect_host')!.command).toContain(other);
  });

  test('a Hermes-only Workspace is told to connect Hermes', async () => {
    const dir = makeTempDir('cogmem-gate-hermes-');
    const configPath = writeConfig(dir, '[core]\ndb_path = "memory.db"\n\n[integrations.hermes]\nenabled = true\n');

    const before = await doctor(dir, configPath);
    expect(before.nextConnectHost).toBe('hermes');
    expect(before.nextSteps.find((step) => step.id === 'connect_host')!.command).toContain('connect hermes');
    // And the step says which workspace it will write into.
    expect(before.nextSteps.find((step) => step.id === 'connect_host')!.command).toContain(`--workspace ${dir}`);

    // Once Hermes carries a Cogmem MCP entry, that Host is done and the gate says so.
    const hermesConfig = join(dir, 'home', '.hermes', 'config.yaml');
    mkdirSync(dirname(hermesConfig), { recursive: true });
    writeFileSync(hermesConfig, 'mcp_servers:\n  cogmem:\n    command: "cogmem"\n    args: ["mcp"]\n');
    const after = await doctor(dir, configPath);
    expect(after.nextConnectHost).toBeUndefined();
    expect(after.nextSteps.some((step) => step.id === 'connect_host')).toBe(false);
  });
});

describe('update maintains what connect wrote', () => {
  test('reports a reason for the Host it did not touch as well', async () => {
    const dir = makeTempDir('cogmem-gate-update-hermes-');
    const configPath = writeConfig(dir, '[core]\ndb_path = "memory.db"\n\n[integrations.hermes]\nenabled = true\n');

    const parsed = await update(dir, configPath);
    // `update` generates nothing for Hermes, so it does not refresh it — and says so
    // rather than leaving the reader to guess (#81).
    expect(parsed.hermesMaintenanceSkippedReason).toBe('hermes_has_no_generated_artifacts');
  });

  test('reports the reason it skipped a Host, and repairs the one that is wired', async () => {
    const dir = makeTempDir('cogmem-gate-update-');
    const configPath = writeConfig(dir, '[core]\ndb_path = "memory.db"\n');

    const skipped = await update(dir, configPath);
    expect(skipped.openclawRepairCommand).toBeUndefined();
    expect(skipped.openclawRepairSkippedReason).toBe('openclaw_not_configured');
    expect(skipped.hermesMaintenanceSkippedReason).toBeUndefined();

    // `connect` wrote the plugin, so update refreshes it instead of declining — and
    // the repair names the Workspace the integration belongs to.
    wireOpenClaw(dir, configPath);
    const repaired = await update(dir, configPath);
    expect(repaired.openclawRepairSkippedReason).toBeUndefined();
    expect(repaired.openclawRepairCommand).toContain(`--workspace ${dir}`);
  });
});

describe("init's warning about the switch", () => {
  test('no longer claims connect leaves the integration switch alone', async () => {
    const dir = makeTempDir('cogmem-gate-init-text-');
    const home = join(dir, 'home');
    mkdirSync(home, { recursive: true });

    const { stdout, exitCode } = await run(
      ['bun', initBin, '--yes', '--json', '--no-probe', '--dry-run'],
      { cwd: dir, env: { HOME: home } },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { warnings: Array<{ code: string; message: string }> };
    const warning = parsed.warnings.find((entry) => entry.code === 'host_integration_defaulted')!;
    // `connect --auto` records the integration it wires (ADR-0010), so the old
    // sentence told the operator the opposite of what happens.
    expect(warning.message).not.toContain('does not change this switch');
    expect(warning.message).toContain('records the integration it wired');
  });
});
