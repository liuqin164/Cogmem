#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printCliJson } from './CliJson.js';
import {
  automationSafeCommands,
  connectSteps,
  defaultHermesConfigPath,
  hasHermesCogmemEntry,
  defaultPiConfigPath,
  resolveCogmemInvocation,
  type InstallStep,
} from '../install/InstallSteps.js';
import { integrationScope } from '../host/IntegrationScope.js';
import {
  enableHostIntegration,
  hostWorkspaceFor,
  loadCogmemConfig,
  resolveCogmemConfigPath,
  resolveWorkspaceRoot,
} from '../config/CogmemConfig.js';

import {
  type OpenClawAutoMemoryInstallResult,
  installOpenClawAutoMemoryPlugin,
} from '../host/openclaw/AutoMemoryPluginInstaller.js';

type AgentKind = 'openclaw' | 'hermes' | 'pi';

/** One list, so `connect`, `init` and the gate cannot disagree about the hosts. */
const HOST_NAMES: AgentKind[] = ['openclaw', 'hermes', 'pi'];

const HERMES_COGMEM_TOOLS = [
  'cogmem_remember_turn',
  'cogmem_recall',
  'cogmem_explain_recall',
  'cogmem_strategy_plan',
  'cogmem_episode_append',
  'cogmem_episode_import',
  'cogmem_episode_status',
  'cogmem_topic_list',
  'cogmem_topic_operate',
  'cogmem_topic_rollback',
  'cogmem_episode_repair',
  'cogmem_episode_seal',
  'cogmem_dream_tick',
  'cogmem_dream_status',
  'cogmem_memory_map',
  'cogmem_graph_overview',
  'cogmem_graph_search',
  'cogmem_graph_explore',
  'cogmem_memory_frame_show',
  'cogmem_memory_frame_review',
  'cogmem_memory_dimensions',
  'cogmem_memory_query_plan',
  'cogmem_graph_node',
  'cogmem_graph_neighbors',
  'cogmem_graph_path',
  'cogmem_graph_timeline',
  'cogmem_graph_touch',
  'cogmem_candidate_review',
  'cogmem_maintenance_tick',
  'cogmem_prospective',
];

interface ConnectArgs {
  agent?: AgentKind;
  /** `connect all`: wire every host this config already enables, in one run. */
  allHosts: boolean;
  workspaceRoot: string;
  /** True when the operator named `--workspace`; then nothing may override it. */
  workspaceGiven: boolean;
  configPath?: string;
  openclawConfigPath?: string;
  hermesConfigPath?: string;
  piConfigPath?: string;
  pluginDir?: string;
  bunPath?: string;
  projectId?: string;
  agentId?: string;
  outputPath?: string;
  auto: boolean;
  dryRun: boolean;
  force: boolean;
  json: boolean;
  help: boolean;
}

interface ConnectResult {
  agent: AgentKind;
  workspaceRoot: string;
  /** The host's own workspace: the Workspace unless the config moved it (ADR-0010). */
  hostWorkspaceRoot: string;
  /** The private memory scope this integration writes and its printed steps name. */
  integrationProject: string;
  skillPath: string;
  skillFiles: string[];
  templatePath: string;
  dryRun: boolean;
  installed: boolean;
  alreadyCurrent: boolean;
  nextCommands: string[];
  nextSteps: ConnectNextStep[];
  hostConfigSnippet: string;
  autoMemory?: OpenClawAutoMemoryInstallResult;
  hermesMcp?: HermesMcpInstallResult;
  piMcp?: PiMcpInstallResult;
  /**
   * Where `connect --auto` recorded that this host is wired. `null` means it did
   * not record one (a dry run, or no config yet), not that the write failed.
   */
  integrationEnabled?: { configPath: string; changed: boolean } | null;
}

type ConnectNextStep = InstallStep;

interface HermesMcpInstallResult {
  enabled: true;
  configPath: string;
  serverCommand: string;
  serverArgs: string[];
  dryRun: boolean;
  configUpdated: boolean;
  backupPath?: string;
  /**
   * Set when an existing entry was deliberately left alone *and* the command it
   * records cannot run here. The two are different facts and only one is fine: a
   * preserved binding is somebody's choice, a preserved binding to a missing binary
   * is a host that is not wired while `connect` reports that it is (#96).
   */
  warning?: string;
}

interface PiMcpInstallResult {
  enabled: true;
  configPath: string;
  serverCommand: string;
  serverArgs: string[];
  dryRun: boolean;
  configUpdated: boolean;
  backupPath?: string;
}

