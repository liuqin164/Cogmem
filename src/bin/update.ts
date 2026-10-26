#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hostWorkspaceFor, loadCogmemConfig, resolveCogmemConfigPath, type LoadedCogmemConfig } from '../config/CogmemConfig.js';
import { inspectOpenClawAutoMemoryPlugin } from '../host/openclaw/AutoMemoryPluginInstaller.js';
import { printCliJson } from './CliJson.js';
import { DEFAULT_NPM_PACKAGE, resolveLatestNpmSpec } from './update-release.js';
import {
  buildGate,
  defaultHermesConfigPath,
  hermesIntegrationEstablished,
  installPathSteps,
  pendingHostIntegration,
  postInstallSteps,
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
  skipAgentRefresh: boolean;
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
    skipAgentRefresh: values['skip-agent-refresh'] === true,
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

function buildCommand(target: UpdateTarget, spec: string): string[] {
  if (target.kind === 'npm_global') {
    const prefix = npmGlobalPrefix();
    return prefix
      ? ['npm', 'install', '-g', '--prefix', prefix, `cogmem@${spec}`]
      : ['npm', 'install', '-g', `cogmem@${spec}`];
  }
  const manager = target.manager;
  if (manager === 'bun') return ['bun', 'add', `cogmem@${spec}`];
  if (manager === 'pnpm') return ['pnpm', 'add', `cogmem@${spec}`];
  return ['npm', 'install', `cogmem@${spec}`];
}

function localCogmemBin(cwd: string): string {
  return join(cwd, 'node_modules', '.bin', 'cogmem');
}

function buildOpenClawRepairExecForTarget(target: UpdateTarget, configPath: string, workspaceRoot: string): string[] {
  return [
    target.bin,
    'doctor',
    '--fix',
    '--agent',
    'openclaw',
    '--plugin-only',
    '--config',
    configPath,
    '--workspace',
    workspaceRoot,
  ];
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
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
} | undefined {
  const packagePath = join(cwd, 'package.json');
  if (!existsSync(packagePath)) return undefined;
  return JSON.parse(readFileSync(packagePath, 'utf8'));
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
  if (args.global || isLikelyNpmGlobalInstall(env)) {
    return { cwd, kind: 'npm_global', manager: 'npm', bin: 'cogmem' };
  }
  if (args.installHome) {
    const targetCwd = args.installHome;
    return { cwd: targetCwd, kind: 'install_home', manager: args.manager || detectManager(targetCwd), bin: localCogmemBin(targetCwd) };
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
 * The Workspace `update` should repair, or `undefined` when OpenClaw was never
 * wired.
 *
 * The recorded switch is read first and the artifacts second: a host wired before
 * `connect` began recording itself has no switch, and `update` declining to
 * maintain files that are visibly on disk is the defect ADR-0010 names. The
 * Workspace is derived, so the repair refreshes the one integration `connect`
 * wrote rather than adding a second one under the config directory.
 */
function openClawWorkspaceForUpdate(loaded: LoadedCogmemConfig | undefined): string | undefined {
  if (!loaded) return undefined;
  const workspaceRoot = hostWorkspaceFor(loaded, 'openclaw');
  if (loaded.integrations.openclaw.enabled) return workspaceRoot;
  return inspectOpenClawAutoMemoryPlugin({ workspaceRoot }).installed ? workspaceRoot : undefined;
}

async function runCommand(cmd: string[], cwd: string): Promise<number> {
  const proc = Bun.spawn({
    cmd,
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return proc.exited;
}

/**
 * Run a step whose own chatter must not land inside a JSON document.
 *
 * `--json` promises one object on stdout. A step that inherits stdout writes its
 * progress in front of it — the OpenClaw repair prints `OK configuration parsed`
 * — and the result is unparseable for the agent that asked for JSON.
 */
async function runCommandViaStderr(cmd: string[], cwd: string): Promise<number> {
  const captured = await runCommandCapture(cmd, cwd);
  if (captured.stdout) process.stderr.write(captured.stdout);
  if (captured.stderr) process.stderr.write(captured.stderr);
  return captured.exitCode;
}

async function runCommandCapture(cmd: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({ cmd, cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const resolvedSpec = args.from === 'latest'
    ? resolveLatestNpmSpec({ env: process.env })
    : args.from;
  const target = resolveUpdateTarget(args, process.env);
  if (!args.dryRun && target.kind === 'source_checkout' && !args.localDev) {
    throw new Error('Refusing to update the Cogmem source checkout. Pass --local-dev for an intentional development update, --global for npm global, or --install-home <dir> for the one-line installer home.');
  }
  if (!args.dryRun && target.kind === 'cwd_fallback') {
    throw new Error('Unable to find an installed Cogmem package to update. Pass --global for npm global installs or --install-home <dir> for the one-line installer home.');
  }
  const manager = target.manager;
  const command = buildCommand(target, resolvedSpec);
  const config = loadConfigForUpdate(args, target.cwd);
  const openclawWorkspace = openClawWorkspaceForUpdate(config.loaded);
  const openclawRepairExec = !args.skipAgentRefresh && openclawWorkspace && config.configPath
    ? buildOpenClawRepairExecForTarget(target, config.configPath, openclawWorkspace)
    : undefined;
  const restartRequired = [
    ...(openclawWorkspace ? ['restart OpenClaw gateway or agent host'] : []),
    ...(config.loaded?.integrations.hermes.enabled ? ['reload Hermes MCP server or restart the Hermes agent host'] : []),
  ];
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
    nextCommand: command.join(' '),
    updateWarning: target.warning,
    configPath: config.configPath,
    openclawRepairCommand: openclawRepairExec?.join(' '),
    openclawRepairSkippedReason: openclawRepairExec
      ? undefined
      : (args.skipAgentRefresh ? 'skip_agent_refresh_flag' : (openclawWorkspace ? undefined : 'openclaw_not_configured')),
    // The other Host, reported rather than silently absent: `update` has no repair
    // path for Hermes because it generates nothing there, and "we did not touch it"
    // is a reason a reader is entitled to (#81).
    hermesMaintenanceSkippedReason: config.loaded?.integrations.hermes.enabled
      ? (args.skipAgentRefresh ? 'skip_agent_refresh_flag' : 'hermes_has_no_generated_artifacts')
      : undefined,
    restartRequired,
    followUp: restartRequired.length > 0
      ? `After update finishes, ${restartRequired.join('; ')}.`
      : 'After update finishes, restart any running agent host so it loads the new Cogmem CLI.',
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
    // Only what is outstanding, and only the Host it belongs to: `update` runs on a
    // machine whose integration already exists, so recommending `connect` again
    // would be the gate repeating itself (#81).
    const connectHost = pendingHostIntegration([
      { host: 'openclaw', wanted: config.loaded.integrations.openclaw.enabled, established: Boolean(openclawWorkspace) },
      {
        host: 'hermes',
        wanted: config.loaded.integrations.hermes.enabled,
        established: hermesIntegrationEstablished(defaultHermesConfigPath(process.env)),
      },
    ]);
    const connectWorkspace = connectHost ? hostWorkspaceFor(config.loaded, connectHost) : (openclawWorkspace ?? config.loaded.workspaceRoot);
    result.nextSteps = postInstallSteps(gateBin, connectWorkspace, connectHost);
  } else {
    result.nextSteps = installPathSteps(gateBin).filter((step) => step.id !== 'install_gate');
  }
  result.postUpdateGateCommand = gateArgs(...(args.json ? ['--json'] : [])).join(' ');

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
    if (result.openclawRepairCommand) console.log(`openclaw: ${result.openclawRepairCommand}`);
    console.log(result.followUp);
    if (args.dryRun) console.log(`Post-update gate: ${result.postUpdateGateCommand}`);
  }

  if (!args.dryRun) {
    const runStep = args.json ? runCommandViaStderr : runCommand;
    const updateExitCode = await runStep(command, target.cwd);
    if (updateExitCode !== 0) process.exit(updateExitCode);
    if (openclawRepairExec) {
      const repairExitCode = await runStep(openclawRepairExec, process.cwd());
      if (repairExitCode !== 0) process.exit(repairExitCode);
    }

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
      printCliJson('update', result);
      process.exit(Math.max(gateRun.exitCode, result.installGate?.exitCode ?? 1));
    }

    process.exit(await runCommand(gateArgs(), gateCwd));
  }
}

main().catch((error) => {
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
