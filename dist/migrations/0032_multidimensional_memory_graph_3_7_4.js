import { createHash } from 'node:crypto';
import { memoryEdgeId, memoryEntityId } from '../binding/MemoryBindingIdentity.js';
import { cognitiveEdgeId, cognitiveNodeId } from '../engine/CognitiveGraphIdentity.js';
import { FINAL_AUXILIARY_OBJECTS, FINAL_TABLES, } from './v3_7_4/FinalSchemaDefinition.js';
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
    const preservedAuxiliaryObjects = detachAuxiliaryObjects(db);
    resetFreshBootstrap(db);
    installMissingFinalTables(db);
    installMigrationAuditTables(db);
    discardUnscopedRuntime(db);
    discardUnscopedPolicyExecutions(db);
    migrateEntityScope(db);
    migratePendingEntityResolution(db);
    migrateMemoryEntityProjectionIds(db);
    migrateScopedTopology(db);
    dropRebuildableProjections(db);
    installMissingFinalTables(db);
    reconcileChangedTables(db);
    rebuildTopologyMembership(db);
    rebuildCognitiveGraph(db);
    initializeProjectionState(db);
    installFinalAuxiliaryObjects(db);
    restoreAuxiliaryObjects(db, preservedAuxiliaryObjects);
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
        relation_type,target_type,target_id
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
            if (!memoryEndpointMatchesScope(db, row.source_type, row.source_id, row.project_id)
                || !memoryEndpointMatchesScope(db, row.target_type, row.target_id, row.project_id)) {
                return 'memory_edge_endpoint_scope';
            }
            seen.add(expected);
        }
    }
    if (tableExists(db, 'memory_entity_scope_identity') && db.prepare(`
    SELECT 1 FROM memory_entity_scope_identity m
    LEFT JOIN memory_entities e ON e.entity_id=m.scoped_entity_id
    WHERE e.entity_id IS NULL OR COALESCE(e.project_id,'')<>m.project_id OR e.entity_type<>m.entity_type
    LIMIT 1
  `).get())
        return 'memory_entity_scope_identity';
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
    pruneInvalidMemoryEdges(db, false);
    const rows = db.prepare('SELECT * FROM memory_entities').all();
    const insert = db.prepare(`
    INSERT OR IGNORE INTO memory_entities(
      entity_id,project_id,canonical_name,entity_type,aliases_json,stable_path,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)
  `);
    const mapIdentity = db.prepare(`
    INSERT OR IGNORE INTO memory_entity_scope_identity(
      root_entity_id,project_id,scoped_entity_id,entity_type,created_at
    ) VALUES(?,?,?,?,?)
  `);
    for (const row of rows) {
        const oldId = String(row.entity_id);
        const ownerScope = String(row.project_id ?? '');
        const scopes = new Set([ownerScope]);
        for (const item of db.prepare(`
      SELECT DISTINCT COALESCE(project_id,'') AS scope FROM memory_bindings WHERE entity_id=?
    `).all(oldId))
            scopes.add(item.scope);
        if (tableExists(db, 'memory_edges')) {
            for (const item of db.prepare(`
        SELECT DISTINCT COALESCE(project_id,'') AS scope FROM memory_edges
        WHERE (source_type='entity' AND source_id=?) OR (target_type='entity' AND target_id=?)
      `).all(oldId, oldId))
                scopes.add(item.scope);
        }
        for (const scope of [ownerScope, ...[...scopes].filter((item) => item !== ownerScope).sort()]) {
            const nextId = scope === ownerScope
                ? oldId
                : memoryEntityId(scope, String(row.entity_type), oldId);
            if (nextId !== oldId) {
                const scopedAliases = tableExists(db, 'entity_aliases')
                    ? db.prepare(`
              SELECT alias_text FROM entity_aliases
              WHERE entity_id=? AND project_id=?
              ORDER BY normalized_alias
            `).all(oldId, scope).map((item) => item.alias_text)
                    : [];
                insert.run(nextId, scope || null, String(row.canonical_name), String(row.entity_type), JSON.stringify(scopedAliases), null, Number(row.created_at), Number(row.updated_at));
            }
            mapIdentity.run(oldId, scope, nextId, String(row.entity_type), Number(row.created_at));
            if (nextId === oldId)
                continue;
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
    }
    pruneInvalidMemoryEdges(db, true);
    rekeyMemoryEdges(db);
}
function pruneInvalidMemoryEdges(db, validateEntities) {
    if (!tableExists(db, 'memory_edges'))
        return;
    const rows = db.prepare(`SELECT * FROM memory_edges ORDER BY edge_id`).all();
    for (const row of rows) {
        const scope = String(row.project_id ?? '');
        const evidence = parseEvidenceIds(row.evidence_event_ids_json);
        let reason = evidence ? undefined : 'memory_edge_evidence_malformed';
        if (!reason && evidence.some((eventId) => !recordMatchesScope(db, 'memory_events', 'event_id', eventId, scope))) {
            reason = 'memory_edge_evidence_scope_mismatch';
        }
        for (const endpoint of [
            { type: String(row.source_type), id: String(row.source_id) },
            { type: String(row.target_type), id: String(row.target_id) },
        ]) {
            if (reason || (!validateEntities && endpoint.type === 'entity'))
                continue;
            if (!memoryEndpointMatchesScope(db, endpoint.type, endpoint.id, scope)) {
                reason = 'memory_edge_endpoint_scope_mismatch';
            }
        }
        if (!reason)
            continue;
        quarantineEntityRow(db, 'memory_edge', String(row.edge_id), row, [scope], reason);
        db.prepare(`DELETE FROM memory_edges WHERE edge_id=?`).run(String(row.edge_id));
    }
}
function memoryEndpointMatchesScope(db, type, id, scope) {
    if (type === 'event' || type === 'raw_event')
        return recordMatchesScope(db, 'memory_events', 'event_id', id, scope);
    if (type === 'episode')
        return recordMatchesScope(db, 'memory_episodes', 'episode_id', id, scope);
    if (type === 'entity')
        return optionalRecordMatchesScope(db, 'memory_entities', 'entity_id', id, scope);
    if (type === 'topic')
        return optionalRecordMatchesScope(db, 'memory_topics', 'topic_path', id, scope);
    if (type === 'cluster')
        return optionalRecordMatchesScope(db, 'memory_clusters', 'cluster_id', id, scope);
    return true;
}
function optionalRecordMatchesScope(db, table, idColumn, id, scope) {
    if (!tableExists(db, table))
        return true;
    const rows = db.prepare(`
    SELECT COALESCE(project_id,'') AS scope FROM ${quoteIdentifier(table)}
    WHERE ${quoteIdentifier(idColumn)}=?
  `).all(id);
    return rows.length === 0 || rows.some((row) => row.scope === scope);
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
function preferredEdgeAuthority(left, right) {
    const priority = ['model_candidate', 'atlas_curator', 'memory_frame_projector', 'governed_projection', 'raw_evidence'];
    return priority.indexOf(left) >= priority.indexOf(right) ? left : right;
}
function rekeyMemoryEdges(db) {
    if (!tableExists(db, 'memory_edges'))
        return;
    const rows = db.prepare('SELECT * FROM memory_edges ORDER BY edge_id').all();
    for (const row of rows) {
        const edgeId = memoryEdgeId({
            projectId: row.project_id ?? '',
            sourceType: row.source_type,
            sourceId: row.source_id,
            relationType: row.relation_type,
            targetType: row.target_type,
            targetId: row.target_id,
        });
        if (edgeId === row.edge_id)
            continue;
        const existing = db.prepare('SELECT * FROM memory_edges WHERE edge_id=?').get(edgeId);
        if (!existing) {
            db.prepare('UPDATE memory_edges SET edge_id=? WHERE edge_id=?').run(edgeId, row.edge_id);
            continue;
        }
        const evidence = new Set([
            ...(parseEvidenceIds(existing.evidence_event_ids_json) ?? []),
            ...(parseEvidenceIds(row.evidence_event_ids_json) ?? []),
        ]);
        db.prepare(`
      UPDATE memory_edges SET
        confidence=?,base_weight=?,stability=?,activation=?,evidence_event_ids_json=?,
        status=?,valid_from=?,valid_to=?,version=?,source_authority=?,created_at=?,updated_at=?
      WHERE edge_id=?
    `).run(Math.max(existing.confidence, row.confidence), Math.max(existing.base_weight, row.base_weight), Math.max(existing.stability, row.stability), Math.max(existing.activation, row.activation), JSON.stringify([...evidence].sort()), existing.status === 'active' || row.status === 'active' ? 'active' : existing.status, Math.min(existing.valid_from, row.valid_from), existing.valid_to == null || row.valid_to == null ? null : Math.max(existing.valid_to, row.valid_to), Math.max(existing.version, row.version) + 1, preferredEdgeAuthority(existing.source_authority, row.source_authority), Math.min(existing.created_at, row.created_at), Math.max(existing.updated_at, row.updated_at), edgeId);
        db.prepare('DELETE FROM memory_edges WHERE edge_id=?').run(row.edge_id);
    }
}
function migrateScopedTopology(db) {
    rebuildScopedTopologyParents(db, 'task');
    rebuildScopedTopologyParents(db, 'event_cluster');
    cleanProjectBranchTopology(db);
}
function rebuildScopedTopologyParents(db, kind) {
    const parentTable = kind === 'task' ? 'task_branches' : 'event_clusters';
    const entryTable = kind === 'task' ? 'task_branch_entries' : 'event_cluster_entries';
    const idColumn = kind === 'task' ? 'task_id' : 'cluster_id';
    const keyColumn = kind === 'task' ? 'task_key' : 'cluster_key';
    if (!tableExists(db, parentTable) || !tableExists(db, entryTable))
        return;
    const parents = db.prepare(`SELECT * FROM ${parentTable}`).all();
    const entries = db.prepare(`SELECT rowid AS migration_rowid,* FROM ${entryTable}`).all();
    const parentsById = new Map(parents.map((row) => [String(row[idColumn]), row]));
    const grouped = new Map();
    for (const entry of entries) {
        const oldId = String(entry[idColumn]);
        const parent = parentsById.get(oldId);
        const inferred = inferTopologyEntryScope(db, entry);
        if (!parent || inferred.scope === undefined) {
            quarantineEntityRow(db, `${kind}_entry`, `${oldId}:${String(entry.migration_rowid)}`, entry, inferred.scopes, parent ? inferred.reason : `${kind}_parent_missing`);
            continue;
        }
        const groupKey = `${oldId}\0${inferred.scope}`;
        const group = grouped.get(groupKey) ?? [];
        group.push(entry);
        grouped.set(groupKey, group);
    }
    db.exec(`DROP TABLE ${entryTable}; DROP TABLE ${parentTable};`);
    installTable(db, parentTable);
    installTable(db, entryTable);
    const inserted = new Set();
    for (const [groupKey, scopedEntries] of [...grouped].sort(([left], [right]) => left.localeCompare(right))) {
        const [oldId, scope] = groupKey.split('\0');
        const parent = parentsById.get(oldId);
        const key = String(parent[keyColumn]);
        const nextId = scopedId(kind, key, scope);
        if (!inserted.has(nextId)) {
            if (kind === 'task') {
                db.prepare(`
          INSERT INTO task_branches(task_id,project_id,task_key,title,status,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?)
        `).run(nextId, scope, key, String(parent.title), String(parent.status), Number(parent.created_at), Number(parent.updated_at));
            }
            else {
                db.prepare(`
          INSERT INTO event_clusters(cluster_id,project_id,cluster_key,cluster_type,title,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?)
        `).run(nextId, scope, key, String(parent.cluster_type), String(parent.title), Number(parent.created_at), Number(parent.updated_at));
            }
            inserted.add(nextId);
        }
        const insertEntry = db.prepare(`
      INSERT INTO ${entryTable}(
        ${idColumn},project_id,neuron_id,unit_id,belief_id,fact_id,event_id,created_at
      ) VALUES(?,?,?,?,?,?,?,?)
    `);
        for (const entry of scopedEntries)
            insertEntry.run(nextId, scope, entry.neuron_id ?? null, entry.unit_id ?? null, entry.belief_id ?? null, entry.fact_id ?? null, entry.event_id ?? null, Number(entry.created_at));
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
function cleanProjectBranchTopology(db) {
    if (tableExists(db, 'branch_entries') && tableExists(db, 'project_branches')) {
        for (const entry of db.prepare(`SELECT rowid AS migration_rowid,* FROM branch_entries`).all()) {
            const parent = db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM project_branches WHERE branch_id=?`)
                .get(String(entry.branch_id));
            const inferred = inferTopologyEntryScope(db, entry);
            if (parent && inferred.scope === parent.scope)
                continue;
            quarantineEntityRow(db, 'branch_entry', String(entry.migration_rowid), entry, inferred.scopes, parent ? inferred.reason || 'branch_entry_scope_mismatch' : 'branch_parent_missing');
            db.prepare(`DELETE FROM branch_entries WHERE rowid=?`).run(Number(entry.migration_rowid));
        }
    }
    if (tableExists(db, 'branch_links') && tableExists(db, 'project_branches')) {
        for (const row of db.prepare(`SELECT rowid AS migration_rowid,* FROM branch_links`).all()) {
            const scopes = db.prepare(`
        SELECT COALESCE(a.project_id,'') AS parent_scope,COALESCE(b.project_id,'') AS child_scope
        FROM project_branches a JOIN project_branches b ON b.branch_id=? WHERE a.branch_id=?
      `).get(String(row.child_branch_id), String(row.parent_branch_id));
            if (scopes && scopes.parent_scope === scopes.child_scope)
                continue;
            quarantineEntityRow(db, 'branch_link', String(row.migration_rowid), row, scopes ? [scopes.parent_scope, scopes.child_scope] : [], 'branch_link_scope_mismatch');
            db.prepare(`DELETE FROM branch_links WHERE rowid=?`).run(Number(row.migration_rowid));
        }
    }
}
function rebuildTopologyMembership(db) {
    if (!tableExists(db, 'topology_membership'))
        return;
    db.exec(`DELETE FROM topology_membership`);
    const insert = db.prepare(`
    INSERT OR IGNORE INTO topology_membership(
      neuron_id,project_id,dimension_type,dimension_key,title,created_at
    ) VALUES(?,?,?,?,?,?)
  `);
    for (const config of [
        { parent: 'project_branches', entries: 'branch_entries', id: 'branch_id', type: 'project_branch', key: 'branch_key' },
        { parent: 'task_branches', entries: 'task_branch_entries', id: 'task_id', type: 'task_branch', key: 'task_key' },
        { parent: 'event_clusters', entries: 'event_cluster_entries', id: 'cluster_id', type: 'event_cluster', key: 'cluster_key' },
    ]) {
        for (const row of db.prepare(`
      SELECT e.neuron_id,p.project_id,p.${config.key} AS dimension_key,p.title,e.created_at
      FROM ${config.entries} e JOIN ${config.parent} p ON p.${config.id}=e.${config.id}
      JOIN neurons n ON n.id=e.neuron_id AND n.is_deleted=0
      WHERE e.neuron_id IS NOT NULL AND COALESCE(n.project_id,'')=p.project_id
    `).all())
            insert.run(String(row.neuron_id), String(row.project_id), config.type, String(row.dimension_key), String(row.title), Number(row.created_at));
    }
}
function rebuildCognitiveGraph(db) {
    if (!tableExists(db, 'cognitive_nodes') || !tableExists(db, 'cognitive_edges'))
        return;
    db.exec(`DELETE FROM cognitive_edges; DELETE FROM cognitive_nodes;`);
    const insertNode = db.prepare(`
    INSERT OR IGNORE INTO cognitive_nodes(
      node_id,node_type,node_key,title,project_id,source_neuron_id,metadata_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?)
  `);
    const insertEdge = db.prepare(`
    INSERT OR IGNORE INTO cognitive_edges(
      edge_id,source_node_id,target_node_id,edge_type,weight,project_id,metadata_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?)
  `);
    const addNode = (scope, nodeType, nodeKey, title, sourceNeuronId, metadata, createdAt) => {
        const nodeId = cognitiveNodeId(scope, nodeType, nodeKey);
        insertNode.run(nodeId, nodeType, nodeKey, title, scope, sourceNeuronId, metadata ? JSON.stringify(metadata) : null, createdAt, createdAt);
        return nodeId;
    };
    const addEdge = (scope, sourceNodeId, targetNodeId, edgeType, createdAt) => insertEdge.run(cognitiveEdgeId({ projectId: scope, sourceNodeId, targetNodeId, edgeType }), sourceNodeId, targetNodeId, edgeType, 1, scope, null, createdAt);
    const neuronNodes = new Map();
    const neuronScopes = new Map();
    for (const row of db.prepare(`
    SELECT id,content,COALESCE(project_id,'') AS scope,type,created_at
    FROM neurons WHERE is_deleted=0 ORDER BY id
  `).all()) {
        const neuronId = String(row.id);
        const scope = String(row.scope);
        neuronScopes.set(neuronId, scope);
        neuronNodes.set(neuronId, addNode(scope, 'neuron', `neuron:${neuronId}`, String(row.content).slice(0, 120), neuronId, { type: String(row.type) }, Number(row.created_at)));
    }
    if (tableExists(db, 'interaction_units')) {
        for (const row of db.prepare(`SELECT * FROM interaction_units ORDER BY unit_id`).all()) {
            const scopes = scopesForUnit(db, String(row.unit_id));
            if (scopes?.length !== 1) {
                quarantineEntityRow(db, 'cognitive_unit', String(row.unit_id), row, scopes ?? [], 'cognitive_unit_scope_unresolved');
                continue;
            }
            const scope = scopes[0];
            const unitNode = addNode(scope, 'unit', `unit:${String(row.unit_id)}`, String(row.semantic_text), null, { type: String(row.type) }, Number(row.created_at));
            for (const neuronId of parseEvidenceIds(row.message_neuron_ids_json) ?? []) {
                const neuronNode = neuronNodes.get(neuronId);
                if (neuronNode)
                    addEdge(scope, unitNode, neuronNode, 'summarizes', Number(row.created_at));
            }
        }
    }
    if (tableExists(db, 'beliefs')) {
        for (const row of db.prepare(`SELECT * FROM beliefs ORDER BY id`).all()) {
            const sourceNeuronId = typeof row.source_neuron_id === 'string' && neuronNodes.has(row.source_neuron_id)
                ? row.source_neuron_id
                : null;
            const scope = sourceNeuronId ? neuronScopes.get(sourceNeuronId) : String(row.project_id ?? '');
            const beliefNode = addNode(scope, 'belief', `belief:${String(row.id)}`, `${String(row.subject)} ${String(row.predicate)} ${String(row.object_value)}`.trim(), sourceNeuronId, null, Number(row.created_at));
            if (sourceNeuronId)
                addEdge(scope, beliefNode, neuronNodes.get(sourceNeuronId), 'supports_belief', Number(row.created_at));
        }
    }
    if (tableExists(db, 'facts')) {
        for (const row of db.prepare(`
      SELECT f.*,COALESCE(n.project_id,'') AS scope,n.created_at AS neuron_created_at
      FROM facts f JOIN neurons n ON n.id=f.neuron_id WHERE n.is_deleted=0 ORDER BY f.fact_id
    `).all()) {
            const scope = String(row.scope);
            const factNode = addNode(scope, 'fact', `fact:${String(row.fact_id)}`, `${String(row.subject)} ${String(row.predicate_family)} ${String(row.object_value ?? row.predicate_value ?? '')}`.trim(), String(row.neuron_id), null, Number(row.valid_from ?? row.neuron_created_at));
            addEdge(scope, factNode, neuronNodes.get(String(row.neuron_id)), 'references_fact', Number(row.valid_from ?? row.neuron_created_at));
            if (typeof row.entity_id === 'string' && row.entity_id) {
                const entity = tableExists(db, 'entity_instances')
                    ? db.prepare(`SELECT canonical_name,type FROM entity_instances WHERE instance_id=?`).get(row.entity_id)
                    : null;
                const entityNode = addNode(scope, 'entity', `entity:${row.entity_id}`, String(entity?.canonical_name ?? row.entity_id), String(row.neuron_id), entity ? { type: String(entity.type) } : null, Number(row.valid_from ?? row.neuron_created_at));
                addEdge(scope, factNode, entityNode, 'mentions_entity', Number(row.valid_from ?? row.neuron_created_at));
            }
        }
    }
    if (tableExists(db, 'compiled_events')) {
        for (const row of db.prepare(`
      SELECT e.*,COALESCE(n.project_id,'') AS scope,n.created_at AS neuron_created_at
      FROM compiled_events e JOIN neurons n ON n.id=e.neuron_id WHERE n.is_deleted=0 ORDER BY e.event_id
    `).all()) {
            const scope = String(row.scope);
            const eventNode = addNode(scope, 'compiled_event', `compiled_event:${String(row.event_id)}`, `${String(row.event_type)}:${String(row.target ?? row.actor ?? 'event')}`, String(row.neuron_id), null, Number(row.valid_from ?? row.neuron_created_at));
            addEdge(scope, eventNode, neuronNodes.get(String(row.neuron_id)), 'references_event', Number(row.valid_from ?? row.neuron_created_at));
        }
    }
    for (const config of [
        { parent: 'project_branches', entries: 'branch_entries', id: 'branch_id', type: 'project_branch', prefix: 'project_branch', edge: 'belongs_to_project_branch' },
        { parent: 'task_branches', entries: 'task_branch_entries', id: 'task_id', type: 'task_branch', prefix: 'task_branch', edge: 'belongs_to_task' },
        { parent: 'event_clusters', entries: 'event_cluster_entries', id: 'cluster_id', type: 'event_cluster', prefix: 'event_cluster', edge: 'belongs_to_event_cluster' },
    ]) {
        for (const parent of db.prepare(`SELECT * FROM ${config.parent} ORDER BY ${config.id}`).all()) {
            const scope = String(parent.project_id ?? '');
            const parentId = String(parent[config.id]);
            const parentNode = addNode(scope, config.type, `${config.prefix}:${parentId}`, String(parent.title), null, { [config.id]: parentId }, Number(parent.created_at));
            for (const entry of db.prepare(`
        SELECT neuron_id,created_at FROM ${config.entries}
        WHERE ${config.id}=? AND project_id=? AND neuron_id IS NOT NULL
      `).all(parentId, scope)) {
                const neuronNode = neuronNodes.get(entry.neuron_id);
                if (neuronNode)
                    addEdge(scope, neuronNode, parentNode, config.edge, Number(entry.created_at));
            }
        }
    }
    if (tableExists(db, 'branch_links')) {
        for (const row of db.prepare(`
      SELECT l.*,COALESCE(a.project_id,'') AS scope
      FROM branch_links l JOIN project_branches a ON a.branch_id=l.parent_branch_id
      JOIN project_branches b ON b.branch_id=l.child_branch_id AND b.project_id=a.project_id
    `).all()) {
            const scope = String(row.scope);
            addEdge(scope, cognitiveNodeId(scope, 'project_branch', `project_branch:${String(row.parent_branch_id)}`), cognitiveNodeId(scope, 'project_branch', `project_branch:${String(row.child_branch_id)}`), 'extends_branch', Number(row.created_at));
        }
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
        branch_links: {
            project_id: `COALESCE((
        SELECT project_id FROM project_branches WHERE branch_id=parent_branch_id
      ),'')`,
        },
        branch_entries: {
            project_id: `COALESCE((
        SELECT project_id FROM project_branches WHERE branch_id=branch_entries.branch_id
      ),'')`,
        },
        task_branches: { project_id: `COALESCE(project_id,'')` },
        task_branch_entries: {
            project_id: `COALESCE((
        SELECT project_id FROM task_branches WHERE task_id=task_branch_entries.task_id
      ),'')`,
        },
        event_clusters: { project_id: `COALESCE(project_id,'')` },
        event_cluster_entries: {
            project_id: `COALESCE((
        SELECT project_id FROM event_clusters WHERE cluster_id=event_cluster_entries.cluster_id
      ),'')`,
        },
        topology_membership: {
            project_id: `COALESCE((
        SELECT project_id FROM neurons WHERE id=topology_membership.neuron_id
      ),project_id,'')`,
        },
        cognitive_nodes: {
            project_id: `COALESCE((
        SELECT project_id FROM neurons WHERE id=cognitive_nodes.source_neuron_id
      ),project_id,'')`,
        },
        cognitive_edges: {
            project_id: `COALESCE((
        SELECT project_id FROM cognitive_nodes WHERE node_id=cognitive_edges.source_node_id
      ),project_id,'')`,
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
function quarantineEntityRow(db, recordType, recordId, row, scopes, reason) {
    const hash = stableHash(row);
    db.prepare(`
    INSERT OR IGNORE INTO entity_scope_migration_quarantine(
      quarantine_id,record_type,record_id,record_hash,implicated_scopes_json,reason,created_at
    ) VALUES(?,?,?,?,?,?,?)
  `).run(`${recordType}-${hash.slice(0, 32)}`, recordType, recordId, hash, JSON.stringify(scopes), reason ?? (scopes.length ? `${recordType}_scope_ambiguous` : `${recordType}_scope_unresolved`), Date.now());
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
