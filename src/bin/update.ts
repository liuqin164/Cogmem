#!/usr/bin/env bun
import { emitRefusalDocument } from './RefusalDocument.js';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCogmemConfig, resolveCogmemConfigPath, type LoadedCogmemConfig } from '../config/CogmemConfig.js';
import { appendUpdateTrace, type UpdateTraceEntry } from '../install/AutoUpgrade.js';
import {
  readResidentSessions,
  resolveResidentSessionDir,
  startResidentProcess,
  stopResidentProcess,
  type ResidentActionResult,
  type ResidentProcessRunner,
} from '../install/ResidentSession.js';
import { compareVersions, fetchLatestVersion, loadUpdateSettings, type UpdateSettings } from '../install/VersionCheck.js';
import { assertCliArgs } from './CliArgs.js';
import { printCliJson } from './CliJson.js';
import { DEFAULT_NPM_PACKAGE, resolveLatestNpmSpec } from './update-release.js';
import {
  buildGate,
  installPathSteps,
  resolveCogmemInvocation,
  type InstallGate,
  type InstallStep,
} from '../install/InstallSteps.js';

interface UpdateArgs {
  dryRun: boolean;
  yes: boolean;
  json: boolean;
  from: string;
  installHome?: string;
  global: boolean;
  localDev: boolean;
  manager?: 'bun' | 'npm' | 'pnpm';
  configPath?: string;
  /**
   * Swap and verify without stopping or starting the resident service (#150).
   * This is the unattended form: an automatic upgrade stages, and a service
   * manager owns the restart.
   */
  stageOnly: boolean;
}

function readArgs(argv: string[]): UpdateArgs {
  const values: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const next = argv[index + 1];
    const key = item.slice(2);
    if (!next || next.startsWith('--')) {
      values[key] = true;
      continue;
    }
    values[key] = next;
    index += 1;
  }
  const manager = values.manager === 'npm' || values.manager === 'pnpm' || values.manager === 'bun'
    ? values.manager
    : undefined;
  return {
    dryRun: values['dry-run'] === true || values.yes !== true,
    yes: values.yes === true,
    json: values.json === true,
    from: typeof values.from === 'string' ? values.from : 'latest',
    installHome: typeof values['install-home'] === 'string' ? values['install-home'] : undefined,
    global: values.global === true,
    localDev: values['local-dev'] === true,
    manager,
    configPath: typeof values.config === 'string' ? values.config : undefined,
    stageOnly: values['stage-only'] === true,
  };
}

function detectManager(cwd: string): 'bun' | 'npm' | 'pnpm' {
  if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))) return 'bun';
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  return 'npm';
}

interface UpdateTarget {
  cwd: string;
  kind: 'install_home' | 'local_project' | 'npm_global' | 'source_checkout' | 'cwd_fallback';
  manager: 'bun' | 'npm' | 'pnpm';
  bin: string;
  warning?: string;
}

/**
 * The prefix that owns this installation, when it is a global npm one.
 *
 * A global install lives at `<prefix>/lib/node_modules/cogmem` (or `<prefix>/node_modules`
 * on Windows). A bare `npm install -g` targets npm's *configured* default instead, which is
 * a different tree whenever the install used `--prefix`: the operator updates one copy and
 * keeps running another, or gets EACCES naming a path they never chose (#89). The running
 * copy's own location is the only reliable statement of where it is, so it is derived
 * rather than guessed. `COGMEM_NPM_PREFIX` overrides it for a layout that does not match.
 */
function npmGlobalPrefix(env: Record<string, string | undefined> = process.env): string | undefined {
  const explicit = env.COGMEM_NPM_PREFIX?.trim();
  if (explicit) return explicit;
  const root = ownPackageRoot();
  const marker = `${sep}node_modules${sep}cogmem`;
  const index = root.indexOf(marker);
  if (index === -1) return undefined;
  // Strip `/lib` too when present: npm's posix layout is `<prefix>/lib/node_modules`.
  const before = root.slice(0, index);
  return before.endsWith(`${sep}lib`) ? before.slice(0, -`${sep}lib`.length) : before;
}

/**
 * Quote one argument so the printed command runs as printed.
 *
 * `nextCommand` is a string an operator copies into a shell, so a prefix containing a
 * space has to survive the copy. Same rule the factory uses for the commands it prints.
 */
