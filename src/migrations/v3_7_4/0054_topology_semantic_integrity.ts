import { createHash } from 'node:crypto';
// Internal atomic 3.7.4 installation step; never receives its own migration receipt.
import type Database from 'bun:sqlite';
import type { Migration } from '../../types/Migration.js';

type Entry = {
  neuron_id: string | null; unit_id: string | null; belief_id: string | null;
  fact_id: string | null; event_id: string | null; created_at: number;
};
type Parent = Record<string, unknown>;
type Resolution = { scope: string; neuronId: string; implicatedScopes: string[] } | { error: string; implicatedScopes: string[] };

export const migration_0054: Migration = {
  version: '0054',
  description: 'enforce topology provenance and repair canonical cluster identity',
  up(db) {
    ensureColumn(db, 'topology_identity_quarantine', 'implicated_scopes_json', `TEXT NOT NULL DEFAULT '[]'`);
    for (const table of ['branch_entries', 'task_branch_entries', 'event_cluster_entries']) {
      ensureColumn(db, table, 'project_id', `TEXT NOT NULL DEFAULT ''`);
    }
    if (tableExists(db, 'topology_identity_quarantine')) {
      db.exec(`UPDATE topology_identity_quarantine SET implicated_scopes_json=json_array(COALESCE(project_scope,'')) WHERE implicated_scopes_json='[]'`);
    }
    repairBranches(db);
    repairKind(db, 'task');
    repairKind(db, 'cluster');
    rebuildDerivedTopology(db);
    assertTopologyIntegrity(db);
  },
  down() {},
};

export function topologyIntegritySatisfied(db: Database): boolean {
  try { assertTopologyIntegrity(db); return true; } catch { return false; }
}

function repairBranches(db: Database): void {
  if (!tableExists(db, 'project_branches') || !tableExists(db, 'branch_entries')) return;
  const rows = db.prepare(`SELECT e.*,p.project_id FROM branch_entries e JOIN project_branches p ON p.branch_id=e.branch_id`).all() as Array<Entry & { branch_id: string; project_id: string }>;
  const remove = db.prepare(`DELETE FROM branch_entries WHERE branch_id=? AND COALESCE(neuron_id,'')=COALESCE(?,'') AND COALESCE(unit_id,'')=COALESCE(?,'') AND COALESCE(belief_id,'')=COALESCE(?,'') AND COALESCE(fact_id,'')=COALESCE(?,'') AND COALESCE(event_id,'')=COALESCE(?,'')`);
  for (const row of rows) {
    const resolved = resolveEntry(db, row);
    if ('error' in resolved || resolved.scope !== row.project_id) {
      quarantine(db, 'branch', row.branch_id, row.project_id, row, 'error' in resolved ? resolved : { error: 'entry_parent_project_scope_conflict', implicatedScopes: [row.project_id, resolved.scope] });
      remove.run(row.branch_id, row.neuron_id, row.unit_id, row.belief_id, row.fact_id, row.event_id);
    } else {
      db.prepare(`UPDATE branch_entries SET project_id=? WHERE branch_id=? AND COALESCE(neuron_id,'')=COALESCE(?,'') AND COALESCE(unit_id,'')=COALESCE(?,'') AND COALESCE(belief_id,'')=COALESCE(?,'') AND COALESCE(fact_id,'')=COALESCE(?,'') AND COALESCE(event_id,'')=COALESCE(?,'')`)
        .run(resolved.scope, row.branch_id, row.neuron_id, row.unit_id, row.belief_id, row.fact_id, row.event_id);
    }
  }
}