/**
 * Whether a host config's `command` can be spawned from here.
 *
 * Absolute paths are checked as paths; a bare name is looked up on `PATH`, because
 * that is what the host itself will do.
 */
function commandResolves(command: string): boolean {
  if (isAbsolute(command)) return existsSync(command);
  return (process.env.PATH || '')
    .split(':')
    .some((segment) => Boolean(segment) && existsSync(join(segment, command)));
}

/** The `command` an existing `mcp_servers.cogmem` block records, if it records one. */
function existingCogmemCommand(original: string): string | undefined {
  const lines = original.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^\s+cogmem\s*:\s*$/.test(line));
  if (start === -1) return undefined;
  const indent = leadingSpaces(lines[start]);
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && leadingSpaces(line) <= indent) break;
    const match = /^\s*command\s*:\s*(.+?)\s*$/.exec(line);
    if (match) return match[1].replace(/^["']|["']$/g, '');
  }
  return undefined;
}

const CONNECT_FLAGS = new Set([
  'workspace',
  'config',
  'openclaw-config',
  'hermes-config',
  'pi-config',
  'plugin-dir',
  'bun',
  'project',
  'agent-id',
  'output',
  'auto',
  'dry-run',
  'force',
  'json',
  'help',
  'h',
]);

function readArgs(argv: string[]): ConnectArgs {
  const values: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      positionals.push(item);
      continue;
    }
    const next = argv[index + 1];
    const key = item.slice(2);
    // A silently ignored flag is how `--bun-path` left the recorded bunPath unset.
    if (!CONNECT_FLAGS.has(key)) {
      throw new Error(
        `Unknown option --${key}. Known options: ${Array.from(CONNECT_FLAGS).map((flag) => `--${flag}`).join(', ')}.`,
      );
    }
    if (!next || next.startsWith('--')) {
      values[key] = true;
      continue;
    }
    values[key] = next;
    index += 1;
  }

  const rawAgent = positionals[0];
  const allHosts = rawAgent === 'all';
  if (!allHosts && rawAgent !== undefined && !HOST_NAMES.includes(rawAgent as AgentKind)) {
    throw new Error(`Unknown host: ${rawAgent}. Expected one of ${HOST_NAMES.join(', ')}, or all.`);
  }
  const agent = rawAgent === 'openclaw' || rawAgent === 'hermes' || rawAgent === 'pi' ? rawAgent : undefined;
  const configPath = stringValue(values.config);
  // `--workspace` is the operator's override. Otherwise the Workspace is the
  // directory that contains `.cogmem/`, derived here exactly as `init`, `doctor`
  // and `update` derive it — the plugin id is a hash of this path, so a second
  // derivation is a second identity nobody can inspect (ADR-0010).
  const givenWorkspace = stringValue(values.workspace);
  const workspaceRoot = resolve(givenWorkspace || resolveWorkspaceRoot({ cwd: process.cwd(), configPath }));
  return {
    agent,
    allHosts,
    workspaceRoot,
    workspaceGiven: givenWorkspace !== undefined,
    configPath,
    openclawConfigPath: stringValue(values['openclaw-config']),
    hermesConfigPath: stringValue(values['hermes-config']),
    piConfigPath: stringValue(values['pi-config']),
    pluginDir: stringValue(values['plugin-dir']),
    bunPath: stringValue(values.bun),
    projectId: stringValue(values.project),
    agentId: stringValue(values['agent-id']),
    outputPath: stringValue(values.output),
    auto: values.auto === true,
    dryRun: values['dry-run'] === true,
    force: values.force === true,
    json: values.json === true,
    help: values.help === true || values.h === true,
  };
}

function stringValue(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}

function templatePathFor(agent: AgentKind): string {
  return join(packageRoot(), 'examples', `${agent}-backend`, 'SKILL.md');
}

function operationsTemplatePathFor(agent: AgentKind): string {
  return join(packageRoot(), 'examples', `${agent}-backend`, 'references', 'operations.md');
}

function defaultSkillPath(agent: AgentKind, workspaceRoot: string): string {
  if (agent === 'openclaw') {
    return join(workspaceRoot, 'skills', 'cogmem-memory', 'SKILL.md');
  }
  const home = process.env.HOME || homedir();
  if (agent === 'pi') {
    // The Agent Skills location, because that is the one pi actually scans. Measured
    // on a real pi: the same skill under `~/.pi/skills/` was not listed, and under
    // `~/.agents/skills/` it was.
    return join(home, '.agents', 'skills', 'cogmem-memory', 'SKILL.md');
  }
  return join(home, '.hermes', 'skills', 'cogmem-memory', 'SKILL.md');
}