function shellQuoteArg(value: string): string {
  // Only quote what a shell would otherwise split or expand, so the common command still
  // reads as `npm install -g --prefix /usr/local cogmem@4.0.0`.
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/gu, `'\\''`)}'`;
}

function buildCommand(target: UpdateTarget, spec: string): string[] {
  if (target.kind === 'npm_global') {
    // No fallback to a bare `npm install -g`: that targets npm's *configured* default
    // prefix, which is a different tree whenever the install used `--prefix`. Updating a
    // copy the operator does not run, or failing on a path they never chose, are both
    // worse than saying the prefix is unknown (#89).
    const prefix = npmGlobalPrefix();
    if (!prefix) {
      throw new Error(
        'Unable to determine the npm prefix that owns this installation, so `update` will not '
        + 'guess. Set COGMEM_NPM_PREFIX to that prefix (for example COGMEM_NPM_PREFIX=/usr/local), '
        + 'or run the install yourself: npm install -g --prefix <prefix> cogmem@<version>.',
      );
    }
    return ['npm', 'install', '-g', '--prefix', prefix, `cogmem@${spec}`];
  }
  const manager = target.manager;
  if (manager === 'bun') return ['bun', 'add', `cogmem@${spec}`];
  if (manager === 'pnpm') return ['pnpm', 'add', `cogmem@${spec}`];
  return ['npm', 'install', `cogmem@${spec}`];
}

function localCogmemBin(cwd: string): string {
  return join(cwd, 'node_modules', '.bin', 'cogmem');
}

function installedSpec(cwd: string): string | undefined {
  const manifest = readPackageManifest(cwd);
  if (!manifest) return undefined;
  return manifest.dependencies?.['cogmem']
    || manifest.devDependencies?.['cogmem']
    || manifest.optionalDependencies?.['cogmem']
    || manifest.dependencies?.['@CognitiveOS/core']
    || manifest.devDependencies?.['@CognitiveOS/core']
    || manifest.optionalDependencies?.['@CognitiveOS/core'];
}

