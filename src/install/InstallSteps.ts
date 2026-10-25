import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';

import { cliArg } from '../utils/CliArgument.js';

/**
 * The Install actor vocabulary: who carries out one install step.
 * Defined once here so the installer, `init`, `doctor`, `connect` and `update`
 * all speak the same three words. See ADR-0003.
 */
export type InstallActor = 'agent' | 'operator' | 'host';

/**
 * One install step. The shape `connect` already used, now shared: every step
 * names exactly one actor, and only `agent` steps may be `safeForAutomation`.
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

/** The subset of steps an agent may run unattended, in declaration order. */
export function automationSafeCommands(steps: InstallStep[]): string[] {
  return steps.filter((step) => step.safeForAutomation && step.actor === 'agent').map((step) => step.command);
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
 * What the gate says to do once a config exists and the kernel opened.
 *
 * `connectHost` is the Host whose integration is still outstanding, or `undefined`
 * when every Host the operator asked for is already wired — in which case the gate
 * recommends nothing, because a step list that names finished work never converges
 * (#81). The Host is a parameter rather than the literal `openclaw` so a
 * Hermes-only Workspace is told to connect Hermes.
 */
export function postInstallSteps(bin: string, workspace: string, connectHost?: HostIntegration): InstallStep[] {
  const steps: InstallStep[] = [];
  if (connectHost) {
    steps.push({
      id: 'connect_host',
      actor: 'operator',
      safeForAutomation: false,
      // The workspace is carried, not left to the caller's directory: `connect`
      // derives it by walking up, so the same step run one directory away writes a
      // second integration under a second identity (ADR-0010).
      command: `${bin} connect ${connectHost} --auto --force --workspace ${cliArg(workspace)}`,
      when: `when this ${connectHost} workspace should receive automatic recall`,
      purpose: 'install the host integration files; names the host it wires and the workspace it will write into',
    });
  }
  if (steps.length > 0) {
    steps.push({
      id: 'restart_host',
      actor: 'host',
      safeForAutomation: false,
      command: 'restart the agent host',
      when: 'after connect changed host files',
      purpose: 'reload the host so it picks up the Cogmem integration it just gained',
    });
  }
  return steps;
}

/** Host integration kinds that `connect` knows about. */
export type HostIntegration = 'openclaw' | 'hermes';

/**
 * Whether one Host's integration exists.
 *
 * A fact about files, not a preference (ADR-0010): `connect <host> --auto` is what
 * makes it true, and a Host that has been wired does not read back as unwired.
 */
export interface HostWiring {
  host: HostIntegration;
  /** The operator asked for this Host — `integrations.<host>.enabled`. */
  wanted: boolean;
  /** The integration is on disk. */
  established: boolean;
}

/** The Host a fresh machine is told about when nothing is wired anywhere. */
const PRIMARY_HOST: HostIntegration = 'openclaw';

/** The Hermes config `connect` patches. One function, so writer and reader agree. */
export function defaultHermesConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.HOME || homedir(), '.hermes', 'config.yaml');
}

/**
 * Whether a Hermes config carries a Cogmem MCP entry.
 *
 * The same predicate `connect` uses to decide whether to patch an existing entry or
 * write one: two spellings of "is this wired" is how a config becomes wired to the
 * writer and unwired to the gate, which recommends the step forever.
 */
export function hasHermesCogmemEntry(configText: string): boolean {
  return /^\s+cogmem\s*:/m.test(configText);
}

/** Whether the Hermes integration is on disk at `configPath`. */
export function hermesIntegrationEstablished(configPath: string): boolean {
  if (!existsSync(configPath)) return false;
  try {
    return hasHermesCogmemEntry(readFileSync(configPath, 'utf8'));
  } catch {
    // Unreadable is not "wired": recommending the step again is recoverable, while a
    // false positive hides a broken install.
    return false;
  }
}

/**
 * The Host the gate still has work for, or `undefined` when there is none.
 *
 * Only unsatisfied work is named (#81):
 *
 * 1. a Host the operator asked for and did not get, so a Hermes-only Workspace is
 *    told to connect Hermes rather than OpenClaw;
 * 2. otherwise, **nothing** if any Host is already wired — an integration exists on
 *    this machine, and naming another one is how the gate never converged for the
 *    operator who already has what they asked for;
 * 3. otherwise the primary Host, so a fresh machine is still told what to do.
 */
export function pendingHostIntegration(wiring: HostWiring[]): HostIntegration | undefined {
  const wanted = wiring.find((entry) => entry.wanted && !entry.established);
  if (wanted) return wanted.host;
  if (wiring.some((entry) => entry.established)) return undefined;
  const primary = wiring.find((entry) => entry.host === PRIMARY_HOST);
  return primary && !primary.established ? PRIMARY_HOST : undefined;
}

/**
 * The steps that follow `connect`, shared rather than redefined in `connect.ts`.
 * Ids and commands are the contract: the JSON field `nextSteps` and the derived
 * `nextCommands` both read this list.
 */