function nextCommands(agent: AgentKind, workspace: string, project: string): string[] {
  return automationSafeCommands(nextSteps(agent, workspace, project));
}

function nextSteps(agent: AgentKind, workspace: string, project: string): ConnectNextStep[] {
  return connectSteps(agent, resolveCogmemInvocation(), workspace, project);
}

function usage(): string {
  return [
    'Usage: cogmem-connect <openclaw|hermes|pi|all> [--workspace <dir>] [--output <SKILL.md>] [--auto] [--config <config.toml>] [--openclaw-config <openclaw.json>] [--hermes-config <config.yaml>] [--pi-config <mcp.json>] [--plugin-dir <dir>] [--bun <path>] [--project <id>] [--agent-id <id>] [--dry-run] [--force] [--json]',
    '',
    'Installs the agent-facing cogmem memory skill bundle into:',
    '  OpenClaw: <workspace>/skills/cogmem-memory/',
    '  Hermes:   ~/.hermes/skills/cogmem-memory/',
    '  pi:       ~/.agents/skills/cogmem-memory/',
    '',
    'The bundle includes SKILL.md plus references/operations.md with import, recall, Atlas, governance, repair, and backup commands.',
    'For OpenClaw, pass --auto to install the local automatic recall/remember plugin wrapper and patch OpenClaw plugin config.',
    'For Hermes, pass --auto to patch ~/.hermes/config.yaml with a cogmem MCP server entry.',
    'For pi, pass --auto to patch ~/.pi/agent/mcp.json with the same server. --pi-config names another file.',
    'Use `all` to wire every host this config already enables in one run — the second half of `cogmem init --agent all`.',
    '--bun must be a real Bun binary (the plugin bridge imports bun:sqlite); defaults to the runtime that invoked this CLI.',
  ].join('\n');
}

function hostConfigSnippet(agent: AgentKind, workspaceRoot: string, auto: boolean, project: string): string {
  if (agent === 'openclaw') {
    if (auto) {
      return [
        '// cogmem-connect openclaw --auto installs a local OpenClaw plugin wrapper.',
        '// The wrapper registers before_prompt_build for governed recall and agent_end for turn recording.',
        '// It calls KernelAgentMemoryBackend through cogmem public API via a Bun bridge.',
        '// Restart the OpenClaw Gateway after changing plugin code, hook policy, or plugins.load.paths.',
      ].join('\n');
    }
    return [
      '// cogmem-connect does not modify OpenClaw host config.',
      '// It installs a workspace skill at <workspace>/skills/cogmem-memory/SKILL.md.',
      '// Current OpenClaw memory config is owned by OpenClaw, for example memory.backend = "builtin" | "qmd".',
      '// Do not write unknown OpenClaw config fields for cogmem.',
      '// Add host config only after installing a real OpenClaw plugin wrapper with a valid manifest/schema.',
    ].join('\n');
  }

  const mcpServer = resolveCogmemMcpServer(workspaceRoot, project);
  if (agent === 'pi') {
    return JSON.stringify({ mcpServers: { cogmem: { command: mcpServer.command, args: mcpServer.args } } }, null, 2);
  }
  return [
    'mcp_servers:',
    '  cogmem:',
    `    command: "${mcpServer.command}"`,
    `    args: ${JSON.stringify(mcpServer.args)}`,
    '    enabled: true',
    '    tools:',
    '      include:',
    ...HERMES_COGMEM_TOOLS.map((tool) => `        - ${tool}`),
  ].join('\n');
}

/**
 * The command written into a Host's MCP configuration.
 *
 * It has to resolve on the machine it was written on, so the shared resolver
 * decides it (ADR-0010, #78): a bare `cogmem` for a host whose PATH does not
 * carry it is a server entry that never starts. A workspace-local launcher, when
 * there is one, still wins — that is the version the workspace actually depends
 * on, so host and Cogmem upgrade together.
 */
