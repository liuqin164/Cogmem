#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printCliJson } from './CliJson.js';

import {
  type OpenClawAutoMemoryInstallResult,
  installOpenClawAutoMemoryPlugin,
} from '../host/openclaw/AutoMemoryPluginInstaller.js';

type AgentKind = 'openclaw' | 'hermes';

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
  'cogmem_graph_node',
  'cogmem_graph_neighbors',
  'cogmem_graph_path',
  'cogmem_graph_timeline',
  'cogmem_maintenance_tick',
  'cogmem_prospective',
];

interface ConnectArgs {
  agent?: AgentKind;
  workspaceRoot: string;
  configPath?: string;
  openclawConfigPath?: string;
  hermesConfigPath?: string;
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
  skillPath: string;
  templatePath: string;
  dryRun: boolean;
  installed: boolean;
  alreadyCurrent: boolean;
  nextCommands: string[];
  hostConfigSnippet: string;
  autoMemory?: OpenClawAutoMemoryInstallResult;
  hermesMcp?: HermesMcpInstallResult;
}

interface HermesMcpInstallResult {
  enabled: true;
  configPath: string;
  serverCommand: string;
  dryRun: boolean;
  configUpdated: boolean;
  backupPath?: string;
}

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
    if (!next || next.startsWith('--')) {
      values[key] = true;
      continue;
    }
    values[key] = next;
    index += 1;
  }

  const rawAgent = positionals[0];
  const agent = rawAgent === 'openclaw' || rawAgent === 'hermes' ? rawAgent : undefined;
  return {
    agent,
    workspaceRoot: resolve(stringValue(values.workspace) || '.'),
    configPath: stringValue(values.config),
    openclawConfigPath: stringValue(values['openclaw-config']),
    hermesConfigPath: stringValue(values['hermes-config']),
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

function defaultSkillPath(agent: AgentKind, workspaceRoot: string): string {
  if (agent === 'openclaw') {
    return join(workspaceRoot, 'skills', 'cogmem-memory', 'SKILL.md');
  }
  return join(process.env.HOME || homedir(), '.hermes', 'skills', 'cogmem-memory', 'SKILL.md');
}

function nextCommands(agent: AgentKind): string[] {
  if (agent === 'openclaw') {
    return [
      './node_modules/.bin/cogmem-init --agent openclaw --scope project',
      './node_modules/.bin/cogmem-doctor',
      './node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw --dry-run',
      './node_modules/.bin/cogmem-import-openclaw --workspace . --project openclaw',
      './node_modules/.bin/cogmem-connect openclaw --workspace . --auto --force',
    ];
  }
  return [
    './node_modules/.bin/cogmem-init --agent hermes',
    './node_modules/.bin/cogmem-doctor',
    './node_modules/.bin/cogmem-connect hermes --workspace . --auto --force',
    './node_modules/.bin/cogmem-import-hermes --workspace . --project hermes --dry-run',
    './node_modules/.bin/cogmem-import-hermes --workspace . --project hermes',
  ];
}

function usage(): string {
  return [
    'Usage: cogmem-connect <openclaw|hermes> [--workspace <dir>] [--output <SKILL.md>] [--auto] [--config <config.toml>] [--openclaw-config <openclaw.json>] [--hermes-config <config.yaml>] [--dry-run] [--force] [--json]',
    '',
    'Installs the agent-facing cogmem memory skill file into:',
    '  OpenClaw: <workspace>/skills/cogmem-memory/SKILL.md',
    '  Hermes:   ~/.hermes/skills/cogmem-memory/SKILL.md',
    '',
    'By default this command installs only the agent-facing skill file.',
    'For OpenClaw, pass --auto to install the local automatic recall/remember plugin wrapper and patch OpenClaw plugin config.',
    'For Hermes, pass --auto to patch ~/.hermes/config.yaml with a cogmem MCP server entry.',
  ].join('\n');
}

function hostConfigSnippet(agent: AgentKind, workspaceRoot: string, auto: boolean): string {
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

  const mcpBin = resolveCogmemMcpCommand(workspaceRoot);
  return [
    'mcp_servers:',
    '  cogmem:',
    `    command: "${mcpBin}"`,
    '    args: []',
    '    enabled: true',
    '    tools:',
    '      include:',
    ...HERMES_COGMEM_TOOLS.map((tool) => `        - ${tool}`),
  ].join('\n');
}

function resolveCogmemMcpCommand(workspaceRoot: string): string {
  if (process.env.COGMEM_MCP_BIN) return process.env.COGMEM_MCP_BIN;
  const workspaceBin = join(workspaceRoot, 'node_modules', '.bin', 'cogmem-mcp');
  if (existsSync(workspaceBin)) return workspaceBin;
  const pathValue = process.env.PATH || '';
  for (const segment of pathValue.split(':')) {
    if (!segment) continue;
    const candidate = join(segment, 'cogmem-mcp');
    if (existsSync(candidate)) return candidate;
  }
  return 'cogmem-mcp';
}

function installSkill(args: ConnectArgs): ConnectResult {
  if (!args.agent) throw new Error(usage());
  const templatePath = templatePathFor(args.agent);
  if (!existsSync(templatePath)) {
    throw new Error(`Missing packaged skill template: ${templatePath}`);
  }

  const template = readFileSync(templatePath, 'utf8');
  const skillPath = resolve(args.outputPath || defaultSkillPath(args.agent, args.workspaceRoot));
  const alreadyCurrent = existsSync(skillPath) && readFileSync(skillPath, 'utf8') === template;
  let autoMemory: OpenClawAutoMemoryInstallResult | undefined;
  let hermesMcp: HermesMcpInstallResult | undefined;

  if (!args.dryRun && !alreadyCurrent) {
    if (existsSync(skillPath) && !args.force) {
      throw new Error(`Skill already exists at ${skillPath}. Re-run with --force to overwrite.`);
    }
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(skillPath, template, 'utf8');
  }

  if (args.agent === 'openclaw' && args.auto) {
    autoMemory = installOpenClawAutoMemoryPlugin({
      workspaceRoot: args.workspaceRoot,
      configPath: args.configPath,
      openclawConfigPath: args.openclawConfigPath,
      pluginDir: args.pluginDir,
      bunPath: args.bunPath,
      projectId: args.projectId,
      agentId: args.agentId,
      dryRun: args.dryRun,
      force: args.force,
    });
  } else if (args.agent === 'hermes' && args.auto) {
    hermesMcp = installHermesMcpConfig({
      workspaceRoot: args.workspaceRoot,
      configPath: args.hermesConfigPath,
      dryRun: args.dryRun,
      force: args.force,
    });
  }

  return {
    agent: args.agent,
    workspaceRoot: args.workspaceRoot,
    skillPath,
    templatePath,
    dryRun: args.dryRun,
    installed: !args.dryRun && !alreadyCurrent,
    alreadyCurrent,
    nextCommands: nextCommands(args.agent),
    hostConfigSnippet: hostConfigSnippet(args.agent, args.workspaceRoot, args.auto),
    autoMemory,
    hermesMcp,
  };
}

function defaultHermesConfigPath(env = process.env): string {
  return join(env.HOME || homedir(), '.hermes', 'config.yaml');
}

function installHermesMcpConfig(input: {
  workspaceRoot: string;
  configPath?: string;
  dryRun: boolean;
  force: boolean;
}): HermesMcpInstallResult {
  const configPath = resolve(input.configPath || defaultHermesConfigPath());
  const serverCommand = resolveCogmemMcpCommand(resolve(input.workspaceRoot));
  const original = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const patched = patchHermesMcpConfig(original, serverCommand);
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

  return {
    enabled: true,
    configPath,
    serverCommand,
    dryRun: input.dryRun,
    configUpdated: changed || input.force,
    backupPath,
  };
}

function patchHermesMcpConfig(original: string, serverCommand: string): string {
  if (/^\s+cogmem\s*:/m.test(original) && original.includes('cogmem-mcp')) {
    return patchExistingHermesCogmemConfig(original);
  }

  const lines = original.replace(/\r\n/g, '\n').split('\n');
  const serverBlock = [
    '  cogmem:',
    `    command: "${serverCommand}"`,
    '    args: []',
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

function patchExistingHermesCogmemConfig(original: string): string {
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
  console.log(`skill: ${result.skillPath}`);
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
  if (result.hermesMcp) {
    console.log('');
    console.log('Hermes MCP integration:');
    console.log(`  config: ${result.hermesMcp.configPath}`);
    console.log(`  command: ${result.hermesMcp.serverCommand}`);
    if (result.hermesMcp.backupPath) console.log(`  backup: ${result.hermesMcp.backupPath}`);
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

  const result = installSkill(args);
  if (args.json) {
    printCliJson(`connect.${result.agent}`, result);
    return;
  }
  printHuman(result);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
