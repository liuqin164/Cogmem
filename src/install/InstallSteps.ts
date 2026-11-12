import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';

import { cliArg } from '../utils/CliArgument.js';

/**
 * The Install actor vocabulary: who carries out one install step.
 * Defined once here so the installer, `init`, `doctor` and `update` all speak
 * the same three words. See ADR-0003.
 */
export type InstallActor = 'agent' | 'operator' | 'host';

/**
 * One install step: every step names exactly one actor, and only `agent` steps
 * may be `safeForAutomation`.
 */
export interface InstallStep {
  id: string;
  actor: InstallActor;
  safeForAutomation: boolean;
  command: string;
  when: string;
  purpose: string;
}

/** The four Install gate outcomes. `not_installed` is not a failure. */
export type InstallGateLevel = 'not_installed' | 'ok' | 'warn' | 'fail';

export interface InstallGateDiagnostic {
  code: string;
  message: string;
}

export interface InstallGate {
  level: InstallGateLevel;
  exitCode: 0 | 1;
  summary: string;
  diagnostics: InstallGateDiagnostic[];
  nextSteps: InstallStep[];
}

const EXIT_CODE: Record<InstallGateLevel, 0 | 1> = {
  not_installed: 0,
  ok: 0,
  warn: 0,
  fail: 1,
};

const SUMMARY: Record<InstallGateLevel, string> = {
  not_installed: 'not installed yet',
  ok: 'installed and working',
  warn: 'installed but degraded',
  fail: 'broken',
};

export function buildGate(
  level: InstallGateLevel,
  diagnostics: InstallGateDiagnostic[],
  nextSteps: InstallStep[],
): InstallGate {
  return {
    level,
    exitCode: EXIT_CODE[level],
    summary: SUMMARY[level],
    diagnostics,
    nextSteps,
  };
}

/**
 * The two Install paths, as the steps that follow a finished install.
 * The installer prints these and stops; it never runs them.
 */
/**
 * The step that runs the Install gate.
 *
 * Defined once because it appears in more than one list, and the two copies had
 * already drifted apart in the one field that legitimately differs — when it is
 * run — while the rest must never diverge. `init` reports it as the step to take
 * now; the install-path list reports it as the step after setup.
 */
export function installGateStep(bin: string, when = 'after either setup step'): InstallStep {
  return {
    id: 'install_gate',
    actor: 'agent',
    safeForAutomation: true,
    command: `${bin} doctor --json`,
    when,
    purpose: 'the Install gate: not installed, OK, WARN or FAIL, plus the next step',
  };
}

export function installPathSteps(bin: string): InstallStep[] {
  return [
    {
      id: 'operator_init',
      actor: 'operator',
      safeForAutomation: false,
      command: `${bin} init`,
      when: 'with a terminal available',
      purpose: 'interactive first-time config; asks for provider, key and passphrase',
    },
    {
      id: 'agent_init',
      actor: 'agent',
      safeForAutomation: true,
      command: `${bin} init --yes --json`,
      when: 'with no human present',
      purpose: 'non-interactive config; Human-required settings fall back to conservative defaults',
    },
    installGateStep(bin),
  ];
}

/**
 * The directory the CLI is installed into, when it can be told apart from a
 * source checkout. `COGMEM_BIN_DIR` wins. The dispatcher may be invoked via a
 * symlink that Bun/Node resolves in `process.argv[1]`, so also match the
 * launched file against `cogmem` entries on PATH.
 */
