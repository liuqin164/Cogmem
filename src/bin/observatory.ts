#!/usr/bin/env bun
/**
 * The resident observatory: one loopback HTTP process serving the zero-write pages and the soul
 * editor, the one governance write (#194).
 *
 * It is the process #150 stops and starts on upgrade. It records itself as a resident session with
 * `transport: 'http'` so `doctor` can report the version the serving process loaded and `update` can
 * swap the package under it — the same contract the MCP process carried before this round.
 */
import { resolve } from 'node:path';

import { startObservatoryServer } from '../observatory/HttpServer.js';
import { loadAgentRegistry, resolveAgentRegistryPath } from '../agent/AgentRegistry.js';
import { resolveWorkspaceRoot } from '../config/CogmemConfig.js';
import {
  clearResidentSession,
  detectSystemdScope,
  detectSystemdUnit,
  resolveResidentSessionDir,
  writeResidentSession,
} from '../install/ResidentSession.js';
import { maybeStartVersionCheck } from '../install/VersionCheck.js';
import { CORE_VERSION } from '../version.js';
import { assertCliArgs } from './CliArgs.js';

interface ObservatoryArgs {
  dbPath?: string;
  configPath?: string;
  cwd?: string;
  port: number;
  agentsPath?: string;
  help: boolean;
}

function usage(): string {
  return [
    'Usage: cogmem observatory [options]',
    '',
    'Starts the memory observatory on loopback (default port 7337); reads are zero-write, the soul editor is the one write.',
    '',
    'Options:',
    '  --db <memory.db>        Memory database path',
    '  --config <config.toml>  Cog config path',
    '  --cwd <dir>             Working directory for project resolution',
    '  --port <n>              HTTP port (default: 7337)',
    '  --agents <agents.json>  Family roster listed in the scope bar (default: the workspace, then the home directory)',
    '',
    'Examples:',
    '  cogmem observatory --db ~/.cogmem/memory.db',
    '  cogmem observatory --config .cogmem/config.toml --port 7337',
  ].join('\n');
}

function readArgs(argv: string[]): ObservatoryArgs {
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
    port: numberArg(values, 'port', 7337),
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

async function main(): Promise<void> {
  assertCliArgs(process.argv.slice(2), { usage: usage(), extraFlags: ['agents', 'config', 'cwd', 'db', 'port'] });
  const args = readArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const runtime = {
    dbPath: args.dbPath ? resolve(args.dbPath) : undefined,
    configPath: args.configPath ? resolve(args.configPath) : undefined,
    // The same Workspace every other command derives, so the page and `doctor` answer about one directory (ADR-0010).
    cwd: args.cwd ? resolve(args.cwd) : resolveWorkspaceRoot({ configPath: args.configPath }),
  };

  // #150: started directly (systemd, a fixture) rather than through the dispatcher, the daily check
  // has to start here too — detached, and skipped when the dispatcher already started one.
  if (!process.env.COGMEM_VERSION_CHECK_STARTED) {
    maybeStartVersionCheck({ env: process.env, configPath: runtime.configPath, cwd: runtime.cwd });
  }

  const registry = resolveAgentRegistryPath({
    explicit: args.agentsPath,
    configPath: runtime.configPath,
    cwd: runtime.cwd,
  });
  const agents = registry.path ? loadAgentRegistry(registry.path) : undefined;

  const handle = await startObservatoryServer({
    ...runtime,
    port: args.port,
    ...(agents ? { connectedAgents: () => agents.list().map((agent) => agent.hostId) } : {}),
  });

  const sessionDir = resolveResidentSessionDir({ configPath: runtime.configPath, workspaceRoot: runtime.cwd });
  writeResidentSession(sessionDir, {
    pid: process.pid,
    version: CORE_VERSION,
    transport: 'http',
    startedAt: Date.now(),
    systemdUnit: detectSystemdUnit(),
    systemdScope: detectSystemdScope(),
    command: [process.execPath || 'bun', process.argv[1]!, ...process.argv.slice(2)],
    cwd: runtime.cwd,
    configPath: runtime.configPath,
    url: handle.url,
    port: handle.port,
  });

  // Deliberately a concatenation, not a template literal: this is a status line naming the URL,
  // and the command-template guard would try to resolve anything that reads like a `cogmem …` line.
  console.error('cogmem memory observatory (read-only; soul editor is the one write) on ' + handle.url);

  const shutdown = (): void => {
    clearResidentSession(sessionDir);
    handle.stop();
    process.exit(0);
  };
  process.on('exit', () => clearResidentSession(sessionDir));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
