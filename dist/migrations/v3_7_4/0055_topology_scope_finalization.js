import { createHash } from 'node:crypto';
export const migration_0055 = {
    version: '0055',
    description: 'finalize topology scope integrity and compensate task identity',
    up(db) {
        ensureColumn(db, 'branch_links', 'project_id', `TEXT NOT NULL DEFAULT ''`);
        repairBranchLinks(db);
        repairTimeEntries(db);
        repairEventLinks(db);
        repairClusterKeys(db);
        restoreTaskMetadata(db);
        restorePre0052TaskIdentity(db);
        repairTaskKeys(db);
        rebuildMembership(db);
        rebuildCognitiveTopology(db);
        assertTopologyFinalized(db);
        installBranchScopeTriggers(db);
    },
    down() { },
};
function restoreTaskMetadata(db) {
    if (!tableExists(db, 'task_branches') || !tempTableExists(db, '_0055_task_metadata_backup'))
        return;
    db.exec(`UPDATE task_branches SET title=(SELECT b.title FROM temp._0055_task_metadata_backup b WHERE b.project_id=task_branches.project_id AND b.task_key=task_branches.task_key LIMIT 1),status=(SELECT b.status FROM temp._0055_task_metadata_backup b WHERE b.project_id=task_branches.project_id AND b.task_key=task_branches.task_key LIMIT 1) WHERE EXISTS (SELECT 1 FROM temp._0055_task_metadata_backup b WHERE b.project_id=task_branches.project_id AND b.task_key=task_branches.task_key)`);
}
function restorePre0052TaskIdentity(db) {
    if (!tableExists(db, 'task_branches') || !tableExists(db, 'task_branch_entries') || !tempTableExists(db, '_0055_task_identity_backup') || !tempTableExists(db, '_0055_task_entry_backup'))
        return;
    const parents = db.prepare(`SELECT * FROM temp._0055_task_identity_backup`).all();
    const valid = [];
    for (const parent of parents) {
        const entries = db.prepare(`SELECT * FROM temp._0055_task_entry_backup WHERE task_id=?`).all(String(parent.task_id));
        const scope = String(parent.project_id ?? '');
        if (entries.every((entry) => { const resolved = resolveEntry(db, entry); return !('error' in resolved) && resolved.scope === scope; }))
            valid.push({ parent, scope, key: String(parent.task_key), entries });
    }
    const affected = new Set();
    for (const item of valid) {
        const row = db.prepare(`SELECT task_id FROM task_branches WHERE project_id=? AND task_key IN (?,?)`).get(item.scope, item.key, legacyNormalized(item.scope, item.key));
        if (row)
            affected.add(row.task_id);
    }
    for (const id of affected) {
        db.prepare(`DELETE FROM task_branch_entries WHERE task_id=?`).run(id);
        db.prepare(`DELETE FROM task_branches WHERE task_id=?`).run(id);
    }
    for (const item of valid) {
        const id = stableId('task', item.scope, item.key);
        db.prepare(`INSERT OR IGNORE INTO task_branches(task_id,project_id,task_key,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).run(id, item.scope, item.key, String(item.parent.title), String(item.parent.status), Number(item.parent.created_at), Number(item.parent.updated_at));
        for (const entry of item.entries)
            db.prepare(`INSERT OR IGNORE INTO task_branch_entries(task_id,project_id,neuron_id,unit_id,belief_id,fact_id,event_id,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(id, item.scope, entry.neuron_id, entry.unit_id, entry.belief_id, entry.fact_id, entry.event_id, entry.created_at);
    }
}
export function topologyFinalizationSatisfied(db) {
    try {
        assertTopologyFinalized(db);
        return true;
    }
    catch {
        return false;
    }
}
function repairBranchLinks(db) {
    if (!tableExists(db, 'branch_links') || !tableExists(db, 'project_branches'))
        return;
    const rows = db.prepare(`SELECT l.*,p.project_id AS parent_scope,c.project_id AS child_scope FROM branch_links l LEFT JOIN project_branches p ON p.branch_id=l.parent_branch_id LEFT JOIN project_branches c ON c.branch_id=l.child_branch_id`).all();
    for (const row of rows) {
        const parentScope = row.parent_scope === null ? undefined : String(row.parent_scope);
        const childScope = row.child_scope === null ? undefined : String(row.child_scope);
        if (parentScope === undefined || childScope === undefined || parentScope !== childScope) {
            quarantine(db, 'branch_link', String(row.parent_branch_id), parentScope ?? '', row, parentScope === undefined || childScope === undefined ? 'branch_link_dangling' : 'branch_link_project_scope_conflict', [parentScope, childScope].filter((value) => value !== undefined));
            db.prepare(`DELETE FROM branch_links WHERE parent_branch_id=? AND child_branch_id=? AND relation_type=?`).run(String(row.parent_branch_id), String(row.child_branch_id), String(row.relation_type));
        }
        else
            db.prepare(`UPDATE branch_links SET project_id=? WHERE parent_branch_id=? AND child_branch_id=? AND relation_type=?`).run(parentScope, String(row.parent_branch_id), String(row.child_branch_id), String(row.relation_type));
    }
}
function repairTimeEntries(db) {
    if (!tableExists(db, 'time_bucket_entries') || !tableExists(db, 'time_buckets'))
        return;
    const rows = db.prepare(`SELECT e.rowid AS rid,e.*,b.project_id AS bucket_scope FROM time_bucket_entries e LEFT JOIN time_buckets b ON b.bucket_id=e.bucket_id`).all();
    for (const row of rows) {
        const resolved = resolveEntry(db, row);
        if (row.bucket_scope === null || 'error' in resolved || resolved.scope !== row.bucket_scope) {
            const implicated = 'error' in resolved ? resolved.implicatedScopes : [resolved.scope];
            quarantine(db, 'time_bucket', row.bucket_id, row.bucket_scope ?? '', row, row.bucket_scope === null ? 'time_bucket_dangling' : 'error' in resolved ? resolved.error : 'time_bucket_project_scope_conflict', implicated);
            db.prepare(`DELETE FROM time_bucket_entries WHERE rowid=?`).run(row.rid);
        }
        else
            db.prepare(`UPDATE time_bucket_entries SET project_id=?,neuron_id=COALESCE(neuron_id,?) WHERE rowid=?`).run(resolved.scope, resolved.neuronId, row.rid);
    }
}
function repairEventLinks(db) {
    if (!tableExists(db, 'memory_events'))
        return;
    const rows = db.prepare(`SELECT event_id,COALESCE(project_id,'') AS scope,parent_event_id,prev_event_id,next_event_id FROM memory_events`).all();
    for (const row of rows)
        for (const column of ['parent_event_id', 'prev_event_id', 'next_event_id']) {
            const targetId = row[column];
            if (!targetId)
                continue;
            const target = db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM memory_events WHERE event_id=?`).get(targetId);
            if (target && target.scope === row.scope)
                continue;
            quarantine(db, 'event_link', String(row.event_id), String(row.scope), row, target ? 'event_link_project_scope_conflict' : 'event_link_dangling', target ? [String(row.scope), target.scope] : [String(row.scope)]);
            db.prepare(`UPDATE memory_events SET ${column}=NULL WHERE event_id=?`).run(row.event_id);
        }
}
function repairClusterKeys(db) {
    if (!tableExists(db, 'event_clusters'))
        return;
    const rows = db.prepare(`SELECT * FROM event_clusters WHERE cluster_key NOT LIKE cluster_type || ':%'`).all();
    for (const row of rows) {
        const clusterId = String(row.cluster_id);
        quarantine(db, 'event_cluster', clusterId, String(row.project_id ?? ''), row, 'event_cluster_key_noncanonical', [String(row.project_id ?? '')]);
        if (tableExists(db, 'event_cluster_entries'))
            db.prepare(`DELETE FROM event_cluster_entries WHERE cluster_id=?`).run(clusterId);
        db.prepare(`DELETE FROM event_clusters WHERE cluster_id=?`).run(clusterId);
    }
}
function repairTaskKeys(db) {
    if (!tableExists(db, 'task_branches') || !tableExists(db, 'task_branch_entries'))
        return;
    const tasks = db.prepare(`SELECT * FROM task_branches`).all();
    for (const task of tasks) {
        const taskId = String(task.task_id);
        const scope = String(task.project_id ?? '');
        const current = String(task.task_key);
        const entries = db.prepare(`SELECT * FROM task_branch_entries WHERE task_id=?`).all(taskId);
        const candidates = new Set();
        const add = (value) => { if (typeof value === 'string' && value.trim())
            candidates.add(normalizeKey(value)); };
        add(task.title);
        for (const entry of entries) {
            if (entry.fact_id) {
                const fact = db.prepare(`SELECT predicate_family,object_value FROM facts WHERE fact_id=?`).get(entry.fact_id);
                if (fact?.object_value)
                    add(fact.predicate_family === 'has_issue' ? `issue:${fact.object_value}` : fact.predicate_family === 'worked_on' ? fact.object_value : undefined);
            }
            if (entry.belief_id) {
                const belief = db.prepare(`SELECT predicate FROM beliefs WHERE id=?`).get(entry.belief_id);
                if (belief && /^(?:workflow|decision)\./.test(belief.predicate))
                    add(belief.predicate);
            }
            if (entry.unit_id) {
                const unit = db.prepare(`SELECT type,semantic_text FROM interaction_units WHERE unit_id=?`).get(entry.unit_id);
                if (unit?.type === 'proposal')
                    add(unit.semantic_text);
            }
        }
        const matches = [...candidates].filter((candidate) => legacyNormalized(scope, candidate) === current);
        if (matches.length === 1 && matches[0] !== current) {
            const owner = db.prepare(`SELECT task_id FROM task_branches WHERE project_id=? AND task_key=?`).get(scope, matches[0]);
            if (!owner || owner.task_id === taskId)
                db.prepare(`UPDATE task_branches SET task_key=? WHERE task_id=?`).run(matches[0], taskId);
            else
                quarantine(db, 'task_identity', taskId, scope, task, 'task_key_recovery_collision', [scope]);
        }
        else if (matches.length > 1)
            quarantine(db, 'task_identity', taskId, scope, { ...task, candidates: matches }, 'task_key_recovery_ambiguous', [scope]);
    }
}
function rebuildMembership(db) {
    if (!tableExists(db, 'topology_membership') || !tableExists(db, 'neurons'))
        return;
    db.exec(`DELETE FROM topology_membership WHERE dimension_type IN ('time_bucket','project_branch','task_branch','event_cluster')`);
    if (tableExists(db, 'time_bucket_entries') && tableExists(db, 'time_buckets'))
        db.exec(`INSERT OR IGNORE INTO topology_membership(neuron_id,project_id,dimension_type,dimension_key,title,created_at) SELECT e.neuron_id,b.project_id,'time_bucket',b.bucket_id,b.label,e.created_at FROM time_bucket_entries e JOIN time_buckets b ON b.bucket_id=e.bucket_id JOIN neurons n ON n.id=e.neuron_id AND n.is_deleted=0 AND COALESCE(n.project_id,'')=b.project_id WHERE e.neuron_id IS NOT NULL`);
    if (tableExists(db, 'branch_entries') && tableExists(db, 'project_branches'))
        db.exec(`INSERT OR IGNORE INTO topology_membership(neuron_id,project_id,dimension_type,dimension_key,title,created_at) SELECT e.neuron_id,b.project_id,'project_branch',b.branch_key,b.title,e.created_at FROM branch_entries e JOIN project_branches b ON b.branch_id=e.branch_id JOIN neurons n ON n.id=e.neuron_id AND n.is_deleted=0 AND COALESCE(n.project_id,'')=b.project_id WHERE e.neuron_id IS NOT NULL`);
    if (tableExists(db, 'task_branch_entries') && tableExists(db, 'task_branches'))
        db.exec(`INSERT OR IGNORE INTO topology_membership(neuron_id,project_id,dimension_type,dimension_key,title,created_at) SELECT e.neuron_id,b.project_id,'task_branch',b.task_key,b.title,e.created_at FROM task_branch_entries e JOIN task_branches b ON b.task_id=e.task_id JOIN neurons n ON n.id=e.neuron_id AND n.is_deleted=0 AND COALESCE(n.project_id,'')=b.project_id WHERE e.neuron_id IS NOT NULL`);
    if (tableExists(db, 'event_cluster_entries') && tableExists(db, 'event_clusters'))
        db.exec(`INSERT OR IGNORE INTO topology_membership(neuron_id,project_id,dimension_type,dimension_key,title,created_at) SELECT e.neuron_id,b.project_id,'event_cluster',b.cluster_key,b.title,e.created_at FROM event_cluster_entries e JOIN event_clusters b ON b.cluster_id=e.cluster_id JOIN neurons n ON n.id=e.neuron_id AND n.is_deleted=0 AND COALESCE(n.project_id,'')=b.project_id WHERE e.neuron_id IS NOT NULL`);
}
function rebuildCognitiveTopology(db) {
    if (!tableExists(db, 'cognitive_nodes') || !tableExists(db, 'cognitive_edges') || !tableExists(db, 'neurons'))
        return;
    db.exec(`DELETE FROM cognitive_edges WHERE source_node_id IN (SELECT node_id FROM cognitive_nodes WHERE node_type IN ('project_branch','task_branch','event_cluster')) OR target_node_id IN (SELECT node_id FROM cognitive_nodes WHERE node_type IN ('project_branch','task_branch','event_cluster')); DELETE FROM cognitive_nodes WHERE node_type IN ('project_branch','task_branch','event_cluster')`);
    rebuildCognitiveKind(db, 'project_branch', 'project_branches', 'branch_entries', 'branch_id', 'belongs_to_project_branch');
    rebuildCognitiveKind(db, 'task_branch', 'task_branches', 'task_branch_entries', 'task_id', 'belongs_to_task');
    rebuildCognitiveKind(db, 'event_cluster', 'event_clusters', 'event_cluster_entries', 'cluster_id', 'belongs_to_event_cluster');
}
function rebuildCognitiveKind(db, nodeType, parentTable, entryTable, idColumn, edgeType) {
    if (!tableExists(db, parentTable) || !tableExists(db, entryTable))
        return;
    const rows = db.prepare(`SELECT p.${idColumn} AS id,p.project_id AS scope,p.title,e.neuron_id,e.created_at FROM ${parentTable} p JOIN ${entryTable} e ON e.${idColumn}=p.${idColumn} WHERE e.neuron_id IS NOT NULL`).all();
    for (const row of rows) {
        const nodeKey = `${nodeType}:${row.id}`;
        const target = cognitiveNodeId(row.scope, nodeType, nodeKey);
        db.prepare(`INSERT OR IGNORE INTO cognitive_nodes(node_id,node_type,node_key,title,project_id,source_neuron_id,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,NULL,'{}',?,?)`).run(target, nodeType, nodeKey, row.title, row.scope, row.created_at, row.created_at);
        const neuron = db.prepare(`SELECT content,created_at FROM neurons WHERE id=? AND is_deleted=0 AND COALESCE(project_id,'')=?`).get(row.neuron_id, row.scope);
        if (!neuron)
            continue;
        const source = cognitiveNodeId(row.scope, 'neuron', `neuron:${row.neuron_id}`);
        db.prepare(`INSERT OR IGNORE INTO cognitive_nodes(node_id,node_type,node_key,title,project_id,source_neuron_id,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,'{}',?,?)`).run(source, 'neuron', `neuron:${row.neuron_id}`, neuron.content.slice(0, 120), row.scope, row.neuron_id, neuron.created_at, row.created_at);
        db.prepare(`INSERT OR IGNORE INTO cognitive_edges(edge_id,source_node_id,target_node_id,edge_type,weight,project_id,metadata_json,created_at) VALUES(?,?,?,?,1,?,'{}',?)`).run(cognitiveEdgeId(row.scope, source, target, edgeType), source, target, edgeType, row.scope, row.created_at);
    }
}
function assertTopologyFinalized(db) {
    for (const [parentTable, entryTable, idColumn] of [['project_branches', 'branch_entries', 'branch_id'], ['task_branches', 'task_branch_entries', 'task_id'], ['event_clusters', 'event_cluster_entries', 'cluster_id']]) {
        if (!tableExists(db, parentTable) || !tableExists(db, entryTable))
            continue;
        for (const row of db.prepare(`SELECT e.*,p.project_id AS parent_scope FROM ${entryTable} e LEFT JOIN ${parentTable} p ON p.${idColumn}=e.${idColumn}`).all()) {
            const resolved = resolveEntry(db, row);
            if (row.parent_scope === null || 'error' in resolved || row.project_id !== row.parent_scope || resolved.scope !== row.parent_scope)
                throw new Error('topology_finalization_entry_failed');
        }
    }
    if (tableExists(db, 'branch_links') && db.prepare(`SELECT 1 FROM branch_links l LEFT JOIN project_branches p ON p.branch_id=l.parent_branch_id LEFT JOIN project_branches c ON c.branch_id=l.child_branch_id WHERE p.branch_id IS NULL OR c.branch_id IS NULL OR p.project_id<>c.project_id OR COALESCE(l.project_id,'')<>p.project_id LIMIT 1`).get())
        throw new Error('topology_finalization_branch_link_failed');
    if (tableExists(db, 'time_bucket_entries') && tableExists(db, 'time_buckets'))
        for (const row of db.prepare(`SELECT e.*,b.project_id AS bucket_scope FROM time_bucket_entries e LEFT JOIN time_buckets b ON b.bucket_id=e.bucket_id`).all()) {
            const resolved = resolveEntry(db, row);
            if (row.bucket_scope === null || 'error' in resolved || row.project_id !== row.bucket_scope || resolved.scope !== row.bucket_scope)
                throw new Error('topology_finalization_time_failed');
        }
    if (tableExists(db, 'event_clusters') && db.prepare(`SELECT 1 FROM event_clusters WHERE cluster_key NOT LIKE cluster_type || ':%' LIMIT 1`).get())
        throw new Error('topology_finalization_cluster_key_failed');
    if (tableExists(db, 'memory_events') && db.prepare(`SELECT 1 FROM memory_events e LEFT JOIN memory_events p ON p.event_id=e.parent_event_id LEFT JOIN memory_events v ON v.event_id=e.prev_event_id LEFT JOIN memory_events n ON n.event_id=e.next_event_id WHERE (e.parent_event_id IS NOT NULL AND (p.event_id IS NULL OR COALESCE(p.project_id,'')<>COALESCE(e.project_id,''))) OR (e.prev_event_id IS NOT NULL AND (v.event_id IS NULL OR COALESCE(v.project_id,'')<>COALESCE(e.project_id,''))) OR (e.next_event_id IS NOT NULL AND (n.event_id IS NULL OR COALESCE(n.project_id,'')<>COALESCE(e.project_id,''))) LIMIT 1`).get())
        throw new Error('topology_finalization_event_link_failed');
    if (tableExists(db, 'topology_membership') && db.prepare(`SELECT 1 FROM topology_membership m LEFT JOIN neurons n ON n.id=m.neuron_id WHERE n.id IS NULL OR n.is_deleted<>0 OR COALESCE(m.project_id,'')<>COALESCE(n.project_id,'') LIMIT 1`).get())
        throw new Error('topology_finalization_membership_failed');
    if (tableExists(db, 'cognitive_edges') && tableExists(db, 'cognitive_nodes') && db.prepare(`SELECT 1 FROM cognitive_edges e LEFT JOIN cognitive_nodes s ON s.node_id=e.source_node_id LEFT JOIN cognitive_nodes t ON t.node_id=e.target_node_id WHERE s.node_id IS NULL OR t.node_id IS NULL OR e.project_id<>s.project_id OR e.project_id<>t.project_id LIMIT 1`).get())
        throw new Error('topology_finalization_cognitive_failed');
    assertDerivedTopologyExact(db);
}
function assertDerivedTopologyExact(db) {
    if (!tableExists(db, 'neurons'))
        return;
    const dimensions = [
        ['time_bucket', 'time_buckets', 'time_bucket_entries', 'bucket_id', 'bucket_id', 'label', 'time_bucket'],
        ['project_branch', 'project_branches', 'branch_entries', 'branch_id', 'branch_key', 'title', 'project_branch'],
        ['task_branch', 'task_branches', 'task_branch_entries', 'task_id', 'task_key', 'title', 'task_branch'],
        ['event_cluster', 'event_clusters', 'event_cluster_entries', 'cluster_id', 'cluster_key', 'title', 'event_cluster'],
    ];
    const expectedMembership = new Set();
    for (const [dimension, parentTable, entryTable, idColumn, keyColumn, titleColumn] of dimensions) {
        if (!tableExists(db, parentTable) || !tableExists(db, entryTable))
            continue;
        const rows = db.prepare(`SELECT e.neuron_id,p.project_id AS scope,p.${keyColumn} AS dimension_key,p.${titleColumn} AS title,e.created_at FROM ${entryTable} e JOIN ${parentTable} p ON p.${idColumn}=e.${idColumn} JOIN neurons n ON n.id=e.neuron_id AND n.is_deleted=0 AND COALESCE(n.project_id,'')=p.project_id WHERE e.neuron_id IS NOT NULL`).all();
        for (const row of rows)
            expectedMembership.add(JSON.stringify([row.neuron_id, row.scope, dimension, row.dimension_key, row.title, row.created_at]));
    }
    if (tableExists(db, 'topology_membership')) {
        const actual = new Set(db.prepare(`SELECT neuron_id,COALESCE(project_id,'') AS scope,dimension_type,dimension_key,title,created_at FROM topology_membership WHERE dimension_type IN ('time_bucket','project_branch','task_branch','event_cluster')`).all().map((row) => JSON.stringify([row.neuron_id, row.scope, row.dimension_type, row.dimension_key, row.title, row.created_at])));
        if (!sameSet(actual, expectedMembership))
            throw new Error('topology_finalization_membership_equivalence_failed');
    }
    if (!tableExists(db, 'cognitive_nodes') || !tableExists(db, 'cognitive_edges'))
        return;
    const expectedNodes = new Set();
    const expectedEdges = new Set();
    const cognitive = [
        ['project_branch', 'project_branches', 'branch_entries', 'branch_id', 'belongs_to_project_branch'],
        ['task_branch', 'task_branches', 'task_branch_entries', 'task_id', 'belongs_to_task'],
        ['event_cluster', 'event_clusters', 'event_cluster_entries', 'cluster_id', 'belongs_to_event_cluster'],
    ];
    for (const [nodeType, parentTable, entryTable, idColumn, edgeType] of cognitive) {
        if (!tableExists(db, parentTable) || !tableExists(db, entryTable))
            continue;
        const rows = db.prepare(`SELECT DISTINCT p.${idColumn} AS id,p.project_id AS scope,e.neuron_id FROM ${parentTable} p JOIN ${entryTable} e ON e.${idColumn}=p.${idColumn} JOIN neurons n ON n.id=e.neuron_id AND n.is_deleted=0 AND COALESCE(n.project_id,'')=p.project_id WHERE e.neuron_id IS NOT NULL`).all();
        for (const row of rows) {
            const target = cognitiveNodeId(row.scope, nodeType, `${nodeType}:${row.id}`);
            const source = cognitiveNodeId(row.scope, 'neuron', `neuron:${row.neuron_id}`);
            expectedNodes.add(target);
            expectedEdges.add(cognitiveEdgeId(row.scope, source, target, edgeType));
        }
    }
    const actualNodes = new Set(db.prepare(`SELECT node_id FROM cognitive_nodes WHERE node_type IN ('project_branch','task_branch','event_cluster')`).all().map((row) => row.node_id));
    const actualEdges = new Set(db.prepare(`SELECT edge_id FROM cognitive_edges WHERE edge_type IN ('belongs_to_project_branch','belongs_to_task','belongs_to_event_cluster')`).all().map((row) => row.edge_id));
    if (!sameSet(actualNodes, expectedNodes) || !sameSet(actualEdges, expectedEdges))
        throw new Error('topology_finalization_cognitive_equivalence_failed');
}
function sameSet(left, right) { return left.size === right.size && [...left].every((value) => right.has(value)); }
function installBranchScopeTriggers(db) {
    if (!tableExists(db, 'project_branches') || !tableExists(db, 'branch_links') || !tableExists(db, 'branch_entries'))
        return;
    db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_project_branch_scope_immutable BEFORE UPDATE OF project_id,branch_key ON project_branches WHEN NEW.project_id<>OLD.project_id OR NEW.branch_key<>OLD.branch_key BEGIN SELECT RAISE(ABORT,'project_branch_identity_conflict'); END;
    CREATE TRIGGER IF NOT EXISTS trg_branch_link_scope_insert BEFORE INSERT ON branch_links WHEN NOT EXISTS (SELECT 1 FROM project_branches p JOIN project_branches c ON p.project_id=c.project_id WHERE p.branch_id=NEW.parent_branch_id AND c.branch_id=NEW.child_branch_id AND p.project_id=COALESCE(NEW.project_id,'')) BEGIN SELECT RAISE(ABORT,'topology_branch_link_project_scope_mismatch'); END;
    CREATE TRIGGER IF NOT EXISTS trg_branch_link_scope_update BEFORE UPDATE ON branch_links WHEN NOT EXISTS (SELECT 1 FROM project_branches p JOIN project_branches c ON p.project_id=c.project_id WHERE p.branch_id=NEW.parent_branch_id AND c.branch_id=NEW.child_branch_id AND p.project_id=COALESCE(NEW.project_id,'')) BEGIN SELECT RAISE(ABORT,'topology_branch_link_project_scope_mismatch'); END;
    CREATE TRIGGER IF NOT EXISTS trg_branch_entry_parent_scope_insert BEFORE INSERT ON branch_entries WHEN NOT EXISTS (SELECT 1 FROM project_branches p WHERE p.branch_id=NEW.branch_id AND p.project_id=COALESCE(NEW.project_id,'')) BEGIN SELECT RAISE(ABORT,'topology_reference_project_scope_mismatch'); END;
    CREATE TRIGGER IF NOT EXISTS trg_branch_entry_parent_scope_update BEFORE UPDATE ON branch_entries WHEN NOT EXISTS (SELECT 1 FROM project_branches p WHERE p.branch_id=NEW.branch_id AND p.project_id=COALESCE(NEW.project_id,'')) BEGIN SELECT RAISE(ABORT,'topology_reference_project_scope_mismatch'); END;
  `);
}
function resolveEntry(db, entry) {
    const scopes = [];
    const neurons = [];
    let error;
    const addNeuron = (id) => { const row = id && tableExists(db, 'neurons') ? db.prepare(`SELECT COALESCE(project_id,'') AS scope,is_deleted FROM neurons WHERE id=?`).get(id) : null; if (!row)
        error ||= 'entry_reference_dangling';
    else if (row.is_deleted !== 0)
        error ||= 'entry_references_deleted_neuron';
    else {
        scopes.push(row.scope);
        neurons.push(id);
    } };
    if (entry.neuron_id)
        addNeuron(entry.neuron_id);
    if (entry.fact_id) {
        const row = tableExists(db, 'facts') ? db.prepare(`SELECT neuron_id FROM facts WHERE fact_id=?`).get(entry.fact_id) : null;
        if (row)
            addNeuron(row.neuron_id);
        else
            error ||= 'entry_reference_dangling';
    }
    if (entry.event_id) {
        const row = tableExists(db, 'compiled_events') ? db.prepare(`SELECT neuron_id FROM compiled_events WHERE event_id=?`).get(entry.event_id) : null;
        if (row)
            addNeuron(row.neuron_id);
        else
            error ||= 'entry_reference_dangling';
    }
    if (entry.unit_id) {
        const row = tableExists(db, 'interaction_units') ? db.prepare(`SELECT message_neuron_ids_json FROM interaction_units WHERE unit_id=?`).get(entry.unit_id) : null;
        const ids = parseIds(row?.message_neuron_ids_json);
        if (!row || ids.length === 0)
            error ||= 'entry_reference_dangling';
        for (const id of ids)
            addNeuron(id);
    }
    if (entry.belief_id) {
        const belief = tableExists(db, 'beliefs') ? db.prepare(`SELECT COALESCE(project_id,'') AS scope,source_neuron_id FROM beliefs WHERE id=?`).get(entry.belief_id) : null;
        if (!belief)
            error ||= 'entry_reference_dangling';
        else {
            scopes.push(belief.scope);
            if (belief.source_neuron_id)
                addNeuron(belief.source_neuron_id);
            if (tableExists(db, 'belief_evidence'))
                for (const evidence of db.prepare(`SELECT neuron_id,event_id FROM belief_evidence WHERE belief_id=?`).all(entry.belief_id)) {
                    if (evidence.neuron_id)
                        addNeuron(evidence.neuron_id);
                    if (evidence.event_id) {
                        const event = tableExists(db, 'memory_events') ? db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM memory_events WHERE event_id=?`).get(evidence.event_id) : null;
                        if (event)
                            scopes.push(event.scope);
                        else
                            error ||= 'entry_reference_dangling';
                    }
                }
        }
    }
    if (![entry.neuron_id, entry.fact_id, entry.event_id, entry.unit_id, entry.belief_id].some(Boolean))
        error ||= 'entry_reference_dangling';
    const distinct = [...new Set(scopes)];
    if (!error && distinct.length !== 1)
        error = distinct.length > 1 ? 'entry_project_scope_conflict' : 'entry_project_scope_unresolved';
    return error ? { error, implicatedScopes: distinct } : { scope: distinct[0], neuronId: neurons[0], implicatedScopes: distinct };
}
function quarantine(db, type, oldId, scope, entry, reason, implicated) {
    if (!tableExists(db, 'topology_identity_quarantine'))
        return;
    db.prepare(`INSERT OR REPLACE INTO topology_identity_quarantine(quarantine_id,identity_type,old_parent_id,project_scope,entry_json,reason,created_at,implicated_scopes_json) VALUES(?,?,?,?,?,?,?,?)`).run(stableId('quarantine', type, oldId, JSON.stringify(entry)), type, oldId, scope, JSON.stringify(entry), reason, Date.now(), JSON.stringify([...new Set([scope, ...implicated])]));
}
function legacyNormalized(scope, key) { const prefix = `${scope || 'global'}:`; return key.startsWith(prefix) ? key.slice(prefix.length) : key; }
function normalizeKey(value) { return value.trim().toLowerCase().replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, ''); }
function parseIds(value) { try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string' && id.length > 0) : [];
}
catch {
    return [];
} }
function stableId(...parts) { return `${parts[0]}-${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)}`; }
function cognitiveNodeId(projectId, nodeType, nodeKey) { return `cgnode-${createHash('sha256').update(`${projectId}\0${nodeType}\0${nodeKey}`).digest('hex').slice(0, 32)}`; }
function cognitiveEdgeId(projectId, source, target, type) { return `cgedge-${createHash('sha256').update(`${projectId}\0${source}\0${target}\0${type}`).digest('hex').slice(0, 32)}`; }
function tableExists(db, name) { return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name)); }
function tempTableExists(db, name) { return Boolean(db.prepare(`SELECT 1 FROM sqlite_temp_master WHERE type='table' AND name=?`).get(name)); }
function ensureColumn(db, table, column, definition) { if (!tableExists(db, table))
    return; const columns = db.prepare(`PRAGMA table_info(${table})`).all(); if (!columns.some((item) => item.name === column))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); }
