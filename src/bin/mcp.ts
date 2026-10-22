#!/usr/bin/env bun
import { resolve } from 'node:path';

import { startCogmemMcpServer } from '../mcp/server.js';
import { startCogmemMcpHttpServer } from '../mcp/http.js';
import { resolveProfile, type McpToolProfile } from '../mcp/profiles.js';

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
    cwd: args.cwd ? resolve(args.cwd) : process.cwd(),
    hostId: args.hostId,
  };

  if (args.transport === 'stdio') {
    await startCogmemMcpServer(runtime, {
      profile: args.profile,
      hostId: args.hostId,
      projectId: args.projectId,
    });
    return;
  }

  const handle = await startCogmemMcpHttpServer(runtime, {
    port: args.port,
    hostname: args.bind,
    path: args.path,
    token: args.token,
    profile: args.profile,
    hostId: args.hostId,
    projectId: args.projectId,
  });

  console.error(`cogmem mcp listening on ${handle.url} (profile=${args.profile}${args.hostId ? `, host=${args.hostId}` : ''})`);

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
