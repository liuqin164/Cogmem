import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cogmemLauncherPath,
  resolveCliBinDir,
  resolveCogmemInvocation,
  type InstallStep,
} from '../src/install/InstallSteps.js';
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
  test('recall --json carries semanticIndex (#135)', async () => {
  // The CLI assembled its recall output by hand, so a field added to the backend result
  // never reached the command line — the one place a person checks it.
  const dir = makeTempDir('cogmem-recall-field-');
  const dbPath = join(dir, 'memory.db');
  const binDir = join(import.meta.dir, '..', 'src', 'bin');
  const spawn = async (args: string[]) => {
    const proc = Bun.spawn([process.execPath, ...args], { cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, PATH: '/usr/bin:/bin', HOME: dir } });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { stdout, stderr, code };
  };
  const appended = await spawn([join(binDir, 'episode.ts'), 'append', '--db', dbPath, '--project', 'p', '--session', 's1', '--source-agent', 'a', '--role', 'user', '--text', '归档保留期定成七年。', '--json']);
  expect(appended.code, appended.stderr).toBe(0);
  const recall = await spawn([join(binDir, 'memory.ts'), 'recall', '--db', dbPath, '--timezone', 'UTC', '--project', 'p', '--agent', 'a', '--query', '归档保留期', '--json']);
  expect(recall.code, recall.stderr).toBe(0);
  const body = JSON.parse(recall.stdout) as { semanticIndex?: unknown };
  // No model provider configured: the answer came from literal matching, and it says so.
  expect(body.semanticIndex).toBe(false);
});

test('no entry point leaves its usage text empty', () => {
  // `--help` is answered centrally, so an empty usage still exits 0 — which is how five
  // commands shipped with `usage: ''` and printed the dispatcher's generic line instead of
  // their own (#141). Asking each one dynamically cannot catch that; this reads the source.
  const offenders = readdirSync(join(coreRoot, 'src', 'bin'))
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => ({ entry, source: readFileSync(join(coreRoot, 'src', 'bin', entry), 'utf8') }))
    // Only entry points: the shared checker both defines the function and mentions
    // `usage: ''` in its doc comment about the drift that pattern caused.
    .filter(({ source }) => source.includes('assertCliArgs(') && !source.includes('export function assertCliArgs'))
    .filter(({ source }) => /usage:\s*''/.test(source))
    .map(({ entry }) => entry)
    // The alias directory is generated from the same three-line pattern and is deleted with
    // #112; its entries never had a usage of their own.
    .filter((entry) => !entry.startsWith('alias'));
  expect(offenders).toEqual([]);
});

