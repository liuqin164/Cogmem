import { createHash } from 'node:crypto';
export const migration_0057 = {
    version: '0057',
    description: 'compensate legacy project isolation and scope ingestion identities',
    up(db) {
        classifyTaskRecovery(db);
        auditEntityIsolation(db);
        rebuildAliasConflicts(db);
        migrateIngestionIdentity(db);
        migrateEventCounters(db);
        assertProjectIsolationCompensated(db);
    },
    down() { },
};
function classifyTaskRecovery(db) {
    if (!tableExists(db, 'task_identity_restoration_manifest'))
        return;
    const columns = tableColumns(db, 'task_identity_restoration_manifest');
    if (!columns.has('recovery_status'))
        db.exec(`ALTER TABLE task_identity_restoration_manifest ADD COLUMN recovery_status TEXT NOT NULL DEFAULT 'unresolved'`);
    db.exec(`UPDATE task_identity_restoration_manifest SET recovery_status=CASE
    WHEN source IN ('pre_0052_backup','pre_0054_backup') THEN 'verified_original'
    WHEN source='restored_from_snapshot' THEN 'restored_from_snapshot'
    WHEN source='operator_confirmed' THEN 'operator_confirmed'
    ELSE 'unresolved' END`);
    db.exec(`CREATE TABLE IF NOT EXISTS task_identity_recovery_quarantine (
    task_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_key TEXT NOT NULL,
    title TEXT NOT NULL, status TEXT NOT NULL, manifest_source TEXT NOT NULL,
    reason TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
    db.exec(`INSERT OR REPLACE INTO task_identity_recovery_quarantine
    SELECT task_id,project_id,task_key,title,status,source,'original_task_identity_unproven',unixepoch()*1000
    FROM task_identity_restoration_manifest WHERE recovery_status='unresolved'`);
}
function auditEntityIsolation(db) {
    ensureAuditTable(db);
    if (tableExists(db, 'entity_aliases') && tableExists(db, 'entity_instances')) {
        const original = count(db, 'entity_aliases');
        const invalid = db.prepare(`SELECT a.* FROM entity_aliases a LEFT JOIN entity_instances i ON i.instance_id=a.entity_id
      WHERE i.instance_id IS NULL OR NOT (
        json_extract(i.metadata_json,'$.projectId')=a.project_id
        OR EXISTS (SELECT 1 FROM entity_mentions m WHERE m.entity_id=a.entity_id AND COALESCE(m.project_id,'')=a.project_id)
      )`).all();
        for (const row of invalid)
            quarantine(db, 'entity_alias_0057', String(row.alias_id), row, String(row.project_id ?? ''), 'entity_alias_scope_unproven');
        if (invalid.length)
            db.exec(`DELETE FROM entity_aliases WHERE alias_id IN (
      SELECT old_parent_id FROM topology_identity_quarantine WHERE identity_type='entity_alias_0057'
    )`);
        recordAudit(db, 'entity_aliases', original, count(db, 'entity_aliases'), invalid.length, 0);
    }
    if (tableExists(db, 'entity_relations')) {
        const original = count(db, 'entity_relations');
        const invalid = db.prepare(`SELECT r.* FROM entity_relations r WHERE NOT (
      EXISTS (SELECT 1 FROM entity_mentions m WHERE m.entity_id=r.source_entity_id AND COALESCE(m.project_id,'')=r.project_id)
      OR EXISTS (SELECT 1 FROM entity_instances i WHERE i.instance_id=r.source_entity_id AND json_extract(i.metadata_json,'$.projectId')=r.project_id)
    ) OR NOT (
      EXISTS (SELECT 1 FROM entity_mentions m WHERE m.entity_id=r.target_entity_id AND COALESCE(m.project_id,'')=r.project_id)
      OR EXISTS (SELECT 1 FROM entity_instances i WHERE i.instance_id=r.target_entity_id AND json_extract(i.metadata_json,'$.projectId')=r.project_id)
    ) OR (r.source_neuron_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM neurons n WHERE n.id=r.source_neuron_id AND n.is_deleted=0 AND COALESCE(n.project_id,'')=r.project_id
    ))`).all();
        for (const row of invalid)
            quarantine(db, 'entity_relation_0057', String(row.relation_id), row, String(row.project_id ?? ''), 'entity_relation_scope_unproven');
        if (invalid.length)
            db.exec(`DELETE FROM entity_relations WHERE relation_id IN (
      SELECT old_parent_id FROM topology_identity_quarantine WHERE identity_type='entity_relation_0057'
    )`);
        recordAudit(db, 'entity_relations', original, count(db, 'entity_relations'), invalid.length, 0);
    }
}
function rebuildAliasConflicts(db) {
    if (!tableExists(db, 'entity_alias_conflicts') || !tableExists(db, 'entity_aliases') || !tableExists(db, 'entity_instances'))
        return;
    db.exec(`DELETE FROM entity_alias_conflicts`);
    const rows = db.prepare(`SELECT a.project_id,a.normalized_alias,i.type,GROUP_CONCAT(DISTINCT a.entity_id) AS entity_ids,
    MIN(a.created_at) AS created_at,MAX(a.updated_at) AS updated_at
    FROM entity_aliases a JOIN entity_instances i ON i.instance_id=a.entity_id
    GROUP BY a.project_id,a.normalized_alias,i.type HAVING COUNT(DISTINCT a.entity_id)>1`).all();
    const insert = db.prepare(`INSERT INTO entity_alias_conflicts(
    conflict_id,project_id,normalized_alias,entity_type,entity_ids_json,policy,status,created_at,updated_at
  ) VALUES(?,?,?,?,?,'prefer_recent_mention','active',?,?)`);
    for (const row of rows)
        insert.run(stableId('alias-conflict', `${row.project_id}\0${row.normalized_alias}\0${row.type}`), row.project_id, row.normalized_alias, row.type, JSON.stringify(row.entity_ids.split(',').sort()), row.created_at, row.updated_at);
}
function migrateIngestionIdentity(db) {
    ensureAuditTable(db);
    if (tableExists(db, 'ingestion_source_cursors') && !tableColumns(db, 'ingestion_source_cursors').has('project_scope')) {
        const original = count(db, 'ingestion_source_cursors');
        db.exec(`ALTER TABLE ingestion_source_cursors RENAME TO ingestion_source_cursors_0057_old`);
        createCursorTable(db);
        db.exec(`INSERT OR REPLACE INTO ingestion_source_cursors
      SELECT COALESCE(project_id,''),source_id,source_path,source_type,COALESCE(project_id,''),enabled,
        last_processed_at,last_seen_hash,last_seen_mtime,content_window_start,content_window_end,updated_at
      FROM ingestion_source_cursors_0057_old; DROP TABLE ingestion_source_cursors_0057_old`);
        recordAudit(db, 'ingestion_source_cursors', original, count(db, 'ingestion_source_cursors'), 0, original - count(db, 'ingestion_source_cursors'));
    }
    else
        createCursorTable(db);
    if (tableExists(db, 'ingestion_processed_records') && !tableColumns(db, 'ingestion_processed_records').has('project_scope')) {
        const original = count(db, 'ingestion_processed_records');
        db.exec(`ALTER TABLE ingestion_processed_records RENAME TO ingestion_processed_records_0057_old`);
        createProcessedTable(db);
        const neuronScope = tableExists(db, 'neurons')
            ? `(SELECT COALESCE(n.project_id,'') FROM neurons n WHERE n.id=o.neuron_id LIMIT 1)`
            : 'NULL';
        db.exec(`INSERT OR REPLACE INTO ingestion_processed_records
      SELECT COALESCE(${neuronScope},(SELECT c.project_scope FROM ingestion_source_cursors c WHERE c.source_id=o.source_id LIMIT 1),''),
        o.record_hash,o.source_id,o.source_path,o.source_type,o.content_hash,o.content_window_start,o.content_window_end,
        o.processed_at,o.neuron_id,COALESCE(${neuronScope},(SELECT c.project_scope FROM ingestion_source_cursors c WHERE c.source_id=o.source_id LIMIT 1),'')
      FROM ingestion_processed_records_0057_old o; DROP TABLE ingestion_processed_records_0057_old`);
        recordAudit(db, 'ingestion_processed_records', original, count(db, 'ingestion_processed_records'), 0, original - count(db, 'ingestion_processed_records'));
    }
    else
        createProcessedTable(db);
}
function migrateEventCounters(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS event_sequence_counters(counter_key TEXT PRIMARY KEY,value INTEGER NOT NULL)`);
    if (!tableExists(db, 'memory_events'))
        return;
    const upsert = db.prepare(`INSERT INTO event_sequence_counters(counter_key,value) VALUES(?,?)
    ON CONFLICT(counter_key) DO UPDATE SET value=MAX(value,excluded.value)`);
    const global = db.prepare(`SELECT COALESCE(MAX(global_seq),0) AS value FROM memory_events`).get();
    upsert.run('global', global.value);
    for (const row of db.prepare(`SELECT project_scope,stream_id,MAX(event_version) AS value FROM memory_events GROUP BY project_scope,stream_id`).all()) {
        upsert.run(sequenceKey('event', row.project_scope, row.stream_id), row.value);
    }
    for (const row of db.prepare(`SELECT project_scope,COALESCE(thread_id,stream_id) AS thread_id,MAX(thread_seq) AS thread_value,MAX(turn_seq) AS turn_value
    FROM memory_events WHERE thread_id IS NOT NULL OR stream_type='thread' GROUP BY project_scope,COALESCE(thread_id,stream_id)`).all()) {
        if (row.thread_value != null)
            upsert.run(sequenceKey('thread', row.project_scope, row.thread_id), row.thread_value);
        if (row.turn_value != null)
            upsert.run(sequenceKey('turn', row.project_scope, row.thread_id), row.turn_value);
    }
}
export function projectIsolationCompensationSatisfied(db) {
    if (!tableExists(db, 'project_isolation_compensation_audit'))
        return false;
    if (tableExists(db, 'task_identity_restoration_manifest')) {
        if (!tableColumns(db, 'task_identity_restoration_manifest').has('recovery_status'))
            return false;
        if (db.prepare(`SELECT 1 FROM task_identity_restoration_manifest m
      LEFT JOIN task_identity_recovery_quarantine q ON q.task_id=m.task_id
      WHERE m.recovery_status='unresolved' AND q.task_id IS NULL LIMIT 1`).get())
            return false;
    }
    if (!hasColumns(db, 'ingestion_source_cursors', ['project_scope', 'project_id'])
        || !hasColumns(db, 'ingestion_processed_records', ['project_scope', 'project_id']))
        return false;
    if (!tableExists(db, 'event_sequence_counters'))
        return false;
    if (db.prepare(`SELECT 1 FROM project_isolation_compensation_audit
    WHERE retained_count+split_count+quarantined_count+approved_deleted_count<>original_count LIMIT 1`).get())
        return false;
    return true;
}
function assertProjectIsolationCompensated(db) {
    if (!projectIsolationCompensationSatisfied(db))
        throw new Error('project_isolation_compensation_failed');
}
function createCursorTable(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS ingestion_source_cursors (
    project_scope TEXT NOT NULL DEFAULT '', source_id TEXT NOT NULL, source_path TEXT NOT NULL,
    source_type TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
    last_processed_at INTEGER,last_seen_hash TEXT,last_seen_mtime INTEGER,content_window_start INTEGER,
    content_window_end INTEGER,updated_at INTEGER NOT NULL,PRIMARY KEY(project_scope,source_id)
  )`);
}
function createProcessedTable(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS ingestion_processed_records (
    project_scope TEXT NOT NULL DEFAULT '',record_hash TEXT NOT NULL,source_id TEXT NOT NULL,
    source_path TEXT NOT NULL,source_type TEXT NOT NULL,content_hash TEXT NOT NULL,
    content_window_start INTEGER NOT NULL,content_window_end INTEGER NOT NULL,processed_at INTEGER NOT NULL,
    neuron_id TEXT,project_id TEXT NOT NULL DEFAULT '',PRIMARY KEY(project_scope,source_id,record_hash)
  ); CREATE INDEX IF NOT EXISTS idx_ingestion_processed_source_window
    ON ingestion_processed_records(project_scope,source_id,content_window_start,content_window_end,processed_at DESC)`);
}
function ensureAuditTable(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS project_isolation_compensation_audit (
    category TEXT PRIMARY KEY,original_count INTEGER NOT NULL,retained_count INTEGER NOT NULL,
    split_count INTEGER NOT NULL,quarantined_count INTEGER NOT NULL,approved_deleted_count INTEGER NOT NULL,
    recorded_at INTEGER NOT NULL
  )`);
}
function recordAudit(db, category, original, retained, quarantined, approvedDeleted) {
    db.prepare(`INSERT OR REPLACE INTO project_isolation_compensation_audit VALUES(?,?,?,?,?,?,?)`)
        .run(category, original, retained, 0, quarantined, approvedDeleted, Date.now());
}
function quarantine(db, type, id, row, scope, reason) {
    if (!tableExists(db, 'topology_identity_quarantine'))
        throw new Error(`migration_0057_quarantine_unavailable:${type}:${id}`);
    db.prepare(`INSERT OR REPLACE INTO topology_identity_quarantine(
    quarantine_id,identity_type,old_parent_id,project_scope,entry_json,reason,created_at,implicated_scopes_json
  ) VALUES(?,?,?,?,?,?,?,?)`).run(stableId('quarantine', `${type}\0${id}`), type, id, scope, JSON.stringify(row), reason, Date.now(), JSON.stringify([scope]));
}
function stableId(kind, value) {
    return `${kind}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}
function sequenceKey(kind, projectId, id) {
    return `${kind}:${createHash('sha256').update(`${projectId}\0${id}`).digest('hex')}`;
}
function count(db, table) { return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count); }
function tableExists(db, name) { return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name)); }
function tableColumns(db, name) { return new Set(db.prepare(`PRAGMA table_info(${name})`).all().map((row) => row.name)); }
function hasColumns(db, name, columns) {
    if (!tableExists(db, name))
        return false;
    const existing = tableColumns(db, name);
    return columns.every((column) => existing.has(column));
}
