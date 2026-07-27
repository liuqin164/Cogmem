import { createHash } from 'node:crypto';
export const migration_0059 = {
    version: '0059',
    description: 'scope policy execution and finalize provenance guards',
    up(db) {
        migratePolicyExecutions(db);
        repairPendingQuarantine(db);
        removeUnresolvedTaskProjections(db);
        removeDanglingRows(db);
        installRuntimeProvenanceGuards(db);
        assertProjectExecutionAndProvenanceGuards(db);
    },
    down() { },
};
function migratePolicyExecutions(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS policy_execution_quarantine (
    execution_id TEXT PRIMARY KEY,
    record_hash TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
    if (!tableExists(db, 'policy_executions')) {
        createPolicyExecutionTable(db);
        return;
    }
    if (hasScopedPolicyIdentity(db))
        return;
    const rows = db.prepare(`SELECT * FROM policy_executions`).all();
    db.exec(`ALTER TABLE policy_executions RENAME TO policy_executions_0059_unscoped`);
    createPolicyExecutionTable(db);
    const quarantine = db.prepare(`INSERT OR REPLACE INTO policy_execution_quarantine VALUES(?,?,?,?)`);
    for (const row of rows) {
        quarantine.run(String(row.execution_id), createHash('sha256').update(JSON.stringify(row)).digest('hex'), 'project_scope_unproven', Date.now());
    }
    db.exec(`DROP TABLE policy_executions_0059_unscoped`);
}
function createPolicyExecutionTable(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS policy_executions (
    execution_id TEXT PRIMARY KEY,
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
    UNIQUE(project_scope,idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS idx_policy_executions_runtime
    ON policy_executions(project_scope,runtime_id,updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_policy_executions_policy_group
    ON policy_executions(project_scope,policy_group,updated_at DESC)`);
}
function repairPendingQuarantine(db) {
    if (!tableExists(db, 'pending_entity_resolution_quarantine'))
        return;
    addColumn(db, 'pending_entity_resolution_quarantine', 'project_scope', `TEXT NOT NULL DEFAULT ''`);
    addColumn(db, 'pending_entity_resolution_quarantine', 'implicated_scopes_json', `TEXT NOT NULL DEFAULT '[]'`);
    addColumn(db, 'pending_entity_resolution_quarantine', 'context_neuron_id', 'TEXT');
    addColumn(db, 'pending_entity_resolution_quarantine', 'scope_resolved', 'INTEGER NOT NULL DEFAULT 0');
    const rows = db.prepare(`SELECT pending_id,record_json FROM pending_entity_resolution_quarantine`).all();
    const update = db.prepare(`UPDATE pending_entity_resolution_quarantine
    SET project_scope=?,implicated_scopes_json=?,context_neuron_id=?,scope_resolved=?,record_json=?
    WHERE pending_id=?`);
    for (const row of rows) {
        const record = parseRecord(row.record_json);
        const contextNeuronId = typeof record.context_neuron_id === 'string' ? record.context_neuron_id : undefined;
        const neuron = contextNeuronId && tableExists(db, 'neurons')
            ? db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM neurons WHERE id=?`).get(contextNeuronId)
            : null;
        if (neuron) {
            update.run(neuron.scope, JSON.stringify([neuron.scope]), contextNeuronId, 1, row.record_json, row.pending_id);
        }
        else {
            update.run('', '[]', contextNeuronId ?? null, 0, JSON.stringify({
                pendingId: row.pending_id,
                recordHash: createHash('sha256').update(row.record_json).digest('hex'),
            }), row.pending_id);
        }
    }
}
function removeUnresolvedTaskProjections(db) {
    if (!tableExists(db, 'task_identity_restoration_manifest'))
        return;
    if (tableExists(db, 'task_branch_entries'))
        db.exec(`DELETE FROM task_branch_entries
    WHERE task_id IN (SELECT task_id FROM task_identity_restoration_manifest WHERE recovery_status='unresolved')`);
    if (tableExists(db, 'topology_membership'))
        db.exec(`DELETE FROM topology_membership
    WHERE dimension_type='task_branch' AND EXISTS (
      SELECT 1 FROM task_identity_restoration_manifest m
      WHERE m.recovery_status='unresolved'
        AND m.project_id=COALESCE(topology_membership.project_id,'')
        AND m.task_key=topology_membership.dimension_key
    )`);
    if (tableExists(db, 'cognitive_nodes') && tableExists(db, 'cognitive_edges')) {
        db.exec(`DELETE FROM cognitive_edges WHERE source_node_id IN (
      SELECT n.node_id FROM cognitive_nodes n JOIN task_identity_restoration_manifest m
        ON m.project_id=n.project_id AND m.task_key=n.node_key
      WHERE n.node_type='task_branch' AND m.recovery_status='unresolved'
    ) OR target_node_id IN (
      SELECT n.node_id FROM cognitive_nodes n JOIN task_identity_restoration_manifest m
        ON m.project_id=n.project_id AND m.task_key=n.node_key
      WHERE n.node_type='task_branch' AND m.recovery_status='unresolved'
    );
    DELETE FROM cognitive_nodes WHERE node_type='task_branch' AND EXISTS (
      SELECT 1 FROM task_identity_restoration_manifest m
      WHERE m.recovery_status='unresolved' AND m.project_id=cognitive_nodes.project_id
        AND m.task_key=cognitive_nodes.node_key
    )`);
    }
    if (tableExists(db, 'task_branches'))
        db.exec(`DELETE FROM task_branches
    WHERE task_id IN (SELECT task_id FROM task_identity_restoration_manifest WHERE recovery_status='unresolved')`);
}
function removeDanglingRows(db) {
    if (tableExists(db, 'synapses') && tableExists(db, 'neurons'))
        db.exec(`DELETE FROM synapses
    WHERE NOT EXISTS (
      SELECT 1 FROM neurons a JOIN neurons b ON b.id=synapses.target_id
      WHERE a.id=synapses.source_id AND a.is_deleted=0 AND b.is_deleted=0
        AND COALESCE(a.project_id,'')=COALESCE(b.project_id,'')
        AND synapses.project_id=COALESCE(a.project_id,'')
    )`);
    if (tableExists(db, 'cognitive_nodes') && tableExists(db, 'neurons'))
        db.exec(`DELETE FROM cognitive_nodes
    WHERE source_neuron_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM neurons n WHERE n.id=cognitive_nodes.source_neuron_id AND n.is_deleted=0
        AND COALESCE(n.project_id,'')=cognitive_nodes.project_id
    )`);
    if (tableExists(db, 'cognitive_edges') && tableExists(db, 'cognitive_nodes'))
        db.exec(`DELETE FROM cognitive_edges
    WHERE NOT EXISTS (
      SELECT 1 FROM cognitive_nodes a JOIN cognitive_nodes b ON b.node_id=cognitive_edges.target_node_id
      WHERE a.node_id=cognitive_edges.source_node_id AND a.project_id=cognitive_edges.project_id
        AND b.project_id=cognitive_edges.project_id
    )`);
    if (tableExists(db, 'reasoning_steps') && tableExists(db, 'reasoning_chains') && tableExists(db, 'neurons'))
        db.exec(`DELETE FROM reasoning_steps
    WHERE NOT EXISTS (
      SELECT 1 FROM reasoning_chains c JOIN neurons n ON n.id=reasoning_steps.neuron_id
      WHERE c.id=reasoning_steps.chain_id AND n.is_deleted=0
        AND COALESCE(c.project_id,'')=COALESCE(n.project_id,'')
    )`);
    if (tableExists(db, 'belief_evidence') && tableExists(db, 'beliefs')
        && tableExists(db, 'neurons') && tableExists(db, 'memory_events'))
        db.exec(`DELETE FROM belief_evidence
    WHERE NOT EXISTS (SELECT 1 FROM beliefs b WHERE b.id=belief_evidence.belief_id)
      OR (neuron_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM beliefs b JOIN neurons n ON n.id=belief_evidence.neuron_id AND n.is_deleted=0
        WHERE b.id=belief_evidence.belief_id AND COALESCE(b.project_id,'')=COALESCE(n.project_id,'')
      ))
      OR (event_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM beliefs b JOIN memory_events e ON e.event_id=belief_evidence.event_id
        WHERE b.id=belief_evidence.belief_id AND COALESCE(b.project_id,'')=COALESCE(e.project_id,'')
      ))`);
    if (tableExists(db, 'pending_entity_resolution') && tableExists(db, 'neurons'))
        db.exec(`DELETE FROM pending_entity_resolution
    WHERE context_neuron_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM neurons n WHERE n.id=pending_entity_resolution.context_neuron_id AND n.is_deleted=0
        AND COALESCE(n.project_id,'')=pending_entity_resolution.project_scope
    )`);
}
export function installRuntimeProvenanceGuards(db) {
    if (tableExists(db, 'synapses') && tableExists(db, 'neurons')) {
        scopeTrigger(db, 'synapses_scope_insert', 'synapses', 'INSERT', synapseGuard());
        scopeTrigger(db, 'synapses_scope_update', 'synapses', 'UPDATE', synapseGuard());
    }
    if (tableExists(db, 'belief_evidence') && tableExists(db, 'beliefs')
        && tableExists(db, 'neurons') && tableExists(db, 'memory_events')) {
        scopeTrigger(db, 'belief_evidence_scope_insert', 'belief_evidence', 'INSERT', beliefEvidenceGuard());
        scopeTrigger(db, 'belief_evidence_scope_update', 'belief_evidence', 'UPDATE', beliefEvidenceGuard());
    }
    if (tableExists(db, 'cognitive_nodes') && tableExists(db, 'neurons')) {
        const guard = `NEW.source_neuron_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM neurons n WHERE n.id=NEW.source_neuron_id AND n.is_deleted=0
        AND COALESCE(n.project_id,'')=NEW.project_id)`;
        scopeTrigger(db, 'cognitive_node_source_insert', 'cognitive_nodes', 'INSERT', guard);
        scopeTrigger(db, 'cognitive_node_source_update', 'cognitive_nodes', 'UPDATE', guard);
    }
    if (tableExists(db, 'reasoning_steps') && tableExists(db, 'reasoning_chains') && tableExists(db, 'neurons')) {
        const guard = `NOT EXISTS (
      SELECT 1 FROM reasoning_chains c JOIN neurons n ON n.id=NEW.neuron_id
      WHERE c.id=NEW.chain_id AND n.is_deleted=0 AND COALESCE(c.project_id,'')=COALESCE(n.project_id,''))`;
        scopeTrigger(db, 'reasoning_step_scope_insert', 'reasoning_steps', 'INSERT', guard);
        scopeTrigger(db, 'reasoning_step_scope_update', 'reasoning_steps', 'UPDATE', guard);
    }
    if (tableExists(db, 'pending_entity_resolution') && tableExists(db, 'neurons')) {
        const guard = `NEW.context_neuron_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM neurons n WHERE n.id=NEW.context_neuron_id AND n.is_deleted=0
        AND COALESCE(n.project_id,'')=NEW.project_scope)`;
        scopeTrigger(db, 'pending_entity_scope_insert', 'pending_entity_resolution', 'INSERT', guard);
        scopeTrigger(db, 'pending_entity_scope_update', 'pending_entity_resolution', 'UPDATE', guard);
    }
    if (tableExists(db, 'memory_bindings') && tableExists(db, 'memory_events')
        && tableExists(db, 'memory_topics') && tableExists(db, 'memory_entities')) {
        const guard = `NOT EXISTS (
      SELECT 1 FROM memory_events e WHERE e.event_id=NEW.event_id
        AND COALESCE(e.project_id,'')=COALESCE(NEW.project_id,'')
    ) OR NOT EXISTS (
      SELECT 1 FROM memory_topics t WHERE t.topic_path=NEW.topic_path
        AND COALESCE(t.project_id,'')=COALESCE(NEW.project_id,'')
    ) OR (NEW.entity_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM memory_entities e WHERE e.entity_id=NEW.entity_id
        AND COALESCE(e.project_id,'')=COALESCE(NEW.project_id,'')
    ))`;
        scopeTrigger(db, 'memory_binding_scope_insert', 'memory_bindings', 'INSERT', guard);
        scopeTrigger(db, 'memory_binding_scope_update', 'memory_bindings', 'UPDATE', guard);
    }
}
export function projectExecutionAndProvenanceGuardsSatisfied(db) {
    try {
        assertProjectExecutionAndProvenanceGuards(db);
        return true;
    }
    catch {
        return false;
    }
}
function assertProjectExecutionAndProvenanceGuards(db) {
    if (!tableExists(db, 'policy_executions') || !hasScopedPolicyIdentity(db)
        || !tableExists(db, 'policy_execution_quarantine'))
        throw new Error('policy_execution_scope_missing');
    if (tableExists(db, 'pending_entity_resolution_quarantine')) {
        for (const column of ['project_scope', 'implicated_scopes_json', 'context_neuron_id', 'scope_resolved']) {
            if (!tableColumns(db, 'pending_entity_resolution_quarantine').has(column))
                throw new Error('pending_quarantine_scope_missing');
        }
        if (db.prepare(`SELECT 1 FROM pending_entity_resolution_quarantine
      WHERE scope_resolved=0 AND (NOT json_valid(record_json) OR json_extract(record_json,'$.recordHash') IS NULL) LIMIT 1`).get()) {
            throw new Error('pending_quarantine_unscoped_payload');
        }
    }
    if (tableExists(db, 'task_identity_restoration_manifest')) {
        if (tableExists(db, 'task_branches') && db.prepare(`SELECT 1 FROM task_branches
      WHERE task_id IN (SELECT task_id FROM task_identity_restoration_manifest WHERE recovery_status='unresolved') LIMIT 1`).get()) {
            throw new Error('unresolved_task_active');
        }
        if (tableExists(db, 'task_branch_entries') && db.prepare(`SELECT 1 FROM task_branch_entries
      WHERE task_id IN (SELECT task_id FROM task_identity_restoration_manifest WHERE recovery_status='unresolved') LIMIT 1`).get()) {
            throw new Error('unresolved_task_entry_active');
        }
        if (tableExists(db, 'topology_membership') && db.prepare(`SELECT 1 FROM topology_membership t
      JOIN task_identity_restoration_manifest m
        ON m.project_id=COALESCE(t.project_id,'') AND m.task_key=t.dimension_key
      WHERE t.dimension_type='task_branch' AND m.recovery_status='unresolved' LIMIT 1`).get()) {
            throw new Error('unresolved_task_membership_active');
        }
        if (tableExists(db, 'cognitive_nodes') && db.prepare(`SELECT 1 FROM cognitive_nodes n
      JOIN task_identity_restoration_manifest m ON m.project_id=n.project_id AND m.task_key=n.node_key
      WHERE n.node_type='task_branch' AND m.recovery_status='unresolved' LIMIT 1`).get()) {
            throw new Error('unresolved_task_cognitive_node_active');
        }
    }
    if (tableExists(db, 'synapses') && tableExists(db, 'neurons') && db.prepare(`SELECT 1 FROM synapses s
    LEFT JOIN neurons a ON a.id=s.source_id LEFT JOIN neurons b ON b.id=s.target_id
    WHERE a.id IS NULL OR b.id IS NULL OR a.is_deleted<>0 OR b.is_deleted<>0
      OR COALESCE(a.project_id,'')<>COALESCE(b.project_id,'') OR s.project_id<>COALESCE(a.project_id,'') LIMIT 1`).get()) {
        throw new Error('synapse_endpoint_invalid');
    }
    if (tableExists(db, 'pending_entity_resolution') && tableExists(db, 'neurons') && db.prepare(`SELECT 1 FROM pending_entity_resolution p
    LEFT JOIN neurons n ON n.id=p.context_neuron_id
    WHERE n.id IS NULL OR n.is_deleted<>0 OR COALESCE(n.project_id,'')<>p.project_scope LIMIT 1`).get()) {
        throw new Error('pending_context_invalid');
    }
    if (tableExists(db, 'cognitive_nodes') && tableExists(db, 'neurons') && db.prepare(`SELECT 1 FROM cognitive_nodes n
    LEFT JOIN neurons source ON source.id=n.source_neuron_id
    WHERE n.source_neuron_id IS NOT NULL AND (
      source.id IS NULL OR source.is_deleted<>0 OR COALESCE(source.project_id,'')<>n.project_id
    ) LIMIT 1`).get())
        throw new Error('cognitive_source_invalid');
    if (tableExists(db, 'cognitive_edges') && tableExists(db, 'cognitive_nodes') && db.prepare(`SELECT 1 FROM cognitive_edges e
    LEFT JOIN cognitive_nodes source ON source.node_id=e.source_node_id
    LEFT JOIN cognitive_nodes target ON target.node_id=e.target_node_id
    WHERE source.node_id IS NULL OR target.node_id IS NULL
      OR source.project_id<>e.project_id OR target.project_id<>e.project_id LIMIT 1`).get()) {
        throw new Error('cognitive_edge_invalid');
    }
    if (tableExists(db, 'reasoning_steps') && tableExists(db, 'reasoning_chains') && tableExists(db, 'neurons')
        && db.prepare(`SELECT 1 FROM reasoning_steps s
      LEFT JOIN reasoning_chains c ON c.id=s.chain_id LEFT JOIN neurons n ON n.id=s.neuron_id
      WHERE c.id IS NULL OR n.id IS NULL OR n.is_deleted<>0
        OR COALESCE(c.project_id,'')<>COALESCE(n.project_id,'') LIMIT 1`).get()) {
        throw new Error('reasoning_step_invalid');
    }
    if (tableExists(db, 'belief_evidence') && tableExists(db, 'beliefs')
        && tableExists(db, 'neurons') && tableExists(db, 'memory_events')
        && db.prepare(`SELECT 1 FROM belief_evidence e LEFT JOIN beliefs b ON b.id=e.belief_id
      LEFT JOIN neurons n ON n.id=e.neuron_id LEFT JOIN memory_events event ON event.event_id=e.event_id
      WHERE b.id IS NULL OR (e.neuron_id IS NOT NULL AND (
        n.id IS NULL OR n.is_deleted<>0 OR COALESCE(n.project_id,'')<>COALESCE(b.project_id,'')
      )) OR (e.event_id IS NOT NULL AND (
        event.event_id IS NULL OR COALESCE(event.project_id,'')<>COALESCE(b.project_id,'')
      )) LIMIT 1`).get())
        throw new Error('belief_evidence_invalid');
    if (tableExists(db, 'memory_bindings') && tableExists(db, 'memory_events')
        && tableExists(db, 'memory_topics') && tableExists(db, 'memory_entities')
        && db.prepare(`SELECT 1 FROM memory_bindings b
      LEFT JOIN memory_events event ON event.event_id=b.event_id
      LEFT JOIN memory_topics topic ON topic.topic_path=b.topic_path
        AND COALESCE(topic.project_id,'')=COALESCE(b.project_id,'')
      LEFT JOIN memory_entities entity ON entity.entity_id=b.entity_id
      WHERE event.event_id IS NULL OR COALESCE(event.project_id,'')<>COALESCE(b.project_id,'')
        OR topic.topic_path IS NULL OR (b.entity_id IS NOT NULL AND (
          entity.entity_id IS NULL OR COALESCE(entity.project_id,'')<>COALESCE(b.project_id,'')
        )) LIMIT 1`).get())
        throw new Error('memory_binding_endpoint_invalid');
    for (const trigger of expectedTriggers(db)) {
        if (!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?`).get(trigger))
            throw new Error(`scope_trigger_missing:${trigger}`);
    }
}
function expectedTriggers(db) {
    return [
        ...(tableExists(db, 'synapses') && tableExists(db, 'neurons') ? ['synapses_scope_insert', 'synapses_scope_update'] : []),
        ...(tableExists(db, 'belief_evidence') && tableExists(db, 'beliefs') && tableExists(db, 'neurons') && tableExists(db, 'memory_events')
            ? ['belief_evidence_scope_insert', 'belief_evidence_scope_update'] : []),
        ...(tableExists(db, 'cognitive_nodes') && tableExists(db, 'neurons') ? ['cognitive_node_source_insert', 'cognitive_node_source_update'] : []),
        ...(tableExists(db, 'reasoning_steps') && tableExists(db, 'reasoning_chains') && tableExists(db, 'neurons') ? ['reasoning_step_scope_insert', 'reasoning_step_scope_update'] : []),
        ...(tableExists(db, 'pending_entity_resolution') && tableExists(db, 'neurons') ? ['pending_entity_scope_insert', 'pending_entity_scope_update'] : []),
        ...(tableExists(db, 'memory_bindings') && tableExists(db, 'memory_events') && tableExists(db, 'memory_topics') && tableExists(db, 'memory_entities')
            ? ['memory_binding_scope_insert', 'memory_binding_scope_update'] : []),
    ];
}
function synapseGuard() {
    return `NOT EXISTS (
    SELECT 1 FROM neurons a JOIN neurons b ON b.id=NEW.target_id
    WHERE a.id=NEW.source_id AND a.is_deleted=0 AND b.is_deleted=0
      AND COALESCE(a.project_id,'')=COALESCE(b.project_id,'')
      AND NEW.project_id=COALESCE(a.project_id,''))`;
}
function beliefEvidenceGuard() {
    return `(NEW.neuron_id IS NULL AND NEW.event_id IS NULL)
    OR NOT EXISTS (SELECT 1 FROM beliefs b WHERE b.id=NEW.belief_id)
    OR (NEW.neuron_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM beliefs b JOIN neurons n ON n.id=NEW.neuron_id AND n.is_deleted=0
      WHERE b.id=NEW.belief_id AND COALESCE(b.project_id,'')=COALESCE(n.project_id,'')
    ))
    OR (NEW.event_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM beliefs b JOIN memory_events e ON e.event_id=NEW.event_id
      WHERE b.id=NEW.belief_id AND COALESCE(b.project_id,'')=COALESCE(e.project_id,'')
    ))`;
}
function scopeTrigger(db, name, table, operation, guard) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${name} BEFORE ${operation} ON ${table}
    WHEN ${guard} BEGIN SELECT RAISE(ABORT,'project_scope_mismatch'); END`);
}
function hasScopedPolicyIdentity(db) {
    if (!tableColumns(db, 'policy_executions').has('project_scope'))
        return false;
    return db.prepare(`PRAGMA index_list(policy_executions)`).all()
        .filter((index) => index.unique === 1)
        .some((index) => db.prepare(`PRAGMA index_info(${index.name})`).all()
        .map((column) => column.name).join('|') === 'project_scope|idempotency_key');
}
function addColumn(db, table, column, declaration) {
    if (!tableColumns(db, table).has(column))
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}
function parseRecord(value) {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}
function tableExists(db, name) {
    return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}
function tableColumns(db, name) {
    return tableExists(db, name)
        ? new Set(db.prepare(`PRAGMA table_info(${name})`).all().map((row) => row.name))
        : new Set();
}
