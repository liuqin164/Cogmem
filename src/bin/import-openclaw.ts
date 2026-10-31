#!/usr/bin/env bun
import { runOpenClawImport } from './import-support.js';
import { assertCliArgs } from './CliArgs.js';
assertCliArgs(process.argv.slice(2), { usage: '', extraFlags: ['workspace', 'project', 'db', 'state-db', 'timezone', 'config', 'env-path', 'profile', 'date', 'session', 'sessions', 'memory', 'reindex-raw', 'dry-run', 'json', 'progress', 'no-progress', 'since', 'until', 'skip-errors', 'max-errors', 'resume', 'checkpoint-file', 'start-line', 'end-line', 'max-lines', 'seal-batch', 'force-seal', 'chunk-size', 'format', 'file', 'agent', 'source-agent', 'legacy-env', 'no-probe', 'scope', 'vector-dimension'] });

runOpenClawImport(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
