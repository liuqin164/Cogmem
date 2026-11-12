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
 * Commands used to answer "how do I invoke `cogmem`" different ways: `doctor`
 * printed an absolute path unconditionally, `init --json` printed the bin
 * **directory** (`/path/to/bin doctor --json`, exit 126), and an integration
 * wrote a bare `cogmem` into a config on machines where it does not resolve.
 * All of them are printed steps whose whole promise is that they run when
 * pasted.
 */
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const doctorBin = join(coreRoot, 'src/bin/doctor.ts');
const initBin = join(coreRoot, 'src/bin/init.ts');
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
  // added. Four commands answered `--help` by doing their work (`update` ran an update
  // check; `compact`, `prospective` and `strategy` opened a database), and three had no
  // usage text to answer with at all.
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
    // Every step that invokes the CLI has to run. `fix_path` is a shell export, not an
    // invocation.
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
  // mismatch surfaced. This pins the three, so a future edit to an allowlist has to notice.
  const dir = makeTempDir('cogmem-flag-allowed-');
  const configDir = join(dir, '.cogmem');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.toml'), '[core]\ndb_path = "memory.db"\n');
  const config = join(configDir, 'config.toml');
  const cases: Array<[string, string[]]> = [
    ['memory.ts', ['recall', '--query', 'x', '--exclude-session', 's1', '--config', config, '--json']],
    ['memory.ts', ['graph-path', '--from', 'a', '--to', 'b', '--max-hops', '2', '--config', config, '--json']],
    ['memory.ts', ['frame-backfill', '--project', 'p', '--cursor', 'c', '--limit', '2', '--config', config, '--json']],
  ];
  for (const [file, args] of cases) {
    const proc = Bun.spawnSync({ cmd: ['bun', join(coreRoot, 'src', 'bin', file), ...args], cwd: coreRoot, stdout: 'pipe', stderr: 'pipe' });
    const text = new TextDecoder().decode(proc.stdout) + new TextDecoder().decode(proc.stderr);
    expect({ case: `${file} ${args[0]}`, refused: text.includes('unknown flag') }).toEqual({ case: `${file} ${args[0]}`, refused: false });
  }
});

test('the JSON command field names the command the way every other one does', () => {
  // Multi-word commands report dot-separated names — `memory.graph-search`, `strategy.plan`,
  // `snapshot.export`, `dream.tick` — so a consumer keys on one shape. `repair project-scope`
  // reported a space, the only one, which meant special-casing a single command.
  const dir = makeTempDir('cogmem-command-field-');
  const configDir = join(dir, '.cogmem');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.toml'), '[core]\ndb_path = "memory.db"\n');
  const config = join(configDir, 'config.toml');

  // Every helper-built envelope takes its command from the first argument, so a literal with a
  // space there is wrong by construction. Template arguments interpolate and are skipped.
  const offenders: string[] = [];
  for (const file of readdirSync(join(coreRoot, 'src', 'bin')).filter((entry) => entry.endsWith('.ts'))) {
    const source = readFileSync(join(coreRoot, 'src', 'bin', file), 'utf8');
    for (const match of source.matchAll(/printCliJson\(\s*'([^']*)'/g)) {
      if (/\s/.test(match[1]!)) offenders.push(`${file}: ${match[1]}`);
    }
  }
  expect(offenders).toEqual([]);

  // The commands that hand-roll their envelope are checked as they run.
  const runs: Array<[string, string[]]> = [
    ['cleanup.ts', ['--dry-run']],
    ['doctor.ts', ['--config', config]],
    ['repair.ts', ['project-scope', '--from', 'a', '--to', 'b', '--dry-run', '--config', config]],
    ['init.ts', ['--yes', '--no-probe']],
  ];
  for (const [file, args] of runs) {
    const proc = Bun.spawnSync({ cmd: ['bun', join(coreRoot, 'src', 'bin', file), ...args, '--json'], cwd: dir, stdout: 'pipe', stderr: 'pipe' });
    const text = new TextDecoder().decode(proc.stdout);
    if (!text.trim().startsWith('{')) continue; // a run that refused printed no envelope
    const command = (JSON.parse(text) as { command?: string }).command ?? '';
    expect({ file, name: command, spaceFree: /^[a-z][a-z0-9.-]*$/.test(command) }).toEqual({ file, name: command, spaceFree: true });
  }
});

