import { createHash } from 'node:crypto';
import { cognitiveEdgeId, cognitiveNodeId } from '../engine/CognitiveGraphIdentity.js';
export const migration_0052 = {
    version: '0052',
    description: 'repair project-scoped topology identity from entry provenance',
    up(db) {
        ensureColumn(db, 'topology_time_rebuild_jobs', 'publish_token', 'TEXT');
        db.exec(`
      CREATE TABLE IF NOT EXISTS topology_identity_quarantine (
        quarantine_id TEXT PRIMARY KEY, identity_type TEXT NOT NULL, old_parent_id TEXT NOT NULL,
        project_scope TEXT, entry_json TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS vector_write_outbox (
        neuron_id TEXT PRIMARY KEY, vector_json TEXT NOT NULL, created_at INTEGER NOT NULL
      );
    `);
        normalizeTemporalEntries(db);
        normalizeDreamLedgerKeys(db);
        if (tableExists(db, 'task_branches') && tableExists(db, 'task_branch_entries')) {
            rebuildIdentity(db, 'task');
        }
        if (tableExists(db, 'event_clusters') && tableExists(db, 'event_cluster_entries')) {
            rebuildIdentity(db, 'cluster');
        }
        rebuildDerivedTopology(db);
    },
    down() { },
};
function rebuildIdentity(db, kind) {
    const parentTable = kind === 'task' ? 'task_branches' : 'event_clusters';
    const entryTable = kind === 'task' ? 'task_branch_entries' : 'event_cluster_entries';
    const idColumn = kind === 'task' ? 'task_id' : 'cluster_id';
    const keyColumn = kind === 'task' ? 'task_key' : 'cluster_key';
    const parents = db.prepare(`SELECT * FROM ${parentTable}`).all();
    const entriesByParent = new Map();
    for (const entry of db.prepare(`SELECT * FROM ${entryTable}`).all()) {
        const parentId = String(entry[idColumn]);
        const list = entriesByParent.get(parentId) ?? [];
        list.push(entry);
        entriesByParent.set(parentId, list);
    }
    const groups = new Map();
    for (const parent of parents) {
        const oldId = String(parent[idColumn]);
        const parentScope = String(parent.project_id ?? '');
        const key = normalizeLegacyKey(String(parent[keyColumn]), parentScope);
        const entries = entriesByParent.get(oldId) ?? [];
        if (entries.length === 0)
            addGroup(groups, kind, parentScope, key, parent, []);
        for (const entry of entries) {
            const resolved = inferEntryScope(db, entry);
            if (!resolved) {
                db.prepare(`INSERT OR REPLACE INTO topology_identity_quarantine
          (quarantine_id,identity_type,old_parent_id,project_scope,entry_json,reason,created_at)
          VALUES(?,?,?,?,?,?,?)`).run(stableId('quarantine', kind, oldId, JSON.stringify(entry)), kind, oldId, parentScope, JSON.stringify(entry), 'entry_project_scope_unresolved', Date.now());
                continue;
            }
            addGroup(groups, kind, resolved.scope, key, parent, [{ ...entry, neuron_id: entry.neuron_id ?? resolved.neuronId ?? null }]);
        }
    }
    createReplacementTables(db, kind);
    const insertParent = kind === 'task'
        ? db.prepare(`INSERT OR IGNORE INTO task_branches_v0052(task_id,project_id,task_key,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
        : db.prepare(`INSERT OR IGNORE INTO event_clusters_v0052(cluster_id,project_id,cluster_key,cluster_type,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`);
    const insertEntry = kind === 'task'
        ? db.prepare(`INSERT OR IGNORE INTO task_branch_entries_v0052(task_id,neuron_id,unit_id,belief_id,fact_id,event_id,created_at) VALUES(?,?,?,?,?,?,?)`)
        : db.prepare(`INSERT OR IGNORE INTO event_cluster_entries_v0052(cluster_id,neuron_id,unit_id,belief_id,fact_id,event_id,created_at) VALUES(?,?,?,?,?,?,?)`);
    for (const group of groups.values()) {
        if (kind === 'task')
            insertParent.run(group.id, group.scope, group.key, String(group.parent.title), String(group.parent.status), Number(group.parent.created_at), Number(group.parent.updated_at));
        else
            insertParent.run(group.id, group.scope, group.key, String(group.parent.cluster_type), String(group.parent.title), Number(group.parent.created_at), Number(group.parent.updated_at));
        const seenEntries = new Set();
        for (const entry of group.entries) {
            const identity = [entry.neuron_id, entry.unit_id, entry.belief_id, entry.fact_id, entry.event_id].map((value) => value ?? '').join('\0');
            if (seenEntries.has(identity))
                continue;
            seenEntries.add(identity);
            insertEntry.run(group.id, entry.neuron_id, entry.unit_id, entry.belief_id, entry.fact_id, entry.event_id, entry.created_at);
        }
    }
    db.exec(`
    DROP TABLE ${entryTable}; DROP TABLE ${parentTable};
    ALTER TABLE ${parentTable}_v0052 RENAME TO ${parentTable};
    ALTER TABLE ${entryTable}_v0052 RENAME TO ${entryTable};
    CREATE UNIQUE INDEX idx_${kind === 'task' ? 'task_branch' : 'event_cluster'}_entries_reference_unique
      ON ${entryTable}(${idColumn},COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''));
  `);
}
function addGroup(groups, kind, scope, key, parent, entries) {
    const groupKey = `${scope}\0${key}`;
    const existing = groups.get(groupKey);
    if (existing) {
        existing.entries.push(...entries);
        return;
    }
    groups.set(groupKey, { id: stableId(kind, scope, key), scope, key, parent, entries: [...entries] });
}
function createReplacementTables(db, kind) {
    if (kind === 'task')
        db.exec(`
    DROP TABLE IF EXISTS task_branches_v0052; DROP TABLE IF EXISTS task_branch_entries_v0052;
    CREATE TABLE task_branches_v0052(task_id TEXT PRIMARY KEY,project_id TEXT NOT NULL DEFAULT '',task_key TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(project_id,task_key));
    CREATE TABLE task_branch_entries_v0052(task_id TEXT NOT NULL,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER NOT NULL,UNIQUE(task_id,neuron_id,unit_id,belief_id,fact_id,event_id));
  `);
    else
        db.exec(`
    DROP TABLE IF EXISTS event_clusters_v0052; DROP TABLE IF EXISTS event_cluster_entries_v0052;
    CREATE TABLE event_clusters_v0052(cluster_id TEXT PRIMARY KEY,project_id TEXT NOT NULL DEFAULT '',cluster_key TEXT NOT NULL,cluster_type TEXT NOT NULL,title TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(project_id,cluster_key));
    CREATE TABLE event_cluster_entries_v0052(cluster_id TEXT NOT NULL,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER NOT NULL,UNIQUE(cluster_id,neuron_id,unit_id,belief_id,fact_id,event_id));
  `);
}
function inferEntryScope(db, entry) {
    for (const neuronId of [entry.neuron_id, neuronForFact(db, entry.fact_id), neuronForEvent(db, entry.event_id), neuronForBelief(db, entry.belief_id)]) {
        const scope = scopeForNeuron(db, neuronId);
        if (scope !== null)
            return { scope, neuronId: neuronId ?? undefined };
    }
    if (entry.unit_id && tableExists(db, 'interaction_units')) {
        const row = db.prepare(`SELECT message_neuron_ids_json FROM interaction_units WHERE unit_id=?`).get(entry.unit_id);
        const ids = parseIds(row?.message_neuron_ids_json);
        const scopes = new Set(ids.map((id) => scopeForNeuron(db, id)).filter((value) => value !== null));
        if (scopes.size === 1)
            return { scope: [...scopes][0], neuronId: ids[0] };
    }
    return null;
}
function neuronForFact(db, id) {
    if (!id || !tableExists(db, 'facts'))
        return null;
    return db.prepare(`SELECT neuron_id FROM facts WHERE fact_id=?`).get(id)?.neuron_id ?? null;
}
function neuronForEvent(db, id) {
    if (!id || !tableExists(db, 'compiled_events'))
        return null;
    return db.prepare(`SELECT neuron_id FROM compiled_events WHERE event_id=?`).get(id)?.neuron_id ?? null;
}
function neuronForBelief(db, id) {
    if (!id || !tableExists(db, 'beliefs'))
        return null;
    const direct = db.prepare(`SELECT source_neuron_id FROM beliefs WHERE id=?`).get(id)?.source_neuron_id;
    if (direct)
        return direct;
    if (!tableExists(db, 'belief_evidence'))
        return null;
    return db.prepare(`SELECT neuron_id FROM belief_evidence WHERE belief_id=? AND neuron_id IS NOT NULL ORDER BY created_at LIMIT 1`).get(id)?.neuron_id ?? null;
}
function scopeForNeuron(db, id) {
    if (!id || !tableExists(db, 'neurons'))
        return null;
    const row = db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM neurons WHERE id=?`).get(id);
    return row ? String(row.scope ?? '') : null;
}
function rebuildDerivedTopology(db) {
    if (tableExists(db, 'topology_membership')) {
        db.exec(`DELETE FROM topology_membership WHERE dimension_type IN ('task_branch','event_cluster')`);
        if (tableExists(db, 'task_branches'))
            db.exec(`INSERT OR IGNORE INTO topology_membership(neuron_id,project_id,dimension_type,dimension_key,title,created_at)
      SELECT e.neuron_id,t.project_id,'task_branch',t.task_key,t.title,e.created_at FROM task_branch_entries e JOIN task_branches t ON t.task_id=e.task_id WHERE e.neuron_id IS NOT NULL`);
        if (tableExists(db, 'event_clusters'))
            db.exec(`INSERT OR IGNORE INTO topology_membership(neuron_id,project_id,dimension_type,dimension_key,title,created_at)
      SELECT e.neuron_id,c.project_id,'event_cluster',c.cluster_key,c.title,e.created_at FROM event_cluster_entries e JOIN event_clusters c ON c.cluster_id=e.cluster_id WHERE e.neuron_id IS NOT NULL`);
    }
    if (!tableExists(db, 'cognitive_nodes') || !tableExists(db, 'cognitive_edges'))
        return;
    db.exec(`DELETE FROM cognitive_edges WHERE source_node_id IN (SELECT node_id FROM cognitive_nodes WHERE node_type IN ('task_branch','event_cluster')) OR target_node_id IN (SELECT node_id FROM cognitive_nodes WHERE node_type IN ('task_branch','event_cluster')); DELETE FROM cognitive_nodes WHERE node_type IN ('task_branch','event_cluster');`);
    if (tableExists(db, 'task_branches') && tableExists(db, 'task_branch_entries'))
        rebuildCognitiveKind(db, 'task');
    if (tableExists(db, 'event_clusters') && tableExists(db, 'event_cluster_entries'))
        rebuildCognitiveKind(db, 'cluster');
}
function rebuildCognitiveKind(db, kind) {
    const rows = kind === 'task'
        ? db.prepare(`SELECT t.task_id AS id,t.project_id AS scope,t.title,e.neuron_id,e.created_at FROM task_branches t JOIN task_branch_entries e ON e.task_id=t.task_id WHERE e.neuron_id IS NOT NULL`).all()
        : db.prepare(`SELECT c.cluster_id AS id,c.project_id AS scope,c.title,e.neuron_id,e.created_at FROM event_clusters c JOIN event_cluster_entries e ON e.cluster_id=c.cluster_id WHERE e.neuron_id IS NOT NULL`).all();
    for (const row of rows) {
        const type = kind === 'task' ? 'task_branch' : 'event_cluster';
        const nodeKey = `${type}:${row.id}`;
        const target = cognitiveNodeId(row.scope, type, nodeKey);
        db.prepare(`INSERT OR IGNORE INTO cognitive_nodes(node_id,node_type,node_key,title,project_id,source_neuron_id,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
            .run(target, type, nodeKey, row.title, row.scope, row.neuron_id, JSON.stringify({ [`${kind}Id`]: row.id }), row.created_at, row.created_at);
        let source = db.prepare(`SELECT node_id FROM cognitive_nodes WHERE node_type='neuron' AND project_id=? AND source_neuron_id=? LIMIT 1`).get(row.scope, row.neuron_id)?.node_id;
        if (!source) {
            source = cognitiveNodeId(row.scope, 'neuron', `neuron:${row.neuron_id}`);
            const neuron = db.prepare(`SELECT content,created_at FROM neurons WHERE id=?`).get(row.neuron_id);
            db.prepare(`INSERT OR IGNORE INTO cognitive_nodes(node_id,node_type,node_key,title,project_id,source_neuron_id,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
                .run(source, 'neuron', `neuron:${row.neuron_id}`, String(neuron?.content ?? row.neuron_id).slice(0, 120), row.scope, row.neuron_id, '{}', neuron?.created_at ?? row.created_at, row.created_at);
        }
        const edgeType = kind === 'task' ? 'belongs_to_task' : 'belongs_to_event_cluster';
        db.prepare(`INSERT OR IGNORE INTO cognitive_edges(edge_id,source_node_id,target_node_id,edge_type,weight,project_id,metadata_json,created_at) VALUES(?,?,?,?,1,?,'{}',?)`)
            .run(cognitiveEdgeId({ projectId: row.scope, sourceNodeId: source, targetNodeId: target, edgeType }), source, target, edgeType, row.scope, row.created_at);
    }
}
function normalizeTemporalEntries(db) {
    if (!tableExists(db, 'time_bucket_entries'))
        return;
    const column = db.prepare(`PRAGMA table_info(time_bucket_entries)`).all().find((item) => item.name === 'project_id');
    if (column?.notnull) {
        db.exec(`UPDATE time_bucket_entries SET project_id='' WHERE project_id IS NULL`);
        return;
    }
    db.exec(`DROP TABLE IF EXISTS time_bucket_entries_v0052; CREATE TABLE time_bucket_entries_v0052(bucket_id TEXT NOT NULL,neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,project_id TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,UNIQUE(bucket_id,neuron_id,unit_id,belief_id,fact_id,event_id)); INSERT OR IGNORE INTO time_bucket_entries_v0052 SELECT bucket_id,neuron_id,unit_id,belief_id,fact_id,event_id,COALESCE(project_id,''),created_at FROM time_bucket_entries; DROP TABLE time_bucket_entries; ALTER TABLE time_bucket_entries_v0052 RENAME TO time_bucket_entries; CREATE INDEX idx_time_bucket_entries_bucket ON time_bucket_entries(bucket_id,created_at DESC); CREATE UNIQUE INDEX idx_time_bucket_entries_reference_unique ON time_bucket_entries(bucket_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,''));`);
}
function normalizeDreamLedgerKeys(db) {
    if (!tableExists(db, 'dream_ledger_state'))
        return;
    const rows = db.prepare(`SELECT * FROM dream_ledger_state`).all();
    for (const row of rows) {
        const scope = row.project_id;
        const key = scope === null ? 'all' : `scope:${scope.length}:${scope}`;
        db.prepare(`INSERT OR REPLACE INTO dream_ledger_state(project_key,project_id,last_dreamed_global_seq,last_dreamed_at,updated_at) VALUES(?,?,?,?,?)`).run(key, scope, row.last_dreamed_global_seq, row.last_dreamed_at, row.updated_at);
        if (row.project_key !== key)
            db.prepare(`DELETE FROM dream_ledger_state WHERE project_key=?`).run(row.project_key);
        if (scope === null && row.project_key === '__global__')
            db.prepare(`INSERT OR IGNORE INTO dream_ledger_state(project_key,project_id,last_dreamed_global_seq,last_dreamed_at,updated_at) VALUES('scope:0:','',?,?,?)`).run(row.last_dreamed_global_seq, row.last_dreamed_at, row.updated_at);
    }
}
function normalizeLegacyKey(key, parentScope) {
    const prefix = parentScope === '' || parentScope === 'global' ? 'global:' : `${parentScope}:`;
    return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}
function parseIds(value) { try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
}
catch {
    return [];
} }
function stableId(...parts) { return `${parts[0]}-${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)}`; }
function tableExists(db, name) { return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name)); }
function ensureColumn(db, table, column, definition) { if (!tableExists(db, table))
    return; const columns = db.prepare(`PRAGMA table_info(${table})`).all(); if (!columns.some((item) => item.name === column))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); }
