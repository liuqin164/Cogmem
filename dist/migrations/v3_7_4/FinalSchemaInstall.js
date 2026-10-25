import { memoryEdgeId, } from '../../binding/MemoryBindingIdentity.js';
import { cognitiveEdgeId, cognitiveNodeId } from '../../engine/CognitiveGraphIdentity.js';
import { FINAL_AUXILIARY_OBJECTS, FINAL_TABLES, } from './FinalSchemaDefinition.js';
/**
 * Install the 4.0 final schema in a database that has none.
 *
 * Moved here from `0032_multidimensional_memory_graph_3_7_4.ts`, which was the
 * migration that also carried the 3.x upgrade path. This is only the part a new
 * database needs; the upgrade helpers that lived beside it are gone, and the
 * schema it produces is verified object-for-object against the old installer's
 * output (501 objects, digest pinned in `__tests__/schema-migration.unit.test.ts`).
 *
 * The postcondition check at the end is not decoration: it is what notices a
 * projection or auxiliary object that failed to install, and it runs on every
 * creation.
 */
export function installFinalSchema(db) {
    db.exec('PRAGMA defer_foreign_keys=ON; PRAGMA legacy_alter_table=ON');
    const preservedAuxiliaryObjects = detachAuxiliaryObjects(db);
    resetFreshBootstrap(db);
    installMissingFinalTables(db);
    installMigrationAuditTables(db);
    dropRebuildableProjections(db);
    installMissingFinalTables(db);
    initializeProjectionState(db);
    installFinalAuxiliaryObjects(db);
    restoreAuxiliaryObjects(db, preservedAuxiliaryObjects);
    db.exec('DROP TABLE IF EXISTS _cogmem_bootstrap_state; PRAGMA legacy_alter_table=OFF');
    const issue = multidimensionalMemoryGraph374Issue(db);
    if (issue)
        throw new Error(`multidimensional_memory_graph_3_7_4_postcondition_failed:${issue}`);
}
const REBUILDABLE_PROJECTIONS = [
    'memory_atlas_fts',
    'memory_atlas_access',
    'memory_atlas_activation',
    'memory_atlas_documents',
    'memory_atlas_projection_state',
    'memory_action_frame_evidence',
    'memory_action_frames',
    'cognitive_edges',
    'cognitive_nodes',
    'vector_projection_state',
    'time_bucket_entries',
    'time_buckets',
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
    if (tableExists(db, 'memory_action_frames') && db.prepare(`
    SELECT 1 FROM memory_action_frames a
    WHERE a.target_entity_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM memory_entities e
      WHERE e.entity_id=a.target_entity_id
        AND COALESCE(e.project_id,'')=a.project_id
    ) LIMIT 1
  `).get())
        return 'memory_action_target';
    if (tableExists(db, 'memory_edges')) {
        const seen = new Set();
        for (const row of db.prepare(`
      SELECT edge_id,COALESCE(project_id,'') AS project_id,source_type,source_id,
        relation_type,target_type,target_id,source_authority
      FROM memory_edges
    `).all()) {
            const expected = memoryEdgeId({
                projectId: row.project_id,
                sourceType: row.source_type,
                sourceId: row.source_id,
                relationType: row.relation_type,
                targetType: row.target_type,
                targetId: row.target_id,
            });
            if (row.edge_id !== expected || seen.has(expected))
                return 'memory_edge_identity';
            if (!memoryEndpointMatchesScope(db, row.source_type, row.source_id, row.project_id, row.source_authority)
                || !memoryEndpointMatchesScope(db, row.target_type, row.target_id, row.project_id, row.source_authority)) {
                return 'memory_edge_endpoint_scope';
            }
            seen.add(expected);
        }
        if (!tableExists(db, 'memory_edge_supports') || db.prepare(`
      SELECT 1 FROM memory_edges e
      WHERE NOT EXISTS (
        SELECT 1 FROM memory_edge_supports s
        WHERE s.edge_id=e.edge_id AND s.support_status='active'
      ) LIMIT 1
    `).get())
            return 'memory_edge_support_projection';
        if (db.prepare(`
      SELECT 1 FROM memory_edge_supports s
      WHERE s.support_status='active' AND NOT EXISTS (
        SELECT 1 FROM memory_edges e WHERE e.edge_id=s.edge_id
      ) LIMIT 1
    `).get())
            return 'memory_edge_support_orphan';
        for (const support of db.prepare(`SELECT * FROM memory_edge_supports`).all()) {
            const scope = String(support.project_id ?? '');
            const expected = memoryEdgeId({
                projectId: scope,
                sourceType: String(support.source_type),
                sourceId: String(support.source_id),
                relationType: String(support.relation_type),
                targetType: String(support.target_type),
                targetId: String(support.target_id),
            });
            if (String(support.edge_id) !== expected)
                return 'memory_edge_support_identity';
            const evidence = parseEvidenceIds(support.evidence_event_ids_json);
            if (!evidence || evidence.some((eventId) => !recordMatchesScope(db, 'memory_events', 'event_id', eventId, scope))) {
                return 'memory_edge_support_evidence';
            }
        }
    }
    if (tableExists(db, 'memory_entity_scope_identity') && db.prepare(`
    SELECT 1 FROM memory_entity_scope_identity m
    LEFT JOIN memory_entities e ON e.entity_id=m.scoped_entity_id
    WHERE e.entity_id IS NULL OR COALESCE(e.project_id,'')<>m.project_id OR e.entity_type<>m.entity_type
    LIMIT 1
  `).get())
        return 'memory_entity_scope_identity';
    if (tableExists(db, 'memory_bindings')) {
        for (const row of db.prepare(`SELECT * FROM memory_bindings`).all()) {
            if (memoryBindingReferenceIssue(db, row))
                return 'memory_binding_reference_scope';
        }
    }
    if (tableExists(db, 'pending_entity_resolution')) {
        for (const row of db.prepare(`
      SELECT pending_id,project_scope,resolved_entity_id,status
      FROM pending_entity_resolution WHERE status='resolved'
    `).all()) {
            if (!row.resolved_entity_id || !entityVisibleInScope(db, row.resolved_entity_id, row.project_scope)) {
                return 'pending_entity_resolved_scope';
            }
        }
    }
    for (const config of [
        { parent: 'task_branches', entries: 'task_branch_entries', id: 'task_id' },
        { parent: 'event_clusters', entries: 'event_cluster_entries', id: 'cluster_id' },
        { parent: 'project_branches', entries: 'branch_entries', id: 'branch_id' },
    ]) {
        if (!tableExists(db, config.parent) || !tableExists(db, config.entries))
            continue;
        for (const entry of db.prepare(`SELECT * FROM ${config.entries}`).all()) {
            const parent = db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM ${config.parent} WHERE ${config.id}=?`)
                .get(String(entry[config.id]));
            const inferred = inferTopologyEntryScope(db, entry);
            if (!parent || inferred.scope !== parent.scope || String(entry.project_id ?? '') !== parent.scope) {
                return `${config.entries}_scope`;
            }
        }
    }
    if (tableExists(db, 'topology_membership') && db.prepare(`
    SELECT 1 FROM topology_membership m LEFT JOIN neurons n ON n.id=m.neuron_id
    WHERE n.id IS NULL OR n.is_deleted<>0 OR COALESCE(n.project_id,'')<>COALESCE(m.project_id,'')
    LIMIT 1
  `).get())
        return 'topology_membership_scope';
    if (tableExists(db, 'cognitive_nodes')) {
        for (const row of db.prepare(`SELECT * FROM cognitive_nodes`).all()) {
            const scope = String(row.project_id ?? '');
            if (String(row.node_id) !== cognitiveNodeId(scope, row.node_type, String(row.node_key))) {
                return 'cognitive_node_identity';
            }
            if (row.source_neuron_id != null && !(scopeForNeuron(db, String(row.source_neuron_id)) ?? []).includes(scope)) {
                return 'cognitive_node_scope';
            }
            if (row.node_type === 'fact' && !db.prepare(`
        SELECT 1 FROM facts WHERE ('fact:'||fact_id)=? AND status IN ('provisional','provisional_enriched','verified')
      `).get(String(row.node_key)))
                return 'cognitive_fact_inactive';
            if (row.node_type === 'belief' && !db.prepare(`
        SELECT 1 FROM beliefs WHERE ('belief:'||id)=? AND status='active'
      `).get(String(row.node_key)))
                return 'cognitive_belief_inactive';
            if (row.node_type === 'compiled_event' && !db.prepare(`
        SELECT 1 FROM compiled_events WHERE ('compiled_event:'||event_id)=? AND status IN ('provisional','verified')
      `).get(String(row.node_key)))
                return 'cognitive_event_inactive';
        }
    }
    if (tableExists(db, 'cognitive_edges')) {
        for (const row of db.prepare(`
      SELECT e.*,s.project_id AS source_project,t.project_id AS target_project
      FROM cognitive_edges e LEFT JOIN cognitive_nodes s ON s.node_id=e.source_node_id
      LEFT JOIN cognitive_nodes t ON t.node_id=e.target_node_id
    `).all()) {
            const scope = String(row.project_id ?? '');
            if (row.source_project !== scope || row.target_project !== scope
                || String(row.edge_id) !== cognitiveEdgeId({
                    projectId: scope,
                    sourceNodeId: String(row.source_node_id),
                    targetNodeId: String(row.target_node_id),
                    edgeType: row.edge_type,
                }))
                return 'cognitive_edge_scope';
        }
    }
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
function memoryBindingReferenceIssue(db, row) {
    const scope = String(row.project_id ?? '');
    if (!recordMatchesScope(db, 'memory_events', 'event_id', String(row.event_id), scope))
        return 'memory_binding_event_scope_mismatch';
    if (!recordMatchesScope(db, 'memory_topics', 'topic_path', String(row.topic_path), scope))
        return 'memory_binding_topic_scope_mismatch';
    if (row.entity_id != null && !recordMatchesScope(db, 'memory_entities', 'entity_id', String(row.entity_id), scope))
        return 'memory_binding_entity_scope_mismatch';
    if (row.cluster_id != null) {
        const cluster = db.prepare(`
      SELECT topic_path FROM memory_clusters
      WHERE cluster_id=? AND COALESCE(project_id,'')=?
    `).get(String(row.cluster_id), scope);
        if (!cluster)
            return 'memory_binding_cluster_scope_mismatch';
        if (cluster.topic_path !== String(row.topic_path))
            return 'memory_binding_cluster_topic_mismatch';
    }
    const related = parseEvidenceIds(row.related_event_ids_json);
    if (!related)
        return 'memory_binding_related_events_malformed';
    if (related.some((eventId) => !recordMatchesScope(db, 'memory_events', 'event_id', eventId, scope)))
        return 'memory_binding_related_event_scope_mismatch';
    return undefined;
}
function memoryEndpointMatchesScope(db, type, id, scope, authority) {
    if (authority === 'atlas_curator' || authority === 'memory_frame_projector') {
        return tableExists(db, 'memory_atlas_documents') && Boolean(db.prepare(`
      SELECT 1 FROM memory_atlas_documents
      WHERE project_id=? AND node_id=? AND status NOT IN ('rejected','archived','needs_confirmation')
    `).get(scope, atlasNodeId(type, id, scope)));
    }
    if (!['raw_evidence', 'governed_projection', 'model_candidate'].includes(authority))
        return false;
    if (type === 'event' || type === 'raw_event')
        return recordMatchesScope(db, 'memory_events', 'event_id', id, scope);
    if (type === 'episode')
        return recordMatchesScope(db, 'memory_episodes', 'episode_id', id, scope);
    if (type === 'entity')
        return recordMatchesScope(db, 'memory_entities', 'entity_id', id, scope);
    if (type === 'topic')
        return recordMatchesScope(db, 'memory_topics', 'topic_path', id, scope);
    if (type === 'cluster')
        return recordMatchesScope(db, 'memory_clusters', 'cluster_id', id, scope);
    return false;
}
const PROJECT_SCOPED_ATLAS_NODE_TYPES = new Set([
    'topic', 'time', 'issue', 'session', 'thread', 'memoryKind', 'actionKind',
]);
function atlasNodeId(type, id, scope) {
    if (type === 'entity' && id.startsWith('facet:'))
        return `entity:${scope}:${id}`;
    return PROJECT_SCOPED_ATLAS_NODE_TYPES.has(type)
        ? `${type}:${scope}:${id}`
        : `${type}:${id}`;
}
function recordMatchesScope(db, table, idColumn, id, scope) {
    if (!tableExists(db, table))
        return false;
    return Boolean(db.prepare(`
    SELECT 1 FROM ${quoteIdentifier(table)}
    WHERE ${quoteIdentifier(idColumn)}=? AND COALESCE(project_id,'')=?
  `).get(id, scope));
}
function parseEvidenceIds(value) {
    try {
        const parsed = JSON.parse(String(value ?? '[]'));
        return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
            ? [...new Set(parsed.filter(Boolean))]
            : null;
    }
    catch {
        return null;
    }
}
function inferTopologyEntryScope(db, entry) {
    const scopes = new Set();
    let unresolved = false;
    let referenced = false;
    const add = (resolved) => {
        referenced = true;
        if (!resolved?.length)
            unresolved = true;
        else
            for (const scope of resolved)
                scopes.add(scope);
    };
    if (entry.neuron_id)
        add(scopeForNeuron(db, String(entry.neuron_id)));
    if (entry.unit_id)
        add(scopesForUnit(db, String(entry.unit_id)));
    if (entry.belief_id)
        add(scopeForBelief(db, String(entry.belief_id)));
    if (entry.fact_id)
        add(scopeForNeuronReference(db, 'facts', 'fact_id', String(entry.fact_id)));
    if (entry.event_id) {
        add(scopeForNeuronReference(db, 'compiled_events', 'event_id', String(entry.event_id))
            ?? scopeForProjectRecord(db, 'memory_events', 'event_id', String(entry.event_id)));
    }
    if (!referenced || unresolved || scopes.size !== 1)
        return {
            scopes: [...scopes].sort(),
            reason: !referenced || unresolved ? 'topology_entry_scope_unresolved' : 'topology_entry_scope_conflict',
        };
    return { scope: [...scopes][0], scopes: [...scopes], reason: '' };
}
function scopeForNeuron(db, neuronId) {
    if (!tableExists(db, 'neurons'))
        return null;
    const row = db.prepare(`
    SELECT COALESCE(project_id,'') AS scope FROM neurons WHERE id=? AND is_deleted=0
  `).get(neuronId);
    return row ? [row.scope] : null;
}
function scopeForProjectRecord(db, table, idColumn, id) {
    if (!tableExists(db, table))
        return null;
    const row = db.prepare(`
    SELECT COALESCE(project_id,'') AS scope FROM ${quoteIdentifier(table)}
    WHERE ${quoteIdentifier(idColumn)}=?
  `).get(id);
    return row ? [row.scope] : null;
}
function scopeForNeuronReference(db, table, idColumn, id) {
    if (!tableExists(db, table) || !tableExists(db, 'neurons'))
        return null;
    const row = db.prepare(`
    SELECT COALESCE(n.project_id,'') AS scope
    FROM ${quoteIdentifier(table)} r JOIN neurons n ON n.id=r.neuron_id
    WHERE r.${quoteIdentifier(idColumn)}=? AND n.is_deleted=0
  `).get(id);
    return row ? [row.scope] : null;
}
function scopeForBelief(db, beliefId) {
    return scopeForProjectRecord(db, 'beliefs', 'id', beliefId)
        ?? scopeForProjectRecord(db, 'belief_graph_nodes', 'belief_id', beliefId);
}
function scopesForUnit(db, unitId) {
    if (!tableExists(db, 'interaction_units'))
        return null;
    const row = db.prepare(`SELECT message_neuron_ids_json FROM interaction_units WHERE unit_id=?`)
        .get(unitId);
    const neuronIds = row ? parseEvidenceIds(row.message_neuron_ids_json) : null;
    if (!neuronIds?.length)
        return null;
    const scopes = new Set();
    for (const neuronId of neuronIds) {
        const scope = scopeForNeuron(db, neuronId);
        if (!scope)
            return null;
        scopes.add(scope[0]);
    }
    return [...scopes];
}
function dropRebuildableProjections(db) {
    if (tableExists(db, 'memory_edge_supports'))
        db.exec(`
    DELETE FROM memory_edge_supports
    WHERE source_authority IN ('atlas_curator','memory_frame_projector')
  `);
    if (tableExists(db, 'memory_edges'))
        db.exec(`
    DELETE FROM memory_edges
    WHERE source_authority IN ('atlas_curator','memory_frame_projector')
  `);
    for (const table of REBUILDABLE_PROJECTIONS)
        db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(table)}`);
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
function detachAuxiliaryObjects(db) {
    const owned = new Set(FINAL_AUXILIARY_OBJECTS.map((object) => object.name));
    const rows = db.prepare(`
    SELECT type,name,sql FROM sqlite_master
    WHERE type IN ('view','trigger','index') AND sql IS NOT NULL AND name NOT GLOB 'sqlite_*'
    ORDER BY CASE type WHEN 'view' THEN 0 WHEN 'trigger' THEN 1 ELSE 2 END
  `).all();
    for (const row of rows)
        db.exec(`DROP ${row.type.toUpperCase()} IF EXISTS ${quoteIdentifier(row.name)}`);
    return rows.filter((row) => !owned.has(row.name)).map((row) => row.sql);
}
function restoreAuxiliaryObjects(db, sql) {
    for (const statement of sql)
        db.exec(statement);
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
function entityVisibleInScope(db, entityId, scope) {
    if (!tableExists(db, 'entity_instances') || !db.prepare(`
    SELECT 1 FROM entity_instances WHERE instance_id=? AND status='active'
  `).get(entityId))
        return false;
    return entityScopes(db, entityId).includes(scope);
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
function tableExists(db, table) {
    return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table));
}
function quoteIdentifier(identifier) {
    return `"${identifier.replaceAll('"', '""')}"`;
}