test('the JSON contract in --help names the array keys the commands actually emit', () => {
  // `--help` promised "arrays use items". Nine measured commands produced `items` twice and
  // `events`, `episodes`, `nodes`, `edges`, `decisions` and `statuses` everywhere else — and the
  // agent-facing docs already tell readers to use `nodes`/`edges`. Domain names are the better
  // contract, so the help describes them and this fails when one is added without being named.
  const dir = makeTempDir('cogmem-array-keys-');
  const configDir = join(dir, '.cogmem');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.toml'), '[core]\ndb_path = "memory.db"\n');
  const config = join(configDir, 'config.toml');

  const help = new TextDecoder().decode(Bun.spawnSync({ cmd: ['bun', join(coreRoot, 'src', 'bin', 'cogmem.ts'), '--help'], cwd: coreRoot, stdout: 'pipe', stderr: 'pipe' }).stdout);
  expect(help).toContain('named for what they hold');

  const cases: Array<[string, string[]]> = [
    ['memory.ts', ['recall', '--query', 'x', '--project', 'p', '--config', config]],
    ['memory.ts', ['list', '--project', 'p', '--config', config]],
    ['memory.ts', ['search', '--query', 'x', '--project', 'p', '--config', config]],
    ['memory.ts', ['govern', '--project', 'p', '--config', config]],
    ['memory.ts', ['graph', '--project', 'p', '--config', config]],
    ['memory.ts', ['graph-search', '--project', 'p', '--query', 'x', '--config', config]],
    ['episode.ts', ['list', '--project', 'p', '--config', config]],
    ['prospective.ts', ['list', '--project', 'p', '--config', config]],
    ['compact.ts', ['--dry-run', '--config', config]],
  ];
  const undocumented: string[] = [];
  for (const [file, args] of cases) {
    const proc = Bun.spawnSync({ cmd: ['bun', join(coreRoot, 'src', 'bin', file), ...args, '--json'], cwd: coreRoot, stdout: 'pipe', stderr: 'pipe' });
    const text = new TextDecoder().decode(proc.stdout);
    if (!text.trim().startsWith('{')) continue; // a refusing run printed no envelope
    const body = JSON.parse(text) as Record<string, unknown>;
    for (const key of Object.keys(body)) {
      if (!Array.isArray(body[key])) continue;
      if (!help.includes(key)) undocumented.push(`${file} ${args[0]}: ${key}`);
    }
  }
  expect(undocumented).toEqual([]);
});

test('every dispatched command is named in --help', () => {
  // `normalize-transcript` ran, had a usage text, and was required by the release checklist,
  // while the top-level help never listed it — a command nobody can discover from `--help`.
  const source = readFileSync(join(coreRoot, 'src', 'bin', 'cogmem.ts'), 'utf8');
  const map = source.slice(source.indexOf('const COMMANDS'), source.indexOf('};', source.indexOf('const COMMANDS')));
  const commands = [...map.matchAll(/'?([a-z][a-z-]*)'?:\s*'/g)].map((m) => m[1]!);
  expect(commands.length).toBeGreaterThan(15);

  const help = new TextDecoder().decode(Bun.spawnSync({
    cmd: ['bun', join(coreRoot, 'src', 'bin', 'cogmem.ts'), '--help'], cwd: coreRoot, stdout: 'pipe', stderr: 'pipe',
  }).stdout);
  const missing = commands.filter((command) => !help.includes(command));
  expect(missing).toEqual([]);
});

test('every subcommand a bin accepts is named in that command --help', () => {
  // The top-level guard above catches a command that is dispatched but undocumented; this is
  // the same question one level down. Names are read from the bin's own `command === '...'`
  // and `isMemoryCommand` guards, and matched anywhere in the help text rather than at the
  // start of a line — help writes related actions on one line (`reject|complete|expire`).
  const source = readFileSync(join(coreRoot, 'src', 'bin', 'cogmem.ts'), 'utf8');
  const map = source.slice(source.indexOf('const COMMANDS'), source.indexOf('};', source.indexOf('const COMMANDS')));
  const commands = [...map.matchAll(/'?([a-z][a-z-]*)'?:\s*'([a-z-]+)'/g)].map((m) => m[2]!);

  const undocumented: string[] = [];
  let checked = 0;
  for (const entry of new Set(commands)) {
    const file = join(coreRoot, 'src', 'bin', `${entry}.ts`);
    if (!existsSync(file)) continue;
    const code = readFileSync(file, 'utf8');
    const accepted = new Set<string>();
    for (const m of code.matchAll(/command === '([a-z][a-z-]*)'/g)) accepted.add(m[1]!);
    const guardStart = code.indexOf('function isMemoryCommand');
    if (guardStart >= 0) {
      const body = code.slice(guardStart, guardStart + 1200);
      for (const m of body.matchAll(/value === '([a-z][a-z-]*)'/g)) accepted.add(m[1]!);
    }
    if (accepted.size === 0) continue;
    const help = new TextDecoder().decode(Bun.spawnSync({
      cmd: ['bun', file, '--help'], cwd: coreRoot, stdout: 'pipe', stderr: 'pipe',
    }).stdout);
    for (const sub of accepted) {
      if (sub === 'help') continue;
      checked += 1;
      if (!help.includes(sub)) undocumented.push(`${entry} ${sub}`);
    }
  }
  expect(checked).toBeGreaterThan(30);
  expect(undocumented).toEqual([]);
});