function resolveCogmemMcpServer(workspaceRoot: string, project: string): { command: string; args: string[] } {
  // The server is bound to the integration's own scope: one Workspace is one
  // private memory scope, so a server that answers whatever project a caller
  // names is a Hermes integration with no scope at all (ADR-0010, #79).
  // `cogmem` takes a subcommand; the standalone `cogmem-mcp`/`COGMEM_MCP_BIN`
  // entry points are the server itself and would read a positional `mcp` as a
  // bad argument. Same binding, two shapes.
  // The Workspace travels with the entry, the way the OpenClaw plugin entry records
  // its `cwd`: `cogmem mcp` otherwise resolves its config by walking up from
  // whatever directory the host was launched in, so an entry without this works only
  // when the host happens to run inside the Workspace — Hermes elsewhere reported
  // `Connection closed` after 8.1s, and the same host from inside the Workspace
  // connected in 414ms (#86).
  const configPath = join(workspaceRoot, '.cogmem', 'config.toml');
  const bound = ['mcp', '--project', project, '--config', configPath];
  const mcpOnlyBound = ['--project', project, '--config', configPath];
  if (process.env.COGMEM_MCP_BIN) return { command: process.env.COGMEM_MCP_BIN, args: mcpOnlyBound };
  if (process.env.COGMEM_BIN) return { command: process.env.COGMEM_BIN, args: bound };
  // The documented order: an explicit override, then the workspace-local
  // launcher, then whatever this machine resolves. `cogmem-mcp` stays last as the
  // compatibility entry point for host configs written before the dispatcher.
  const workspaceCli = join(workspaceRoot, 'node_modules', '.bin', 'cogmem');
  if (existsSync(workspaceCli)) return { command: workspaceCli, args: bound };
  const resolved = resolveCogmemInvocation();
  if (isAbsolute(resolved)) return { command: resolved, args: bound };
  // Compatibility entry points, in the order they have always been tried: a
  // workspace-local `cogmem-mcp` first, then one on `PATH`.
  const workspaceMcp = join(workspaceRoot, 'node_modules', '.bin', 'cogmem-mcp');
  if (existsSync(workspaceMcp)) return { command: workspaceMcp, args: mcpOnlyBound };
  const pathValue = process.env.PATH || '';
  for (const segment of pathValue.split(':')) {
    if (!segment) continue;
    const candidate = join(segment, 'cogmem-mcp');
    if (existsSync(candidate)) return { command: candidate, args: mcpOnlyBound };
  }
  return { command: 'cogmem', args: bound };
}

function installSkill(args: ConnectArgs): ConnectResult {
  if (!args.agent) throw new Error(usage());
  return installForHost(args.agent, args);
}

