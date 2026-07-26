#!/usr/bin/env bun
import Database from 'bun:sqlite';

import { loadCogmemConfig, resolveCogmemConfigPath } from '../config/CogmemConfig.js';

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
    '       cogmem repair task-identity --task-id <id> --project <projectId> --task-key <key> --title <title> --status <status> [--db <memory.db>|--config <config.toml>] [--dry-run|--apply] [--json]',
    '',
    'Conservatively moves empty-project upgrade residue into a real project scope.',
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
  const [command] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (!['project-scope', 'task-identity'].includes(command || '') || hasFlag('--help') || hasFlag('-h')) {
    console.log(usage());
    process.exit(['project-scope', 'task-identity'].includes(command || '') ? 0 : 1);
  }
  if (command === 'task-identity') return repairTaskIdentity();
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
      command: 'repair project-scope',
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

function repairTaskIdentity(): void {
  const taskId = readArg('--task-id');
  const projectId = readArg('--project');
  const taskKey = readArg('--task-key');
  const title = readArg('--title');
  const status = readArg('--status');
  if (!taskId || projectId === undefined || !taskKey || !title || !status) throw new Error(`Missing task identity field.\n${usage()}`);
  if (!['active', 'derived'].includes(status)) throw new Error('Invalid task status; expected active or derived.');
  const apply = hasFlag('--apply');
  const dbPath = dbPathFromArgs();
  const db = new Database(dbPath);
  db.exec('PRAGMA busy_timeout = 5000;');
  try {
    const current = db.prepare(`SELECT task_id,COALESCE(project_id,'') AS project_id,task_key,title,status FROM task_branches WHERE task_id=?`)
      .get(taskId) as { task_id: string; project_id: string; task_key: string; title: string; status: string } | null;
    if (!current) throw new Error(`Unknown task: ${taskId}`);
    const recovery = db.prepare(`SELECT recovery_status FROM task_identity_restoration_manifest WHERE task_id=?`)
      .get(taskId) as { recovery_status: string } | null;
    const quarantine = db.prepare(`SELECT 1 FROM task_identity_recovery_quarantine WHERE task_id=?`).get(taskId);
    if (recovery?.recovery_status !== 'unresolved' || !quarantine) throw new Error(`Task is not unresolved or lacks quarantine provenance: ${taskId}`);
    if (projectId !== current.project_id) throw new Error('Task identity repair cannot change project scope.');
    const collision = db.prepare(`SELECT task_id FROM task_branches WHERE project_id=? AND task_key=? AND task_id<>?`)
      .get(projectId, taskKey, taskId);
    if (collision) throw new Error(`Task identity collision: ${projectId}:${taskKey}`);
    if (apply) db.transaction(() => {
      const oldKey = current.task_key;
      const cognitiveNodeIds = db.prepare(`SELECT node_id FROM cognitive_nodes WHERE project_id=? AND node_type='task_branch' AND node_key=?`)
        .all(projectId, oldKey) as Array<{ node_id: string }>;
      for (const node of cognitiveNodeIds) {
        db.prepare(`DELETE FROM cognitive_edges WHERE source_node_id=? OR target_node_id=?`).run(node.node_id, node.node_id);
        db.prepare(`DELETE FROM cognitive_nodes WHERE node_id=?`).run(node.node_id);
      }
      db.prepare(`DELETE FROM topology_membership WHERE COALESCE(project_id,'')=? AND dimension_type='task_branch' AND dimension_key=?`)
        .run(projectId, oldKey);
      db.prepare(`UPDATE task_branches SET project_id=?,task_key=?,title=?,status=?,updated_at=? WHERE task_id=?`)
        .run(projectId, taskKey, title, status, Date.now(), taskId);
      db.prepare(`UPDATE task_branch_entries SET project_id=? WHERE task_id=?`).run(projectId, taskId);
      db.prepare(`UPDATE task_identity_restoration_manifest
        SET project_id=?,task_key=?,title=?,status=?,source='operator_confirmed',recovery_status='operator_confirmed',recorded_at=?
        WHERE task_id=?`).run(projectId, taskKey, title, status, Date.now(), taskId);
      db.prepare(`DELETE FROM task_identity_recovery_quarantine WHERE task_id=?`).run(taskId);
      db.prepare(`UPDATE topology_projection_state SET status='dirty',updated_at=?,error=NULL WHERE project_id=?`)
        .run(Date.now(), projectId);
      db.prepare(`INSERT INTO migration_repair_receipts(repair_id,migration_version,repair_type,details_json,created_at)
        VALUES(?,?,?,?,?)`).run(
        `task-identity-${taskId}-${Date.now()}`,'0058','task_identity_operator_confirmation',
        JSON.stringify({ taskId, projectId, previousTaskKey: oldKey, taskKey, title, status }),Date.now(),
      );
    })();
    const payload = { schemaVersion: 'cogmem.cli.v1', command: 'repair task-identity', dbPath, dryRun: !apply, apply, taskId, projectId, taskKey, title, status, current };
    console.log(hasFlag('--json') ? JSON.stringify(payload) : `${apply ? 'applied' : 'dry-run'} task-identity repair ${JSON.stringify(payload)}`);
  } finally {
    db.close();
  }
}

main();
