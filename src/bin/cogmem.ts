#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveCliBinDir } from '../install/InstallSteps.js';
import { checkForUpdate, maybeStartVersionCheck, renderUpdateNotice } from '../install/VersionCheck.js';
import { assertCliArgs } from './CliArgs.js';

const COMMANDS: Record<string, string> = {
  init: 'init',
  doctor: 'doctor',
  update: 'update',
  compact: 'compact',
  memory: 'memory',
  'explain-recall': 'explain-recall',
  observatory: 'observatory',
  repair: 'repair',
  import: 'import',
  'normalize-transcript': 'normalize-transcript',
  snapshot: 'snapshot',
  prospective: 'prospective',
  strategy: 'strategy',
  'brain-eval': 'brain-eval',
  episode: 'episode',
  dream: 'dream',
  cleanup: 'cleanup',
};

function usage(): string {
  return [
    'Usage: cogmem <command> [args]',
    '',
    'Commands:',
    '  init                 interactive setup',
    '  doctor               validate config, kernel, storage and the install gate',
    '  update               show or run package update command',
    '  compact              dry-run or apply vector-only storage compaction',
    '  memory               audit/search/show raw and compiled memory; run dream/candidates queue',
    '  import <host>        import memory files from one host (openclaw | hermes)',
    '  explain-recall       explain governed recall',
    '  observatory          serve the read-only memory observatory on loopback',
    '  normalize-transcript  convert a transcript export into conversation Markdown',
    '  repair               conservative upgrade repair commands such as project-scope',
    '  snapshot             export/import snapshots',
    '  prospective          manage confirmed-only future-memory candidates; never executes tasks',
    '  strategy             inspect current-turn memory policy and read-only outcome telemetry',
    '  brain-eval           evaluate recall, provenance, leakage, budget, and false activation',
    '  episode              append, import, inspect, seal, or repair conversation episodes',
    '  dream                conditionally process sealed episode backlog',
    '  cleanup              remove the managed launcher after its installation is gone',
    '',
    'JSON output: commands with --json emit cogmem.cli.v1. Object fields stay top-level, and arrays are named for what they hold: items (recall, prospective list), events (list, search), decisions (govern), episodes (episode list), statuses (compact), and nodes/edges/matchedFacets/nextActions/warnings on Atlas reads.',
    'Queue commands expose candidate, promoted, needs_confirmation, and beliefs at the top level. `dream status` and `dream night` nest the frame-stamp report as staleFrames: {checked, total, stale, truncated}. A tick that could not use the memory model carries semanticProcessorReason and, when the call threw, semanticProcessorError.',
  ].join('\n');
}

function siblingEntrypoint(command: string): string {
  const base = dirname(fileURLToPath(import.meta.url));
  const jsPath = join(base, `${command}.js`);
  if (existsSync(jsPath)) return jsPath;
  return join(base, `${command}.ts`);
}

/** The version this installation reports, read from the manifest beside the entry point. */
async function readVersion(): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { join, dirname } = await import('node:path');
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 4; depth += 1) {
    try {
      const raw = await readFile(join(dir, 'package.json'), 'utf8');
      const version = (JSON.parse(raw) as { version?: string }).version;
      if (version) return version;
    } catch { /* keep walking up: src/bin and dist/bin sit at different depths */ }
    dir = dirname(dir);
  }
  return 'unknown';
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    console.log(usage());
    return;
  }
  // A version flag is what a person types after installing, before anything else works.
  // It used to answer "Unknown cogmem command: --version".
  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(await readVersion());
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

  // #150: start the daily check in the background, never wait for it. `update` is
  // excluded because it is the thing the check would call — starting a check from
  // an update would be the recursion, not the feature.
  if (command !== 'update' && maybeStartVersionCheck({ env, configPath: explicitConfig(rest) }).started) {
    // A resident entrypoint started directly (systemd, a fixture) starts the check
    // itself; this mark is how it knows the dispatcher already did.
    env.COGMEM_VERSION_CHECK_STARTED = '1';
  }

  const proc = Bun.spawn({
    cmd: [process.execPath || 'bun', siblingEntrypoint(entrypoint), ...rest],
    cwd: process.cwd(),
    // Inherited, not piped. The dispatcher used to read the child's output to EOF and
    // write it afterwards, which works for a command that exits and cannot work for
    // one that does not: `cogmem observatory` serves until it is stopped, and piping
    // its output would hold every line until the process exited. Inheriting the
    // streams makes the child write to the terminal directly, as it is produced.
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env,
  });
  const exitCode = await proc.exited;
  printUpdateNotice(command, rest, env);
  process.exit(exitCode);
}

/**
 * One line after a command's own output, and only where a person is reading (#150).
 *
 * stderr rather than stdout, because stdout is a machine contract on every command
 * that carries `--json`; the notice is suppressed there, on the long-running
 * `observatory`, and for `--help`, which a test asserts writes nothing to stderr.
 */
function printUpdateNotice(command: string, rest: string[], env: Record<string, string | undefined>): void {
  // Not `update`: the process asking is the one that was just replaced, so its own
  // `CORE_VERSION` is the old one and it would announce the release it just installed.
  if (command === 'update' || command === 'observatory') return;
  if (rest.includes('--json') || rest.includes('--help') || rest.includes('-h')) return;
  const notice = renderUpdateNotice(checkForUpdate({ env, configPath: explicitConfig(rest) }));
  if (notice) process.stderr.write(`${notice}\n`);
}

/**
 * The `--config` this invocation named, if any.
 *
 * The check has to read the same config the command does: `[update] check` and the
 * automatic-upgrade switches in a file only reachable through the flag were
 * silently ignored, which is the shape the documented systemd unit uses.
 */
function explicitConfig(rest: string[]): string | undefined {
  const index = rest.indexOf('--config');
  const value = index >= 0 ? rest[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
