import type Database from 'bun:sqlite';
import type { Migration } from '../types/Migration.js';
import type { CognitiveEdgeType, CognitiveNodeType, TimeBucketType } from '../types/index.js';
import { cognitiveEdgeId, cognitiveNodeId } from '../engine/CognitiveGraphIdentity.js';
import { timeBucketId } from '../topology/TimeBucketIdentity.js';

type BucketRow = {
  bucket_id: string;
  project_id?: string | null;
  time_zone?: string | null;
  bucket_type: TimeBucketType;
  bucket_start: number;
  bucket_end: number;
  label: string;
};

export const migration_0049: Migration = {
  version: '0049',
  description: 'scope cognitive graph and civil time topology identities by project',
  up(db) {
    rebuildTimeTopologyIdentity(db);
    rebuildCognitiveGraphIdentity(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS topology_projection_state (
        project_id TEXT PRIMARY KEY,
        projection_version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL CHECK(status IN ('dirty','building','clean','failed')),
        time_zone TEXT,
        updated_at INTEGER NOT NULL,
        error TEXT
      );
    `);
    if (tableExists(db, 'neurons')) {
      db.exec(`
        INSERT INTO topology_projection_state(project_id,projection_version,status,time_zone,updated_at,error)
        SELECT DISTINCT project_id,3,'dirty',NULL,unixepoch()*1000,NULL
        FROM neurons
        WHERE project_id IS NOT NULL AND project_id<>'' AND is_deleted=0
        ON CONFLICT(project_id) DO UPDATE SET
          projection_version=3,status='dirty',updated_at=excluded.updated_at,error=NULL;
      `);
    }
  },
  down() {},
};

function rebuildTimeTopologyIdentity(db: Database): void {
  const hadBuckets = tableExists(db, 'time_buckets');
  const bucketColumns = hadBuckets ? columns(db, 'time_buckets') : new Set<string>();
  const buckets = hadBuckets
    ? db.prepare(`SELECT bucket_id,${bucketColumns.has('project_id') ? 'project_id' : 'NULL AS project_id'},${bucketColumns.has('time_zone') ? 'time_zone' : 'NULL AS time_zone'},bucket_type,bucket_start,bucket_end,label FROM time_buckets`).all() as BucketRow[]
    : [];
  const entries = tableExists(db, 'time_bucket_entries')
    ? db.prepare(`SELECT bucket_id,neuron_id,unit_id,belief_id,fact_id,event_id,project_id,created_at FROM time_bucket_entries`).all() as Array<Record<string, unknown>>
    : [];
  const timeZones = new Map<string, string>();
  if (tableExists(db, 'topology_projection_state')) {
    for (const row of db.prepare(`SELECT project_id,time_zone FROM topology_projection_state WHERE time_zone IS NOT NULL AND time_zone<>''`).all() as Array<{ project_id: string; time_zone: string }>) {
      timeZones.set(row.project_id, row.time_zone);
    }
  }

  db.exec(`
    DROP TABLE IF EXISTS time_buckets_0049;
    DROP TABLE IF EXISTS time_bucket_entries_0049;
    CREATE TABLE time_buckets_0049 (
      bucket_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT '',
      time_zone TEXT NOT NULL DEFAULT 'UTC',
      bucket_type TEXT NOT NULL,
      bucket_start INTEGER NOT NULL,
      bucket_end INTEGER NOT NULL,
      label TEXT NOT NULL,
      UNIQUE(project_id,time_zone,bucket_type,bucket_start,bucket_end)
    );
    CREATE TABLE time_bucket_entries_0049 (
      bucket_id TEXT NOT NULL,
      neuron_id TEXT,
      unit_id TEXT,
      belief_id TEXT,
      fact_id TEXT,
      event_id TEXT,
      project_id TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(bucket_id,neuron_id,unit_id,belief_id,fact_id,event_id)
    );
  `);

  const entriesByBucket = new Map<string, Array<Record<string, unknown>>>();
  for (const entry of entries) {
    const values = entriesByBucket.get(String(entry.bucket_id)) ?? [];
    values.push(entry);
    entriesByBucket.set(String(entry.bucket_id), values);
  }
  const bucketMapping = new Map<string, string>();
  const insertBucket = db.prepare(`INSERT OR IGNORE INTO time_buckets_0049(bucket_id,project_id,time_zone,bucket_type,bucket_start,bucket_end,label) VALUES(?,?,?,?,?,?,?)`);
  for (const bucket of buckets) {
    const attached = entriesByBucket.get(bucket.bucket_id) ?? [];
    const scopes = new Set(attached.map((entry) => String(entry.project_id ?? '')).filter(Boolean));
    if (bucket.project_id) scopes.add(bucket.project_id);
    if (scopes.size === 0) scopes.add('');
    for (const projectId of scopes) {
      const timeZone = bucket.time_zone || timeZones.get(projectId) || 'UTC';
      const scopedId = timeBucketId({ projectId: projectId || undefined, timeZone, bucketType: bucket.bucket_type, bucketStart: bucket.bucket_start, bucketEnd: bucket.bucket_end });
      insertBucket.run(scopedId, projectId, timeZone, bucket.bucket_type, bucket.bucket_start, bucket.bucket_end, bucket.label);
      bucketMapping.set(`${bucket.bucket_id}\0${projectId}`, scopedId);
    }
  }

  const insertEntry = db.prepare(`INSERT OR IGNORE INTO time_bucket_entries_0049(bucket_id,neuron_id,unit_id,belief_id,fact_id,event_id,project_id,created_at) VALUES(?,?,?,?,?,?,?,?)`);
  for (const entry of entries) {
    const projectId = String(entry.project_id ?? '');
    const scopedId = bucketMapping.get(`${String(entry.bucket_id)}\0${projectId}`) ?? bucketMapping.get(`${String(entry.bucket_id)}\0`);
    if (!scopedId) continue;
    insertEntry.run(
      scopedId,
      stringOrNull(entry.neuron_id),
      stringOrNull(entry.unit_id),
      stringOrNull(entry.belief_id),
      stringOrNull(entry.fact_id),
      stringOrNull(entry.event_id),
      projectId || null,
      Number(entry.created_at),
    );
  }

  db.exec(`
    DROP TABLE IF EXISTS temporal_adjacency;
    DROP TABLE IF EXISTS time_bucket_entries;
    DROP TABLE IF EXISTS time_buckets;
    ALTER TABLE time_buckets_0049 RENAME TO time_buckets;
    ALTER TABLE time_bucket_entries_0049 RENAME TO time_bucket_entries;
    CREATE INDEX idx_time_bucket_entries_bucket ON time_bucket_entries(bucket_id,created_at DESC);
    CREATE INDEX idx_time_buckets_project_range ON time_buckets(project_id,time_zone,bucket_type,bucket_start,bucket_end);
    CREATE TABLE temporal_adjacency (
      project_id TEXT NOT NULL DEFAULT '',
      time_zone TEXT NOT NULL DEFAULT 'UTC',
      source_bucket_id TEXT NOT NULL,
      adjacent_bucket_id TEXT NOT NULL,
      bucket_type TEXT NOT NULL,
      weight REAL NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(project_id,time_zone,source_bucket_id,adjacent_bucket_id)
    );
    CREATE INDEX idx_temporal_adjacency_source ON temporal_adjacency(source_bucket_id,created_at DESC);
  `);
  if (tableExists(db, 'topology_membership')) {
    db.exec(`
      DELETE FROM topology_membership WHERE dimension_type='time_bucket';
      INSERT OR IGNORE INTO topology_membership(neuron_id,project_id,dimension_type,dimension_key,title,created_at)
      SELECT e.neuron_id,e.project_id,'time_bucket',e.bucket_id,b.label,e.created_at
      FROM time_bucket_entries e JOIN time_buckets b ON b.bucket_id=e.bucket_id
      WHERE e.neuron_id IS NOT NULL;
    `);
  }
}

function rebuildCognitiveGraphIdentity(db: Database): void {
  const nodes = tableExists(db, 'cognitive_nodes')
    ? db.prepare(`SELECT * FROM cognitive_nodes`).all() as Array<Record<string, unknown>>
    : [];
  const edges = tableExists(db, 'cognitive_edges')
    ? db.prepare(`SELECT * FROM cognitive_edges`).all() as Array<Record<string, unknown>>
    : [];
  const scopesByNode = new Map<string, Set<string>>();
  for (const node of nodes) scopesByNode.set(String(node.node_id), new Set([String(node.project_id ?? '')]));
  for (const edge of edges) {
    const scope = String(edge.project_id ?? '');
    for (const nodeId of [String(edge.source_node_id), String(edge.target_node_id)]) {
      const scopes = scopesByNode.get(nodeId) ?? new Set<string>();
      scopes.add(scope);
      scopesByNode.set(nodeId, scopes);
    }
  }

  db.exec(`
    DROP TABLE IF EXISTS cognitive_nodes_0049;
    DROP TABLE IF EXISTS cognitive_edges_0049;
    CREATE TABLE cognitive_nodes_0049 (
      node_id TEXT PRIMARY KEY,
      node_type TEXT NOT NULL,
      node_key TEXT NOT NULL,
      title TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT '',
      source_neuron_id TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id,node_type,node_key)
    );
    CREATE TABLE cognitive_edges_0049 (
      edge_id TEXT PRIMARY KEY,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      weight REAL NOT NULL,
      project_id TEXT NOT NULL DEFAULT '',
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(project_id,source_node_id,target_node_id,edge_type)
    );
  `);
  const nodeIdMap = new Map<string, string>();
  const insertNode = db.prepare(`INSERT OR REPLACE INTO cognitive_nodes_0049(node_id,node_type,node_key,title,project_id,source_neuron_id,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`);
  for (const node of nodes) {
    const nodeType = String(node.node_type) as CognitiveNodeType;
    if (nodeType === 'time_bucket') continue;
    for (const projectId of scopesByNode.get(String(node.node_id)) ?? new Set([String(node.project_id ?? '')])) {
      const nodeKey = String(node.node_key);
      const scopedNodeId = cognitiveNodeId(projectId || undefined, nodeType, nodeKey);
      const sourceNeuronId = validSourceNeuron(db, String(node.source_neuron_id ?? ''), projectId) ? String(node.source_neuron_id) : null;
      insertNode.run(scopedNodeId, nodeType, nodeKey, String(node.title), projectId, sourceNeuronId, stringOrNull(node.metadata_json), Number(node.created_at), Number(node.updated_at));
      nodeIdMap.set(`${String(node.node_id)}\0${projectId}`, scopedNodeId);
    }
  }
  const insertEdge = db.prepare(`INSERT OR REPLACE INTO cognitive_edges_0049(edge_id,source_node_id,target_node_id,edge_type,weight,project_id,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?)`);
  for (const edge of edges) {
    const edgeType = String(edge.edge_type) as CognitiveEdgeType;
    if (edgeType === 'occurred_in_time_bucket') continue;
    const projectId = String(edge.project_id ?? '');
    const source = nodeIdMap.get(`${String(edge.source_node_id)}\0${projectId}`);
    const target = nodeIdMap.get(`${String(edge.target_node_id)}\0${projectId}`);
    if (!source || !target) continue;
    const edgeId = cognitiveEdgeId({ projectId: projectId || undefined, sourceNodeId: source, targetNodeId: target, edgeType });
    insertEdge.run(edgeId, source, target, edgeType, Number(edge.weight), projectId, stringOrNull(edge.metadata_json), Number(edge.created_at));
  }
  db.exec(`
    DROP TABLE IF EXISTS cognitive_edges;
    DROP TABLE IF EXISTS cognitive_nodes;
    ALTER TABLE cognitive_nodes_0049 RENAME TO cognitive_nodes;
    ALTER TABLE cognitive_edges_0049 RENAME TO cognitive_edges;
    CREATE INDEX idx_cognitive_nodes_type_project ON cognitive_nodes(node_type,project_id,updated_at DESC);
    CREATE INDEX idx_cognitive_nodes_title ON cognitive_nodes(title,updated_at DESC);
    CREATE INDEX idx_cognitive_edges_source ON cognitive_edges(source_node_id,created_at DESC);
    CREATE INDEX idx_cognitive_edges_target ON cognitive_edges(target_node_id,created_at DESC);
    CREATE INDEX idx_cognitive_edges_project ON cognitive_edges(project_id,edge_type,created_at DESC);
  `);
}

function validSourceNeuron(db: Database, neuronId: string, projectId: string): boolean {
  if (!neuronId || !tableExists(db, 'neurons')) return false;
  return Boolean(db.prepare(`SELECT 1 FROM neurons WHERE id=? AND COALESCE(project_id,'')=? LIMIT 1`).get(neuronId, projectId));
}

function tableExists(db: Database, name: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
}

function columns(db: Database, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
