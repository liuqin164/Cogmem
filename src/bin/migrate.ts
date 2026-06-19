#!/usr/bin/env bun
import Database from 'bun:sqlite';
import { copyFileSync, existsSync } from 'node:fs';

import { loadCogmemConfig, resolveCogmemConfigPath } from '../config/CogmemConfig.js';
import { ALL_MIGRATIONS, SchemaMigrationRunner } from '../migrations/index.js';

interface MigrateArgs {
  dbPath?: string;
  configPath?: string;
  dryRun: boolean;
  backup: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): MigrateArgs {
  let dbPath: string | undefined;
  let configPath: string | undefined;
  let yes = false;
  let dryRun = false;
  let backup = false;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--db') dbPath = argv[++index];
    else if (arg === '--config') configPath = argv[++index];
    else if (arg === '--yes') yes = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--backup') backup = true;
    else if (arg === '--json') json = true;
  }
  return { dbPath, configPath, dryRun: dryRun || !yes, backup, json };
}

function resolveDbPath(args: MigrateArgs): string {
  if (args.dbPath) return args.dbPath;
  const resolution = args.configPath
    ? resolveCogmemConfigPath({ configPath: args.configPath })
    : resolveCogmemConfigPath();
  if (resolution.kind !== 'toml') {
    throw new Error('Usage: cogmem migrate [--config <config.toml>|--db <memory.db>] [--dry-run|--yes] [--backup] [--json]');
  }
  const loaded = loadCogmemConfig({ configPath: resolution.path });
  if (!loaded.options.dbPath) throw new Error('Configured database path is missing.');
  return loaded.options.dbPath;
}

function backupDatabase(dbPath: string): string | undefined {
  if (dbPath === ':memory:' || !existsSync(dbPath)) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.pre-migrate-${stamp}.bak`;
  copyFileSync(dbPath, backupPath);
  return backupPath;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = resolveDbPath(args);
  const backupPath = !args.dryRun && args.backup ? backupDatabase(dbPath) : undefined;
  const db = new Database(dbPath);
  db.exec('PRAGMA busy_timeout = 5000;');
  try {
    const runner = new SchemaMigrationRunner(db, ALL_MIGRATIONS);
    const result = runner.run({ dryRun: args.dryRun });
    if (!args.dryRun) {
      db.exec(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
      const numericVersion = Number.parseInt(result.currentVersion || '0', 10);
      db.prepare(`INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)`).run(String(numericVersion));
    }
    const output = { command: 'migrate', dbPath, backupPath, ...result };
    if (args.json) console.log(JSON.stringify(output, null, 2));
    else {
      console.log(`cogmem migrate ${args.dryRun ? 'dry-run' : 'complete'}`);
      console.log(`database: ${dbPath}`);
      console.log(`pending: ${result.pending.join(', ') || 'none'}`);
      console.log(`applied: ${result.applied.join(', ') || 'none'}`);
      if (backupPath) console.log(`backup: ${backupPath}`);
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
