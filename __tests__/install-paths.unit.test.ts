import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  automationSafeCommands,
  connectSteps,
  installPathSteps,
  isOnPath,
  pathWarningSteps,
  resolveCliBinDir,
  type InstallStep,
} from '../src/install/InstallSteps.js';
import { makeTempDir } from './helpers/tmp.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const doctorBin = join(coreRoot, 'src/bin/doctor.ts');
const initBin = join(coreRoot, 'src/bin/init.ts');

// The CLI under test must be reachable even when a case narrows PATH, so the
// directory holding this Bun binary is always kept on it.
const BUN_DIR = dirname(process.execPath);

function run(cmd: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  const env = { ...process.env, NO_COLOR: '1', ...options.env };
  env.PATH = [BUN_DIR, env.PATH].filter(Boolean).join(':');
  const proc = Bun.spawn({
    cmd,
    cwd: options.cwd ?? coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  });
  return Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
}

test('the installed layout is recognised, so the gate cannot report OK off PATH', () => {
  const home = makeTempDir('cogmem-bin-dir-');
  const shimDir = join(home, 'node_modules', '.bin');
  const pkgBin = join(home, 'node_modules', 'cogmem', 'dist', 'bin');
  mkdirSync(shimDir, { recursive: true });
  mkdirSync(pkgBin, { recursive: true });
  writeFileSync(join(shimDir, 'cogmem'), '#!/bin/sh\n');
  writeFileSync(join(pkgBin, 'cogmem.js'), '// dispatcher\n');

  // What Bun actually reports as argv[1] when the launcher resolves the shim.
  // Reporting `ok` here would be a silent success on a machine where `cogmem`
  // does not resolve at all, which is the failure this covers.
  expect(resolveCliBinDir(join(pkgBin, 'cogmem.js'), { PATH: '/usr/bin:/bin' })).toBe(shimDir);
  // A source checkout is still not an installed layout.
  expect(resolveCliBinDir('src/bin/doctor.ts', { PATH: '/usr/bin:/bin' })).toBeUndefined();
  rmSync(home, { recursive: true, force: true });
});

describe('install step shape', () => {
  test('every step names exactly one actor and only agent steps are automation-safe', () => {
    const steps: InstallStep[] = [
      ...installPathSteps('cogmem'),
      ...connectSteps('openclaw', 'cogmem', '/tmp/ws', 'openclaw-abc12345'),
      ...connectSteps('hermes', 'cogmem', '/tmp/ws', 'hermes-abc12345'),
      ...pathWarningSteps('/opt/bin'),
    ];
    for (const step of steps) {
      expect(['agent', 'operator', 'host']).toContain(step.actor);
      expect(step.id.length).toBeGreaterThan(0);
      expect(step.command.length).toBeGreaterThan(0);
      expect(step.when.length).toBeGreaterThan(0);
      expect(step.purpose.length).toBeGreaterThan(0);
      if (step.actor !== 'agent') expect(step.safeForAutomation).toBe(false);
    }
  });

  test('the automation-safe subset is the agent steps, in declaration order', () => {
    const steps = connectSteps('openclaw', 'cogmem', '/tmp/ws', 'openclaw-abc12345');
    const commands = automationSafeCommands(steps);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.length).toBeLessThan(steps.length);
    expect(commands.every((command) => steps.some((step) => step.command === command))).toBe(true);
    expect(commands).not.toContain('openclaw gateway restart');
    expect(commands.every((command) => !command.includes(' init '))).toBe(true);
  });

  test('both Install paths are named, each with its actor', () => {
    const steps = installPathSteps('/opt/bin/cogmem');
    const operator = steps.find((step) => step.id === 'operator_init');
    const agent = steps.find((step) => step.id === 'agent_init');
    expect(operator?.actor).toBe('operator');
    expect(operator?.safeForAutomation).toBe(false);
    expect(agent?.actor).toBe('agent');
    expect(agent?.safeForAutomation).toBe(true);
    expect(agent?.command).toContain('init --yes');
    expect(steps.some((step) => step.command.includes('doctor'))).toBe(true);
  });

  test('the bin directory is only inferred from an installed layout', () => {
    expect(resolveCliBinDir('/home/u/.bun/bin/cogmem', {})).toBe('/home/u/.bun/bin');
    expect(resolveCliBinDir('/home/u/proj/node_modules/.bin/cogmem', {})).toBe('/home/u/proj/node_modules/.bin');
    expect(resolveCliBinDir('/home/u/proj/src/bin/doctor.ts', {})).toBeUndefined();
    expect(resolveCliBinDir(undefined, {})).toBeUndefined();
    expect(resolveCliBinDir('/home/u/proj/src/bin/doctor.ts', { COGMEM_BIN_DIR: '/opt/bin' })).toBe('/opt/bin');
  });

  test('finds the installed launcher when argv1 is the symlink target', () => {
    const dir = makeTempDir('cogmem-launcher-path-');
    const binDir = join(dir, 'bin');
    const launcher = join(dir, 'package', 'dist', 'bin', 'cogmem.js');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(dirname(launcher), { recursive: true });
    writeFileSync(launcher, '#!/usr/bin/env bun\n');
    symlinkSync(launcher, join(binDir, 'cogmem'));
    expect(resolveCliBinDir(launcher, { PATH: binDir })).toBe(binDir);
  });

  test('PATH membership compares resolved directories', () => {
    expect(isOnPath('/usr/local/bin', { PATH: '/usr/bin:/usr/local/bin' })).toBe(true);
    expect(isOnPath('/opt/bin', { PATH: '/usr/bin:/usr/local/bin' })).toBe(false);
    expect(isOnPath('/opt/bin', { PATH: '' })).toBe(false);
  });
});

