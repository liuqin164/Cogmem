import { createHash } from 'node:crypto';
// Internal atomic 3.7.4 installation step; never receives its own migration receipt.
import type Database from 'bun:sqlite';
import type { Migration } from '../../types/Migration.js';

const INDEXES = [
  ['idx_policy_execution_read_model_runtime', 'policy_execution_read_model', ['project_scope', 'runtime_id', 'updated_at']],
  ['idx_runtime_states_scope_runtime', 'runtime_states', ['project_scope', 'runtime_id', 'entity_type', 'updated_at']],
  ['idx_runtime_transitions_scope_runtime', 'runtime_transitions', ['project_scope', 'runtime_id', 'occurred_at']],
  ['idx_runtime_event_outbox_scope', 'runtime_event_outbox', ['project_scope', 'created_at', 'outbox_id']],
  ['idx_runtime_projection_states_scope', 'runtime_projection_states', ['projection_name', 'project_scope', 'runtime_id']],
  ['idx_runtime_projection_transitions_scope', 'runtime_projection_transitions', ['projection_name', 'project_scope', 'runtime_id']],
] as const;

export const migration_0062: Migration = {
  version: '0062',
  description: 'discard unscoped projector events and persist outbox recovery state',
  requiresBackup: true,
  up(db) {
    finalizeDiscardReceipts(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS projection_event_discard_receipts (
        projector TEXT NOT NULL,
        event_id TEXT NOT NULL,
        global_seq INTEGER NOT NULL DEFAULT 0,
        event_type TEXT NOT NULL,
        event_identity_hash TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(projector,event_id)
      );
    `);
    addColumn(db, 'policy_executions', 'execution_outcome', 'TEXT');
    addColumn(db, 'policy_execution_read_model', 'execution_outcome', 'TEXT');
    for (const table of ['policy_executions', 'policy_execution_read_model']) {
      if (!tableExists(db, table)) continue;
      db.exec(`UPDATE ${table} SET execution_outcome=CASE
        WHEN status IN ('executed','skipped') THEN 'executed'
        WHEN status='failed' THEN 'outcome_unknown'
        ELSE NULL END
        WHERE execution_outcome IS NULL`);
    }
    for (const table of ['policy_execution_audit_outbox', 'runtime_event_outbox']) {
      addColumn(db, table, 'attempt_count', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, table, 'last_error', 'TEXT');
      addColumn(db, table, 'next_retry_at', 'INTEGER');
      addColumn(db, table, 'dead_lettered_at', 'INTEGER');
    }
    reinstallIndexes(db);
    recordUnscopedEvents(db);
    if (tableExists(db, 'runtime_projection_state')) db.exec(`DELETE FROM runtime_projection_state`);
    if (tableExists(db, 'policy_projection_state')) {
      db.exec(`DELETE FROM policy_projection_state WHERE projection_name LIKE 'policy_execution_projection:%'`);
    }
    assertProjectionScopeAndOutboxRecovery(db);
  },
  down() {},
};

export function projectionScopeAndOutboxRecoverySatisfied(db: Database): boolean {
  try {
    assertProjectionScopeAndOutboxRecovery(db);
    return true;
  } catch {
    return false;
  }
}

function finalizeDiscardReceipts(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS runtime_scope_discard_receipts (
    quarantine_id TEXT PRIMARY KEY,
    source_table TEXT NOT NULL,
    record_hash TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  if (tableExists(db, 'runtime_scope_quarantine')) {
    db.exec(`INSERT OR IGNORE INTO runtime_scope_discard_receipts
      SELECT quarantine_id,source_table,record_hash,reason,created_at FROM runtime_scope_quarantine`);
    db.exec(`DROP TABLE runtime_scope_quarantine`);
  }
}

function recordUnscopedEvents(db: Database): void {
  if (!tableExists(db, 'memory_events')) return;
  const rows = db.prepare(`
    SELECT event_id,COALESCE(global_seq,0) AS global_seq,stream_id,stream_type,event_type,event_version,
      project_id,occurred_at,payload_hash,causation_id,correlation_id,actor_id,source_id
    FROM memory_events
    WHERE project_id IS NULL
      AND event_type IN ('RUNTIME_STATE_UPDATED','RUNTIME_TRANSITION_RECORDED','POLICY_EXECUTION_UPDATED')
  `).all() as Array<Record<string, unknown> & { event_id: string; global_seq: number; event_type: string }>;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO projection_event_discard_receipts(
      projector,event_id,global_seq,event_type,event_identity_hash,reason,created_at
    ) VALUES(?,?,?,?,?,?,?)
  `);
  for (const row of rows) {
    const projector = row.event_type.startsWith('RUNTIME_') ? 'runtime' : 'policy_execution';
    const eventIdentityHash = createHash('sha256')
      .update(JSON.stringify(row))
      .digest('hex');
    insert.run(projector, row.event_id, row.global_seq, row.event_type, eventIdentityHash, 'legacy_event_scope_unproven', Date.now());
  }
}

function reinstallIndexes(db: Database): void {
  for (const [name, table, columns] of INDEXES) {
    db.exec(`DROP INDEX IF EXISTS ${name}`);
    db.exec(`CREATE INDEX ${name} ON ${table}(${columns.join(',')})`);
  }
}

function assertProjectionScopeAndOutboxRecovery(db: Database): void {
  if (!tableExists(db, 'runtime_scope_discard_receipts')) throw new Error('runtime_scope_discard_receipts_missing');
  if (tableExists(db, 'runtime_scope_quarantine')) throw new Error('runtime_scope_quarantine_retained');
  if (!tableExists(db, 'projection_event_discard_receipts')) throw new Error('projection_event_discard_receipts_missing');
  assertColumns(db, 'projection_event_discard_receipts', ['event_identity_hash']);
  assertColumns(db, 'policy_executions', ['execution_outcome']);
  assertColumns(db, 'policy_execution_read_model', ['execution_outcome']);
  for (const table of ['policy_execution_audit_outbox', 'runtime_event_outbox']) {
    assertColumns(db, table, ['attempt_count', 'last_error', 'next_retry_at', 'dead_lettered_at']);
    const attempt = tableInfo(db, table).find((column) => column.name === 'attempt_count');
    if (attempt?.type !== 'INTEGER' || attempt.notnull !== 1 || String(attempt.dflt_value) !== '0') {
      throw new Error(`projection_column_mismatch:${table}:attempt_count`);
    }
  }
  for (const [name, table, columns] of INDEXES) {
    const index = (db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string; unique: number }>)
      .find((item) => item.name === name);
    if (!index || index.unique !== 0) throw new Error(`projection_index_mismatch:${name}`);
    const actual = (db.prepare(`PRAGMA index_info(${name})`).all() as Array<{ name: string; seqno: number }>)
      .sort((left, right) => left.seqno - right.seqno)
      .map((item) => item.name);
    if (actual.join('|') !== columns.join('|')) throw new Error(`projection_index_mismatch:${name}`);
  }
}

function addColumn(db: Database, table: string, name: string, definition: string): void {
  if (!tableExists(db, table) || tableInfo(db, table).some((column) => column.name === name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function assertColumns(db: Database, table: string, columns: string[]): void {
  const actual = new Set(tableInfo(db, table).map((column) => column.name));
  if (columns.some((column) => !actual.has(column))) throw new Error(`projection_columns_missing:${table}`);
}

function tableInfo(db: Database, table: string): Array<{
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
}> {
  return db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
  }>;
}

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table));
}
