import { createHash } from 'node:crypto';
import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';

interface CanonicalTable {
  name: string;
  create: string;
  columns: string[];
  notNull: string[];
  primaryKey: string[];
  preserve: boolean;
}

interface AtlasTriggerSpec {
  name: string;
  sql: string;
}

const TABLES: CanonicalTable[] = [
  {
    name: 'policy_execution_read_model',
    create: `CREATE TABLE policy_execution_read_model (
      execution_id TEXT NOT NULL, project_scope TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      runtime_id TEXT, policy TEXT NOT NULL, action TEXT NOT NULL, target TEXT, status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0, next_retry_at INTEGER, dead_lettered_at INTEGER,
      replay_policy TEXT, actor_id TEXT, causation_id TEXT, correlation_id TEXT, policy_group TEXT,
      stream_type TEXT, event_type TEXT, detail TEXT, metadata_json TEXT, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, source_global_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(project_scope,idempotency_key)
    )`,
    columns: [
      'execution_id', 'project_scope', 'idempotency_key', 'runtime_id', 'policy', 'action', 'target',
      'status', 'attempt_count', 'next_retry_at', 'dead_lettered_at', 'replay_policy', 'actor_id',
      'causation_id', 'correlation_id', 'policy_group', 'stream_type', 'event_type', 'detail',
      'metadata_json', 'created_at', 'updated_at', 'source_global_seq',
    ],
    notNull: ['execution_id', 'project_scope', 'idempotency_key', 'policy', 'action', 'status', 'attempt_count', 'created_at', 'updated_at', 'source_global_seq'],
    primaryKey: ['project_scope', 'idempotency_key'],
    preserve: true,
  },
  {
    name: 'policy_execution_audit_outbox',
    create: `CREATE TABLE policy_execution_audit_outbox (
      outbox_id TEXT NOT NULL PRIMARY KEY, project_scope TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL
    )`,
    columns: ['outbox_id', 'project_scope', 'payload_json', 'created_at'],
    notNull: ['outbox_id', 'project_scope', 'payload_json', 'created_at'],
    primaryKey: ['outbox_id'],
    preserve: true,
  },
  {
    name: 'runtime_states',
    create: `CREATE TABLE runtime_states (
      project_scope TEXT NOT NULL, runtime_id TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_key TEXT NOT NULL, status TEXT NOT NULL, metadata_json TEXT, updated_at INTEGER NOT NULL,
      PRIMARY KEY(project_scope,runtime_id,entity_type,entity_key)
    )`,
    columns: ['project_scope', 'runtime_id', 'entity_type', 'entity_key', 'status', 'metadata_json', 'updated_at'],
    notNull: ['project_scope', 'runtime_id', 'entity_type', 'entity_key', 'status', 'updated_at'],
    primaryKey: ['project_scope', 'runtime_id', 'entity_type', 'entity_key'],
    preserve: true,
  },
  {
    name: 'runtime_transitions',
    create: `CREATE TABLE runtime_transitions (
      project_scope TEXT NOT NULL, transition_id TEXT NOT NULL, runtime_id TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_key TEXT NOT NULL, transition_type TEXT NOT NULL,
      from_status TEXT, to_status TEXT NOT NULL, payload_json TEXT, occurred_at INTEGER NOT NULL,
      PRIMARY KEY(project_scope,transition_id)
    )`,
    columns: ['project_scope', 'transition_id', 'runtime_id', 'entity_type', 'entity_key', 'transition_type', 'from_status', 'to_status', 'payload_json', 'occurred_at'],
    notNull: ['project_scope', 'transition_id', 'runtime_id', 'entity_type', 'entity_key', 'transition_type', 'to_status', 'occurred_at'],
    primaryKey: ['project_scope', 'transition_id'],
    preserve: true,
  },
  {
    name: 'runtime_event_outbox',
    create: `CREATE TABLE runtime_event_outbox (
      project_scope TEXT NOT NULL, outbox_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(project_scope,outbox_id)
    )`,
    columns: ['project_scope', 'outbox_id', 'payload_json', 'created_at'],
    notNull: ['project_scope', 'outbox_id', 'payload_json', 'created_at'],
    primaryKey: ['project_scope', 'outbox_id'],
    preserve: true,
  },
  {
    name: 'runtime_projection_states',
    create: `CREATE TABLE runtime_projection_states (
      projection_name TEXT NOT NULL, project_scope TEXT NOT NULL, runtime_id TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_key TEXT NOT NULL, status TEXT NOT NULL, metadata_json TEXT,
      updated_at INTEGER NOT NULL, source_global_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(projection_name,project_scope,runtime_id,entity_type,entity_key)
    )`,
    columns: ['projection_name', 'project_scope', 'runtime_id', 'entity_type', 'entity_key', 'status', 'metadata_json', 'updated_at', 'source_global_seq'],
    notNull: ['projection_name', 'project_scope', 'runtime_id', 'entity_type', 'entity_key', 'status', 'updated_at', 'source_global_seq'],
    primaryKey: ['projection_name', 'project_scope', 'runtime_id', 'entity_type', 'entity_key'],
    preserve: true,
  },
  {
    name: 'runtime_projection_transitions',
    create: `CREATE TABLE runtime_projection_transitions (
      projection_name TEXT NOT NULL, project_scope TEXT NOT NULL, transition_id TEXT NOT NULL,
      runtime_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_key TEXT NOT NULL,
      transition_type TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, payload_json TEXT,
      occurred_at INTEGER NOT NULL, source_global_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(projection_name,project_scope,transition_id)
    )`,
    columns: ['projection_name', 'project_scope', 'transition_id', 'runtime_id', 'entity_type', 'entity_key', 'transition_type', 'from_status', 'to_status', 'payload_json', 'occurred_at', 'source_global_seq'],
    notNull: ['projection_name', 'project_scope', 'transition_id', 'runtime_id', 'entity_type', 'entity_key', 'transition_type', 'to_status', 'occurred_at', 'source_global_seq'],
    primaryKey: ['projection_name', 'project_scope', 'transition_id'],
    preserve: true,
  },
];

