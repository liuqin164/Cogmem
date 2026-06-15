#!/usr/bin/env bun
import { resolve } from 'node:path';

import { startCogmemMcpServer } from '../mcp/server.js';

interface McpArgs {
  dbPath?: string;
  configPath?: string;
  cwd?: string;
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
  return {
    dbPath: stringArg(values, 'db'),
    configPath: stringArg(values, 'config'),
    cwd: stringArg(values, 'cwd'),
    help: values.help === true || values.h === true,
  };
}

function stringArg(values: Record<string, string | boolean>, key: string): string | undefined {
  const value = values[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function usage(): string {
  return [
    'Usage: cogmem-mcp [--db <memory.db>|--config <config.toml>] [--cwd <dir>]',
    '',
    'Starts a stdio MCP server exposing cogmem_remember_turn, cogmem_recall, cogmem_explain_recall, cogmem_memory_map, and cogmem_maintenance_tick.',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  await startCogmemMcpServer({
    dbPath: args.dbPath ? resolve(args.dbPath) : undefined,
    configPath: args.configPath ? resolve(args.configPath) : undefined,
    cwd: args.cwd ? resolve(args.cwd) : process.cwd(),
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
