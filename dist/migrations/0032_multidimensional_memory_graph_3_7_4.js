import { createHash } from 'node:crypto';
import { FINAL_AUXILIARY_OBJECTS, FINAL_TABLES, } from './v3_7_4/FinalSchemaDefinition.js';
const REBUILDABLE_PROJECTIONS = [
    'memory_atlas_fts',
    'memory_atlas_access',
    'memory_atlas_activation',
    'memory_atlas_documents',
    'memory_atlas_projection_state',
    'vector_projection_state',
    'time_bucket_entries',
    'time_buckets',
    'branch_links',
    'branch_entries',
    'project_branches',
    'task_branch_entries',
    'task_branches',
    'event_cluster_entries',
    'event_clusters',
    'topology_membership',
    'cognitive_edges',
    'cognitive_nodes',
    'temporal_adjacency',
    'neuron_embeddings',
    'topology_projection_state',
    'topology_source_revisions',
    'topology_time_rebuild_active_neurons',
    'topology_time_rebuild_adjacency',
    'topology_time_rebuild_buckets',
    'topology_time_rebuild_cognitive_edges',
    'topology_time_rebuild_cognitive_nodes',
    'topology_time_rebuild_entries',
    'topology_time_rebuild_jobs',
];
export const migration_0032 = {
    version: '0032',
    description: 'install the final 3.7.4 multidimensional memory graph schema',
    requiresBackup: true,
    up(db) {
        installMultidimensionalMemoryGraph374(db);
    },
    down() { },
};
export function installMultidimensionalMemoryGraph374(db) {
    db.exec('PRAGMA defer_foreign_keys=ON; PRAGMA legacy_alter_table=ON');
    dropUserDefinedAuxiliaryObjects(db);
    resetFreshBootstrap(db);
    installMissingFinalTables(db);
    installMigrationAuditTables(db);
    discardUnscopedRuntime(db);
    discardUnscopedPolicyExecutions(db);
    migrateEntityScope(db);
    migratePendingEntityResolution(db);
    migrateMemoryEntityProjectionIds(db);
    dropRebuildableProjections(db);
    installMissingFinalTables(db);
    reconcileChangedTables(db);
    initializeProjectionState(db);
    installFinalAuxiliaryObjects(db);
    db.exec('DROP TABLE IF EXISTS _cogmem_bootstrap_state; PRAGMA legacy_alter_table=OFF');
    const issue = multidimensionalMemoryGraph374Issue(db);
    if (issue)
        throw new Error(`multidimensional_memory_graph_3_7_4_postcondition_failed:${issue}`);
}
export function multidimensionalMemoryGraph374Satisfied(db) {
    return multidimensionalMemoryGraph374Issue(db) === undefined;
}
export function multidimensionalMemoryGraph374Issue(db) {
    for (const object of FINAL_TABLES) {
        const actual = schemaSql(db, 'table', object.name);
        if (!actual)
            return `table_missing:${object.name}`;
        if (normalizeTableSql(actual) !== normalizeTableSql(object.sql))
            return `table_definition:${object.name}`;
    }
    for (const object of FINAL_AUXILIARY_OBJECTS) {
        const actual = schemaSql(db, object.type, object.name);
        if (!actual)
            return `${object.type}_missing:${object.name}`;
        if (normalizeSql(actual) !== normalizeSql(object.sql))
            return `${object.type}_definition:${object.name}`;
    }
    if (!tableExists(db, 'entity_scope_migration_quarantine'))
        return 'table_missing:entity_scope_migration_quarantine';
    if (tableExists(db, 'memory_events') && db.prepare(`
    SELECT 1 FROM memory_events WHERE project_scope<>COALESCE(project_id,'') LIMIT 1
  `).get())
        return 'memory_event_scope';
    if (tableExists(db, 'synapses') && tableExists(db, 'neurons') && db.prepare(`
    SELECT 1 FROM synapses s
    LEFT JOIN neurons a ON a.id=s.source_id
    LEFT JOIN neurons b ON b.id=s.target_id
    WHERE a.id IS NULL OR b.id IS NULL OR a.is_deleted<>0 OR b.is_deleted<>0
      OR COALESCE(a.project_id,'')<>COALESCE(b.project_id,'')
      OR s.project_id<>COALESCE(a.project_id,'')
    LIMIT 1
  `).get())
        return 'synapse_scope';
    if (tableExists(db, 'entity_aliases') && db.prepare(`
    SELECT 1 FROM entity_aliases a
    WHERE NOT EXISTS (
      SELECT 1 FROM entity_instances i
      WHERE i.instance_id=a.entity_id
        AND (
          json_extract(i.metadata_json,'$.projectId')=a.project_id
          OR EXISTS (
            SELECT 1 FROM entity_mentions m
            WHERE m.entity_id=a.entity_id AND COALESCE(m.project_id,'')=a.project_id
          )
        )
    ) LIMIT 1
  `).get())
        return 'entity_alias_scope';
    return undefined;
}
function installMissingFinalTables(db) {
    for (const object of FINAL_TABLES) {
        if (tableExists(db, object.name))
            continue;
        db.exec(withIfNotExists(object.sql));
    }
}
function installMigrationAuditTables(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS entity_scope_migration_quarantine (
      quarantine_id TEXT PRIMARY KEY,
      record_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      record_hash TEXT NOT NULL,
      implicated_scopes_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}
function discardUnscopedRuntime(db) {
    const tables = ['runtime_states', 'runtime_transitions', 'runtime_event_outbox'];
    if (!tables.some((table) => tableExists(db, table) && !columnExists(db, table, 'project_scope')))
        return;
    const insert = db.prepare(`
    INSERT OR IGNORE INTO runtime_scope_discard_receipts(
      quarantine_id,source_table,record_hash,reason,created_at
    ) VALUES(?,?,?,?,?)
  `);
    for (const table of tables) {
        if (!tableExists(db, table) || columnExists(db, table, 'project_scope'))
            continue;
        for (const [index, row] of db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all().entries()) {
            const hash = stableHash(row);
            insert.run(`runtime-${hash.slice(0, 32)}-${index}`, table, hash, 'legacy_runtime_scope_unproven', Date.now());
        }
    }
    for (const table of [
        'runtime_projection_transitions',
        'runtime_projection_states',
        'runtime_event_outbox',
        'runtime_transitions',
        'runtime_states',
    ])
        db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(table)}`);
}
function discardUnscopedPolicyExecutions(db) {
    if (!tableExists(db, 'policy_executions') || columnExists(db, 'policy_executions', 'project_scope'))
        return;
    const quarantine = db.prepare(`
    INSERT OR IGNORE INTO policy_execution_quarantine(execution_id,record_hash,reason,created_at)
    VALUES(?,?,?,?)
  `);
    const tombstone = db.prepare(`
    INSERT OR IGNORE INTO policy_execution_legacy_tombstones(
      idempotency_key_hash,legacy_execution_id,legacy_status,reason,created_at
    ) VALUES(?,?,?,?,?)
  `);
    for (const row of db.prepare('SELECT * FROM policy_executions').all()) {
        const executionId = String(row.execution_id ?? stableHash(row).slice(0, 32));
        quarantine.run(executionId, stableHash(row), 'legacy_execution_scope_unproven', Date.now());
        if (typeof row.idempotency_key === 'string' && row.idempotency_key) {
            tombstone.run(createHash('sha256').update(row.idempotency_key).digest('hex'), executionId, String(row.status ?? 'unknown'), 'legacy_execution_scope_ambiguous', Date.now());
        }
    }
    db.exec('DROP TABLE policy_executions');
}
function migrateEntityScope(db) {
    if (tableExists(db, 'entity_aliases') && !columnExists(db, 'entity_aliases', 'project_id')) {
        const rows = db.prepare('SELECT * FROM entity_aliases').all();
        db.exec('DROP TABLE entity_aliases');
        installTable(db, 'entity_aliases');
        const insert = db.prepare(`
      INSERT INTO entity_aliases(alias_id,entity_id,project_id,alias_text,normalized_alias,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?)
    `);
        for (const row of rows) {
            const entityId = String(row.entity_id);
            const scopes = entityScopes(db, entityId);
            if (scopes.length !== 1) {
                quarantineEntityRow(db, 'entity_alias', String(row.alias_id), row, scopes);
                continue;
            }
            insert.run(scopedId('alias', String(row.alias_id), scopes[0]), entityId, scopes[0], String(row.alias_text), String(row.normalized_alias), Number(row.created_at), Number(row.updated_at));
        }
    }
    if (tableExists(db, 'entity_relations') && !columnExists(db, 'entity_relations', 'project_id')) {
        const rows = db.prepare('SELECT * FROM entity_relations').all();
        db.exec('DROP TABLE entity_relations');
        installTable(db, 'entity_relations');
        const insert = db.prepare(`
      INSERT INTO entity_relations(
        relation_id,project_id,source_entity_id,target_entity_id,relation_type,source_neuron_id,created_at
      ) VALUES(?,?,?,?,?,?,?)
    `);
        for (const row of rows) {
            const sourceScopes = entityScopes(db, String(row.source_entity_id));
            const targetScopes = new Set(entityScopes(db, String(row.target_entity_id)));
            let scopes = sourceScopes.filter((scope) => targetScopes.has(scope));
            if (row.source_neuron_id != null) {
                const source = db.prepare(`
          SELECT COALESCE(project_id,'') AS scope FROM neurons WHERE id=? AND is_deleted=0
        `).get(String(row.source_neuron_id));
                scopes = source && scopes.includes(source.scope) ? [source.scope] : [];
            }
            if (scopes.length !== 1) {
                quarantineEntityRow(db, 'entity_relation', String(row.relation_id), row, scopes);
                continue;
            }
            insert.run(scopedId('relation', String(row.relation_id), scopes[0]), scopes[0], String(row.source_entity_id), String(row.target_entity_id), String(row.relation_type), row.source_neuron_id == null ? null : String(row.source_neuron_id), Number(row.created_at));
        }
    }
    if (tableExists(db, 'entity_alias_conflicts'))
        db.exec('DROP TABLE entity_alias_conflicts');
    installTable(db, 'entity_alias_conflicts');
    rebuildAliasConflicts(db);
    if (tableExists(db, 'entity_instances')) {
        for (const row of db.prepare('SELECT instance_id FROM entity_instances').all()) {
            if (entityScopes(db, row.instance_id).length > 1) {
                db.prepare(`UPDATE entity_instances SET aliases_json='[]',metadata_json='{}' WHERE instance_id=?`).run(row.instance_id);
            }
        }
    }
}
function migratePendingEntityResolution(db) {
    if (!tableExists(db, 'pending_entity_resolution') || columnExists(db, 'pending_entity_resolution', 'project_scope'))
        return;
    const rows = db.prepare('SELECT * FROM pending_entity_resolution').all();
    db.exec('DROP TABLE pending_entity_resolution');
    installTable(db, 'pending_entity_resolution');
    const live = db.prepare(`
    INSERT INTO pending_entity_resolution(
      pending_id,reference_text,entity_type,context_neuron_id,project_scope,resolved_entity_id,
      status,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?)
  `);
    const quarantine = db.prepare(`
    INSERT OR IGNORE INTO pending_entity_resolution_quarantine(
      pending_id,record_json,reason,created_at,project_scope,implicated_scopes_json,context_neuron_id,scope_resolved
    ) VALUES(?,?,?,?,?,?,?,?)
  `);
    for (const row of rows) {
        const contextNeuronId = typeof row.context_neuron_id === 'string' ? row.context_neuron_id : undefined;
        const neuron = contextNeuronId
            ? db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM neurons WHERE id=? AND is_deleted=0`)
                .get(contextNeuronId)
            : null;
        if (!neuron) {
            quarantine.run(String(row.pending_id), JSON.stringify({ recordHash: stableHash(row) }), 'pending_scope_unproven', Date.now(), '', '[]', contextNeuronId ?? null, 0);
            continue;
        }
        live.run(String(row.pending_id), String(row.reference_text), typeof row.entity_type === 'string' ? row.entity_type : null, contextNeuronId ?? null, neuron.scope, typeof row.resolved_entity_id === 'string' ? row.resolved_entity_id : null, String(row.status), Number(row.created_at), Number(row.updated_at));
    }
}
function migrateMemoryEntityProjectionIds(db) {
    if (!tableExists(db, 'memory_entities') || !tableExists(db, 'memory_bindings'))
        return;
    const rows = db.prepare('SELECT * FROM memory_entities').all();
    const insert = db.prepare(`
    INSERT OR IGNORE INTO memory_entities(
      entity_id,project_id,canonical_name,entity_type,aliases_json,stable_path,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)
  `);
    for (const row of rows) {
        const oldId = String(row.entity_id);
        const scopes = new Set([String(row.project_id ?? '')]);
        for (const item of db.prepare(`
      SELECT DISTINCT COALESCE(project_id,'') AS scope FROM memory_bindings WHERE entity_id=?
    `).all(oldId))
            scopes.add(item.scope);
        for (const scope of scopes) {
            const nextId = scopedId('entity', `${String(row.entity_type)}\0${oldId}`, scope);
            const ownsPayload = String(row.project_id ?? '') === scope;
            insert.run(nextId, scope || null, ownsPayload ? String(row.canonical_name) : `entity-${nextId.slice(-12)}`, String(row.entity_type), ownsPayload ? String(row.aliases_json) : '[]', ownsPayload && row.stable_path != null ? String(row.stable_path) : null, Number(row.created_at), Number(row.updated_at));
            db.prepare(`
        UPDATE memory_bindings SET entity_id=?
        WHERE entity_id=? AND COALESCE(project_id,'')=?
      `).run(nextId, oldId, scope);
            if (tableExists(db, 'memory_edges')) {
                db.prepare(`
          UPDATE memory_edges SET source_id=?
          WHERE source_type='entity' AND source_id=? AND COALESCE(project_id,'')=?
        `).run(nextId, oldId, scope);
                db.prepare(`
          UPDATE memory_edges SET target_id=?
          WHERE target_type='entity' AND target_id=? AND COALESCE(project_id,'')=?
        `).run(nextId, oldId, scope);
            }
        }
        db.prepare('DELETE FROM memory_entities WHERE entity_id=?').run(oldId);
    }
}
function dropRebuildableProjections(db) {
    for (const table of REBUILDABLE_PROJECTIONS)
        db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(table)}`);
}
function reconcileChangedTables(db) {
    const mappings = {
        memory_events: { project_scope: `COALESCE(project_id,'')` },
        synapses: {
            project_id: `COALESCE((SELECT project_id FROM neurons WHERE id=source_id),'')`,
        },
        ingestion_source_cursors: {
            project_scope: `COALESCE(project_id,'')`,
            project_id: `COALESCE(project_id,'')`,
        },
        ingestion_processed_records: {
            project_scope: `COALESCE((
        SELECT project_scope FROM ingestion_source_cursors
        WHERE source_id=ingestion_processed_records.source_id
      ),'')`,
            project_id: `COALESCE((
        SELECT project_scope FROM ingestion_source_cursors
        WHERE source_id=ingestion_processed_records.source_id
      ),'')`,
        },
    };
    const filters = {
        synapses: `EXISTS (
      SELECT 1 FROM neurons a JOIN neurons b ON b.id=synapses.target_id
      WHERE a.id=synapses.source_id AND a.is_deleted=0 AND b.is_deleted=0
        AND COALESCE(a.project_id,'')=COALESCE(b.project_id,'')
    )`,
    };
    for (const object of FINAL_TABLES) {
        if (!tableExists(db, object.name) || tableDefinitionMatches(db, object))
            continue;
        if (/^CREATE VIRTUAL TABLE/i.test(object.sql)) {
            db.exec(`DROP TABLE ${quoteIdentifier(object.name)}`);
            db.exec(object.sql);
            continue;
        }
        rebuildTable(db, object, mappings[object.name], filters[object.name]);
    }
}
function rebuildTable(db, object, mappings = {}, filter) {
    const oldName = `_schema31_${object.name}`;
    db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(oldName)}`);
    db.exec(`ALTER TABLE ${quoteIdentifier(object.name)} RENAME TO ${quoteIdentifier(oldName)}`);
    db.exec(object.sql);
    const sourceColumns = tableColumns(db, oldName);
    const targetInfo = db.prepare(`PRAGMA table_info(${quoteIdentifier(object.name)})`).all();
    const selected = targetInfo.filter((column) => sourceColumns.has(column.name) || mappings[column.name] !== undefined);
    const missingRequired = targetInfo.find((column) => !selected.includes(column) && column.notnull === 1 && column.dflt_value == null);
    if (missingRequired)
        throw new Error(`schema31_column_mapping_required:${object.name}:${missingRequired.name}`);
    if (selected.length > 0) {
        const columns = selected.map((column) => quoteIdentifier(column.name)).join(',');
        const expressions = selected.map((column) => (mappings[column.name] ?? quoteIdentifier(column.name)).replaceAll(object.name, oldName)).join(',');
        try {
            db.exec(`
        INSERT INTO ${quoteIdentifier(object.name)}(${columns})
        SELECT ${expressions} FROM ${quoteIdentifier(oldName)}
        ${filter ? `WHERE ${filter.replaceAll(object.name, oldName)}` : ''}
      `);
        }
        catch (error) {
            throw new Error(`schema31_table_copy_failed:${object.name}`, { cause: error });
        }
    }
    db.exec(`DROP TABLE ${quoteIdentifier(oldName)}`);
}
function initializeProjectionState(db) {
    const now = Date.now();
    if (tableExists(db, 'topology_source_revisions')) {
        db.exec(`
      INSERT OR IGNORE INTO topology_source_revisions(project_id,revision,updated_at)
      SELECT DISTINCT COALESCE(project_id,''),0,${now} FROM neurons WHERE is_deleted=0
    `);
    }
    if (tableExists(db, 'topology_projection_state')) {
        db.exec(`
      INSERT OR REPLACE INTO topology_projection_state(
        project_id,projection_version,status,time_zone,updated_at,error,source_revision
      )
      SELECT project_id,1,'dirty',NULL,${now},NULL,revision FROM topology_source_revisions
    `);
    }
    if (tableExists(db, 'memory_atlas_projection_state')) {
        db.exec(`
      INSERT OR REPLACE INTO memory_atlas_projection_state(
        project_id,projection_name,status,metadata_json,projection_version
      )
      SELECT DISTINCT COALESCE(project_id,''),'memory_atlas.v2','dirty','{}','v2'
      FROM neurons WHERE is_deleted=0
    `);
    }
}
function dropUserDefinedAuxiliaryObjects(db) {
    const rows = db.prepare(`
    SELECT type,name FROM sqlite_master
    WHERE type IN ('view','trigger','index') AND sql IS NOT NULL AND name NOT GLOB 'sqlite_*'
    ORDER BY CASE type WHEN 'view' THEN 0 WHEN 'trigger' THEN 1 ELSE 2 END
  `).all();
    for (const row of rows)
        db.exec(`DROP ${row.type.toUpperCase()} IF EXISTS ${quoteIdentifier(row.name)}`);
}
function resetFreshBootstrap(db) {
    if (!tableExists(db, '_cogmem_bootstrap_state'))
        return;
    const tables = db.prepare(`
    SELECT name,sql FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
      AND name NOT IN ('_cogmem_bootstrap_state','_schema_migrations')
    ORDER BY CASE WHEN sql LIKE 'CREATE VIRTUAL TABLE%' THEN 0 ELSE 1 END,name
  `).all();
    for (const table of tables)
        db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(table.name)}`);
}
function installFinalAuxiliaryObjects(db) {
    for (const object of FINAL_AUXILIARY_OBJECTS)
        db.exec(object.sql);
}
function installTable(db, name) {
    if (tableExists(db, name))
        return;
    const object = FINAL_TABLES.find((item) => item.name === name);
    if (!object)
        throw new Error(`final_table_definition_missing:${name}`);
    db.exec(object.sql);
}
function rebuildAliasConflicts(db) {
    if (!tableExists(db, 'entity_aliases') || !tableExists(db, 'entity_instances'))
        return;
    const rows = db.prepare(`
    SELECT a.project_id,a.normalized_alias,i.type,
      GROUP_CONCAT(DISTINCT a.entity_id) AS entity_ids,
      MIN(a.created_at) AS created_at,MAX(a.updated_at) AS updated_at
    FROM entity_aliases a
    JOIN entity_instances i ON i.instance_id=a.entity_id
    GROUP BY a.project_id,a.normalized_alias,i.type
    HAVING COUNT(DISTINCT a.entity_id)>1
  `).all();
    const insert = db.prepare(`
    INSERT INTO entity_alias_conflicts(
      conflict_id,project_id,normalized_alias,entity_type,entity_ids_json,policy,status,created_at,updated_at
    ) VALUES(?,?,?,?,?,'prefer_recent_mention','active',?,?)
  `);
    for (const row of rows)
        insert.run(scopedId('alias-conflict', `${row.normalized_alias}\0${row.type}`, row.project_id), row.project_id, row.normalized_alias, row.type, JSON.stringify(row.entity_ids.split(',').sort()), row.created_at, row.updated_at);
}
function entityScopes(db, entityId) {
    const scopes = new Set();
    if (tableExists(db, 'entity_instances')) {
        const row = db.prepare(`
      SELECT json_extract(metadata_json,'$.projectId') AS project_id
      FROM entity_instances WHERE instance_id=?
    `).get(entityId);
        if (typeof row?.project_id === 'string')
            scopes.add(row.project_id);
    }
    if (tableExists(db, 'entity_mentions')) {
        for (const row of db.prepare(`
      SELECT DISTINCT COALESCE(project_id,'') AS project_id
      FROM entity_mentions WHERE entity_id=?
    `).all(entityId))
            scopes.add(row.project_id);
    }
    return [...scopes].sort();
}
function quarantineEntityRow(db, recordType, recordId, row, scopes) {
    const hash = stableHash(row);
    db.prepare(`
    INSERT OR IGNORE INTO entity_scope_migration_quarantine(
      quarantine_id,record_type,record_id,record_hash,implicated_scopes_json,reason,created_at
    ) VALUES(?,?,?,?,?,?,?)
  `).run(`${recordType}-${hash.slice(0, 32)}`, recordType, recordId, hash, JSON.stringify(scopes), scopes.length ? `${recordType}_scope_ambiguous` : `${recordType}_scope_unresolved`, Date.now());
}
function scopedId(kind, id, scope) {
    return `${kind}-${createHash('sha256').update(`${scope}\0${id}`).digest('hex').slice(0, 32)}`;
}
function stableHash(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function tableDefinitionMatches(db, object) {
    const actual = schemaSql(db, 'table', object.name);
    return Boolean(actual && normalizeTableSql(actual) === normalizeTableSql(object.sql));
}
function schemaSql(db, type, name) {
    return db.prepare(`
    SELECT sql FROM sqlite_master WHERE type=? AND name=?
  `).get(type, name)?.sql;
}
function normalizeTableSql(sql) {
    return normalizeSql(sql)
        .replace(/^create virtual table [^ (]+/i, 'create virtual table')
        .replace(/^create table [^ (]+/i, 'create table');
}
function normalizeSql(sql) {
    return sql
        .replace(/\bIF NOT EXISTS\b/gi, '')
        .replace(/["'`\[\]]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*([(),=])\s*/g, '$1')
        .trim()
        .toLowerCase();
}
function withIfNotExists(sql) {
    return sql
        .replace(/^CREATE VIRTUAL TABLE\s+/i, 'CREATE VIRTUAL TABLE IF NOT EXISTS ')
        .replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
}
function columnExists(db, table, column) {
    return tableColumns(db, table).has(column);
}
function tableColumns(db, table) {
    if (!tableExists(db, table))
        return new Set();
    return new Set(db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all()
        .map((row) => row.name));
}
function tableExists(db, table) {
    return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table));
}
function quoteIdentifier(identifier) {
    return `"${identifier.replaceAll('"', '""')}"`;
}