describe('the install gate answers four outcomes', () => {
  test('with no config anywhere it reports not installed and exits 0', async () => {
    const home = makeTempDir('cogmem-gate-missing-');
    const cwd = makeTempDir('cogmem-gate-cwd-');
    // An explicit path that does not exist yet: the state every fresh install is
    // in. Naming it keeps the case independent of any config on this machine.
    const configPath = join(home, '.cogmem', 'config.toml');
    const { stdout, stderr, exitCode } = await run(['bun', doctorBin, '--config', configPath, '--json'], {
      cwd,
      env: { HOME: home, COGMEM_BIN_DIR: join(home, 'bin') },
    });
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.installGate.level).toBe('not_installed');
    expect(parsed.installGate.exitCode).toBe(0);
    expect(parsed.nextSteps.length).toBeGreaterThan(0);
    expect(parsed.nextSteps.some((step: InstallStep) => step.actor === 'operator')).toBe(true);
    expect(parsed.nextSteps.some((step: InstallStep) => step.actor === 'agent')).toBe(true);
    expect(existsSync(join(home, '.cogmem', 'config.toml'))).toBe(false);
  });

  test('text mode lists the same commands as JSON, in the same order', async () => {
    const home = makeTempDir('cogmem-gate-text-');
    const cwd = makeTempDir('cogmem-gate-text-cwd-');
    const configPath = join(home, '.cogmem', 'config.toml');
    const env = { HOME: home, COGMEM_BIN_DIR: join(home, 'bin') };
    const asJson = await run(['bun', doctorBin, '--config', configPath, '--json'], { cwd, env });
    const asText = await run(['bun', doctorBin, '--config', configPath], { cwd, env });
    const steps = JSON.parse(asJson.stdout).nextSteps as InstallStep[];
    let cursor = -1;
    for (const step of steps) {
      const at = asText.stdout.indexOf(step.command, cursor + 1);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(asText.exitCode).toBe(asJson.exitCode);
  });

  test('a rule_only config reports WARN and exits 0', async () => {
    const dir = makeTempDir('cogmem-gate-ruleonly-');
    const configPath = join(dir, '.cogmem', 'config.toml');
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, [
      '[core]',
      'db_path = "memory.db"',
      'vector_backend = "sqlite-vec"',
      '[memory_model]',
      'provider = "rule_only"',
      'model = "rule_only"',
    ].join('\n'));
    const { stdout, stderr, exitCode } = await run(['bun', doctorBin, '--config', configPath, '--json'], {
      env: { COGMEM_BIN_DIR: join(dir, 'bin') },
    });
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.installGate.level).toBe('warn');
    expect(parsed.installGate.diagnostics.some((d: { code: string }) => d.code === 'rule_only')).toBe(true);
  });

  test('a CLI directory outside PATH is a WARN with the exact export line', async () => {
    const dir = makeTempDir('cogmem-gate-path-');
    const configPath = join(dir, '.cogmem', 'config.toml');
    const binDir = join(dir, 'bin');
    mkdirSync(dirname(configPath), { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'cogmem'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
    const { stdout, exitCode } = await run(['bun', doctorBin, '--config', configPath, '--json'], {
      env: { COGMEM_BIN_DIR: binDir, PATH: '/usr/bin:/bin', HOME: dir },
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.installGate.level).toBe('warn');
    expect(parsed.installGate.diagnostics.some((d: { code: string }) => d.code === 'cli_not_on_path')).toBe(true);
    const fixPath = parsed.nextSteps.find((step: InstallStep) => step.id === 'fix_path');
    expect(fixPath.actor).toBe('operator');
    expect(fixPath.command).toBe('export PATH="' + binDir + ':$PATH"');
    const absolute = parsed.nextSteps.find((step: InstallStep) => step.id === 'use_absolute_bin');
    expect(absolute.actor).toBe('agent');
    expect(absolute.command).toContain(binDir);
  });

  test('a broken config reports FAIL and exits 1 in text and JSON modes', async () => {
    const dir = makeTempDir('cogmem-gate-fail-');
    const configPath = join(dir, '.cogmem', 'config.toml');
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, [
      '[core]',
      'db_path = "memory.db"',
      '[memory_model]',
      'provider = "not_a_provider"',
    ].join('\n'));
    const text = await run(['bun', doctorBin, '--config', configPath], {});
    expect(text.exitCode).toBe(1);
    expect(text.stderr).toContain('FAIL');

    const json = await run(['bun', doctorBin, '--config', configPath, '--json'], {});
    expect(json.exitCode).toBe(1);
    expect(json.stderr).toBe('');
    const parsed = JSON.parse(json.stdout);
    expect(parsed.installGate.level).toBe('fail');
    expect(parsed.installGate.exitCode).toBe(1);
    expect(parsed.installGate.diagnostics[0].code).toBe('invalid_model_provider');
  });
});