function readPackageManifest(cwd: string): {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
} | undefined {
  const packagePath = join(cwd, 'package.json');
  if (!existsSync(packagePath)) return undefined;
  // Tolerant, because this is also how the version a rollback must restore is read:
  // a manifest a half-finished install truncated should not throw out of `update`.
  try {
    return JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch {
    return undefined;
  }
}

function defaultInstallHome(env: Record<string, string | undefined>): string {
  return env.COGMEM_INSTALL_HOME || join(env.HOME || homedir(), '.cogmem', 'pkg');
}

function shouldUpdateCwd(cwd: string): boolean {
  const manifest = readPackageManifest(cwd);
  return manifest?.name === 'cogmem' || installedSpec(cwd) !== undefined;
}

function isCogmemSourceCheckout(cwd: string): boolean {
  const manifest = readPackageManifest(cwd);
  return manifest?.name === 'cogmem'
    && existsSync(join(cwd, 'src', 'bin', 'update.ts'))
    && existsSync(join(cwd, '.git'));
}

function ownPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function isLikelyNpmGlobalInstall(env: Record<string, string | undefined>): boolean {
  if (env.COGMEM_INSTALL_KIND === 'npm_global') return true;
  const root = ownPackageRoot();
  const marker = `${sep}node_modules${sep}cogmem`;
  if (!root.includes(marker)) return false;
  const cwd = resolve(process.cwd());
  return !cwd.startsWith(root + sep);
}

function resolveUpdateTarget(args: UpdateArgs, env: Record<string, string | undefined>): UpdateTarget {
  const cwd = process.cwd();
  // An explicit `--install-home` is the operator naming the tree, so it is answered
  // before the heuristic guesses. It used to be checked second, and
  // `isLikelyNpmGlobalInstall` fires whenever the running package lives under a
  // `node_modules/cogmem` — which is every npm-installed copy — so the flag was
  // ignored on exactly the installs it exists for, and the run answered
  // `Executable not found in $PATH: "cogmem"` (#150, found by the box cycle).
  if (args.installHome) {
    const targetCwd = args.installHome;
    return { cwd: targetCwd, kind: 'install_home', manager: args.manager || detectManager(targetCwd), bin: localCogmemBin(targetCwd) };
  }
  if (args.global || isLikelyNpmGlobalInstall(env)) {
    return { cwd, kind: 'npm_global', manager: 'npm', bin: 'cogmem' };
  }
  if (isCogmemSourceCheckout(cwd)) {
    return {
      cwd,
      kind: 'source_checkout',
      manager: args.manager || detectManager(cwd),
      bin: localCogmemBin(cwd),
      warning: args.localDev ? undefined : 'source_checkout_requires_local_dev_for_write',
    };
  }
  if (shouldUpdateCwd(cwd)) {
    return { cwd, kind: 'local_project', manager: args.manager || detectManager(cwd), bin: localCogmemBin(cwd) };
  }

  const installHome = defaultInstallHome(env);
  if (existsSync(join(installHome, 'package.json'))) {
    return { cwd: installHome, kind: 'install_home', manager: args.manager || detectManager(installHome), bin: localCogmemBin(installHome) };
  }
  return {
    cwd,
    kind: 'cwd_fallback',
    manager: args.manager || detectManager(cwd),
    // The only shape whose `localCogmemBin` path is fabricated: nothing was found
    // to update, so `<cwd>/node_modules/.bin/cogmem` is a guess. Print the command
    // this machine actually resolves instead (#78); a real run refuses anyway.
    bin: resolveCogmemInvocation(),
    warning: 'no_install_home_or_project_dependency_detected',
  };
}

/**
 * Resolve the config this update is about.
 *
 * The search starts at the *target* install, not at the caller's directory: an
 * operator who runs `cogmem update --install-home <dir>` from somewhere else is
 * asking about that install, and resolving from the caller's cwd finds another
 * project's config, or the developer machine's, or none at all (#62).
 */
function loadConfigForUpdate(args: UpdateArgs, targetCwd: string): { configPath?: string; loaded?: LoadedCogmemConfig; skippedReason?: string } {
  const resolution = resolveCogmemConfigPath({ configPath: args.configPath, cwd: targetCwd });
  if (resolution.kind === 'missing') {
    return { configPath: undefined, skippedReason: `missing_config:${resolution.path}` };
  }
  const loaded = loadCogmemConfig({ configPath: resolution.path });
  const error = loaded.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (error) {
    throw new Error(`config_error:${error.code}: ${error.message}`);
  }
  return { configPath: resolution.path, loaded };
}

/**
 * Run one step and answer with its exit code.
 *
 * A command that cannot even be spawned — the new package installed but shipped no
 * bin, or the manager is not on PATH — is a *failed step*, not an exception. Letting
 * the spawn error escape skipped the rollback and left the service stopped on a
 * broken tree, which is the one outcome the abort safety exists to prevent (found on
 * the box: `--from` a package whose `.bin/cogmem` is missing, #150). 127 is the shell's
 * own "command not found", so the callers' `!== 0` branches do the right thing for
 * free.
 */
async function runCommand(cmd: string[], cwd: string): Promise<number> {
  try {
    const proc = Bun.spawn({
      cmd,
      cwd,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    return await proc.exited;
  } catch (error) {
    console.error(`FAIL could not run ${cmd[0]}: ${error instanceof Error ? error.message : String(error)}`);
    return 127;
  }
}

/**
 * Run a step whose own chatter must not land inside a JSON document.
 *
 * `--json` promises one object on stdout. A step that inherits stdout writes its
 * progress in front of it — the post-update gate prints `OK configuration parsed`
 * — and the result is unparseable for the agent that asked for JSON.
 */
async function runCommandViaStderr(cmd: string[], cwd: string): Promise<number> {
  const captured = await runCommandCapture(cmd, cwd);
  if (captured.stdout) process.stderr.write(captured.stdout);
  if (captured.stderr) process.stderr.write(captured.stderr);
  return captured.exitCode;
}

async function runCommandCapture(cmd: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const proc = Bun.spawn({ cmd, cwd, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  } catch (error) {
    // Same contract as `runCommand`: a step that could not start is a step that
    // failed, and the gate branch below turns a non-zero code into the rollback.
    return {
      stdout: '',
      stderr: `could not run ${cmd[0]}: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 127,
    };
  }
}

function usage(): string {
  return [
    'Usage: cogmem update [dry-run] [--json] [--manager npm|bun] [--prefix <dir>]',
    '         [--workspace <dir>] [--config <config.toml>] [--global|--local-dev] [--yes] [--stage-only]',
    '',
    'Reports the command that updates this installation, or runs it with `dry-run` first.',
    '--stage-only swaps and verifies without stopping or starting the resident process;',
    'the service keeps serving the old version until it is restarted.',
  ].join('\n');
}

async function main(): Promise<void> {
  assertCliArgs(process.argv.slice(2), { usage: usage(), extraFlags: ['config', 'json', 'prefix', 'workspace', 'dry-run', 'yes', 'install-home', 'manager', 'from', 'local-dev', 'global', 'check-tools', 'no-gate', 'stage-only'] });
  const args = readArgs(process.argv.slice(2));
  const resolvedSpec = args.from === 'latest'
    ? resolveLatestNpmSpec({ env: process.env })
    : args.from;
  const target = resolveUpdateTarget(args, process.env);
  if (!args.dryRun && target.kind === 'source_checkout' && !args.localDev) {
    throw new Error('Refusing to update the Cog source checkout. Pass --local-dev for an intentional development update, --global for npm global, or --install-home <dir> for the one-line installer home.');
  }
  if (!args.dryRun && target.kind === 'cwd_fallback') {
    throw new Error('Unable to find an installed Cog package to update. Pass --global for npm global installs or --install-home <dir> for the one-line installer home.');
  }
  const manager = target.manager;
  let command: string[] | undefined;
  let prefixUnknownReason: string | undefined;
  try {
    command = buildCommand(target, resolvedSpec);
  } catch (error) {
    if (!args.dryRun) throw error;
    // A dry run is exactly when an operator wants to know this, so it reports rather than
    // exits — and it must not print a command it would then refuse to run.
    prefixUnknownReason = error instanceof Error ? error.message : String(error);
  }
  const config = loadConfigForUpdate(args, target.cwd);

  // #150: the resident process this update takes through stop → swap → migrate →
  // start, and the version a failed migration rolls back to. `--stage-only` is the
  // unattended half: swap and verify, leave the process serving what it loaded, and
  // let the service manager own the restart.
  const settings = loadUpdateSettings({ env: process.env, configPath: config.configPath });
  const sessionDir = resolveResidentSessionDir({
    configPath: config.configPath,
    workspaceRoot: config.loaded?.workspaceRoot ?? target.cwd,
  });
  // The upgrade owns the resident Memory bridge, not a stdio child: killing one of
  // those breaks a live session, and a detached replacement would be a process with
  // nobody on the other end of its pipes (#150).
  const resident = readResidentSessions(sessionDir).find((record) => record.session.transport === 'http');
  const installedBefore = readPackageManifest(packageDirForTarget(target))?.version ?? resident?.session.version;
  const runResident: ResidentProcessRunner = args.json
    ? (cmd, cwd) => runCommandViaStderr(cmd, cwd)
    : (cmd, cwd) => runCommand(cmd, cwd);

  // The same release twice is the case a maintenance timer hits, and doing nothing is
  // the right answer — without stopping and starting a working process to reach it
  // (CODING_STANDARDS: a command that runs once is idempotent). Not gated on
  // `[update] check`: that switch turns the *check* off, and the timer still has to be
  // able to answer "already current" — otherwise every firing stops the process,
  // reinstalls the same release and starts it again.
  const alreadyCurrent = !args.dryRun && resolvedSpec === 'latest'
    ? await installedVersionIsLatest(installedBefore, settings)
    : false;

  const ownsResident = !args.stageOnly && Boolean(resident);
  const lifecycle: UpdateLifecycleReport = {
    previousVersion: installedBefore,
    residentPid: resident?.session.pid,
    systemdUnit: resident?.session.systemdUnit,
    stopped: undefined,
    started: undefined,
    rollback: undefined,
    alreadyCurrent: alreadyCurrent || undefined,
  };
  /**
   * One governance line per update, with the fields every step shares filled in.
   *
   * Written here rather than at each call site because the five sites that record a
   * step had already drifted into five hand-copied field lists, which is how a
   * trace ends up with `to` set on a failure that never installed anything.
   */
  const trace = (entry: Omit<UpdateTraceEntry, 'at' | 'command' | 'from' | 'to' | 'stageOnly' | 'trigger'>): void => {
    recordUpdateTrace(config.loaded?.homeDir, {
      from: installedBefore,
      to: lifecycle.to ?? installedBefore,
      stageOnly: args.stageOnly,
      trigger: process.env.COGMEM_UPDATE_TRIGGER === 'auto' ? 'auto' : 'operator',
      ...entry,
    });
  };

  const result = {
    command: 'update',
    dryRun: args.dryRun,
    manager,
    installKind: target.kind,
    from: args.from,
    source: 'npm',
    npmPackage: DEFAULT_NPM_PACKAGE,
    packageSpec: resolvedSpec,
    targetCwd: target.cwd,
    currentSpec: target.kind === 'npm_global' ? 'npm:global' : installedSpec(target.cwd),
    nextCommand: command ? command.map(shellQuoteArg).join(' ') : undefined,
    prefixUnknown: prefixUnknownReason ? true : undefined,
    updateWarning: [target.warning, prefixUnknownReason].filter(Boolean).join(' ') || undefined,
    configPath: config.configPath,
    stageOnly: args.stageOnly,
    alreadyCurrent: alreadyCurrent || undefined,
    lifecycle,
    /* Filled only when the run fails after it has begun; the fields are absent on success. */
    status: undefined as string | undefined,
    failedStep: undefined as string | undefined,
    error: undefined as string | undefined,
    followUp: 'After update finishes, restart any running resident process so it loads the new Cog CLI.',
    installGate: undefined as InstallGate | undefined,
    nextSteps: [] as InstallStep[],
    postUpdateGateCommand: undefined as string | undefined,
    gateError: undefined as string | undefined,
  };


  // The gate runs last, so post-update verification is the same contract as a
  // fresh install rather than a second one with its own wording. A missing
  // config is "not installed", not a failure: an updater may run before setup.
  const gateBin = target.kind === 'npm_global' ? 'cogmem' : target.bin;
  // The gate has to check the install this update touched, not whatever the
  // caller's directory happens to hold. `--config` names the config this update
  // resolved, and the working directory is the target install: without both,
  // `cogmem update --install-home <dir>` run from somewhere else asked doctor
  // about a different project's config — or the developer machine's — and
  // reported OK or NOT_INSTALLED for it (#62).
  const gateCwd = target.cwd;
  const gateArgs = (...extra: string[]): string[] => [
    gateBin,
    'doctor',
    ...extra,
    ...(config.configPath ? ['--config', config.configPath] : []),
  ];
  // Reused, not retyped: ADR-0003 says the step list is defined once. The copy
  // that used to live here had already drifted from the shared list — it named
  // the first step `init` where the shared definition says `operator_init`, and
  // its wording still assumed an update could migrate something.
  if (config.configPath && config.loaded) {
    // The install is configured, so there is nothing outstanding to wire before the
    // gate runs: the post-update gate is the next step, and it is reported below.
    result.nextSteps = [];
  } else {
    result.nextSteps = installPathSteps(gateBin).filter((step) => step.id !== 'install_gate');
  }
  result.postUpdateGateCommand = gateArgs(...(args.json ? ['--json'] : [])).join(' ');

  if (alreadyCurrent) {
    // Nothing to install, and the resident service is left exactly as it is.
    if (args.json) printCliJson('update', result);
    else console.log(`cogmem update: already at ${installedBefore}; nothing to do.`);
    trace({ status: 'completed', restartRequired: false });
    process.exit(0);
  }

  if (args.dryRun && args.json) {
    // A dry run has not checked the updated install, so do not publish a
    // fabricated OK/NOT_INSTALLED gate. Name the command that will check it.
    printCliJson('update', result);
  } else if (!args.json) {
    console.log(`cogmem update ${args.dryRun ? 'dry-run' : 'running'}`);
    console.log(`target: ${result.targetCwd}`);
    if (result.updateWarning) console.log(`warning: ${result.updateWarning}`);
    console.log(`current: ${result.currentSpec || 'not listed in package.json'}`);
    console.log(`command: ${result.nextCommand}`);
    if (resident && !args.dryRun) {
      console.log(`resident: pid ${resident.session.pid}, serving ${resident.session.version}${resident.session.systemdUnit ? `, unit ${resident.session.systemdUnit}` : ''}`);
    }
    if (args.stageOnly) console.log('stage only: the resident process keeps serving the current version until it is restarted.');
    console.log(result.followUp);
    if (args.dryRun) console.log(`Post-update gate: ${result.postUpdateGateCommand}`);
  }

  if (!args.dryRun) {
    // buildCommand only returns undefined for a dry run that could not determine the
    // prefix; a real run has already thrown by then.
    if (!command) throw new Error('update command was not resolved');

    /**
     * A failure after the swap puts the previous version back and, when this run
     * owned the stop, starts it again — the ticket's abort safety: a migration that
     * fails must not leave a dead service. The error is still loud and the exit
     * code is still the failure's.
     */
    const failAndRollback = async (step: string, message: string, exitCode: number): Promise<never> => {
      const rollback = installedBefore
        ? await rollbackInstall(target, installedBefore, runResident)
        : 'no_previous_version';
      lifecycle.rollback = rollback;
      if (ownsResident && resident) {
        const restarted = await startResidentProcess(resident.session, { run: runResident, cwd: target.cwd });
        lifecycle.started = restarted.error ? 'failed' : restarted.method;
        if (restarted.error) lifecycle.rollback = `${rollback} (restart failed: ${restarted.error})`;
      }
      trace({
        status: 'failed',
        step,
        gateLevel: result.installGate?.level,
        restartRequired: ownsResident,
        error: message,
      });
      result.status = 'error';
      result.failedStep = step;
      result.error = message;
      if (args.json) {
        printCliJson('update', result);
        process.exit(exitCode || 1);
      }
      console.error(`FAIL update stopped at ${step}: ${message}`);
      console.error(`FAIL ${rollback === 'no_previous_version' ? 'no previous version was recorded, so nothing could be rolled back' : `previous version handling: ${rollback}`}`);
      process.exit(exitCode || 1);
    };

    // 1. Stop the resident service, before the package it is running from is replaced.
    //    A service that cannot be stopped aborts here, with nothing swapped and
    //    nothing lost (#150, Ryu's 停旧 → 换版 → 迁移 → 起新).
    if (ownsResident && resident) {
      const stopped = await stopResidentProcess(resident.session, { run: runResident, cwd: target.cwd });
      if (stopped.error) {
        trace({ status: 'failed', step: 'stop', restartRequired: true, error: stopped.error });
        if (args.json) {
          result.status = 'error';
          result.failedStep = 'stop';
          result.error = stopped.error;
          printCliJson('update', result);
          process.exit(1);
        }
        console.error(`FAIL update could not stop the resident process: ${stopped.error}`);
        process.exit(1);
      }
      lifecycle.stopped = stopped.method;
    }

    // 2. Swap the package.
    const updateExitCode = await runResident(command, target.cwd);
    if (updateExitCode !== 0) {
      // The manager failed on its own; whether it left a partial tree is its
      // business, and the rollback is what makes the result knowable.
      await failAndRollback('install', `package manager exited ${updateExitCode}`, updateExitCode);
    }

    // 3. Migrate and verify. The gate opens the kernel with the new version, which is
    //    what runs an additive migration, and refuses to report OK if it cannot.
    if (args.json) {
      const gateRun = await runCommandCapture(gateArgs('--json'), gateCwd);
      try {
        const gatePayload = JSON.parse(gateRun.stdout) as { installGate?: InstallGate; nextSteps?: InstallStep[] };
        if (!gatePayload.installGate) throw new Error('doctor JSON did not include installGate');
        result.installGate = gatePayload.installGate;
        result.nextSteps = gatePayload.nextSteps || [];
      } catch (error) {
        result.installGate = buildGate('fail', [{
          code: 'post_update_gate_unreadable',
          message: error instanceof Error ? error.message : String(error),
        }], []);
        result.gateError = gateRun.stderr || gateRun.stdout;
      }
      if (gateRun.exitCode !== 0 || result.installGate.level === 'fail') {
        await failAndRollback('gate', result.gateError ?? `post-update gate reported ${result.installGate.level}`, Math.max(gateRun.exitCode, result.installGate.exitCode ?? 1));
      }
    } else {
      const gateExit = await runCommand(gateArgs(), gateCwd);
      if (gateExit !== 0) await failAndRollback('gate', `post-update gate exited ${gateExit}`, gateExit);
    }

    // 4. Start the new version — end-to-end runs only. A start that fails does not
    //    roll the upgrade back: the package is installed and the database migrated,
    //    so the honest report is "installed, not running", not an old version.
    const installedAfter = readPackageManifest(packageDirForTarget(target))?.version;
    lifecycle.to = installedAfter;
    if (ownsResident && resident) {
      const started = await startResidentProcess(resident.session, { run: runResident, cwd: target.cwd });
      lifecycle.started = started.error ? 'failed' : started.method;
      if (started.error) {
        trace({
          status: 'completed',
          step: 'start',
          gateLevel: result.installGate?.level ?? 'ok',
          restartRequired: true,
          error: started.error,
        });
        if (args.json) {
          result.status = 'error';
          result.failedStep = 'start';
          result.error = started.error;
          printCliJson('update', result);
          process.exit(1);
        }
        console.error(`FAIL update installed ${installedAfter ?? 'the new version'} but could not start the service: ${started.error}`);
        console.error('Restart it by hand; the package and the database are already updated.');
        process.exit(1);
      }
    }

    trace({
      status: args.stageOnly ? 'staged' : 'completed',
      gateLevel: result.installGate?.level ?? 'ok',
      // Staging on a machine with a resident process is exactly the case that owes a
      // restart, and the state an operator reads afterwards has to say so.
      restartRequired: args.stageOnly && Boolean(resident),
    });

    if (args.json) {
      printCliJson('update', result);
      process.exit(0);
    }
    process.exit(0);
  }
}

interface UpdateLifecycleReport {
  previousVersion?: string;
  to?: string;
  residentPid?: number;
  systemdUnit?: string;
  stopped?: ResidentActionResult['method'];
  started?: ResidentActionResult['method'] | 'failed';
  /** What happened to the previous version after a failure, when there was one. */
  rollback?: string;
  alreadyCurrent?: boolean;
}

/** The directory the package manager writes the cogmem package into. */
function packageDirForTarget(target: UpdateTarget): string {
  if (target.kind !== 'npm_global') return join(target.cwd, 'node_modules', 'cogmem');
  const prefix = npmGlobalPrefix();
  if (!prefix) return join(target.cwd, 'node_modules', 'cogmem');
  // npm's posix layout is `<prefix>/lib/node_modules`; Windows drops the `lib`.
  return process.platform === 'win32'
    ? join(prefix, 'node_modules', 'cogmem')
    : join(prefix, 'lib', 'node_modules', 'cogmem');
}

/** Whether the registry's `latest` is the version already installed. */
async function installedVersionIsLatest(installed: string | undefined, settings: UpdateSettings): Promise<boolean> {
  if (!installed) return false;
  const latest = await fetchLatestVersion({
    registryUrl: settings.registryUrl,
    packageName: settings.packageName,
    timeoutMs: 1500,
  });
  return latest !== undefined && compareVersions(latest, installed) === 0;
}

/**
 * Put the previous version back through the same manager command the update used.
 *
 * Rollback by reinstall rather than by keeping a backup tree: the manager owns the
 * layout, and a directory move around it would leave the manifest and the lockfile
 * disagreeing with what is on disk. It depends on the registry still serving the
 * previous version, which is true for every published release.
 */
// ponytail: reinstall-from-registry rollback; keep a package backup if an install
// must be reversible offline.
async function rollbackInstall(
  target: UpdateTarget,
  version: string,
  runStep: (cmd: string[], cwd: string) => Promise<number>,
): Promise<string> {
  try {
    const exitCode = await runStep(buildCommand(target, version), target.cwd);
    return exitCode === 0 ? `restored ${version}` : `rollback to ${version} exited ${exitCode}`;
  } catch (error) {
    return `rollback to ${version} failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function recordUpdateTrace(
  homeDir: string | undefined,
  entry: Omit<UpdateTraceEntry, 'at' | 'command'>,
): void {
  if (!homeDir) return;
  appendUpdateTrace(homeDir, { at: Date.now(), command: 'update', ...entry });
}

main().catch((error) => {
  // Every entry that can open a database emits the same refusal document under --json; without the
  // flag the sentence on stderr is unchanged.
  if (emitRefusalDocument(error, 'update')) return;
  const message = error instanceof Error ? error.message : String(error);
  // `--json` promises one JSON document on stdout, and that includes the runs
  // that stop before the gate: a config that cannot be parsed used to produce no
  // stdout at all, so the agent that asked for JSON had to parse stderr to find
  // out what happened. The message still goes to stderr for a human watching.
  if (process.argv.includes('--json')) {
    printCliJson('update', { status: 'error', error: { message } });
  }
  console.error(message);
  process.exit(1);
});
