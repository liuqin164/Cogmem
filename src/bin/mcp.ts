#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { startCogmemMcpServer } from '../mcp/server.js';
import { startCogmemMcpHttpServer } from '../mcp/http.js';
import { loadAgentRegistry, resolveAgentRegistryPath } from '../mcp/AgentRegistry.js';
import { resolveProfile, type McpToolProfile } from '../mcp/profiles.js';
import { resolveWorkspaceRoot } from '../config/CogmemConfig.js';

interface McpArgs {
  dbPath?: string;
  configPath?: string;
  cwd?: string;
  transport: 'stdio' | 'http';
  port: number;
  bind: string;
  path: string;
  hostId?: string;
  projectId?: string;
  profile: McpToolProfile;
  token?: string;
  agentsPath?: string;
  help: boolean;
}

function readArgs(argv: string[]): McpArgs {
  const values: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      values[key] = true;
      continue;
    }
    values[key] = next;
    index += 1;
  }

  const transport = stringArg(values, 'transport') ?? 'stdio';
  if (transport !== 'stdio' && transport !== 'http') {
    throw new Error(`unknown_transport:${transport}`);
  }

  return {
    dbPath: stringArg(values, 'db'),
    configPath: stringArg(values, 'config'),
    cwd: stringArg(values, 'cwd'),
    transport,
    port: numberArg(values, 'port', 7337),
    bind: stringArg(values, 'bind') ?? '127.0.0.1',
    path: stringArg(values, 'path') ?? '/mcp',
    hostId: stringArg(values, 'host'),
    projectId: stringArg(values, 'project'),
    profile: resolveProfile(stringArg(values, 'profile')),
    token: stringArg(values, 'token'),
    agentsPath: stringArg(values, 'agents'),
    help: values.help === true || values.h === true,
  };
}

function stringArg(values: Record<string, string | boolean>, key: string): string | undefined {
  const value = values[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberArg(values: Record<string, string | boolean>, key: string, fallback: number): number {
  const value = stringArg(values, key);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`invalid_${key}:${value}`);
  }
  return parsed;
}

function usage(): string {
  return [
    'Usage: cogmem mcp [options]',
    '',
    'Options:',
    '  --db <memory.db>        Memory database path',
    '  --config <config.toml>  Cogmem config path',
    '  --cwd <dir>             Working directory for project resolution',
    '  --transport <stdio|http>  Transport (default: stdio)',
    '  --port <n>              HTTP port (default: 7337)',
    '  --bind <addr>           HTTP bind address (default: 127.0.0.1)',
    '  --path <path>           HTTP endpoint path (default: /mcp)',
    '  --host <id>             Host identity, e.g. claude, cursor, codex, hermes',
    '  --project <id>          Bind this connection to one project; conflicting projectId calls are rejected',
    '  --profile <core|admin|full>  Tool surface (default: core)',
    '  --token <value>         Require Authorization: Bearer <value> over HTTP',
    '  --agents <agents.json>  Registered agents and credentials (default: <workspace>/.cogmem/agents.json, then ~/.cogmem/agents.json, when present)',
    '',
    'Examples:',
    '  cogmem mcp --db ~/.cogmem/memory.db',
    '  cogmem mcp --transport http --host claude --profile core --port 7337',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const runtime = {
    dbPath: args.dbPath ? resolve(args.dbPath) : undefined,
    configPath: args.configPath ? resolve(args.configPath) : undefined,
    // The same Workspace every other command derives: `cwd` is what the kernel's
    // config walk starts from, so defaulting it to `process.cwd()` let the MCP
    // server answer from a different directory than `doctor` was talking about
    // (ADR-0010). `--cwd` still overrides.
    cwd: args.cwd ? resolve(args.cwd) : resolveWorkspaceRoot({ configPath: args.configPath }),
    hostId: args.hostId,
  };

  // Workspace first, then beside the home directory — the same search
  // `init --register-agent` writes into (ADR-0010). An absent registry is the
  // single-agent case; a *named* one that cannot be read is a misconfiguration
  // and refuses to start, because serving every agent as anonymous while the
  // operator believes they are registered is the failure this file exists to
  // prevent (#80).
  const registry = resolveAgentRegistryPath({
    explicit: args.agentsPath,
    configPath: args.configPath,
    cwd: runtime.cwd,
  });
  if (registry.explicit && registry.path && !existsSync(registry.path)) {
    throw new Error(`agent_registry_not_found: ${registry.path} was named but does not exist. A named registry that cannot be read is not the single-agent case.`);
  }
  const agents = registry.path ? loadAgentRegistry(registry.path) : undefined;

  if (args.transport === 'stdio') {
    // stdio has no transport to authenticate, so the credential comes from the
    // environment the host launched this process with — the variable the host
    // bridge already reads. With a registry configured it is required, exactly as
    // on HTTP: a registry means identities exist, and a connection that has not
    // established one must not be served with project access (#80).
    const credential = args.token ?? process.env.COGMEM_AGENT_TOKEN;
    const stdioAgent = agents?.resolve(credential);
    if (agents && !stdioAgent) {
      throw new Error('agent_credential_required: this machine has a registered agent list, so a credential is required over stdio: set COGMEM_AGENT_TOKEN to a registered credential.');
    }
    await startCogmemMcpServer(runtime, {
      profile: stdioAgent?.profile ?? args.profile,
      hostId: args.hostId,
      projectId: stdioAgent?.projectId ?? args.projectId,
      ...(stdioAgent ? { authenticatedHostId: stdioAgent.hostId } : {}),
    });
    return;
  }

  const handle = await startCogmemMcpHttpServer(runtime, {
    port: args.port,
    hostname: args.bind,
    path: args.path,
    token: args.token,
    agents,
    profile: args.profile,
    hostId: args.hostId,
    projectId: args.projectId,
  });

  const registered = agents ? `, agents=${agents.list().length}` : '';
  console.error(`cogmem mcp listening on ${handle.url} (profile=${args.profile}${args.hostId ? `, host=${args.hostId}` : ''}${registered})`);

  const shutdown = (): void => {
    handle.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