describe('init --yes settles Human-required settings conservatively', () => {
  test('an unattended run enables no host, even where one is detected', async () => {
    const dir = makeTempDir('cogmem-init-unattended-');
    const home = join(dir, 'home');
    const workspace = join(dir, 'workspace');
    mkdirSync(join(workspace, 'memory'), { recursive: true });
    writeFileSync(join(workspace, 'USER.md'), '# user');
    writeFileSync(join(workspace, 'SOUL.md'), '# soul');
    mkdirSync(join(home, '.hermes'), { recursive: true });
    writeFileSync(join(home, '.hermes', 'config.yaml'), 'mcp_servers: {}');

    const { stdout, stderr, exitCode } = await run(
      ['bun', initBin, '--yes', '--json', '--no-probe', '--home', join(home, '.cogmem')],
      { cwd: workspace, env: { HOME: home } },
    );
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.written).toBe(true);
    expect(parsed.config.integrations.openclaw).toBe(false);
    expect(parsed.config.integrations.hermes).toBe(false);
    expect(parsed.warnings.some((w: { code: string; command: string }) =>
      w.code === 'host_integration_suggested' && w.command.includes('--agent'))).toBe(true);

    const written = readFileSync(join(home, '.cogmem', 'config.toml'), 'utf8');
    expect(written).not.toContain('enabled = true');
  });

  test('no key and no passphrase are written, and the install lands in rule_only', async () => {
    const dir = makeTempDir('cogmem-init-conservative-');
    const home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    const { stdout, exitCode } = await run(
      ['bun', initBin, '--yes', '--json', '--no-probe', '--home', join(home, '.cogmem')],
      { cwd: dir, env: { HOME: home, OPENAI_API_KEY: 'sk-should-not-be-written', ANTHROPIC_API_KEY: 'sk-ant-should-not-be-written' } },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.config.memoryModel.provider).toBe('rule_only');
    expect(parsed.config.reasoningModel.provider).toBe('rule_only');
    expect(parsed.config.encryption).toBe(false);

    const written = readFileSync(join(home, '.cogmem', 'config.toml'), 'utf8');
    expect(written).not.toContain('sk-should-not-be-written');
    expect(written).not.toContain('sk-ant-should-not-be-written');
    expect(written).not.toContain('api_key');
    expect(written).not.toContain('encryption_passphrase');
    expect(written).toContain('encryption = false');
  });

  test('every Human-required fallback names the setting and the command that sets it', async () => {
    const dir = makeTempDir('cogmem-init-warnings-');
    const home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    const { stdout } = await run(
      ['bun', initBin, '--yes', '--json', '--no-probe', '--home', join(home, '.cogmem')],
      { cwd: dir, env: { HOME: home } },
    );
    const warnings = JSON.parse(stdout).warnings as Array<{ code: string; setting: string; message: string; command: string }>;
    const codes = warnings.map((warning) => warning.code);
    expect(codes).toContain('embedding_provider_defaulted');
    expect(codes).toContain('model_provider_defaulted');
    expect(codes).toContain('encryption_defaulted');
    for (const warning of warnings) {
      expect(warning.setting.length).toBeGreaterThan(0);
      expect(warning.message.length).toBeGreaterThan(0);
      expect(warning.command.length).toBeGreaterThan(0);
    }
  });

  test('Agent-decidable settings keep their defaults', async () => {
    const dir = makeTempDir('cogmem-init-decidable-');
    const home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    const { stdout } = await run(
      ['bun', initBin, '--yes', '--json', '--no-probe', '--home', join(home, '.cogmem')],
      { cwd: dir, env: { HOME: home } },
    );
    const parsed = JSON.parse(stdout);
    expect(parsed.config.dbPath).toBe('memory.db');
    expect(parsed.config.vectorBackend).toBe('sqlite-vec');
    expect(parsed.config.piiRedaction).toEqual({ email: true, phone: true, ssn: true });
  });

  test('--dry-run shows the same values and the same warnings as the real write', async () => {
    const dir = makeTempDir('cogmem-init-dryrun-');
    const home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    const args = ['bun', initBin, '--yes', '--json', '--no-probe', '--home', join(home, '.cogmem')];
    const dry = await run([...args, '--dry-run'], { cwd: dir, env: { HOME: home } });
    expect(existsSync(join(home, '.cogmem', 'config.toml'))).toBe(false);
    const wet = await run(args, { cwd: dir, env: { HOME: home } });
    const dryParsed = JSON.parse(dry.stdout);
    const wetParsed = JSON.parse(wet.stdout);
    expect(dryParsed.dryRun).toBe(true);
    expect(dryParsed.written).toBe(false);
    expect(wetParsed.written).toBe(true);
    expect(dryParsed.config).toEqual(wetParsed.config);
    expect(dryParsed.warnings).toEqual(wetParsed.warnings);
  });

  test('--yes defaults to project scope and --scope overrides it', async () => {
    const dir = makeTempDir('cogmem-init-scope-');
    const home = join(dir, 'home');
    const workspace = join(dir, 'workspace');
    mkdirSync(home, { recursive: true });
    mkdirSync(workspace, { recursive: true });

    const project = await run(['bun', initBin, '--yes', '--json', '--no-probe'], {
      cwd: workspace,
      env: { HOME: home },
    });
    expect(project.exitCode).toBe(0);
    expect(existsSync(join(workspace, '.cogmem', 'config.toml'))).toBe(true);
    expect(existsSync(join(home, '.cogmem', 'config.toml'))).toBe(false);

    const global = await run(
      ['bun', initBin, '--yes', '--json', '--no-probe', '--scope', 'global', '--home', join(home, '.cogmem')],
      { cwd: workspace, env: { HOME: home } },
    );
    expect(global.exitCode).toBe(0);
    expect(existsSync(join(home, '.cogmem', 'config.toml'))).toBe(true);
  });

  test('an existing config is refused without touching it', async () => {
    const dir = makeTempDir('cogmem-init-exists-');
    const home = join(dir, 'home');
    const configPath = join(home, '.cogmem', 'config.toml');
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, '[core]\ndb_path = "keep-me.db"\n');

    const { exitCode } = await run(
      ['bun', initBin, '--yes', '--no-probe', '--home', join(home, '.cogmem')],
      { cwd: dir, env: { HOME: home } },
    );
    expect(exitCode).toBe(1);
    expect(readFileSync(configPath, 'utf8')).toContain('keep-me.db');
  });

  test('an explicit --agent still enables that host', async () => {
    const dir = makeTempDir('cogmem-init-explicit-');
    const home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    const { stdout } = await run(
      ['bun', initBin, '--yes', '--json', '--no-probe', '--agent', 'hermes', '--home', join(home, '.cogmem')],
      { cwd: dir, env: { HOME: home } },
    );
    expect(JSON.parse(stdout).config.integrations.hermes).toBe(true);
  });
});
