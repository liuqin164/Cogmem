#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveCliBinDir } from '../install/InstallSteps.js';
import { assertCliArgs } from './CliArgs.js';

const COMMANDS: Record<string, string> = {
  init: 'init',
  doctor: 'doctor',
  connect: 'connect',
  update: 'update',
  openclaw: 'openclaw',
  compact: 'compact',
  memory: 'memory',
  'explain-recall': 'explain-recall',
  mcp: 'mcp',
  repair: 'repair',
  'import-openclaw': 'import-openclaw',
  'import-hermes': 'import-hermes',
  'normalize-transcript': 'normalize-transcript',
  snapshot: 'snapshot',
  're-embed': 're-embed',
  prospective: 'prospective',
  strategy: 'strategy',
  'brain-eval': 'brain-eval',
  episode: 'episode',
  dream: 'dream',
};

function usage(): string {
  return [
    'Usage: cogmem <command> [args]',
    '',
    'Commands:',
    '  init                 interactive setup',
    '  doctor               validate config; use --fix --agent openclaw to repair OpenClaw auto memory wiring',
    '  connect openclaw     install OpenClaw/Hermes integration files; use --auto for OpenClaw runtime hooks',
    '  update               show or run package update command',
    '  openclaw diagnose    inspect generated OpenClaw plugin files and hook audit without opening the DB',
    '  compact              dry-run or apply vector-only storage compaction',
    '  memory               audit/search/show raw and compiled memory; run dream/candidates queue',
    '  import-openclaw      import OpenClaw memory files',
    '  import-hermes        import Hermes memory files',
    '  explain-recall       explain governed recall',
    '  mcp                  start stdio MCP server',
    '  repair               conservative upgrade repair commands such as project-scope',
    '  snapshot             export/import snapshots',
    '  re-embed             inspect re-embedding progress; re-embedding itself is a host pipeline call',
    '  prospective          manage confirmed-only future-memory candidates; never executes tasks',
    '  strategy             inspect current-turn memory policy and read-only outcome telemetry',
    '  brain-eval           evaluate recall, provenance, leakage, budget, and false activation',
    '  episode              append, import, inspect, seal, or repair conversation episodes',
    '  dream                conditionally process sealed episode backlog',
    '',
    'JSON output: commands with --json emit cogmem.cli.v1. Object fields stay top-level; arrays use items.',
    'Queue commands expose candidate, promoted, needs_confirmation, and beliefs at the top level.',
  ].join('\n');
}

function siblingEntrypoint(command: string): string {
  const base = dirname(fileURLToPath(import.meta.url));
  const jsPath = join(base, `${command}.js`);
  if (existsSync(jsPath)) return jsPath;
  return join(base, `${command}.ts`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    console.log(usage());
    return;
  }
  const entrypoint = COMMANDS[command];
  if (!entrypoint) {
    console.error(`Unknown cogmem command: ${command}`);
    console.error(usage());
    process.exit(1);
  }

  const env = { ...process.env };
  const binDir = resolveCliBinDir(process.argv[1], env);
  if (binDir) env.COGMEM_BIN_DIR = binDir;

  const proc = Bun.spawn({
    cmd: [process.execPath || 'bun', siblingEntrypoint(entrypoint), ...rest],
    cwd: process.cwd(),
    // Inherited, not piped. The dispatcher used to read the child's output to EOF and
    // write it afterwards, which works for a command that exits and cannot work for
    // one that does not: `cogmem mcp` streams JSON-RPC until its client disconnects,
    // so every response was held until the child exited and a client that keeps the
    // connection open never completed the handshake — pi reported `MCP request timed
    // out after 60000ms` with an empty tool list, and the same happened to the
    // startup line of `cogmem mcp --transport http`. Inheriting the streams makes the
    // child write to the client directly, so output arrives as it is produced.
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env,
  });
  process.exit(await proc.exited);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