function installForHost(agent: AgentKind, args: ConnectArgs): ConnectResult {
  const templatePath = templatePathFor(agent);
  const operationsTemplatePath = operationsTemplatePathFor(agent);
  for (const requiredPath of [templatePath, operationsTemplatePath]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Missing packaged skill template: ${requiredPath}`);
    }
  }

  const template = readFileSync(templatePath, 'utf8');
  const operationsTemplate = readFileSync(operationsTemplatePath, 'utf8');
  // Resolved once, so what `connect` installs into and what it records cannot be
  // two different configs.
  const cogmemConfig = resolveCogmemConfigPath({ configPath: args.configPath, cwd: args.workspaceRoot });
  // The host's own workspace: the Workspace unless the config moved it for this
  // host. `doctor` and `update` ask the same function, because the plugin id is a
  // hash of this path and two answers are two identities (ADR-0010).
  // `--workspace` wins: the operator named the directory, so a config value must
  // not silently retarget the plugin to somewhere else.
  const hostWorkspaceRoot = args.workspaceGiven || cogmemConfig.kind !== 'toml'
    ? args.workspaceRoot
    : hostWorkspaceFor(loadCogmemConfig({ configPath: cogmemConfig.path }), agent);
  // The one project this integration writes and reads. `--project` overrides it;
  // otherwise it is derived from the Workspace, so the plugin entry and the
  // printed import step cannot name two different scopes (#79).
  const integrationProject = args.projectId || integrationScope(agent, hostWorkspaceRoot);
  const skillPath = resolve(args.outputPath || defaultSkillPath(agent, hostWorkspaceRoot));
  const operationsPath = join(dirname(skillPath), 'references', 'operations.md');
  const skillFiles = [skillPath, operationsPath];
  const alreadyCurrent = existsSync(skillPath)
    && readFileSync(skillPath, 'utf8') === template
    && existsSync(operationsPath)
    && readFileSync(operationsPath, 'utf8') === operationsTemplate;
  let autoMemory: OpenClawAutoMemoryInstallResult | undefined;
  let hermesMcp: HermesMcpInstallResult | undefined;
  let piMcp: PiMcpInstallResult | undefined;

  if (!args.dryRun && !alreadyCurrent) {
    if (existsSync(skillPath) && !args.force) {
      throw new Error(`Skill already exists at ${skillPath}. Re-run with --force to overwrite.`);
    }
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(skillPath, template, 'utf8');
    mkdirSync(dirname(operationsPath), { recursive: true });
    writeFileSync(operationsPath, operationsTemplate, 'utf8');
  }

  if (agent === 'openclaw' && args.auto) {
    autoMemory = installOpenClawAutoMemoryPlugin({
      workspaceRoot: hostWorkspaceRoot,
      // Left unset when no config exists, so the installer refuses with its own
      // message instead of recording a path nothing will ever find.
      configPath: cogmemConfig.kind === 'toml' ? cogmemConfig.path : undefined,
      openclawConfigPath: args.openclawConfigPath,
      pluginDir: args.pluginDir,
      bunPath: args.bunPath,
      projectId: integrationProject,
      agentId: args.agentId,
      dryRun: args.dryRun,
      force: args.force,
    });
  } else if (agent === 'hermes' && args.auto) {
    hermesMcp = installHermesMcpConfig({
      workspaceRoot: hostWorkspaceRoot,
      configPath: args.hermesConfigPath,
      project: integrationProject,
      dryRun: args.dryRun,
      force: args.force,
    });
  } else if (agent === 'pi' && args.auto) {
    piMcp = installPiMcpConfig({
      workspaceRoot: hostWorkspaceRoot,
      configPath: args.piConfigPath,
      project: integrationProject,
      dryRun: args.dryRun,
      force: args.force,
    });
  }

  // A Host integration is a fact on disk, and this is the step that establishes
  // it: record it where the Install gate reads it, so `update` maintains what
  // `connect` wrote instead of declining because the switch still says otherwise.
  // Not a tier change — the switch stays Human-required (ADR-0003); what changes
  // is which human step records it (ADR-0010).
  // `existsSync` because an explicit `--config` is reported as `toml` whether or
  // not the file is there; recording into an absent one would throw *after* the
  // plugin and the host config were already written.
  const integrationEnabled = !args.dryRun && args.auto && cogmemConfig.kind === 'toml' && existsSync(cogmemConfig.path)
    ? enableHostIntegration(cogmemConfig.path, agent)
    : null;

  return {
    agent: agent,
    workspaceRoot: args.workspaceRoot,
    hostWorkspaceRoot,
    integrationProject,
    skillPath,
    skillFiles,
    templatePath,
    dryRun: args.dryRun,
    installed: !args.dryRun && !alreadyCurrent,
    alreadyCurrent,
    nextCommands: nextCommands(agent, hostWorkspaceRoot, integrationProject),
    nextSteps: nextSteps(agent, hostWorkspaceRoot, integrationProject),
    hostConfigSnippet: hostConfigSnippet(agent, hostWorkspaceRoot, args.auto, integrationProject),
    autoMemory,
    hermesMcp,
    piMcp,
    integrationEnabled,
  };
}

function installHermesMcpConfig(input: {
  workspaceRoot: string;
  project: string;
  configPath?: string;
  dryRun: boolean;
  force: boolean;
}): HermesMcpInstallResult {
  const configPath = resolve(input.configPath || defaultHermesConfigPath());
  const server = resolveCogmemMcpServer(resolve(input.workspaceRoot), input.project);
  const original = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const patched = patchHermesMcpConfig(original, server.command, server.args, input.project);
  const changed = patched !== original;
  let backupPath: string | undefined;

  if (!input.dryRun && (changed || input.force)) {
    mkdirSync(dirname(configPath), { recursive: true });
    if (existsSync(configPath)) {
      backupPath = `${configPath}.cogmem.bak-${Date.now()}`;
      writeFileSync(backupPath, original, 'utf8');
    }
    writeFileSync(configPath, patched, 'utf8');
  }

  // Which command the file will hold is the question, not whether the file changed:
  // a preserved entry still gets a tools list added, so `changed` is often true while
  // its command is exactly the stale one we are looking for. A command equal to the
  // one we resolved is ours; anything else was preserved, and only needs reporting
  // when it cannot run.
  const written = existingCogmemCommand(patched);
  const preserved = written && written !== server.command ? written : undefined;
  const warning = preserved && !commandResolves(preserved)
    ? `the existing mcp_servers.cogmem entry was left as it is (it names a configuration this command does not own), and its command does not exist on this machine: ${preserved}. Hermes will fail to start the server; point it at a real launcher or remove the entry.`
    : undefined;

  return {
    enabled: true,
    configPath,
    serverCommand: server.command,
    serverArgs: server.args,
    dryRun: input.dryRun,
    configUpdated: changed || input.force,
    backupPath,
    ...(warning ? { warning } : {}),
  };
}

/**
 * Write the pi MCP entry, leaving every other server in the file untouched.
 *
 * pi's file is JSON, and `pi mcp add` is the supported writer — but it prompts, and
 * `connect --auto` has to be scriptable for the same reason `connect hermes --auto`
 * is. The entry shape is the one pi writes itself: `{command, args}` under
 * `mcpServers.<name>`.
 */
function patchPiMcpJsonConfig(original: string, serverCommand: string, serverArgs: string[]): string {
  let parsed: Record<string, unknown> = {};
  if (original.trim()) {
    let candidate: unknown;
    try {
      candidate = JSON.parse(original);
    } catch {
      throw new Error(
        'pi mcp.json is not valid JSON, so this command will not rewrite it. Fix the file, or point --pi-config at another path.',
      );
    }
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      parsed = candidate as Record<string, unknown>;
    }
  }
  const existingServers = parsed.mcpServers;
  const servers = existingServers && typeof existingServers === 'object' && !Array.isArray(existingServers)
    ? { ...(existingServers as Record<string, unknown>) }
    : {};
  servers.cogmem = { command: serverCommand, args: serverArgs };
  parsed.mcpServers = servers;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/** Whether the file already carries exactly the entry this command would write. */
function piCogmemEntryMatches(original: string, serverCommand: string, serverArgs: string[]): boolean {
  if (!original.trim()) return false;
  try {
    const parsed = JSON.parse(original) as { mcpServers?: Record<string, { command?: unknown; args?: unknown }> };
    const entry = parsed.mcpServers?.cogmem;
    return Boolean(entry)
      && entry!.command === serverCommand
      && JSON.stringify(entry!.args) === JSON.stringify(serverArgs);
  } catch {
    return false;
  }
}

function installPiMcpConfig(input: {
  workspaceRoot: string;
  project: string;
  configPath?: string;
  dryRun: boolean;
  force: boolean;
}): PiMcpInstallResult {
  const configPath = resolve(input.configPath || defaultPiConfigPath());
  const server = resolveCogmemMcpServer(resolve(input.workspaceRoot), input.project);
  const original = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  // Compared as values, not as text: re-serialising a file pi wrote would otherwise
  // read as a change on every run.
  const current = piCogmemEntryMatches(original, server.command, server.args);
  const patched = patchPiMcpJsonConfig(original, server.command, server.args);
  let backupPath: string | undefined;

  if (!input.dryRun && (!current || input.force)) {
    mkdirSync(dirname(configPath), { recursive: true });
    if (existsSync(configPath)) {
      backupPath = `${configPath}.cogmem.bak-${Date.now()}`;
      writeFileSync(backupPath, original, 'utf8');
    }
    writeFileSync(configPath, patched, 'utf8');
  }

  return {
    enabled: true,
    configPath,
    serverCommand: server.command,
    serverArgs: server.args,
    dryRun: input.dryRun,
    configUpdated: !current || input.force,
    backupPath,
  };
}

function patchHermesMcpConfig(original: string, serverCommand: string, serverArgs: string[], project: string): string {
  if (hasHermesCogmemEntry(original)) {
    return patchExistingHermesCogmemConfig(original, project, serverArgs);
  }

  const lines = original.replace(/\r\n/g, '\n').split('\n');
  const serverBlock = [
    '  cogmem:',
    `    command: "${serverCommand}"`,
    `    args: ${JSON.stringify(serverArgs)}`,
    '    enabled: true',
    '    tools:',
    '      include:',
    ...HERMES_COGMEM_TOOLS.map((tool) => `        - ${tool}`),
  ];

  const mcpIndex = lines.findIndex((line) => /^mcp_servers\s*:\s*(?:\{\})?\s*$/.test(line.trim()));
  if (mcpIndex === -1) {
    const prefix = original.trimEnd();
    return `${prefix}${prefix ? '\n\n' : ''}mcp_servers:\n${serverBlock.join('\n')}\n`;
  }

  lines[mcpIndex] = 'mcp_servers:';
  let insertAt = mcpIndex + 1;
  while (insertAt < lines.length) {
    const line = lines[insertAt];
    if (line.trim() && !line.startsWith(' ') && !line.startsWith('\t') && !line.trim().startsWith('#')) break;
    insertAt += 1;
  }
  lines.splice(insertAt, 0, ...serverBlock);
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

/**
 * Whether an existing `args` line is a shape this command wrote, naming what it
 * would write now.
 *
 * `["mcp"]` is what it wrote before the project binding existed;
 * `["mcp","--project",<this project>]` is what it wrote before the Workspace
 * travelled with it. Both are superseded by the current args and are rewritten.
 * Anything else — a hand-written `--transport`, a flag this command does not know,
 * a *different* project somebody chose — is somebody's deliberate configuration and
 * is left where it is: an unbound entry is a visible problem, a silently retargeted
 * one is not.
 */
function isSupersededCogmemMcpArgs(parsed: unknown[], project: string): boolean {
  if (parsed[0] !== 'mcp') return false;
  for (let index = 1; index < parsed.length; index += 2) {
    const flag = parsed[index];
    const value = parsed[index + 1];
    if (flag === '--project' && value === project) continue;
    if (flag === '--config' && typeof value === 'string') continue;
    return false;
  }
  return true;
}

function patchExistingHermesCogmemConfig(original: string, project: string, serverArgs: string[]): string {
  const lines = original.replace(/\r\n/g, '\n').split('\n');
  const cogmemIndex = lines.findIndex((line) => /^\s+cogmem\s*:\s*$/.test(line));
  if (cogmemIndex === -1) return original.endsWith('\n') ? original : `${original}\n`;

  const cogmemIndent = leadingSpaces(lines[cogmemIndex]);
  let blockEnd = cogmemIndex + 1;
  while (blockEnd < lines.length) {
    const line = lines[blockEnd];
    if (
      line.trim()
      && !line.trim().startsWith('#')
      && leadingSpaces(line) <= cogmemIndent
    ) {
      break;
    }
    blockEnd += 1;
  }

  const block = lines.slice(cogmemIndex, blockEnd);
  // An entry an earlier `connect` wrote names no project — the server then answers
  // whatever scope a caller asks for, which is the defect this fix closes. Its own
  // `args` line is rewritten in place; a line this command did not write
  // (unparseable, or carrying flags it does not know) is left alone.
  for (let index = cogmemIndex + 1; index < blockEnd; index += 1) {
    const match = lines[index].match(/^(\s*)args\s*:\s*(\[.*\])\s*$/);
    if (!match) continue;
    try {
      const parsed = JSON.parse(match[2]!) as unknown;
      if (Array.isArray(parsed) && isSupersededCogmemMcpArgs(parsed, project)) {
        lines[index] = `${match[1]}args: ${JSON.stringify(serverArgs)}`;
      }
    } catch {
      // Leave an unparseable args line alone.
    }
    break;
  }
  const existingTools = new Set<string>();
  for (const line of block) {
    const match = line.match(/^\s*-\s*(cogmem_[\w-]+)\s*$/);
    if (match?.[1]) existingTools.add(match[1]);
  }
  const missing = HERMES_COGMEM_TOOLS.filter((tool) => !existingTools.has(tool));
  if (missing.length === 0) return `${lines.join('\n').replace(/\n+$/u, '')}\n`;

  const includeRelativeIndex = block.findIndex((line) => /^\s+include\s*:\s*$/.test(line));
  if (includeRelativeIndex !== -1) {
    const includeIndex = cogmemIndex + includeRelativeIndex;
    const includeIndent = leadingSpaces(lines[includeIndex]);
    let insertAt = includeIndex + 1;
    while (insertAt < blockEnd) {
      const line = lines[insertAt];
      if (!line.trim()) {
        insertAt += 1;
        continue;
      }
      if (leadingSpaces(line) <= includeIndent) break;
      if (!/^\s*-\s*/.test(line) && leadingSpaces(line) <= includeIndent + 2) break;
      insertAt += 1;
    }
    const itemIndent = `${' '.repeat(includeIndent + 2)}`;
    lines.splice(insertAt, 0, ...missing.map((tool) => `${itemIndent}- ${tool}`));
    return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
  }

  const childIndent = `${' '.repeat(cogmemIndent + 2)}`;
  const includeIndent = `${' '.repeat(cogmemIndent + 4)}`;
  const itemIndent = `${' '.repeat(cogmemIndent + 6)}`;
  lines.splice(blockEnd, 0, `${childIndent}tools:`, `${includeIndent}include:`, ...HERMES_COGMEM_TOOLS.map((tool) => `${itemIndent}- ${tool}`));
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

function leadingSpaces(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function printHuman(result: ConnectResult): void {
  console.log(`cogmem ${result.agent} skill ${result.dryRun ? 'dry-run' : result.installed ? 'installed' : 'already current'}`);
  console.log(`workspace: ${result.workspaceRoot}`);
  if (result.hostWorkspaceRoot !== result.workspaceRoot) console.log(`host workspace: ${result.hostWorkspaceRoot}`);
  console.log(`skill: ${result.skillPath}`);
  console.log(`reference: ${result.skillFiles[1]}`);
  console.log('');
  console.log('Host config snippet:');
  console.log(result.hostConfigSnippet);
  if (result.autoMemory) {
    console.log('');
    console.log('OpenClaw automatic memory plugin:');
    console.log(`  plugin: ${result.autoMemory.pluginDir}`);
    console.log(`  config: ${result.autoMemory.openclawConfigPath}`);
    console.log(`  hooks: ${result.autoMemory.hookNames.join(', ')}`);
    if (result.autoMemory.backupPath) console.log(`  backup: ${result.autoMemory.backupPath}`);
  }
  if (result.integrationEnabled) {
    console.log('');
    console.log(`integration: ${result.integrationEnabled.configPath} (${result.integrationEnabled.changed ? 'recorded' : 'already recorded'})`);
  }
  if (result.piMcp) {
    console.log('');
    console.log('pi MCP integration:');
    console.log(`  config: ${result.piMcp.configPath}`);
    console.log(`  command: ${result.piMcp.serverCommand} ${result.piMcp.serverArgs.join(' ')}`.trimEnd());
    if (result.piMcp.backupPath) console.log(`  backup: ${result.piMcp.backupPath}`);
    console.log('  check: pi mcp list');
  }
  if (result.hermesMcp) {
    console.log('');
    console.log('Hermes MCP integration:');
    console.log(`  config: ${result.hermesMcp.configPath}`);
    console.log(`  command: ${result.hermesMcp.serverCommand} ${result.hermesMcp.serverArgs.join(' ')}`.trimEnd());
    if (result.hermesMcp.backupPath) console.log(`  backup: ${result.hermesMcp.backupPath}`);
    if (result.hermesMcp.warning) console.log(`  warning: ${result.hermesMcp.warning}`);
    console.log('  reload: /reload-mcp');
  }
  console.log('');
  console.log('Next commands:');
  for (const command of result.nextCommands) {
    console.log(`  ${command}`);
  }
  console.log('');
  console.log('Then let the agent read the installed SKILL.md before changing runtime wiring.');
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  if (!args.allHosts) {
    const result = installSkill(args);
    if (args.json) {
      printCliJson(`connect.${result.agent}`, result);
      return;
    }
    printHuman(result);
    return;
  }

  // `connect all` wires what this config already enables — the hosts `init` found
  // and the operator accepted. It is the second half of "install one cogmem and
  // wire them all": one command, one backend, every host that asked for it (#97).
  // It deliberately does not invent hosts: enabling an integration nobody enabled
  // would install three host plugins on a machine that may have one agent.
  const cogmemConfig = resolveCogmemConfigPath({ configPath: args.configPath, cwd: args.workspaceRoot });
  if (cogmemConfig.kind !== 'toml') {
    throw new Error(
      `No cogmem config at ${cogmemConfig.path}, so there is nothing to wire. Run \`cogmem init --agent all\` first, or name one host: cogmem connect openclaw.`,
    );
  }
  const loaded = loadCogmemConfig({ configPath: cogmemConfig.path });
  const hosts = HOST_NAMES.filter((host) => loaded.integrations[host]?.enabled);
  if (hosts.length === 0) {
    throw new Error(
      'No host integration is enabled in this config, so `connect all` has nothing to wire. Run `cogmem init --agent all`, or name one host: cogmem connect openclaw.',
    );
  }
  const results = hosts.map((host) => installForHost(host, args));
  if (args.json) {
    printCliJson('connect.all', { hosts: results });
    return;
  }
  for (const result of results) printHuman(result);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
