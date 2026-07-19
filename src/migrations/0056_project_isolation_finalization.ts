import { createHash } from 'node:crypto';
import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';

export const migration_0056: Migration = {
  version: '0056',
  description: 'finalize project-scoped entity, event, vector, and task recovery state',
  up(db) {
    preserveOrRejectTaskRecovery(db);
    rebuildEntityAliases(db);
    rebuildEntityRelations(db);
    rebuildAliasConflicts(db);
    rebuildMemoryEvents(db);
    rebuildNeuronEmbeddings(db);
    migrateMemoryEntityProjectionIds(db);
    assertProjectIsolationFinalized(db);
  },
  down() {},
};

function preserveOrRejectTaskRecovery(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS task_identity_restoration_manifest (
    task_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_key TEXT NOT NULL,
    title TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, recorded_at INTEGER NOT NULL
  )`);
  if (!tableExists(db, 'task_branches')) return;
  const count = Number((db.prepare(`SELECT COUNT(*) AS count FROM task_branches`).get() as { count: number }).count);
  if (count === 0) return;
  if (!tempTableExists(db, '_0055_task_identity_backup') && !tempTableExists(db, '_0055_task_metadata_backup')) {
    const ids = (db.prepare(`SELECT task_id FROM task_branches ORDER BY task_id LIMIT 20`).all() as Array<{ task_id: string }>).map((row) => row.task_id);
    throw new Error(`migration_0056_task_identity_recovery_unproven:${ids.join(',')}`);
  }
  const source = tempTableExists(db, '_0055_task_identity_backup') ? 'pre_0052_backup' : 'pre_0054_backup';
  const table = source === 'pre_0052_backup' ? 'temp._0055_task_identity_backup' : 'temp._0055_task_metadata_backup';
  db.exec(`INSERT OR REPLACE INTO task_identity_restoration_manifest(task_id,project_id,task_key,title,status,source,recorded_at)
    SELECT task_id,COALESCE(project_id,''),task_key,title,status,'${source}',unixepoch()*1000 FROM ${table}`);
}

function rebuildEntityAliases(db: Database): void {
  if (!tableExists(db, 'entity_aliases')) return;
  const rows = db.prepare(`SELECT * FROM entity_aliases`).all() as Array<Record<string, unknown>>;
  db.exec(`DROP TABLE entity_aliases; CREATE TABLE entity_aliases (
    alias_id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '',
    alias_text TEXT NOT NULL, normalized_alias TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(project_id,entity_id,normalized_alias)
  ); CREATE INDEX idx_entity_aliases_lookup ON entity_aliases(project_id,normalized_alias,updated_at DESC)`);
  const insert = db.prepare(`INSERT OR IGNORE INTO entity_aliases(alias_id,entity_id,project_id,alias_text,normalized_alias,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`);
  for (const row of rows) {
    const scopes = entityScopes(db, String(row.entity_id));
    if (scopes.length === 1) insert.run(String(row.alias_id), String(row.entity_id), scopes[0]!, String(row.alias_text), String(row.normalized_alias), Number(row.created_at), Number(row.updated_at));
  }
  if (tableExists(db, 'entity_instances')) {
    for (const row of db.prepare(`SELECT instance_id FROM entity_instances`).all() as Array<{ instance_id: string }>) {
      if (entityScopes(db, row.instance_id).length > 1) db.prepare(`UPDATE entity_instances SET aliases_json='[]',metadata_json='{}' WHERE instance_id=?`).run(row.instance_id);
    }
  }
}

function rebuildEntityRelations(db: Database): void {
  if (!tableExists(db, 'entity_relations')) return;
  const rows = db.prepare(`SELECT * FROM entity_relations`).all() as Array<Record<string, unknown>>;
  db.exec(`DROP TABLE entity_relations; CREATE TABLE entity_relations (
    relation_id TEXT PRIMARY KEY, project_id TEXT NOT NULL DEFAULT '', source_entity_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL, relation_type TEXT NOT NULL, source_neuron_id TEXT, created_at INTEGER NOT NULL,
    UNIQUE(project_id,source_entity_id,target_entity_id,relation_type)
  )`);
  const insert = db.prepare(`INSERT OR IGNORE INTO entity_relations(relation_id,project_id,source_entity_id,target_entity_id,relation_type,source_neuron_id,created_at) VALUES(?,?,?,?,?,?,?)`);
  for (const row of rows) {
    const sourceScopes = entityScopes(db, String(row.source_entity_id));
    const targetScopes = new Set(entityScopes(db, String(row.target_entity_id)));
    let scopes = sourceScopes.filter((scope) => targetScopes.has(scope));
    if (row.source_neuron_id && tableExists(db, 'neurons')) {
      const neuron = db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM neurons WHERE id=? AND is_deleted=0`).get(String(row.source_neuron_id)) as { scope: string } | null;
      scopes = neuron && scopes.includes(neuron.scope) ? [neuron.scope] : [];
    }
    if (scopes.length === 1) insert.run(String(row.relation_id), scopes[0]!, String(row.source_entity_id), String(row.target_entity_id), String(row.relation_type), row.source_neuron_id == null ? null : String(row.source_neuron_id), Number(row.created_at));
  }
}

