#!/usr/bin/env bun
import { emitRefusalDocument } from './RefusalDocument.js';
import Database from 'bun:sqlite';

import { loadCogmemConfig, resolveCogmemConfigPath } from '../config/CogmemConfig.js';
import { createMemoryKernel } from '../factory.js';
import { countSecretFindings } from '../security/SecretPatterns.js';
import { assertCliArgs } from './CliArgs.js';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function usage(): string {
  return [
    'Usage: cogmem repair project-scope --from <projectId> --to <projectId> [--db <memory.db>|--config <config.toml>] [--dry-run|--apply] [--json]',
    '       cogmem repair secret-marks [--db <memory.db>|--config <config.toml>] [--dry-run|--apply] [--json]',
    '',
    'Conservatively moves empty-project upgrade residue into a real project scope.',
    '',
    'secret-marks is the one-time back-scan for events written before the write path marked secrets (#142): it',
    're-reads each event with the same table the writer uses and stamps the mark, leaving every text untouched. It',
    'never runs on its own — an operator asks for it, and running it twice stamps nothing the second time.',
  ].join('\n');
}

function dbPathFromArgs(): string {
  const explicit = readArg('--db');
  if (explicit) return explicit;
  const resolution = resolveCogmemConfigPath({ configPath: readArg('--config') });
  if (resolution.kind === 'missing') throw new Error(`missing config file: ${resolution.path}`);
  const dbPath = loadCogmemConfig({ configPath: resolution.path }).options.dbPath;
  if (!dbPath) throw new Error(`config does not define a database path: ${resolution.path}`);
  return dbPath;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function tablesWithProjectId(db: Database): string[] {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name: string }>;
  return tables
    .map((table) => table.name)
    .filter((table) => {
      const columns = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>;
      return columns.some((column) => column.name === 'project_id');
    });
}

function countRows(db: Database, table: string, projectId: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(table)} WHERE COALESCE(project_id,'')=?`).get(projectId) as { count: number };
  return Number(row?.count || 0);
}

function nonEmptyProjectIds(db: Database, table: string): string[] {
  const rows = db.prepare(`SELECT DISTINCT project_id FROM ${quoteIdent(table)} WHERE COALESCE(project_id,'')<>'' LIMIT 20`).all() as Array<{ project_id: string }>;
  return rows.map((row) => row.project_id).filter(Boolean);
}

function main(): void {
  assertCliArgs(process.argv.slice(2), { usage: usage(), extraFlags: ['apply', 'config', 'db', 'dry-run', 'from', 'json', 'to'] });
  const [command] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (command !== 'project-scope' && command !== 'secret-marks') {
    console.error(usage());
    process.exit(1);
    process.exit(command === 'project-scope' ? 0 : 1);
  }
  if (command === 'secret-marks') {
    const applySecretMarks = hasFlag('--apply');
    const dbPathForScan = dbPathFromArgs();
    const kernel = createMemoryKernel({ dbPath: dbPathForScan, vectorBackend: 'sqlite-vec' });
    try {
      const events = kernel.eventStore.listEventsForSecretBackScan();
      const byKind: Record<string, number> = {};
      const eventIds: string[] = [];
      for (const event of events) {
        const found = countSecretFindings(event.text);
        if (found.total === 0) continue;
        for (const [kind, count] of Object.entries(found.byKind)) byKind[kind] = (byKind[kind] ?? 0) + count;
        if (!applySecretMarks) continue;
        const key = event.role === 'assistant' ? 'secretFindingsAssistant' : 'secretFindings';
        if (kernel.eventStore.addSecretFindings(event.eventId, key, { total: found.total, byKind: found.byKind })) eventIds.push(event.eventId);
      }
      const payload = {
        schemaVersion: 'cogmem.cli.v1',
        command: 'repair.secret-marks',
        dbPath: dbPathForScan,
        dryRun: !applySecretMarks,
        apply: applySecretMarks,
        scanned: events.length,
        newlyMarked: eventIds.length,
        byKind,
        // Ids of the events this run stamped, so the operator has a record of what changed. The text itself is never
        // printed: the mark exists precisely so the value stays out of logs.
        eventIds,
      };
      if (hasFlag('--json')) console.log(JSON.stringify(payload));
      else console.log(`${applySecretMarks ? 'applied' : 'dry-run'} secret-marks repair ${JSON.stringify({ scanned: payload.scanned, newlyMarked: payload.newlyMarked, byKind })}`);
      return;
    } finally {
      kernel.close();
    }
  }
  const from = readArg('--from');
  const to = readArg('--to');
  if (from === undefined || !to) throw new Error(`Missing --from or --to.\n${usage()}`);
  const apply = hasFlag('--apply');
  const dbPath = dbPathFromArgs();
  const db = new Database(dbPath);
  db.exec('PRAGMA busy_timeout = 5000;');
  try {
    const tables = tablesWithProjectId(db);
    const counts = tables.map((table) => ({
      table,
      fromCount: countRows(db, table, from),
      existingProjectIds: nonEmptyProjectIds(db, table),
    })).filter((row) => row.fromCount > 0);
    const nonEmpty = new Set(counts.flatMap((row) => row.existingProjectIds));
    if (from === '' && to === 'openclaw') {
      for (const projectId of nonEmpty) {
        if (projectId !== to) {
          throw new Error(`Refusing project-scope repair: database already contains non-openclaw project_id "${projectId}".`);
        }
      }
    }
    if (apply) throw new Error('Refusing project-scope repair: generic project_id rewrites are unsafe; use a schema migration or restore/import into the intended project.');
    const changed = 0;
    const payload = {
      schemaVersion: 'cogmem.cli.v1',
      // The `command` field is dot-separated everywhere else a multi-word command reports
      // (`memory.graph-search`, `strategy.plan`, `snapshot.export`, `dream.tick`); this was the
      // one that used a space, so a consumer keying on it had to special-case one command.
      command: 'repair.project-scope',
      dbPath,
      dryRun: !apply,
      apply,
      from,
      to,
      changed,
      tables: counts,
    };
    if (hasFlag('--json')) {
      console.log(JSON.stringify(payload));
    } else {
      console.log(`${apply ? 'applied' : 'dry-run'} project-scope repair ${JSON.stringify({ from, to, changed })}`);
      for (const row of counts) console.log(`${row.table}: ${row.fromCount}`);
    }
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  emitRefusalDocument(error, 'repair');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