test('every command answers --help with its usage, not with an error', async () => {
  // The list comes from the dispatcher itself, so a new command is covered the day it is
  // added. Five commands answered `--help` by doing their work (`update` ran an update
  // check; `compact`, `prospective` and `strategy` opened a database; `host-bridge`
  // reported a bad verb), and three had no usage text to answer with at all.
  const source = readFileSync(join(coreRoot, 'src', 'bin', 'cogmem.ts'), 'utf8');
  const block = /const COMMANDS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source)?.[1] ?? '';
  const cogmemBin = join(coreRoot, 'src/bin/cogmem.ts');
  const commands = [...block.matchAll(/^\s*'?([a-z][a-z0-9-]*)'?:/gm)].map((m) => m[1]!);
  // A parse sanity floor, not a count contract: the surface is being shortened on purpose
  // (#141, #142), and an exact number here would fight that instead of guarding the parse.
  expect(commands.length).toBeGreaterThanOrEqual(15);

  const offenders: string[] = [];
  for (const command of commands) {
    const proc = Bun.spawn([process.execPath, cogmemBin, command, '--help'], {
      cwd: coreRoot, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, PATH: '/usr/bin:/bin', HOME: makeTempDir(`cogmem-help-${command}-`) },
    });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) offenders.push(`${command}: exit ${code}`);
    else if (!stdout.includes('Usage:')) offenders.push(`${command}: no usage on stdout (${stdout.trim().slice(0, 40)})`);
    else if (stderr.trim()) offenders.push(`${command}: wrote to stderr (${stderr.trim().slice(0, 40)})`);
  }
  expect(offenders).toEqual([]);
}, 120_000);


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
    // be the command, not the directory it lives in. It names the managed launcher
    // rather than this installation, so the step a reader copies keeps working after
    // the prefix or the checkout moves (#114).
    expect(parsed.nextSteps[0]!.command).toBe(`${cogmemLauncherPath({ HOME: dir })} doctor --json`);
    expect(parsed.nextSteps[0]!.command).not.toContain(binDir);
    // A dry run writes nothing, so the launcher it names does not exist yet — that is the
    // point of the flag. The step is runnable once the real run has happened, which is the
    // claim worth checking, so make that run and check it then.
    const real = await run(
      ['bun', initBin, '--yes', '--json', '--no-probe'],
      { cwd: workspace, env: { COGMEM_BIN_DIR: binDir, PATH: '/usr/bin:/bin', HOME: dir } },
    );
    expect(real.exitCode).toBe(0);
    const afterReal = JSON.parse(real.stdout) as { nextSteps: InstallStep[] };
    expect(afterReal.nextSteps[0]!.command).toBe(`${cogmemLauncherPath({ HOME: dir })} doctor --json`);
    expectRunnableCommand(afterReal.nextSteps[0]!.command);
  });

  test('connect hermes writes an MCP command that resolves on this machine', async () => {
    const dir = makeTempDir('cogmem-invocation-hermes-');
    const binDir = installedLauncher(dir);
    const workspace = join(dir, 'ws');
    const hermesConfig = join(dir, 'config.yaml');
    mkdirSync(workspace, { recursive: true });
    // The entry names a config the server has to find: without this the MCP server exits
    // and the verification below is honestly false (#116).
    writeConfig(workspace, `[core]\ndb_path = "${join(workspace, 'memory.db')}"\n`);

    const { stdout, exitCode } = await run(
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
    // A bare `cogmem` here is an MCP server entry that never starts, and this
    // installation's own path stops existing the moment the npm prefix or the
    // checkout moves. The entry names the managed launcher instead (#114).
    expect(written).toContain(`command: "${cogmemLauncherPath({ HOME: dir })}"`);
    expect(written).not.toContain(join(binDir, 'cogmem'));
    // Bound to the integration's own scope: an unbound server answers whatever
    // project a caller names (#79).
    expect(written).toMatch(/args: \["mcp","--project","hermes-[0-9a-f]{8}","--config","[^"]+config\.toml"\]/);
    // And the entry it wrote is one Hermes can actually start (#116).
    const reported = JSON.parse(stdout) as { verification?: { ok: boolean; detail: string } };
    expect(reported.verification?.ok).toBe(true);
  });

  test('connect pi writes an extension that names the managed launcher, not this installation', async () => {
    const dir = makeTempDir('cogmem-invocation-pi-');
    const binDir = installedLauncher(dir);
    const workspace = join(dir, 'ws');
    const piConfig = join(dir, 'pi', 'mcp.json');
    mkdirSync(workspace, { recursive: true });
    writeConfig(workspace, `[core]\ndb_path = "${join(workspace, 'memory.db')}"\n`);

    const { stdout: firstStdout, exitCode } = await run(
      ['bun', connectBin, 'pi', '--auto', '--json', '--workspace', workspace, '--pi-config', piConfig],
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
    expect((JSON.parse(firstStdout) as { installed: boolean }).installed).toBe(true);

    // A second connect must not add anything: the adapters used to leave a
    // `.cogmem.bak-<timestamp>` beside every file they replaced, so a directory grew by
    // one file per install and none of them was ever removed (#116).
    const again = await run(
      ['bun', connectBin, 'pi', '--auto', '--json', '--workspace', workspace, '--pi-config', piConfig],
      { cwd: workspace, env: { COGMEM_BIN_DIR: binDir, COGMEM_BIN: '', COGMEM_MCP_BIN: '', PATH: '/usr/bin:/bin', HOME: dir } },
    );
    expect(again.exitCode).toBe(0);
    expect(readdirSync(join(dir, 'pi', 'extensions')).filter((name) => name.includes('.bak'))).toEqual([]);

    const extensions = readdirSync(join(dir, 'pi', 'extensions')).filter((name) => name.endsWith('.ts'));
    expect(extensions.length).toBe(1);

    // `installed` is a claim about a file; this is a claim about the command in it, which
    // is the one #86, #94 and #96 got wrong while reporting success (#116).
    const reported = JSON.parse(again.stdout) as { installed: boolean; verification?: { ok: boolean; tools?: number; detail: string } };
    // Nothing changed this time — and the entry still answers, which is the half that
    // `installed: false` says nothing about.
    expect(reported.installed).toBe(false);
    expect(reported.verification?.ok).toBe(true);
    expect(reported.verification?.tools).toBeGreaterThan(0);
    const extension = readFileSync(join(dir, 'pi', 'extensions', extensions[0]!), 'utf8');
    // Same property as the Hermes entry: the extension runs this launcher, which
    // resolves the installation when the host calls it, and the installation's own
    // path appears nowhere (#114).
    expect(extension).toContain(`const COGMEM_BIN = ${JSON.stringify(cogmemLauncherPath({ HOME: dir }))};`);
    expect(extension).not.toContain(binDir);
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

  test('a global npm install is found through its own shim directory', () => {
    // npm's posix global layout: the shim is `<prefix>/bin/cogmem`, and the script
    // Bun actually reports as argv[1] is
    // `<prefix>/lib/node_modules/cogmem/dist/bin/cogmem.js` — which has no sibling
    // `node_modules/.bin`, so the local-install branch never fires. The resolver
    // gave up on an install that was right there, `connect hermes` wrote a bare
    // `cogmem`, and Hermes parked the server permanently (#94).
    const dir = makeTempDir('cogmem-global-layout-');
    const pkgBin = join(dir, 'lib', 'node_modules', 'cogmem', 'dist', 'bin');
    mkdirSync(pkgBin, { recursive: true });
    const script = join(pkgBin, 'cogmem.js');
    writeFileSync(script, '');
    const shimDir = join(dir, 'bin');
    mkdirSync(shimDir, { recursive: true });
    writeFileSync(join(shimDir, 'cogmem'), '');

    expect(resolveCliBinDir(script, { PATH: '/usr/bin:/bin' })).toBe(shimDir);
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

test('every flag a command reads is a flag the checker allows', () => {
  // The checker validates against the usage text plus `extraFlags`, and a flag that is *read*
  // but not listed is unreachable: `--exclude-session` was implemented (parsed and passed into
  // the recall query), documented, and refused by `assertCliArgs` — while `--cursor`,
  // `--max-hops` and `--skip-agent-refresh` were consumed by their handlers and equally
  // impossible to pass. The reverse also shipped: a dozen `--x-id` alias spellings were read
  // and never allowed, so they were dead code that looked like compatibility.
  const dir = join(coreRoot, 'src', 'bin');
  const offenders: string[] = [];
  for (const file of readdirSync(dir).filter((entry) => entry.endsWith('.ts'))) {
    const source = readFileSync(join(dir, file), 'utf8');
    if (!source.includes('assertCliArgs')) continue;
    const reads = new Set<string>();
    for (const pattern of [
      /(?:stringArg|numberArg|listArgs|booleanArg)\(\s*(?:values|args|argv)\s*,\s*'([a-z][a-z0-9-]*)'/g,
      /(?:values|args)\[\s*'([a-z][a-z0-9-]*)'\s*\]/g,
      /hasFlag\(\s*'--([a-z][a-z0-9-]*)'/g,
      /readArg\(\s*'--([a-z][a-z0-9-]*)'/g,
    ]) {
      for (const match of source.matchAll(pattern)) reads.add(match[1]!);
    }
    // allowed: every `--flag` written anywhere in the file (the usage text and the checker's
    // own call) plus the `extraFlags` array, whose entries carry no dashes.
    const allowed = new Set([...source.matchAll(/--([a-z][a-z0-9-]*)/g)].map((m) => m[1]!));
    for (const array of source.matchAll(/extraFlags:\s*\[([^\]]*)\]/g)) {
      for (const name of array[1]!.matchAll(/'([a-z][a-z0-9-]*)'/g)) allowed.add(name[1]!);
    }
    for (const read of reads) if (!allowed.has(read)) offenders.push(`${file}: --${read}`);
  }
  expect(offenders).toEqual([]);
});

test('the flags that shipped as reads without an allowlist entry now run', () => {
  // Each of these was consumed by its handler and refused by the checker: an implemented
  // capability nobody could reach. `--exclude-session` was also documented, which is how the
  // mismatch surfaced. This pins the four, so a future edit to an allowlist has to notice.
  const dir = makeTempDir('cogmem-flag-allowed-');
  const configDir = join(dir, '.cogmem');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.toml'), '[core]\ndb_path = "memory.db"\n');
  const config = join(configDir, 'config.toml');
  const cases: Array<[string, string[]]> = [
    ['memory.ts', ['recall', '--query', 'x', '--exclude-session', 's1', '--config', config, '--json']],
    ['memory.ts', ['graph-path', '--from', 'a', '--to', 'b', '--max-hops', '2', '--config', config, '--json']],
    ['memory.ts', ['frame-backfill', '--project', 'p', '--cursor', 'c', '--limit', '2', '--config', config, '--json']],
    ['update.ts', ['dry-run', '--skip-agent-refresh', '--config', config, '--json']],
  ];
  for (const [file, args] of cases) {
    const proc = Bun.spawnSync({ cmd: ['bun', join(coreRoot, 'src', 'bin', file), ...args], cwd: coreRoot, stdout: 'pipe', stderr: 'pipe' });
    const text = new TextDecoder().decode(proc.stdout) + new TextDecoder().decode(proc.stderr);
    expect({ case: `${file} ${args[0]}`, refused: text.includes('unknown flag') }).toEqual({ case: `${file} ${args[0]}`, refused: false });
  }
});