function repairKind(db: Database, kind: 'task' | 'cluster'): void {
  const parentTable = kind === 'task' ? 'task_branches' : 'event_clusters';
  const entryTable = kind === 'task' ? 'task_branch_entries' : 'event_cluster_entries';
  if (!tableExists(db, parentTable) || !tableExists(db, entryTable)) return;
  const idColumn = kind === 'task' ? 'task_id' : 'cluster_id';
  const keyColumn = kind === 'task' ? 'task_key' : 'cluster_key';
  const parents = db.prepare(`SELECT * FROM ${parentTable}`).all() as Parent[];
  const entries = db.prepare(`SELECT * FROM ${entryTable}`).all() as Array<Entry & Record<string, unknown>>;
  const byParent = new Map<string, Entry[]>();
  for (const entry of entries) {
    const id = String(entry[idColumn]);
    byParent.set(id, [...(byParent.get(id) ?? []), entry]);
  }
  const groups = new Map<string, { id: string; scope: string; key: string; parent: Parent; entries: Entry[]; split: boolean }>();
  for (const parent of parents) {
    const oldId = String(parent[idColumn]);
    const parentScope = String(parent.project_id ?? '');
    const key = kind === 'cluster' ? canonicalClusterKey(String(parent.cluster_type), String(parent[keyColumn])) : String(parent[keyColumn]);
    const resolvedEntries: Array<{ entry: Entry; resolved: Extract<Resolution, { scope: string }> }> = [];
    for (const entry of byParent.get(oldId) ?? []) {
      const resolved = resolveEntry(db, entry);
      if ('error' in resolved) quarantine(db, kind, oldId, parentScope, entry, resolved);
      else resolvedEntries.push({ entry: { ...entry, neuron_id: entry.neuron_id ?? resolved.neuronId }, resolved });
    }
    const scopes = new Set(resolvedEntries.map((item) => item.resolved.scope));
    if (resolvedEntries.length === 0 && (byParent.get(oldId)?.length ?? 0) === 0) addGroup(groups, kind, parentScope, key, parent, [], false);
    for (const item of resolvedEntries) addGroup(groups, kind, item.resolved.scope, key, parent, [item.entry], scopes.size > 1 || item.resolved.scope !== parentScope);
  }
  createReplacementTables(db, kind);
  const insertParent = kind === 'task'
    ? db.prepare(`INSERT OR IGNORE INTO task_branches_v0054(task_id,project_id,task_key,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
    : db.prepare(`INSERT OR IGNORE INTO event_clusters_v0054(cluster_id,project_id,cluster_key,cluster_type,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`);
  const insertEntry = kind === 'task'
    ? db.prepare(`INSERT OR IGNORE INTO task_branch_entries_v0054(task_id,project_id,neuron_id,unit_id,belief_id,fact_id,event_id,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    : db.prepare(`INSERT OR IGNORE INTO event_cluster_entries_v0054(cluster_id,project_id,neuron_id,unit_id,belief_id,fact_id,event_id,created_at) VALUES(?,?,?,?,?,?,?,?)`);
  for (const group of groups.values()) {
    const title = group.entries.length > 0 ? titleForGroup(db, kind, group.key, group.entries) : String(group.parent.title ?? `${kind}:${group.key}`);
    if (kind === 'task') insertParent.run(group.id, group.scope, group.key, title, group.entries.length > 0 ? 'derived' : String(group.parent.status ?? 'derived'), Number(group.parent.created_at), Number(group.parent.updated_at));
    else insertParent.run(group.id, group.scope, group.key, String(group.parent.cluster_type), title, Number(group.parent.created_at), Number(group.parent.updated_at));
    for (const entry of group.entries) insertEntry.run(group.id, group.scope, entry.neuron_id, entry.unit_id, entry.belief_id, entry.fact_id, entry.event_id, entry.created_at);
  }
  db.exec(`DROP TABLE ${entryTable}; DROP TABLE ${parentTable}; ALTER TABLE ${parentTable}_v0054 RENAME TO ${parentTable}; ALTER TABLE ${entryTable}_v0054 RENAME TO ${entryTable};`);
  db.exec(kind === 'task'
    ? `CREATE UNIQUE INDEX idx_task_branch_entries_reference_unique ON task_branch_entries(task_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,'')); CREATE INDEX idx_task_branches_project ON task_branches(project_id,updated_at DESC);`
    : `CREATE UNIQUE INDEX idx_event_cluster_entries_reference_unique ON event_cluster_entries(cluster_id,COALESCE(neuron_id,''),COALESCE(unit_id,''),COALESCE(belief_id,''),COALESCE(fact_id,''),COALESCE(event_id,'')); CREATE INDEX idx_event_clusters_project ON event_clusters(project_id,updated_at DESC);`);
}

function addGroup(groups: Map<string, { id: string; scope: string; key: string; parent: Parent; entries: Entry[]; split: boolean }>, kind: 'task' | 'cluster', scope: string, key: string, parent: Parent, entries: Entry[], split: boolean): void {
  const mapKey = `${scope}\0${key}`;
  const current = groups.get(mapKey);
  if (current) { current.entries.push(...entries); current.split ||= split; return; }
  groups.set(mapKey, { id: stableId(kind, scope, key), scope, key, parent, entries: [...entries], split });
}

function resolveEntry(db: Database, entry: Entry): Resolution {
  const scopes: string[] = [];
  const neurons: string[] = [];
  let error: string | undefined;
  const addNeuron = (id: string | null | undefined): void => {
    if (!id) { error ||= 'entry_reference_dangling'; return; }
    const row = tableExists(db, 'neurons') ? db.prepare(`SELECT COALESCE(project_id,'') AS scope,is_deleted FROM neurons WHERE id=?`).get(id) as { scope: string; is_deleted: number } | null : null;
    if (!row) { error ||= 'entry_reference_dangling'; return; }
    if (row.is_deleted !== 0) { error ||= 'entry_references_deleted_neuron'; return; }
    scopes.push(row.scope); neurons.push(id);
  };
  if (entry.neuron_id) addNeuron(entry.neuron_id);
  if (entry.fact_id) {
    const row = tableExists(db, 'facts') ? db.prepare(`SELECT neuron_id FROM facts WHERE fact_id=?`).get(entry.fact_id) as { neuron_id: string } | null : null;
    if (!row) error ||= 'entry_reference_dangling'; else addNeuron(row.neuron_id);
  }
  if (entry.event_id) {
    const row = tableExists(db, 'compiled_events') ? db.prepare(`SELECT neuron_id FROM compiled_events WHERE event_id=?`).get(entry.event_id) as { neuron_id: string } | null : null;
    if (!row) error ||= 'entry_reference_dangling'; else addNeuron(row.neuron_id);
  }
  if (entry.unit_id) {
    const row = tableExists(db, 'interaction_units') ? db.prepare(`SELECT message_neuron_ids_json FROM interaction_units WHERE unit_id=?`).get(entry.unit_id) as { message_neuron_ids_json: string } | null : null;
    const ids = parseIds(row?.message_neuron_ids_json);
    if (!row || ids.length === 0) error ||= 'entry_reference_dangling';
    for (const id of ids) addNeuron(id);
  }
  if (entry.belief_id) {
    const belief = tableExists(db, 'beliefs') ? db.prepare(`SELECT COALESCE(project_id,'') AS scope,source_neuron_id FROM beliefs WHERE id=?`).get(entry.belief_id) as { scope: string; source_neuron_id: string | null } | null : null;
    if (!belief) error ||= 'entry_reference_dangling';
    else {
      scopes.push(belief.scope);
      if (belief.source_neuron_id) addNeuron(belief.source_neuron_id);
      if (tableExists(db, 'belief_evidence')) for (const evidence of db.prepare(`SELECT neuron_id,event_id FROM belief_evidence WHERE belief_id=?`).all(entry.belief_id) as Array<{ neuron_id: string | null; event_id: string | null }>) {
        if (evidence.neuron_id) addNeuron(evidence.neuron_id);
        if (evidence.event_id) addEvidenceEventScope(db, evidence.event_id, scopes, addNeuron, () => { error ||= 'entry_reference_dangling'; });
      }
    }
  }
  if (![entry.neuron_id, entry.fact_id, entry.event_id, entry.unit_id, entry.belief_id].some(Boolean)) error ||= 'entry_reference_dangling';
  const distinct = [...new Set(scopes)];
  if (!error && distinct.length !== 1) error = distinct.length > 1 ? 'entry_project_scope_conflict' : 'entry_project_scope_unresolved';
  if (error) return { error, implicatedScopes: distinct };
  return { scope: distinct[0]!, neuronId: neurons[0]!, implicatedScopes: distinct };
}

function addEvidenceEventScope(db: Database, eventId: string, scopes: string[], addNeuron: (id: string) => void, missing: () => void): void {
  if (tableExists(db, 'memory_events')) {
    const row = db.prepare(`SELECT COALESCE(project_id,'') AS scope FROM memory_events WHERE event_id=?`).get(eventId) as { scope: string } | null;
    if (row) { scopes.push(row.scope); return; }
  }
  if (tableExists(db, 'compiled_events')) {
    const row = db.prepare(`SELECT neuron_id FROM compiled_events WHERE event_id=?`).get(eventId) as { neuron_id: string } | null;
    if (row) { addNeuron(row.neuron_id); return; }
  }
  missing();
}

function quarantine(db: Database, kind: string, oldId: string, parentScope: string, entry: Entry, resolved: Extract<Resolution, { error: string }>): void {
  const implicated = [...new Set([parentScope, ...resolved.implicatedScopes])];
  db.prepare(`INSERT OR REPLACE INTO topology_identity_quarantine(quarantine_id,identity_type,old_parent_id,project_scope,entry_json,reason,created_at,implicated_scopes_json) VALUES(?,?,?,?,?,?,?,?)`)
    .run(stableId('quarantine', kind, oldId, JSON.stringify(entry)), kind, oldId, parentScope, JSON.stringify(entry), resolved.error, Date.now(), JSON.stringify(implicated));
}

function createReplacementTables(db: Database, kind: 'task' | 'cluster'): void {
  if (kind === 'task') db.exec(`DROP TABLE IF EXISTS task_branches_v0054; DROP TABLE IF EXISTS task_branch_entries_v0054; CREATE TABLE task_branches_v0054(task_id TEXT PRIMARY KEY,project_id TEXT NOT NULL DEFAULT '',task_key TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(project_id,task_key)); CREATE TABLE task_branch_entries_v0054(task_id TEXT NOT NULL,project_id TEXT NOT NULL DEFAULT '',neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER NOT NULL);`);
  else db.exec(`DROP TABLE IF EXISTS event_clusters_v0054; DROP TABLE IF EXISTS event_cluster_entries_v0054; CREATE TABLE event_clusters_v0054(cluster_id TEXT PRIMARY KEY,project_id TEXT NOT NULL DEFAULT '',cluster_key TEXT NOT NULL,cluster_type TEXT NOT NULL,title TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(project_id,cluster_key)); CREATE TABLE event_cluster_entries_v0054(cluster_id TEXT NOT NULL,project_id TEXT NOT NULL DEFAULT '',neuron_id TEXT,unit_id TEXT,belief_id TEXT,fact_id TEXT,event_id TEXT,created_at INTEGER NOT NULL);`);
}

function rebuildDerivedTopology(db: Database): void {
  if (tableExists(db, 'topology_membership')) {
    db.exec(`DELETE FROM topology_membership WHERE neuron_id NOT IN (SELECT id FROM neurons WHERE is_deleted=0) OR COALESCE(project_id,'')<>(SELECT COALESCE(project_id,'') FROM neurons WHERE id=neuron_id); DELETE FROM topology_membership WHERE dimension_type IN ('task_branch','event_cluster'); INSERT OR IGNORE INTO topology_membership(neuron_id,project_id,dimension_type,dimension_key,title,created_at) SELECT e.neuron_id,t.project_id,'task_branch',t.task_key,t.title,e.created_at FROM task_branch_entries e JOIN task_branches t ON t.task_id=e.task_id WHERE e.neuron_id IS NOT NULL; INSERT OR IGNORE INTO topology_membership(neuron_id,project_id,dimension_type,dimension_key,title,created_at) SELECT e.neuron_id,c.project_id,'event_cluster',c.cluster_key,c.title,e.created_at FROM event_cluster_entries e JOIN event_clusters c ON c.cluster_id=e.cluster_id WHERE e.neuron_id IS NOT NULL;`);
  }
  if (!tableExists(db, 'cognitive_nodes') || !tableExists(db, 'cognitive_edges')) return;
  db.exec(`DELETE FROM cognitive_edges WHERE source_node_id IN (SELECT node_id FROM cognitive_nodes WHERE node_type IN ('task_branch','event_cluster')) OR target_node_id IN (SELECT node_id FROM cognitive_nodes WHERE node_type IN ('task_branch','event_cluster')); DELETE FROM cognitive_nodes WHERE node_type IN ('task_branch','event_cluster');`);
  if (tableExists(db, 'task_branches') && tableExists(db, 'task_branch_entries')) rebuildCognitiveKind(db, 'task');
  if (tableExists(db, 'event_clusters') && tableExists(db, 'event_cluster_entries')) rebuildCognitiveKind(db, 'cluster');
}

function rebuildCognitiveKind(db: Database, kind: 'task' | 'cluster'): void {
  const rows = kind === 'task'
    ? db.prepare(`SELECT t.task_id AS id,t.project_id AS scope,t.title,e.neuron_id,e.created_at FROM task_branches t JOIN task_branch_entries e ON e.task_id=t.task_id WHERE e.neuron_id IS NOT NULL`).all()
    : db.prepare(`SELECT c.cluster_id AS id,c.project_id AS scope,c.title,e.neuron_id,e.created_at FROM event_clusters c JOIN event_cluster_entries e ON e.cluster_id=c.cluster_id WHERE e.neuron_id IS NOT NULL`).all();
  for (const row of rows as Array<{ id: string; scope: string; title: string; neuron_id: string; created_at: number }>) {
    const type = kind === 'task' ? 'task_branch' : 'event_cluster';
    const nodeKey = `${type}:${row.id}`; const target = cognitiveNodeId(row.scope, type, nodeKey);
    db.prepare(`INSERT OR IGNORE INTO cognitive_nodes(node_id,node_type,node_key,title,project_id,source_neuron_id,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,NULL,?,?,?)`).run(target, type, nodeKey, row.title, row.scope, JSON.stringify({ [`${kind}Id`]: row.id }), row.created_at, row.created_at);
    let source = (db.prepare(`SELECT node_id FROM cognitive_nodes WHERE node_type='neuron' AND project_id=? AND source_neuron_id=? LIMIT 1`).get(row.scope, row.neuron_id) as { node_id?: string } | null)?.node_id;
    if (!source) {
      source = cognitiveNodeId(row.scope, 'neuron', `neuron:${row.neuron_id}`);
      const neuron = db.prepare(`SELECT content,created_at FROM neurons WHERE id=? AND is_deleted=0`).get(row.neuron_id) as { content: string; created_at: number } | null;
      if (!neuron) continue;
      db.prepare(`INSERT OR IGNORE INTO cognitive_nodes(node_id,node_type,node_key,title,project_id,source_neuron_id,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?, '{}',?,?)`).run(source, 'neuron', `neuron:${row.neuron_id}`, neuron.content.slice(0, 120), row.scope, row.neuron_id, neuron.created_at, row.created_at);
    }
    const edgeType = kind === 'task' ? 'belongs_to_task' : 'belongs_to_event_cluster';
    db.prepare(`INSERT OR IGNORE INTO cognitive_edges(edge_id,source_node_id,target_node_id,edge_type,weight,project_id,metadata_json,created_at) VALUES(?,?,?,?,1,?,'{}',?)`).run(cognitiveEdgeId(row.scope, source, target, edgeType), source, target, edgeType, row.scope, row.created_at);
  }
}

function assertTopologyIntegrity(db: Database): void {
  for (const [parentTable, entryTable, idColumn] of [['project_branches','branch_entries','branch_id'], ['task_branches','task_branch_entries','task_id'], ['event_clusters','event_cluster_entries','cluster_id']] as const) {
    if (!tableExists(db, parentTable) || !tableExists(db, entryTable)) continue;
    const rows = db.prepare(`SELECT e.*,p.project_id AS parent_scope FROM ${entryTable} e LEFT JOIN ${parentTable} p ON p.${idColumn}=e.${idColumn}`).all() as Array<Entry & { project_id: string; parent_scope: string | null }>;
    for (const row of rows) {
      const resolved = resolveEntry(db, row);
      if (row.parent_scope === null || 'error' in resolved || row.project_id !== row.parent_scope || resolved.scope !== row.parent_scope) throw new Error('topology_semantic_integrity_failed');
    }
  }
  if (tableExists(db, 'event_clusters') && db.prepare(`SELECT 1 FROM event_clusters WHERE cluster_key NOT LIKE cluster_type || ':%' LIMIT 1`).get()) throw new Error('topology_cluster_key_noncanonical');
  if (tableExists(db, 'cognitive_edges') && tableExists(db, 'cognitive_nodes') && db.prepare(`SELECT 1 FROM cognitive_edges e LEFT JOIN cognitive_nodes s ON s.node_id=e.source_node_id LEFT JOIN cognitive_nodes t ON t.node_id=e.target_node_id WHERE s.node_id IS NULL OR t.node_id IS NULL OR e.project_id<>s.project_id OR e.project_id<>t.project_id LIMIT 1`).get()) throw new Error('topology_cognitive_scope_mismatch');
  if (tableExists(db, 'topology_membership') && db.prepare(`SELECT 1 FROM topology_membership m JOIN neurons n ON n.id=m.neuron_id WHERE COALESCE(m.project_id,'')<>COALESCE(n.project_id,'') OR n.is_deleted<>0 LIMIT 1`).get()) throw new Error('topology_membership_scope_mismatch');
}

function titleForGroup(db: Database, kind: string, key: string, entries: Entry[]): string {
  const id = entries.find((entry) => entry.neuron_id)?.neuron_id;
  if (id) {
    const row = db.prepare(`SELECT content FROM neurons WHERE id=? AND is_deleted=0`).get(id) as { content: string } | null;
    if (row?.content) return row.content.slice(0, 96);
  }
  return `${kind}:${key}`;
}

function canonicalClusterKey(type: string, key: string): string { return key.startsWith(`${type}:`) ? key : `${type}:${key}`; }
function parseIds(value?: string): string[] { try { const parsed = JSON.parse(value ?? '[]'); return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && id.length > 0) : []; } catch { return []; } }
function stableId(...parts: string[]): string { return `${parts[0]}-${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)}`; }
function cognitiveNodeId(projectId: string, nodeType: string, nodeKey: string): string { return `cgnode-${createHash('sha256').update(`${projectId}\0${nodeType}\0${nodeKey}`).digest('hex').slice(0, 32)}`; }
function cognitiveEdgeId(projectId: string, source: string, target: string, type: string): string { return `cgedge-${createHash('sha256').update(`${projectId}\0${source}\0${target}\0${type}`).digest('hex').slice(0, 32)}`; }
function tableExists(db: Database, name: string): boolean { return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name)); }
function ensureColumn(db: Database, table: string, column: string, definition: string): void { if (!tableExists(db, table)) return; const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>; if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); }