export function connectSteps(
  host: HostIntegration,
  bin: string,
  workspace: string,
  // The project the Host integration itself writes and reads. Passed in rather
  // than named here: a literal `openclaw` in this list is what made the printed
  // import step write into a scope the installed plugin never asks about
  // (#79, ADR-0010).
  project: string,
): InstallStep[] {
  const importCommand = host === 'openclaw' ? 'import-openclaw' : 'import-hermes';
  // The value the command was given, not a `.` of its own: a step that resolves
  // the workspace from wherever it happens to be run is the same defect the
  // resolver above exists to remove, one level down.
  const workspaceArg = ` --workspace ${cliArg(workspace)}`;
  const steps: InstallStep[] = [
    {
      id: 'doctor',
      actor: 'agent',
      safeForAutomation: true,
      command: `${bin} doctor${workspaceArg}`,
      when: 'after installation or update',
      purpose: 'verify package, config, and database access',
    },
    {
      id: 'import_dry_run',
      actor: 'agent',
      safeForAutomation: true,
      command: `${bin} ${importCommand}${workspaceArg} --project ${project} --dry-run --json`,
      when: 'before importing legacy memory',
      purpose: 'preview source discovery and import counts',
    },
    {
      id: 'import_apply',
      actor: 'agent',
      safeForAutomation: true,
      command: `${bin} ${importCommand}${workspaceArg} --project ${project} --json`,
      when: 'after dry-run looks correct',
      purpose: 'idempotently import legacy memory into Cogmem',
    },
    {
      id: 'memory_plan',
      actor: 'agent',
      safeForAutomation: true,
      command: `${bin} memory plan --project ${project} --json`,
      when: 'after import, update, or user asks for governance progress',
      purpose: 'read agent-safe next actions instead of guessing from raw counters',
    },
    {
      id: 'memory_status',
      actor: 'agent',
      safeForAutomation: true,
      command: `${bin} memory status --project ${project} --json`,
      when: 'for read-only health checks',
      purpose: 'inspect raw ledger, vector fallback, dream backlog, and queue summary',
    },
    {
      id: 'interactive_init',
      actor: 'operator',
      safeForAutomation: false,
      command: `${bin} init --agent ${host} --scope project`,
      when: 'only if no Cogmem config exists and a human operator is present',
      purpose: 'interactive first-time config wizard; agents must not run this unattended',
    },
  ];
  if (host === 'openclaw') {
    steps.splice(1, 0, {
      id: 'openclaw_diagnose',
      actor: 'agent',
      safeForAutomation: true,
      command: `${bin} openclaw diagnose${workspaceArg} --json`,
      when: 'after connect --auto --force or before investigating injection failures',
      purpose: 'verify generated plugin files, audit log, queue lock, and hook diagnostics',
    });
    steps.push({
      id: 'restart_gateway',
      actor: 'host',
      safeForAutomation: false,
      command: 'openclaw gateway restart',
      when: 'after plugin files or OpenClaw config changed',
      purpose: 'reload OpenClaw hooks so the refreshed Cogmem plugin is active',
    });
  } else {
    steps.push({
      id: 'reload_hermes',
      actor: 'host',
      safeForAutomation: false,
      command: 'restart or reload Hermes MCP server',
      when: 'after Hermes MCP config changed',
      purpose: 'reload the cogmem MCP server entry',
    });
  }
  return steps;
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
 * How to invoke this CLI in a command that is about to be printed or written into
 * a Host's configuration.
 *
 * The absolute launcher when the CLI is installed but its directory is not on
 * `PATH`: a printed step that says `cogmem` on a machine where `cogmem` does not
 * resolve is a step that fails the moment it is pasted. The bare name when it
 * does resolve, so nothing bakes a machine-specific path into a host config that
 * outlives this checkout (ADR-0010, #78).
 *
 * One function because four commands had four answers: `doctor` printed an
 * absolute path unconditionally, `connect` printed a literal project-local
 * `.bin/cogmem` path that exists only in a JS project with a local dependency,
 * `init --json` printed the bin *directory*, and `connect hermes`
 * wrote a bare `cogmem` into a config on machines where it was not on `PATH`.
 */
export function resolveCogmemInvocation(
  env: Record<string, string | undefined> = process.env,
  argv1: string | undefined = process.argv[1],
): string {
  // An operator who names the binary means it, for the printed steps as much as
  // for a host's MCP entry. Honouring it here is what makes this *the* answer
  // rather than a fifth one that agrees only when nothing is set.
  const explicit = env.COGMEM_BIN?.trim();
  if (explicit) return explicit;
  const binDir = resolveCliBinDir(argv1, env);
  if (!hasInstalledLauncher(binDir)) return 'cogmem';
  return isOnPath(binDir, env) ? 'cogmem' : join(binDir, 'cogmem');
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