function rebuildAliasConflicts(db: Database): void {
  if (!tableExists(db, 'entity_alias_conflicts')) return;
  db.exec(`DROP TABLE entity_alias_conflicts; CREATE TABLE entity_alias_conflicts (
    conflict_id TEXT PRIMARY KEY, project_id TEXT NOT NULL DEFAULT '', normalized_alias TEXT NOT NULL,
    entity_type TEXT NOT NULL, entity_ids_json TEXT NOT NULL, policy TEXT NOT NULL, status TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(project_id,normalized_alias,entity_type)
  ); CREATE INDEX idx_entity_alias_conflicts_lookup ON entity_alias_conflicts(project_id,normalized_alias,entity_type,status)`);
}

function rebuildMemoryEvents(db: Database): void {
  if (!tableExists(db, 'memory_events')) return;
  const columns = tableColumns(db, 'memory_events');
  const hasScope = columns.has('project_scope');
  db.exec(`ALTER TABLE memory_events RENAME TO memory_events_0056_old; CREATE TABLE memory_events (
    event_id TEXT PRIMARY KEY, global_seq INTEGER, stream_id TEXT NOT NULL, stream_type TEXT NOT NULL,
    event_type TEXT NOT NULL, raw_event_type TEXT, event_version INTEGER NOT NULL, project_id TEXT,
    project_scope TEXT NOT NULL DEFAULT '', workspace_id TEXT, actor_id TEXT, causation_id TEXT, correlation_id TEXT,
    source_neuron_id TEXT, source_id TEXT, content_hash TEXT, thread_id TEXT, session_id TEXT, local_date TEXT,
    local_date_source TEXT NOT NULL DEFAULT 'legacy_unknown', thread_seq INTEGER, turn_id TEXT, turn_seq INTEGER,
    event_ordinal INTEGER, role TEXT, parent_event_id TEXT, prev_event_id TEXT, next_event_id TEXT, causality_type TEXT,
    source_offset INTEGER, line_start INTEGER, line_end INTEGER, char_start INTEGER, char_end INTEGER,
    ordering_confidence TEXT, occurred_at INTEGER NOT NULL, payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000), UNIQUE(project_scope,stream_id,event_version)
  )`);
  const names = [...columns].filter((name) => name !== 'project_scope');
  db.exec(`INSERT INTO memory_events(${names.join(',')},project_scope) SELECT ${names.join(',')},${hasScope ? `COALESCE(project_scope,'')` : `COALESCE(project_id,'')`} FROM memory_events_0056_old; DROP TABLE memory_events_0056_old;
    CREATE INDEX idx_memory_events_stream ON memory_events(project_scope,stream_type,stream_id,event_version);
    CREATE INDEX idx_memory_events_type_time ON memory_events(event_type,occurred_at DESC);
    CREATE INDEX idx_memory_events_global_seq ON memory_events(global_seq);
    CREATE INDEX idx_memory_events_thread_order ON memory_events(project_scope,thread_id,thread_seq,event_ordinal,global_seq);
    CREATE INDEX idx_memory_events_parent ON memory_events(parent_event_id)`);
}

function rebuildNeuronEmbeddings(db: Database): void {
  if (!tableExists(db, 'neuron_embeddings')) return;
  db.exec(`ALTER TABLE neuron_embeddings RENAME TO neuron_embeddings_0056_old; CREATE TABLE neuron_embeddings (
    neuron_id TEXT NOT NULL, project_id TEXT, model_id TEXT NOT NULL, dimensions INTEGER NOT NULL,
    vector_blob BLOB NOT NULL, status TEXT NOT NULL DEFAULT 'done', retry_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL, PRIMARY KEY(neuron_id,model_id), FOREIGN KEY(neuron_id) REFERENCES neurons(id) ON DELETE CASCADE
  ); INSERT INTO neuron_embeddings SELECT e.* FROM neuron_embeddings_0056_old e JOIN neurons n ON n.id=e.neuron_id AND n.is_deleted=0 AND COALESCE(n.project_id,'')=COALESCE(e.project_id,'');
    DROP TABLE neuron_embeddings_0056_old; CREATE INDEX idx_neuron_embeddings_project ON neuron_embeddings(project_id,model_id)`);
}