export function resolveCliBinDir(
  argv1: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const override = env.COGMEM_BIN_DIR?.trim();
  if (override) return resolve(override);
  if (!argv1) return undefined;
  const script = resolve(argv1);
  const leaf = basename(script);
  // Only a launcher named for the CLI counts: a source checkout runs
  // `src/bin/doctor.ts`, which is not an installed layout.
  if (leaf !== 'cogmem' && !/^cogmem\.[cm]?js$/.test(leaf)) return undefined;
  const dir = dirname(script);
  const base = basename(dir);
  if ((base === 'bin' || base === '.bin') && leaf === 'cogmem') return dir;

  // The package's own dispatcher, `<pkg>/dist/bin/cogmem.js`. A user who ran the
  // one-line installer has the launcher in `<pkg parent>/.bin`, and that
  // directory is often not on PATH yet: Bun resolves the shim, so `argv[1]` is
  // this file rather than the launcher. Without this, the gate answered `ok` on a
  // machine where `cogmem` did not resolve at all — the silent success ADR-0003
  // forbids. A global npm install puts its launcher on PATH and the scan below
  // still handles it.
  if (base === 'bin') {
    const shimDir = join(dirname(dirname(dirname(dir))), '.bin');
    if (existsSync(join(shimDir, 'cogmem'))) return shimDir;
    // A **global** npm install keeps its shims in `<prefix>/bin`, not in a sibling
    // `node_modules/.bin`, so the branch above never fires for it. The script Bun
    // reports is `<prefix>/lib/node_modules/cogmem/dist/bin/cogmem.js`; walking up
    // four levels lands on `lib`, and the shim is beside it. Without this the
    // resolver gave up on an install that was sitting right there (#94).
    const above = dirname(dirname(dirname(dirname(dir))));
    const prefix = basename(above) === 'lib' ? dirname(above) : above;
    if (existsSync(join(prefix, 'bin', 'cogmem'))) return join(prefix, 'bin');
  }

  let launchedFile: string;
  try {
    launchedFile = realpathSync(script);
  } catch {
    return undefined;
  }
  for (const entry of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(resolve(entry), 'cogmem');
    if (!existsSync(candidate)) continue;
    try {
      if (realpathSync(candidate) === launchedFile) return resolve(entry);
    } catch {
      // Ignore an invalid PATH entry and continue looking for the launcher.
    }
  }
  return undefined;
}

/**
 * The managed launcher: one per user, at a path no installation owns.
 *
 * Configurations written from here point here and never at an installation. This
 * path does not move when the installation does — an npm prefix change, a moved
 * checkout, a different package manager and an upgrade all leave it valid —
 * because the installation is resolved when the launcher runs, not when it is
 * written.
 *
 * That is the whole difference from what #86, #94 and #96 were symptoms of: an
 * installation's absolute path was baked into the artifacts written from it, so
 * each of those moves broke the integration, and the answer each time was to
 * notice harder instead of to stop writing the path.
 */
export function cogmemLauncherDir(env: Record<string, string | undefined> = process.env): string {
  return env.COGMEM_LAUNCHER_DIR?.trim() || join(env.HOME || homedir(), '.cogmem', 'bin');
}

export function cogmemLauncherPath(env: Record<string, string | undefined> = process.env): string {
  return join(cogmemLauncherDir(env), 'cogmem');
}

export function cogmemLauncherRecordPath(env: Record<string, string | undefined> = process.env): string {
  return join(cogmemLauncherDir(env), 'cogmem.target');
}

export function hasCogmemLauncher(env: Record<string, string | undefined> = process.env): boolean {
  return existsSync(cogmemLauncherPath(env));
}

/** The recorded installation, when it still exists and can be executed. */
export function readCogmemLauncherTarget(env: Record<string, string | undefined> = process.env): string | undefined {
  const recorded = readCogmemLauncherRecord(env)[0];
  if (!recorded || recorded === cogmemLauncherPath(env)) return undefined;
  return isExecutableFile(recorded) ? recorded : undefined;
}

/**
 * The runtime directory recorded beside the installation.
 *
 * An installed `cogmem` is a launcher for a runtime — npm writes a shim that runs
 * `bun` — so the installation is not runnable on its own. A process launching it
 * from an environment whose PATH does not contain that runtime needs this (#94).
 * The launcher owns the runtime instead, and the configuration written from here
 * stops needing it.
 */
export function readCogmemLauncherRuntime(env: Record<string, string | undefined> = process.env): string | undefined {
  const recorded = readCogmemLauncherRecord(env)[1];
  return recorded && isDirectory(recorded) ? recorded : undefined;
}

