#!/usr/bin/env bun
import { emitRefusalDocument } from './RefusalDocument.js';
import { assertCliArgs } from './CliArgs.js';
import { runHermesImport, runOpenClawImport } from './import-support.js';

// One command, one host argument. The two entry points this replaces were identical
// apart from the host name, including a duplicated thirty-eight-entry flag list, and
// both shipped as their own `cogmem-import-*` bin.
const USAGE = [
  'Usage: cogmem import <openclaw|hermes> [--workspace <dir>] [--project <id>]',
  '                    [--db <memory.db>|--config <config.toml>] [--dry-run] [--since <iso>] [--until <iso>] [--json]',
  '',
  'openclaw reads that workspace\'s memory files; hermes reads its profile, sessions, and state',
  'database. Missing --project is derived from the workspace. The full flag set is the shared',
  'import surface; `cogmem init` prints the path it wrote.',
].join('\n');

const HOSTS = { openclaw: runOpenClawImport, hermes: runHermesImport } as const;

assertCliArgs(process.argv.slice(2), {
  usage: USAGE,
  extraFlags: ['workspace', 'project', 'db', 'state-db', 'timezone', 'config', 'env-path', 'profile', 'date', 'session', 'sessions', 'memory', 'reindex-raw', 'dry-run', 'json', 'progress', 'no-progress', 'since', 'until', 'skip-errors', 'max-errors', 'resume', 'checkpoint-file', 'start-line', 'end-line', 'max-lines', 'seal-batch', 'force-seal', 'chunk-size', 'format', 'file', 'agent', 'source-agent', 'legacy-env', 'no-probe', 'scope', 'vector-dimension'],
});

const [host, ...rest] = process.argv.slice(2);
const run = HOSTS[host as keyof typeof HOSTS];
if (!run) {
  // Not a help request: a named host that is not one of the two is a mistake, and exit 0 there
  // would read as "imported nothing, successfully".
  console.error(`Unknown import host: ${host ?? '(none)'} — use openclaw or hermes.\n${USAGE}`);
  process.exit(1);
}

run(rest).catch((error) => {
  if (emitRefusalDocument(error, 'import')) return;
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
