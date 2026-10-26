import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveCogmemInvocation, type InstallStep } from '../src/install/InstallSteps.js';
import { expectRunnableCommand } from './helpers/cli-invocation.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * One resolver decides how Cogmem is invoked (#78).
 *
 * Four commands used to answer "how do I invoke `cogmem`" four ways: `doctor`
 * printed an absolute path unconditionally, `connect` printed a literal
 * `./node_modules/.bin/cogmem` that exists only in a JS project with a local
 * dependency, `init --json` printed the bin **directory** (`/path/to/bin doctor
 * --json`, exit 126) and `connect hermes` wrote a bare `cogmem` into a host
 * config on machines where it does not resolve. All of them are printed steps
 * whose whole promise is that they run when pasted.
 */
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const doctorBin = join(coreRoot, 'src/bin/doctor.ts');
const initBin = join(coreRoot, 'src/bin/init.ts');
const connectBin = join(coreRoot, 'src/bin/connect.ts');
const BUN_DIR = dirname(process.execPath);

function run(cmd: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  const env = { ...process.env, NO_COLOR: '1', ...options.env };
  env.PATH = [BUN_DIR, env.PATH].filter(Boolean).join(':');
  const proc = Bun.spawn({ cmd, cwd: options.cwd ?? coreRoot, stdout: 'pipe', stderr: 'pipe', env });
  return Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
}