function readCogmemLauncherRecord(env: Record<string, string | undefined>): [string | undefined, string | undefined] {
  let lines: string[];
  try {
    lines = readFileSync(cogmemLauncherRecordPath(env), 'utf8').split('\n');
  } catch {
    return [undefined, undefined];
  }
  const target = lines[0]?.trim() || undefined;
  const runtime = lines[1]?.trim() || undefined;
  return [target, runtime];
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Point the managed launcher at an installation, creating it if needed.
 *
 * Returns undefined when there is nothing to point at — a source checkout run
 * through `src/bin/*.ts` has no installed launcher of its own — in which case no
 * launcher is written and the caller keeps the invocation it already had.
 */
export function writeCogmemLauncher(options: {
  env?: Record<string, string | undefined>;
  target: string | undefined;
  runtimeDir?: string;
}): { launcher: string; target: string; runtimeDir?: string } | undefined {
  const env = options.env ?? process.env;
  const target = options.target;
  if (!target || target === 'cogmem' || !isExecutableFile(target)) return undefined;
  const launcher = cogmemLauncherPath(env);
  if (resolve(target) === resolve(launcher)) return undefined;
  const runtimeDir = options.runtimeDir && isDirectory(options.runtimeDir) ? options.runtimeDir : undefined;
  mkdirSync(cogmemLauncherDir(env), { recursive: true });
  writeFileSync(cogmemLauncherRecordPath(env), `${target}\n${runtimeDir ?? ''}\n`);
  writeFileSync(launcher, renderCogmemLauncher());
  chmodSync(launcher, 0o755);
  return { launcher, target, runtimeDir };
}

/**
 * The launcher's source. POSIX `sh`, no bashisms: it is run with whatever a
 * caller has, and one of them runs it with an empty PATH.
 */
export function renderCogmemLauncher(): string {
  return `#!/bin/sh
# Cog launcher, written by \`cogmem init\`. Do not edit.
#
# Configurations written from here point at this file rather than at an
# installation, because this path does not move when the installation does.
# Everything an installation needs is resolved here, when this runs:
#   1. the runtime directory recorded beside this file, so a caller whose PATH has
#      no runtime on it can still run an installed CLI that is a launcher for one;
#   2. $COGMEM_BIN, when an operator has set one;
#   3. the installation recorded beside this file (cogmem.target, its first line);
#   4. the first \`cogmem\` on PATH that is not this file.
# Finding none is reported and exits 127; it never runs something else.
#
# Only shell builtins are used to find this file and read its record: the launcher
# can be run with a PATH that has nothing on it, which is the situation #94 was
# about, and \`dirname\` or \`cat\` missing there would break the launcher rather than
# the installation.
set -u
self=$0
case "$self" in
  */*) launcher_dir=\${self%/*} ;;
  *) launcher_dir=. ;;
esac
launcher_dir=$(cd "$launcher_dir" && pwd) || launcher_dir=\${self%/*}
self="$launcher_dir/cogmem"

recorded=""
runtime=""
if [ -r "$launcher_dir/cogmem.target" ]; then
  { IFS= read -r recorded; IFS= read -r runtime; } < "$launcher_dir/cogmem.target" || true
fi

if [ -n "$runtime" ] && [ -d "$runtime" ]; then PATH="$runtime:$PATH"; export PATH; fi

if [ -n "\${COGMEM_BIN:-}" ] && [ -x "\${COGMEM_BIN}" ]; then exec "\${COGMEM_BIN}" "$@"; fi

target=""
case "$recorded" in
  ""|"$self") ;;
  *) if [ -x "$recorded" ]; then target="$recorded"; fi ;;
esac

if [ -z "$target" ]; then
  IFS=:
  set -f
  for dir in $PATH; do
    if [ -n "$dir" ] && [ "$dir" != "$launcher_dir" ] && [ -x "$dir/cogmem" ]; then
      target="$dir/cogmem"
      break
    fi
  done
  unset IFS
  set +f
fi

if [ -z "$target" ]; then
  echo "cogmem: this launcher found no installation to run." >&2
  echo "cogmem: re-run \`cogmem init\`, or set COGMEM_BIN, then try again." >&2
  exit 127
fi
exec "$target" "$@"
`;
}

function isExecutableFile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * How to invoke this CLI in a command that is about to be printed into a
 * configuration.
 *
 * The absolute launcher when the CLI is installed but its directory is not on
 * `PATH`: a printed step that says `cogmem` on a machine where `cogmem` does not
 * resolve is a step that fails the moment it is pasted. The bare name when it
 * does resolve, so nothing bakes a machine-specific path into a config that
 * outlives this checkout (ADR-0010, #78).
 *
 * One function because four commands had four answers: `doctor` printed an
 * absolute path unconditionally, one printed a literal project-local
 * `.bin/cogmem` path that exists only in a JS project with a local dependency,
 * `init --json` printed the bin *directory*, and an integration wrote a bare
 * `cogmem` into a config on machines where it was not on `PATH`.
 */
export function resolveCogmemInvocation(
  env: Record<string, string | undefined> = process.env,
  argv1: string | undefined = process.argv[1],
): string {
  // An operator who names the binary means it, for the printed steps as much as
  // for a printed step. Honouring it here is what makes this *the* answer
  // rather than a fifth one that agrees only when nothing is set.
  const explicit = env.COGMEM_BIN?.trim();
  if (explicit) return explicit;
  // The managed launcher next, and before any path this installation owns: it is the
  // one entry that survives an upgrade, a moved checkout, a changed npm prefix and a
  // different package manager, which is exactly what a host configuration outlives
  // (#114). An operator who has no launcher gets the previous answer, unchanged.
  if (hasCogmemLauncher(env)) return cogmemLauncherPath(env);
  const installation = resolveCogmemInstallation(env, argv1);
  if (!installation) return 'cogmem';
  return isOnPath(dirname(installation), env) ? 'cogmem' : installation;
}

/**
 * The installed launcher this process is running from, when it is running from one.
 *
 * A source checkout run through `src/bin/*.ts` has none, and undefined is the honest
 * answer there: there is nothing for a host configuration to point at.
 */
export function resolveCogmemInstallation(
  env: Record<string, string | undefined> = process.env,
  argv1: string | undefined = process.argv[1],
): string | undefined {
  const binDir = resolveCliBinDir(argv1, env);
  if (!hasInstalledLauncher(binDir)) return undefined;
  return join(binDir, 'cogmem');
}

/** Point the managed launcher at this installation, if it is one. */
export function ensureCogmemLauncher(
  env: Record<string, string | undefined> = process.env,
  argv1: string | undefined = process.argv[1],
): { launcher: string; target: string; runtimeDir?: string } | undefined {
  // The runtime this process is running under is the runtime the installation needs,
  // recorded once here instead of in every host configuration (#114).
  return writeCogmemLauncher({
    env,
    target: resolveCogmemInstallation(env, argv1),
    runtimeDir: dirname(process.execPath),
  });
}

/**
 * Whether a directory actually holds the CLI launcher. One predicate because
 * "is this an installation" was being spelled out wherever it was asked.
 */
export function hasInstalledLauncher(binDir: string | undefined): binDir is string {
  return Boolean(binDir && existsSync(join(binDir, 'cogmem')));
}

export function isOnPath(dir: string, env: Record<string, string | undefined> = process.env): boolean {
  const pathValue = env.PATH ?? '';
  return pathValue.split(':').filter(Boolean).some((entry) => resolve(entry) === resolve(dir));
}

/**
 * The one wording for "the CLI is not on PATH", used by the installer and the
 * gate so a person and an agent are told the same thing.
 */
export function pathWarningSteps(binDir: string): InstallStep[] {
  return [
    {
      id: 'fix_path',
      actor: 'operator',
      safeForAutomation: false,
      command: `export PATH="${binDir}:$PATH"`,
      when: 'now, and in your shell profile if you want it to persist',
      purpose: 'put the cogmem CLI on PATH so `cogmem` resolves without an absolute path',
    },
    {
      id: 'use_absolute_bin',
      actor: 'agent',
      safeForAutomation: true,
      command: `${resolve(binDir)}/cogmem`,
      when: 'instead of fixing PATH',
      purpose: 'call the CLI by absolute path; do not depend on PATH being set',
    },
  ];
}