export const migration_0061: Migration = {
  version: '0061',
  description: 'scope runtime state and enforce projection table identities',
  requiresBackup: true,
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS runtime_scope_quarantine (
      quarantine_id TEXT PRIMARY KEY,
      source_table TEXT NOT NULL,
      record_hash TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    for (const table of TABLES) repairTable(db, table);
    createIndexes(db);
    installAtlasProjectionDirtyTriggersV3(db);
    assertRuntimeScopeAndProjectionIntegrity(db);
  },
  down() {},
};

export function runtimeScopeAndProjectionIntegritySatisfied(db: Database): boolean {
  try {
    assertRuntimeScopeAndProjectionIntegrity(db);
    return true;
  } catch {
    return false;
  }
}

export function installAtlasProjectionDirtyTriggersV3(db: Database): void {
  const triggers = atlasTriggerSpecs(db);
  if (triggers.every((trigger) => triggerMatches(db, trigger))) return;
  const repair = (): void => {
    for (const trigger of triggers) {
      db.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
      db.exec(trigger.sql);
    }
  };
  const inTransaction = Boolean((db as unknown as { inTransaction?: boolean }).inTransaction);
  if (inTransaction) repair();
  else {
    db.exec('BEGIN IMMEDIATE');
    try {
      repair();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  assertAtlasTriggersV3(db);
}

function repairTable(db: Database, table: CanonicalTable): void {
  if (!tableExists(db, table.name)) {
    db.exec(table.create);
    return;
  }
  if (tableSatisfied(db, table)) return;

  const oldName = `${table.name}_0061_old`;
  db.exec(`DROP TABLE IF EXISTS ${oldName}`);
  db.exec(`ALTER TABLE ${table.name} RENAME TO ${oldName}`);
  db.exec(table.create);
  const oldColumns = tableColumns(db, oldName);
  if (table.preserve && table.columns.every((column) => oldColumns.has(column))) {
    const columns = table.columns.join(',');
    db.exec(`INSERT INTO ${table.name}(${columns}) SELECT ${columns} FROM ${oldName}`);
  } else {
    quarantineRows(db, oldName, table.name, oldColumns.has('project_scope')
      ? 'projection_schema_invalid'
      : 'legacy_runtime_scope_unproven');
  }
  db.exec(`DROP TABLE ${oldName}`);
}

function quarantineRows(db: Database, oldName: string, sourceTable: string, reason: string): void {
  const insert = db.prepare(`INSERT OR IGNORE INTO runtime_scope_quarantine
    (quarantine_id,source_table,record_hash,reason,created_at) VALUES(?,?,?,?,?)`);
  const rows = db.prepare(`SELECT * FROM ${oldName}`).all() as Array<Record<string, unknown>>;
  for (const row of rows) {
    const recordHash = createHash('sha256').update(JSON.stringify(row)).digest('hex');
    const quarantineId = createHash('sha256').update(`${sourceTable}\0${recordHash}`).digest('hex');
    insert.run(quarantineId, sourceTable, recordHash, reason, Date.now());
  }
}

function createIndexes(db: Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_policy_execution_read_model_runtime
      ON policy_execution_read_model(project_scope,runtime_id,updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runtime_states_scope_runtime
      ON runtime_states(project_scope,runtime_id,entity_type,updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runtime_transitions_scope_runtime
      ON runtime_transitions(project_scope,runtime_id,occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runtime_event_outbox_scope
      ON runtime_event_outbox(project_scope,created_at,outbox_id);
    CREATE INDEX IF NOT EXISTS idx_runtime_projection_states_scope
      ON runtime_projection_states(projection_name,project_scope,runtime_id);
    CREATE INDEX IF NOT EXISTS idx_runtime_projection_transitions_scope
      ON runtime_projection_transitions(projection_name,project_scope,runtime_id);
  `);
}

function assertRuntimeScopeAndProjectionIntegrity(db: Database): void {
  if (!tableExists(db, 'runtime_scope_quarantine')) throw new Error('runtime_scope_quarantine_missing');
  for (const table of TABLES) {
    if (!tableSatisfied(db, table)) throw new Error(`projection_table_integrity_mismatch:${table.name}`);
  }
  assertAtlasTriggersV3(db);
  for (const index of [
    'idx_policy_execution_read_model_runtime',
    'idx_runtime_states_scope_runtime',
    'idx_runtime_transitions_scope_runtime',
    'idx_runtime_event_outbox_scope',
    'idx_runtime_projection_states_scope',
    'idx_runtime_projection_transitions_scope',
  ]) {
    if (!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name=?`).get(index)) {
      throw new Error(`projection_index_missing:${index}`);
    }
  }
}

function assertAtlasTriggersV3(db: Database): void {
  for (const trigger of atlasTriggerSpecs(db)) {
    if (!triggerMatches(db, trigger)) throw new Error(`atlas_dirty_trigger_v3_mismatch:${trigger.name}`);
  }
}

function triggerMatches(db: Database, trigger: AtlasTriggerSpec): boolean {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?`).get(trigger.name) as { sql?: string } | null;
  return Boolean(row?.sql && normalizeSql(row.sql) === normalizeSql(trigger.sql));
}

function atlasTriggerSpecs(db: Database): AtlasTriggerSpec[] {
  const sources = [
    'memory_entities', 'memory_topics', 'memory_clusters', 'memory_episodes', 'beliefs', 'memory_bindings',
    'topic_nodes', 'topic_aliases', 'topic_relations', 'memory_events',
  ].filter((table) => tableExists(db, table));
  return sources.flatMap((table) => (['INSERT', 'UPDATE', 'DELETE'] as const).map((operation) => {
    const name = `trg_memory_atlas_dirty_${table}_${operation.toLowerCase()}`;
    if (table !== 'memory_events') {
      const ref = operation === 'DELETE' ? 'OLD' : 'NEW';
      const old = operation === 'UPDATE' ? atlasDirtyStatements(`COALESCE(OLD.project_id,'')`) : '';
      return {
        name,
        sql: `CREATE TRIGGER ${name} AFTER ${operation} ON ${table} BEGIN
          ${atlasDirtyStatements(`COALESCE(${ref}.project_id,'')`)}
          ${old}
        END`,
      };
    }
    const ref = operation === 'DELETE' ? 'OLD' : 'NEW';
    const old = operation === 'UPDATE'
      ? atlasDirtyStatements(`COALESCE(OLD.project_id,'')`, `OLD.role IN ('user','tool')`)
      : '';
    const updateColumns = operation === 'UPDATE'
      ? ' OF project_id,role,payload_json,occurred_at,local_date,event_type'
      : '';
    return {
      name,
      sql: `CREATE TRIGGER ${name} AFTER ${operation}${updateColumns} ON memory_events
        WHEN ${operation === 'UPDATE'
          ? `NEW.role IN ('user','tool') OR OLD.role IN ('user','tool')`
          : `${ref}.role IN ('user','tool')`} BEGIN
        ${atlasDirtyStatements(`COALESCE(${ref}.project_id,'')`, `${ref}.role IN ('user','tool')`)}
        ${old}
      END`,
    };
  }));
}

function atlasDirtyStatements(scope: string, guard = '1'): string {
  return `
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT ${scope},'memory_atlas.v2',NULL,'dirty',NULL,NULL,'{}' WHERE ${guard}
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
    INSERT INTO memory_atlas_projection_state(
      project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json
    ) SELECT ${scope},'memory_atlas.v1',NULL,'dirty',NULL,NULL,'{}' WHERE ${guard}
    ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty',cursor_value=NULL,last_error=NULL;
  `;
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/;$/, '').toLowerCase();
}

function tableSatisfied(db: Database, table: CanonicalTable): boolean {
  const info = db.prepare(`PRAGMA table_info(${table.name})`).all() as Array<{ name: string; notnull: number; pk: number }>;
  if (info.length !== table.columns.length) return false;
  if (info.map((column) => column.name).join('|') !== table.columns.join('|')) return false;
  if (table.notNull.some((name) => info.find((column) => column.name === name)?.notnull !== 1)) return false;
  const primaryKey = info.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
  return primaryKey.join('|') === table.primaryKey.join('|');
}

function tableExists(db: Database, name: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}

function tableColumns(db: Database, name: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map((row) => row.name));
}