/** A bin directory holding a launcher, the way an install leaves one. */
function installedLauncher(dir: string): string {
  const binDir = join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const launcher = join(binDir, 'cogmem');
  // A real launcher, so the one test that executes a printed step is executing
  // this CLI rather than a stub that would pass whatever happened.
  writeFileSync(launcher, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(coreRoot, 'src', 'bin', 'cogmem.ts'))} "$@"\n`);
  chmodSync(launcher, 0o755);
  return binDir;
}

function writeConfig(dir: string, body: string): string {
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, body);
  return configPath;
}

describe('the invocation resolver', () => {
  test('absolute off PATH, bare on it, and never the bin directory', () => {
    const dir = makeTempDir('cogmem-invocation-unit-');
    const binDir = installedLauncher(dir);
    const launcher = join(binDir, 'cogmem');

    expect(resolveCogmemInvocation({ COGMEM_BIN_DIR: binDir, PATH: '/usr/bin:/bin' })).toBe(launcher);
    expect(resolveCogmemInvocation({ COGMEM_BIN_DIR: binDir, PATH: `${binDir}:/usr/bin:/bin` })).toBe('cogmem');
    // A directory that exists but holds no launcher is not an installation.
    expect(resolveCogmemInvocation({ COGMEM_BIN_DIR: join(dir, 'empty'), PATH: '/usr/bin:/bin' })).toBe('cogmem');
    // A source checkout is not an installed layout, so there is nothing to name
    // by path — the bare command is the only honest answer.
    expect(resolveCogmemInvocation({ PATH: '/usr/bin:/bin' }, 'src/bin/doctor.ts')).toBe('cogmem');
  });
});

describe('printed steps run as printed', () => {
  test('off PATH the gate step is absolute, and the export line is carried', async () => {
    const dir = makeTempDir('cogmem-invocation-gate-');
    const binDir = installedLauncher(dir);
    const configPath = writeConfig(dir, '[core]\ndb_path = "memory.db"\n');
    const launcher = join(binDir, 'cogmem');

    const { stdout, exitCode } = await run(['bun', doctorBin, '--config', configPath, '--json'], {
      env: { COGMEM_BIN_DIR: binDir, PATH: '/usr/bin:/bin', HOME: dir },
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { nextSteps: InstallStep[]; installGate: { diagnostics: Array<{ code: string }> } };
    const stepOf = (id: string): InstallStep => parsed.nextSteps.find((step) => step.id === id)!;

    expect(parsed.installGate.diagnostics.some((diagnostic) => diagnostic.code === 'cli_not_on_path')).toBe(true);
    expect(stepOf('fix_path').command).toBe(`export PATH="${binDir}:$PATH"`);
    // The one step that acts on files is absolute off PATH and carries the
    // workspace it is about.
    expect(stepOf('connect_host').command).toBe(`${launcher} connect openclaw --auto --force --workspace ${dir}`);
    // `host` steps are prose by design ("restart the agent host"); every step that
    // invokes the CLI has to run. `fix_path` is a shell export, not an invocation.
    for (const step of parsed.nextSteps) {
      if (step.actor === 'host' || step.id === 'fix_path') continue;
      expectRunnableCommand(step.command);
    }

    // And the absolute command the gate printed actually executes, as printed.
    const executed = await run([launcher, 'doctor', '--config', configPath, '--json'], {
      cwd: dir,
      env: { COGMEM_BIN_DIR: binDir, PATH: '/usr/bin:/bin', HOME: dir },
    });
    expect(executed.stderr).toBe('');
    expect(executed.exitCode).toBe(0);
    expect(JSON.parse(executed.stdout).installGate.level).toBe('warn');
  });

  test('the not-installed state carries the export line as well', async () => {
    const dir = makeTempDir('cogmem-invocation-freshinstall-');
    const binDir = installedLauncher(dir);

    const { stdout, exitCode } = await run(['bun', doctorBin, '--config', join(dir, 'missing', 'config.toml'), '--json'], {
      env: { COGMEM_BIN_DIR: binDir, PATH: '/usr/bin:/bin', HOME: dir },
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { nextSteps: InstallStep[]; installGate: { level: string } };
    // The state a fresh one-line install is in first: it must not be the one state
    // where a CLI that does not resolve is reported without the fix.
    expect(parsed.installGate.level).toBe('not_installed');
    expect(parsed.nextSteps.find((step) => step.id === 'fix_path')!.command).toBe(`export PATH="${binDir}:$PATH"`);
    expect(parsed.nextSteps.find((step) => step.id === 'use_absolute_bin')!.command).toContain(binDir);
  });

  test('on PATH the same step is the bare command', async () => {
    const dir = makeTempDir('cogmem-invocation-onpath-');
    const binDir = installedLauncher(dir);
    const configPath = writeConfig(dir, '[core]\ndb_path = "memory.db"\n');

    const { stdout } = await run(['bun', doctorBin, '--config', configPath, '--json'], {
      env: { COGMEM_BIN_DIR: binDir, PATH: `${binDir}:/usr/bin:/bin`, HOME: dir },
    });
    const parsed = JSON.parse(stdout) as { nextSteps: InstallStep[] };
    expect(parsed.nextSteps.find((step) => step.id === 'connect_host')!.command)
      .toBe(`cogmem connect openclaw --auto --force --workspace ${dir}`);
  });

  test('with no config yet the gate step is absolute off PATH too', async () => {
    const dir = makeTempDir('cogmem-invocation-notinstalled-');
    const binDir = installedLauncher(dir);
    const launcher = join(binDir, 'cogmem');

    const { stdout } = await run(['bun', doctorBin, '--config', join(dir, 'missing', 'config.toml'), '--json'], {
      env: { COGMEM_BIN_DIR: binDir, PATH: '/usr/bin:/bin', HOME: dir },
    });
    const parsed = JSON.parse(stdout) as { nextSteps: InstallStep[]; installGate: { level: string } };
    expect(parsed.installGate.level).toBe('not_installed');
    expect(parsed.nextSteps.find((step) => step.id === 'install_gate')!.command).toBe(`${launcher} doctor --json`);
  });

  test('init --json emits a command, not the bin directory', async () => {
    const dir = makeTempDir('cogmem-invocation-init-');
    const binDir = installedLauncher(dir);
    const workspace = join(dir, 'ws');
    mkdirSync(workspace, { recursive: true });

    const { stdout, exitCode } = await run(
      ['bun', initBin, '--yes', '--json', '--no-probe', '--dry-run'],
      { cwd: workspace, env: { COGMEM_BIN_DIR: binDir, PATH: '/usr/bin:/bin', HOME: dir } },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { nextSteps: InstallStep[] };
    // `/path/to/bin doctor --json` is exit 126 — the step an agent follows has to
    // be the command, not the directory it lives in.
    expect(parsed.nextSteps[0]!.command).toBe(`${join(binDir, 'cogmem')} doctor --json`);
    expectRunnableCommand(parsed.nextSteps[0]!.command);
  });

  test('connect hermes writes an MCP command that resolves on this machine', async () => {
    const dir = makeTempDir('cogmem-invocation-hermes-');
    const binDir = installedLauncher(dir);
    const workspace = join(dir, 'ws');
    const hermesConfig = join(dir, 'config.yaml');
    mkdirSync(workspace, { recursive: true });

    const { exitCode } = await run(
      ['bun', connectBin, 'hermes', '--auto', '--json', '--workspace', workspace, '--hermes-config', hermesConfig],
      {
        cwd: workspace,
        env: {
          COGMEM_BIN_DIR: binDir,
          COGMEM_BIN: '',
          COGMEM_MCP_BIN: '',
          PATH: '/usr/bin:/bin',
          HOME: dir,
        },
      },
    );
    expect(exitCode).toBe(0);
    const written = readFileSync(hermesConfig, 'utf8');
    // A bare `cogmem` here is an MCP server entry that never starts.
    expect(written).toContain(`command: "${join(binDir, 'cogmem')}"`);
    // Bound to the integration's own scope: an unbound server answers whatever
    // project a caller names (#79).
    expect(written).toMatch(/args: \["mcp","--project","hermes-[0-9a-f]{8}","--config","[^"]+config\.toml"\]/);
  });

  test('a workspace with a space is quoted, so the step still runs', async () => {
    const dir = makeTempDir('cogmem-invocation-spaces-');
    const binDir = installedLauncher(dir);
    const workspace = join(dir, 'My Project');
    mkdirSync(workspace, { recursive: true });

    const { stdout, exitCode } = await run(
      ['bun', connectBin, 'openclaw', '--workspace', workspace, '--dry-run', '--json'],
      { cwd: dir, env: { COGMEM_BIN_DIR: binDir, PATH: `${binDir}:/usr/bin:/bin`, HOME: dir } },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { nextSteps: InstallStep[]; nextCommands: string[] };
    const stepOf = (id: string): InstallStep => parsed.nextSteps.find((step) => step.id === id)!;
    // Unquoted, the shell splits it and the step fails with a file it cannot
    // find — "runs as printed" is exactly the promise.
    for (const id of ['openclaw_diagnose', 'import_dry_run', 'import_apply']) {
      expect(stepOf(id).command).toContain(`--workspace '${workspace}' `);
    }
    for (const command of parsed.nextCommands) expectRunnableCommand(command);
  });

  test('an MCP-only entry point is bound without the cogmem subcommand', async () => {
    const dir = makeTempDir('cogmem-invocation-mcponly-');
    const binDir = installedLauncher(dir);
    const workspace = join(dir, 'ws');
    const hermesConfig = join(dir, 'config.yaml');
    const mcpBin = join(dir, 'my-cogmem-mcp');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(mcpBin, '#!/bin/sh\nexit 0\n');
    chmodSync(mcpBin, 0o755);

    const { exitCode } = await run(
      ['bun', connectBin, 'hermes', '--auto', '--json', '--workspace', workspace, '--hermes-config', hermesConfig],
      {
        cwd: workspace,
        env: { COGMEM_MCP_BIN: mcpBin, COGMEM_BIN: '', COGMEM_BIN_DIR: binDir, PATH: '/usr/bin:/bin', HOME: dir },
      },
    );
    expect(exitCode).toBe(0);
    // `COGMEM_MCP_BIN` is the server itself: a positional `mcp` is a bad argument.
    expect(readFileSync(hermesConfig, 'utf8')).toMatch(/args: \["--project","hermes-[0-9a-f]{8}","--config","[^"]+config\.toml"\]/);
  });

  test('connect prints the workspace it was given, not a `.` of its own', async () => {
    const dir = makeTempDir('cogmem-invocation-connect-');
    const binDir = installedLauncher(dir);
    const workspace = join(dir, 'ws');
    mkdirSync(workspace, { recursive: true });

    const { stdout, exitCode } = await run(
      ['bun', connectBin, 'openclaw', '--workspace', workspace, '--dry-run', '--json'],
      { cwd: dir, env: { COGMEM_BIN_DIR: binDir, PATH: `${binDir}:/usr/bin:/bin`, HOME: dir } },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { nextSteps: InstallStep[]; nextCommands: string[] };
    const stepOf = (id: string): InstallStep => parsed.nextSteps.find((step) => step.id === id)!;

    for (const id of ['openclaw_diagnose', 'import_dry_run', 'import_apply']) {
      expect(stepOf(id).command).toContain(`--workspace ${workspace} `);
      expect(stepOf(id).command).not.toContain('--workspace . ');
    }
    for (const command of parsed.nextCommands) expectRunnableCommand(command);
  });
});

describe('the old relative path is gone from the product', () => {
  test('no source file names a relative invocation path', () => {
    const offenders: string[] = [];
    for (const entry of readdirSync(join(coreRoot, 'src'), { recursive: true }) as string[]) {
      if (!entry.endsWith('.ts')) continue;
      const text = readFileSync(join(coreRoot, 'src', entry), 'utf8');
      // `./node_modules/.bin/cogmem` exists only in a JS project with a local
      // dependency, which is not the path the printed steps are for. The
      // resolver decides this now; a second literal is a second answer.
      if (text.includes('./node_modules/.bin/cogmem')) offenders.push(`src/${entry}`);
    }
    expect(offenders).toEqual([]);
  });
});