function migrateMemoryEntityProjectionIds(db: Database): void {
  if (!tableExists(db, 'memory_entities')) return;
  const rows = db.prepare(`SELECT * FROM memory_entities`).all() as Array<Record<string, unknown>>;
  const insert = db.prepare(`INSERT OR IGNORE INTO memory_entities(entity_id,project_id,canonical_name,entity_type,aliases_json,stable_path,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`);
  for (const row of rows) {
    const oldId = String(row.entity_id);
    const scopes = new Set<string>([String(row.project_id ?? '')]);
    if (tableExists(db, 'memory_bindings')) for (const item of db.prepare(`SELECT DISTINCT COALESCE(project_id,'') AS scope FROM memory_bindings WHERE entity_id=?`).all(oldId) as Array<{ scope: string }>) scopes.add(item.scope);
    for (const scope of scopes) {
      const nextId = scopedMemoryEntityId(scope, String(row.entity_type), oldId);
      insert.run(nextId, scope || null, String(row.canonical_name), String(row.entity_type), String(row.aliases_json), row.stable_path == null ? null : String(row.stable_path), Number(row.created_at), Number(row.updated_at));
      if (tableExists(db, 'memory_bindings')) db.prepare(`UPDATE memory_bindings SET entity_id=? WHERE entity_id=? AND COALESCE(project_id,'')=?`).run(nextId, oldId, scope);
      if (tableExists(db, 'memory_edges')) {
        db.prepare(`UPDATE memory_edges SET source_id=? WHERE source_type='entity' AND source_id=? AND COALESCE(project_id,'')=?`).run(nextId, oldId, scope);
        db.prepare(`UPDATE memory_edges SET target_id=? WHERE target_type='entity' AND target_id=? AND COALESCE(project_id,'')=?`).run(nextId, oldId, scope);
      }
    }
    db.prepare(`DELETE FROM memory_entities WHERE entity_id=?`).run(oldId);
  }
}

export function projectIsolationFinalizationSatisfied(db: Database): boolean {
  return (!tableExists(db, 'memory_events') || tableColumns(db, 'memory_events').has('project_scope'))
    && (!tableExists(db, 'entity_aliases') || tableColumns(db, 'entity_aliases').has('project_id'))
    && (!tableExists(db, 'entity_relations') || tableColumns(db, 'entity_relations').has('project_id'))
    && (!tableExists(db, 'entity_alias_conflicts') || tableColumns(db, 'entity_alias_conflicts').has('project_id'))
    && tableExists(db, 'task_identity_restoration_manifest');
}

function assertProjectIsolationFinalized(db: Database): void { if (!projectIsolationFinalizationSatisfied(db)) throw new Error('project_isolation_finalization_failed'); }
function entityScopes(db: Database, entityId: string): string[] {
  const scopes = new Set<string>();
  if (tableExists(db, 'entity_instances')) {
    const row = db.prepare(`SELECT json_extract(metadata_json,'$.projectId') AS project_id FROM entity_instances WHERE instance_id=?`).get(entityId) as { project_id?: string | null } | null;
    if (typeof row?.project_id === 'string') scopes.add(row.project_id);
  }
  if (tableExists(db, 'entity_mentions')) for (const row of db.prepare(`SELECT DISTINCT COALESCE(project_id,'') AS project_id FROM entity_mentions WHERE entity_id=?`).all(entityId) as Array<{ project_id: string }>) scopes.add(row.project_id);
  return [...scopes].sort();
}
function scopedMemoryEntityId(projectId: string, type: string, sourceId: string): string { return `entity-${createHash('sha256').update([projectId,type,sourceId].join('\0')).digest('hex').slice(0,24)}`; }
function tableExists(db: Database, name: string): boolean { return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name)); }
function tempTableExists(db: Database, name: string): boolean { return Boolean(db.prepare(`SELECT 1 FROM sqlite_temp_master WHERE type='table' AND name=?`).get(name)); }
function tableColumns(db: Database, name: string): Set<string> { return new Set((db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map((row) => row.name)); }
