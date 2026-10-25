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

async function update(dir: string, configPath: string) {
  const result = await run(['bun', updateBin, '--dry-run', '--json', '--config', configPath], { cwd: dir, env: { HOME: join(dir, 'home') } });
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as { openclawRepairCommand?: string; openclawRepairSkippedReason?: string };
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
  test('reports the reason it skipped a Host, and repairs the one that is wired', async () => {
    const dir = makeTempDir('cogmem-gate-update-');
    const configPath = writeConfig(dir, '[core]\ndb_path = "memory.db"\n');

    const skipped = await update(dir, configPath);
    expect(skipped.openclawRepairCommand).toBeUndefined();
    expect(skipped.openclawRepairSkippedReason).toBe('openclaw_not_configured');

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
