#!/usr/bin/env bun
import { runOpenClawImport } from './import-support.js';
import { assertCliArgs } from './CliArgs.js';
const USAGE = [
  'Usage: cogmem import-openclaw [--workspace <dir>] [--project <id>] [--db <memory.db>|--config <config.toml>]',
  '                    [--dry-run] [--since <iso>] [--until <iso>] [--json]',
  '',
  'Imports openclaw session memory into the raw ledger. Missing --project derives it from the workspace.',
  'The full flag set is the shared import surface; `cogmem init` prints the path it wrote.',
].join('\\n');
assertCliArgs(process.argv.slice(2), { usage: USAGE, extraFlags: ['workspace', 'project', 'db', 'state-db', 'timezone', 'config', 'env-path', 'profile', 'date', 'session', 'sessions', 'memory', 'reindex-raw', 'dry-run', 'json', 'progress', 'no-progress', 'since', 'until', 'skip-errors', 'max-errors', 'resume', 'checkpoint-file', 'start-line', 'end-line', 'max-lines', 'seal-batch', 'force-seal', 'chunk-size', 'format', 'file', 'agent', 'source-agent', 'legacy-env', 'no-probe', 'scope', 'vector-dimension'] });

runOpenClawImport(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
