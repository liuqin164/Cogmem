import type Database from 'bun:sqlite';
// Internal atomic 3.7.4 installation step; never receives its own migration receipt.
import type { Migration } from '../../types/Migration.js';

interface AtlasTriggerSpec {
  name: string;
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  sql: string;
}

export const migration_0060: Migration = {
  version: '0060',
  description: 'separate execution ledgers, sequence projectors, and repair Atlas invalidation',
  up(db) {
    createReliabilitySchema(db);
    installAtlasProjectionDirtyTriggersV2(db);
    assertExecutionProjectionAndAtlasReliability(db);
  },
  down() {},
};

export function installAtlasProjectionDirtyTriggersV2(db: Database): void {
  for (const operation of ['insert', 'update', 'delete']) {
    db.exec(`DROP TRIGGER IF EXISTS trg_memory_atlas_dirty_memory_frames_${operation}`);
  }
  for (const trigger of atlasTriggerSpecs(db)) {
    db.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
    db.exec(trigger.sql);
  }
  assertAtlasTriggers(db);
}

export function executionProjectionAndAtlasReliabilitySatisfied(db: Database): boolean {
  try {
    assertExecutionProjectionAndAtlasReliability(db);
    return true;
  } catch {
    return false;
  }
}

function createReliabilitySchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS policy_execution_read_model (
      execution_id TEXT NOT NULL,
      project_scope TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      runtime_id TEXT,
      policy TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER,
      dead_lettered_at INTEGER,
      replay_policy TEXT,
      actor_id TEXT,
      causation_id TEXT,
      correlation_id TEXT,
      policy_group TEXT,
      stream_type TEXT,
      event_type TEXT,
      detail TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source_global_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(project_scope,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_policy_execution_read_model_runtime
      ON policy_execution_read_model(project_scope,runtime_id,updated_at DESC);

    CREATE TABLE IF NOT EXISTS policy_execution_audit_outbox (
      outbox_id TEXT PRIMARY KEY,
      project_scope TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runtime_event_outbox (
      outbox_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runtime_projection_states (
      projection_name TEXT NOT NULL,
      runtime_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata_json TEXT,
      updated_at INTEGER NOT NULL,
      source_global_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(projection_name,runtime_id,entity_type,entity_key)
    );

    CREATE TABLE IF NOT EXISTS runtime_projection_transitions (
      projection_name TEXT NOT NULL,
      transition_id TEXT NOT NULL,
      runtime_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL,
      transition_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      payload_json TEXT,
      occurred_at INTEGER NOT NULL,
      PRIMARY KEY(projection_name,transition_id)
    );

    CREATE TABLE IF NOT EXISTS policy_projection_state (
      projection_name TEXT PRIMARY KEY,
      last_event_id TEXT,
      last_event_time INTEGER,
      last_global_seq INTEGER,
      last_rebuild_at INTEGER,
      last_full_count INTEGER NOT NULL DEFAULT 0,
      last_checksum TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS runtime_projection_state (
      projection_name TEXT PRIMARY KEY,
      last_event_id TEXT,
      last_event_time INTEGER,
      last_global_seq INTEGER,
      last_rebuild_at INTEGER,
      last_full_count INTEGER NOT NULL DEFAULT 0,
      last_checksum TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS vector_projection_state (
      projection_name TEXT PRIMARY KEY,
      last_event_id TEXT,
      last_event_time INTEGER,
      last_global_seq INTEGER,
      last_rebuild_at INTEGER,
      last_full_count INTEGER NOT NULL DEFAULT 0,
      last_checksum TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      metadata_json TEXT
    );
  `);
  for (const table of ['policy_projection_state', 'runtime_projection_state', 'vector_projection_state']) {
    addColumn(db, table, 'last_global_seq', 'INTEGER');
  }
  addColumn(db, 'policy_execution_read_model', 'source_global_seq', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'runtime_projection_states', 'source_global_seq', 'INTEGER NOT NULL DEFAULT 0');
}

function assertExecutionProjectionAndAtlasReliability(db: Database): void {
  for (const table of [
    'policy_execution_read_model',
    'policy_execution_audit_outbox',
    'runtime_event_outbox',
    'runtime_projection_states',
    'runtime_projection_transitions',
  ]) {
    if (!tableExists(db, table)) throw new Error(`execution_projection_table_missing:${table}`);
  }
  for (const table of ['policy_projection_state', 'runtime_projection_state', 'vector_projection_state']) {
    if (!tableColumns(db, table).has('last_global_seq')) throw new Error(`projection_global_seq_missing:${table}`);
  }
  if (!tableColumns(db, 'policy_execution_read_model').has('source_global_seq')) throw new Error('policy_read_model_sequence_missing');
  if (!tableColumns(db, 'runtime_projection_states').has('source_global_seq')) throw new Error('runtime_read_model_sequence_missing');
  assertAtlasTriggers(db);
}

function assertAtlasTriggers(db: Database): void {
  for (const trigger of atlasTriggerSpecs(db)) {
    const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?`).get(trigger.name) as { sql?: string } | null;
    if (!row?.sql || normalizeSql(row.sql) !== normalizeSql(trigger.sql)) {
      throw new Error(`atlas_dirty_trigger_mismatch:${trigger.name}`);
    }
  }
}

function atlasTriggerSpecs(db: Database): AtlasTriggerSpec[] {
  const sources = [
    'memory_entities', 'memory_topics', 'memory_clusters', 'memory_episodes', 'beliefs', 'memory_bindings',
    'topic_nodes', 'topic_aliases', 'topic_relations', 'memory_events',
  ].filter((table) => tableExists(db, table));
  return sources.flatMap((table) => (['INSERT', 'UPDATE', 'DELETE'] as const).map((operation) => {
    const ref = operation === 'DELETE' ? 'OLD' : 'NEW';
    const old = operation === 'UPDATE' ? atlasDirtyStatements(`COALESCE(OLD.project_id,'')`) : '';
    const name = `trg_memory_atlas_dirty_${table}_${operation.toLowerCase()}`;
    return {
      name,
      table,
      operation,
      sql: `CREATE TRIGGER ${name} AFTER ${operation} ON ${table} BEGIN
        ${atlasDirtyStatements(`COALESCE(${ref}.project_id,'')`)}
        ${old}
      END`,
    };
  }));
}

function atlasDirtyStatements(scope: string): string {
  return `
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) VALUES(${scope},'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}')
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) VALUES(${scope},'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}')
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
  `;
}

function addColumn(db: Database, table: string, column: string, declaration: string): void {
  if (!tableColumns(db, table).has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/;$/, '').toLowerCase();
}

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table));
}

function tableColumns(db: Database, table: string): Set<string> {
  return tableExists(db, table)
    ? new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name))
    : new Set();
}
