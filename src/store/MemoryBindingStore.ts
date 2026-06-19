import { createHash } from 'node:crypto';
import Database from 'bun:sqlite';
import type {
  MemoryBindingInput,
  MemoryBindingListOptions,
  MemoryBindingRecord,
  MemoryBindingStats,
  MemoryClusterListOptions,
  MemoryClusterRecord,
  MemoryEdgeListOptions,
  MemoryEdgeRecord,
  MemoryEdgeRelation,
  MemoryEntityRecord,
  MemoryEntityType,
  MemoryTopicRecord,
} from '../binding/MemoryBindingTypes.js';

export interface UpsertMemoryEntityInput {
  projectId?: string;
  canonicalName: string;
  entityType: MemoryEntityType;
  aliases?: string[];
  stablePath?: string;
  now?: number;
}

export interface UpsertMemoryTopicInput {
  projectId?: string;
  topicPath: string;
  parentPath?: string;
  topicType: MemoryTopicRecord['topicType'];
  summary?: string;
  now?: number;
}

export interface UpsertMemoryClusterInput {
  projectId?: string;
  topicPath: string;
  clusterType: MemoryClusterRecord['clusterType'];
  title: string;
  summary: string;
  claimKey: string;
  status: MemoryClusterRecord['status'];
  reviewFlags?: string[];
  confidence: number;
  eventId: string;
  now?: number;
}

export interface UpsertMemoryEdgeInput {
  projectId?: string;
  sourceType: MemoryEdgeRecord['sourceType'];
  sourceId: string;
  relationType: MemoryEdgeRelation;
  targetType: MemoryEdgeRecord['targetType'];
  targetId: string;
  confidence: number;
  baseWeight?: number;
  stability?: number;
  activation?: number;
  evidenceEventIds: string[];
  status?: MemoryEdgeRecord['status'];
  createdAt?: number;
  validFrom?: number;
  validTo?: number;
  sourceAuthority?: MemoryEdgeRecord['sourceAuthority'];
}

export interface DecayMemoryEdgeActivationOptions {
  projectId?: string;
  factor?: number;
  floor?: number;
  now?: number;
}

export class MemoryBindingStore {
  private readonly db: Database;
  private readonly ownsDb: boolean;

  constructor(dbOrPath: Database | string = ':memory:') {
    if (typeof dbOrPath === 'string') {
      this.db = new Database(dbOrPath);
      this.ownsDb = true;
    } else {
      this.db = dbOrPath;
      this.ownsDb = false;
    }
    this.initializeSchema();
  }

  upsertEntity(input: UpsertMemoryEntityInput): MemoryEntityRecord {
    const now = input.now ?? Date.now();
    const entityId = entityIdFor(input.projectId, input.entityType, input.canonicalName);
    const aliases = Array.from(new Set([input.canonicalName, ...(input.aliases || [])]))
      .filter(Boolean);
    this.db.prepare(`
      INSERT INTO memory_entities (
        entity_id, project_id, canonical_name, entity_type, aliases_json, stable_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_id) DO UPDATE SET
        aliases_json = excluded.aliases_json,
        stable_path = COALESCE(excluded.stable_path, memory_entities.stable_path),
        updated_at = excluded.updated_at
    `).run(
      entityId,
      input.projectId || null,
      input.canonicalName,
      input.entityType,
      JSON.stringify(aliases),
      input.stablePath || null,
      now,
      now,
    );
    return {
      entityId,
      projectId: input.projectId,
      canonicalName: input.canonicalName,
      entityType: input.entityType,
      aliases,
      stablePath: input.stablePath,
      createdAt: now,
      updatedAt: now,
    };
  }

  upsertTopic(input: UpsertMemoryTopicInput): MemoryTopicRecord {
    const now = input.now ?? Date.now();
    this.db.prepare(`
      INSERT INTO memory_topics (
        topic_path, project_id, project_id_key, parent_path, topic_type, summary, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(topic_path, project_id_key) DO UPDATE SET
        parent_path = COALESCE(excluded.parent_path, memory_topics.parent_path),
        summary = COALESCE(excluded.summary, memory_topics.summary),
        updated_at = excluded.updated_at
    `).run(
      input.topicPath,
      input.projectId || null,
      input.projectId || '',
      input.parentPath || parentPathFor(input.topicPath) || null,
      input.topicType,
      input.summary || null,
      now,
      now,
    );
    return {
      topicPath: input.topicPath,
      projectId: input.projectId,
      parentPath: input.parentPath || parentPathFor(input.topicPath),
      topicType: input.topicType,
      summary: input.summary,
      createdAt: now,
      updatedAt: now,
    };
  }

  insertBinding(input: MemoryBindingInput): MemoryBindingRecord {
    const now = input.createdAt ?? Date.now();
    const bindingId = bindingIdFor(input);
    this.db.prepare(`
      INSERT INTO memory_bindings (
        binding_id, event_id, project_id, role, raw_event_type, entity_id, entity_name, entity_type,
        topic_path, binding_type, confidence, source, signal, claim_key, binding_action, cluster_id, related_event_ids_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(binding_id) DO UPDATE SET
        confidence = excluded.confidence,
        signal = excluded.signal,
        claim_key = excluded.claim_key,
        binding_action = excluded.binding_action,
        cluster_id = excluded.cluster_id,
        related_event_ids_json = excluded.related_event_ids_json
    `).run(
      bindingId,
      input.eventId,
      input.projectId || null,
      input.role || null,
      input.rawEventType || null,
      input.entityId || null,
      input.entityName || null,
      input.entityType || null,
      input.topicPath,
      input.bindingType,
      input.confidence,
      input.source,
      input.signal,
      input.claimKey,
      input.bindingAction || 'create_new_cluster',
      input.clusterId || null,
      JSON.stringify(input.relatedEventIds || []),
      now,
    );
    return {
      bindingId,
      eventId: input.eventId,
      projectId: input.projectId,
      role: input.role,
      rawEventType: input.rawEventType,
      entityId: input.entityId,
      entityName: input.entityName,
      entityType: input.entityType,
      topicPath: input.topicPath,
      bindingType: input.bindingType,
      confidence: input.confidence,
      source: input.source,
      signal: input.signal,
      claimKey: input.claimKey,
      bindingAction: input.bindingAction || 'create_new_cluster',
      clusterId: input.clusterId,
      relatedEventIds: input.relatedEventIds || [],
      createdAt: now,
    };
  }

  upsertCluster(input: UpsertMemoryClusterInput): MemoryClusterRecord {
    const now = input.now ?? Date.now();
    const clusterId = clusterIdFor(input.projectId, input.topicPath, input.clusterType, input.claimKey);
    const existing = this.getCluster(clusterId);
    const evidenceEventIds = existing
      ? Array.from(new Set([...existing.evidenceEventIds, input.eventId]))
      : [input.eventId];
    const reviewFlags = Array.from(new Set([...(existing?.reviewFlags || []), ...(input.reviewFlags || [])]));
    const createdAt = existing?.createdAt ?? now;
    const supportCount = evidenceEventIds.length;
    const confidence = existing ? Math.max(existing.confidence, input.confidence) : input.confidence;
    const status = input.status === 'superseded'
      ? input.status
      : existing?.status && existing.status !== 'possible_conflict'
        ? existing.status
        : input.status;

    this.db.prepare(`
      INSERT INTO memory_clusters (
        cluster_id, project_id, topic_path, cluster_type, title, summary, claim_key, status,
        review_flags_json, confidence, support_count, evidence_event_ids_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cluster_id) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        claim_key = excluded.claim_key,
        status = excluded.status,
        review_flags_json = excluded.review_flags_json,
        confidence = excluded.confidence,
        support_count = excluded.support_count,
        evidence_event_ids_json = excluded.evidence_event_ids_json,
        updated_at = excluded.updated_at
    `).run(
      clusterId,
      input.projectId || null,
      input.topicPath,
      input.clusterType,
      input.title,
      input.summary,
      input.claimKey,
      status,
      JSON.stringify(reviewFlags),
      confidence,
      supportCount,
      JSON.stringify(evidenceEventIds),
      createdAt,
      now,
    );

    return {
      clusterId,
      projectId: input.projectId,
      topicPath: input.topicPath,
      clusterType: input.clusterType,
      title: input.title,
      summary: input.summary,
      claimKey: input.claimKey,
      status,
      reviewFlags,
      confidence,
      supportCount,
      evidenceEventIds,
      createdAt,
      updatedAt: now,
    };
  }

  getCluster(clusterId: string): MemoryClusterRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM memory_clusters
      WHERE cluster_id = ?
    `).get(clusterId) as MemoryClusterRow | null;
    return row ? mapClusterRow(row) : null;
  }

  listClusters(options: MemoryClusterListOptions = {}): MemoryClusterRecord[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.projectId) {
      clauses.push('project_id = ?');
      params.push(options.projectId);
    }
    if (options.topicPath) {
      clauses.push('topic_path = ?');
      params.push(options.topicPath);
    }
    if (options.clusterType) {
      clauses.push('cluster_type = ?');
      params.push(options.clusterType);
    }
    if (options.status) {
      clauses.push('status = ?');
      params.push(options.status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const rows = this.db.prepare(`
      SELECT *
      FROM memory_clusters
      ${where}
      ORDER BY updated_at DESC, cluster_id DESC
      LIMIT ?
    `).all(...params, limit) as MemoryClusterRow[];
    return rows.map(mapClusterRow);
  }

  upsertEdge(input: UpsertMemoryEdgeInput): MemoryEdgeRecord {
    const now = input.createdAt ?? Date.now();
    const edgeId = edgeIdFor(input);
    const evidenceEventIds = Array.from(new Set(input.evidenceEventIds.filter(Boolean)));
    this.db.prepare(`
      INSERT INTO memory_edges (
        edge_id, project_id, source_type, source_id, relation_type, target_type, target_id,
        confidence, base_weight, stability, activation, evidence_event_ids_json, status,
        valid_from, valid_to, version, source_authority, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(edge_id) DO UPDATE SET
        confidence = MAX(memory_edges.confidence, excluded.confidence),
        base_weight = excluded.base_weight,
        stability = MAX(memory_edges.stability, excluded.stability),
        activation = MAX(memory_edges.activation, excluded.activation),
        evidence_event_ids_json = excluded.evidence_event_ids_json,
        status = excluded.status,
        valid_to = excluded.valid_to,
        version = memory_edges.version + 1,
        source_authority = excluded.source_authority,
        updated_at = excluded.updated_at
    `).run(
      edgeId,
      input.projectId || null,
      input.sourceType,
      input.sourceId,
      input.relationType,
      input.targetType,
      input.targetId,
      input.confidence,
      clamp(input.baseWeight ?? 1, 0, 10),
      clamp(input.stability ?? 1, 0, 1),
      clamp(input.activation ?? 1, 0, 10),
      JSON.stringify(evidenceEventIds),
      input.status || 'active',
      input.validFrom ?? now,
      input.validTo ?? null,
      1,
      input.sourceAuthority || 'raw_evidence',
      now,
      now,
    );
    return {
      edgeId,
      projectId: input.projectId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      relationType: input.relationType,
      targetType: input.targetType,
      targetId: input.targetId,
      confidence: input.confidence,
      baseWeight: clamp(input.baseWeight ?? 1, 0, 10),
      stability: clamp(input.stability ?? 1, 0, 1),
      activation: clamp(input.activation ?? 1, 0, 10),
      evidenceEventIds,
      status: input.status || 'active',
      createdAt: now,
      updatedAt: now,
      validFrom: input.validFrom ?? now,
      validTo: input.validTo,
      version: 1,
      sourceAuthority: input.sourceAuthority || 'raw_evidence',
    };
  }

  decayEdgeActivation(options: DecayMemoryEdgeActivationOptions = {}): number {
    const factor = clamp(options.factor ?? 0.85, 0, 1);
    const floor = Math.max(0, options.floor ?? 0.01);
    const now = options.now ?? Date.now();
    const where = options.projectId ? 'WHERE project_id = ?' : '';
    const params = options.projectId ? [options.projectId] : [];
    const result = this.db.prepare(`
      UPDATE memory_edges
      SET activation = CASE WHEN activation * ? < ? THEN 0 ELSE activation * ? END,
          updated_at = ?
      ${where}
    `).run(factor, floor, factor, now, ...params);
    return Number(result.changes ?? 0);
  }

  listEdges(options: MemoryEdgeListOptions = {}): MemoryEdgeRecord[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.projectId) {
      clauses.push('project_id = ?');
      params.push(options.projectId);
    }
    if (options.sourceId) {
      clauses.push('source_id = ?');
      params.push(options.sourceId);
    }
    if (options.targetId) {
      clauses.push('target_id = ?');
      params.push(options.targetId);
    }
    if (options.relationType) {
      clauses.push('relation_type = ?');
      params.push(options.relationType);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const rows = this.db.prepare(`
      SELECT *
      FROM memory_edges
      ${where}
      ORDER BY created_at DESC, edge_id DESC
      LIMIT ?
    `).all(...params, limit) as MemoryEdgeRow[];
    return rows.map(mapEdgeRow);
  }

  listBindings(options: MemoryBindingListOptions = {}): MemoryBindingRecord[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.projectId) {
      clauses.push('project_id = ?');
      params.push(options.projectId);
    }
    if (options.eventId) {
      clauses.push('event_id = ?');
      params.push(options.eventId);
    }
    if (options.topicPath) {
      clauses.push('topic_path = ?');
      params.push(options.topicPath);
    }
    if (options.entityName) {
      clauses.push('entity_name = ?');
      params.push(options.entityName);
    }
    if (options.bindingType) {
      clauses.push('binding_type = ?');
      params.push(options.bindingType);
    }
    if (options.role) {
      clauses.push('role = ?');
      params.push(options.role);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const rows = this.db.prepare(`
      SELECT *
      FROM memory_bindings
      ${where}
      ORDER BY created_at DESC, binding_id DESC
      LIMIT ?
    `).all(...params, limit) as MemoryBindingRow[];
    return rows.map(mapBindingRow);
  }

  getStats(projectId?: string): MemoryBindingStats {
    const params = projectId ? [projectId] : [];
    const where = projectId ? 'WHERE project_id = ?' : '';
    const bindings = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_bindings ${where}`).get(...params) as CountRow;
    const topics = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_topics ${where}`).get(...params) as CountRow;
    const entities = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_entities ${where}`).get(...params) as CountRow;
    const clusters = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_clusters ${where}`).get(...params) as CountRow;
    const edges = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_edges ${where}`).get(...params) as CountRow;
    return {
      bindings: Number(bindings.count),
      topics: Number(topics.count),
      entities: Number(entities.count),
      clusters: Number(clusters.count),
      edges: Number(edges.count),
    };
  }

  deleteByProject(projectId: string): number {
    const bindings = this.db.prepare(`DELETE FROM memory_bindings WHERE project_id = ?`).run(projectId);
    this.db.prepare(`DELETE FROM memory_clusters WHERE project_id = ?`).run(projectId);
    this.db.prepare(`DELETE FROM memory_edges WHERE project_id = ?`).run(projectId);
    this.db.prepare(`DELETE FROM memory_topics WHERE project_id = ?`).run(projectId);
    this.db.prepare(`DELETE FROM memory_entities WHERE project_id = ?`).run(projectId);
    return Number(bindings.changes ?? 0);
  }

  close(): void {
    if (this.ownsDb) this.db.close();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entities (
        entity_id TEXT PRIMARY KEY,
        project_id TEXT,
        canonical_name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        stable_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memory_entities_project_name
        ON memory_entities(project_id, canonical_name);

      CREATE TABLE IF NOT EXISTS memory_topics (
        topic_path TEXT NOT NULL,
        project_id TEXT,
        project_id_key TEXT NOT NULL DEFAULT '',
        parent_path TEXT,
        topic_type TEXT NOT NULL,
        summary TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (topic_path, project_id_key)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_topics_project
        ON memory_topics(project_id, parent_path);

      CREATE TABLE IF NOT EXISTS memory_bindings (
        binding_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        project_id TEXT,
        role TEXT,
        raw_event_type TEXT,
        entity_id TEXT,
        entity_name TEXT,
        entity_type TEXT,
        topic_path TEXT NOT NULL,
        binding_type TEXT NOT NULL,
        confidence REAL NOT NULL,
        source TEXT NOT NULL,
        signal TEXT NOT NULL,
        claim_key TEXT NOT NULL DEFAULT 'default',
        binding_action TEXT NOT NULL DEFAULT 'create_new_cluster',
        cluster_id TEXT,
        related_event_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memory_bindings_project_topic
        ON memory_bindings(project_id, topic_path, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_memory_bindings_event
        ON memory_bindings(event_id);

      CREATE INDEX IF NOT EXISTS idx_memory_bindings_entity
        ON memory_bindings(project_id, entity_name);

      CREATE TABLE IF NOT EXISTS memory_clusters (
        cluster_id TEXT PRIMARY KEY,
        project_id TEXT,
        topic_path TEXT NOT NULL,
        cluster_type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        claim_key TEXT NOT NULL DEFAULT 'default',
        status TEXT NOT NULL,
        review_flags_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL,
        support_count INTEGER NOT NULL,
        evidence_event_ids_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memory_clusters_project_topic
        ON memory_clusters(project_id, topic_path, updated_at DESC);

      CREATE TABLE IF NOT EXISTS memory_edges (
        edge_id TEXT PRIMARY KEY,
        project_id TEXT,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        confidence REAL NOT NULL,
        base_weight REAL NOT NULL DEFAULT 1,
        stability REAL NOT NULL DEFAULT 1,
        activation REAL NOT NULL DEFAULT 1,
        evidence_event_ids_json TEXT NOT NULL,
        status TEXT NOT NULL,
        valid_from INTEGER NOT NULL DEFAULT 0,
        valid_to INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        source_authority TEXT NOT NULL DEFAULT 'raw_evidence',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_memory_edges_project_source
        ON memory_edges(project_id, source_type, source_id);

      CREATE INDEX IF NOT EXISTS idx_memory_edges_project_target
        ON memory_edges(project_id, target_type, target_id);
    `);
    this.ensureCompatibilityColumns();
  }

  private ensureCompatibilityColumns(): void {
    const topicRows = this.db.prepare(`PRAGMA table_info(memory_topics)`).all() as Array<{ name: string }>;
    const topicNames = new Set(topicRows.map((row) => row.name));
    if (!topicNames.has('project_id_key')) {
      this.db.exec(`ALTER TABLE memory_topics ADD COLUMN project_id_key TEXT NOT NULL DEFAULT '';`);
      this.db.exec(`UPDATE memory_topics SET project_id_key = COALESCE(project_id, '');`);
    }

    const bindingRows = this.db.prepare(`PRAGMA table_info(memory_bindings)`).all() as Array<{ name: string }>;
    const bindingNames = new Set(bindingRows.map((row) => row.name));
    if (!bindingNames.has('binding_action')) {
      this.db.exec(`ALTER TABLE memory_bindings ADD COLUMN binding_action TEXT NOT NULL DEFAULT 'create_new_cluster';`);
    }
    if (!bindingNames.has('claim_key')) {
      this.db.exec(`ALTER TABLE memory_bindings ADD COLUMN claim_key TEXT NOT NULL DEFAULT 'default';`);
    }
    if (!bindingNames.has('cluster_id')) {
      this.db.exec(`ALTER TABLE memory_bindings ADD COLUMN cluster_id TEXT;`);
    }
    if (!bindingNames.has('related_event_ids_json')) {
      this.db.exec(`ALTER TABLE memory_bindings ADD COLUMN related_event_ids_json TEXT NOT NULL DEFAULT '[]';`);
    }

    const clusterRows = this.db.prepare(`PRAGMA table_info(memory_clusters)`).all() as Array<{ name: string }>;
    const clusterNames = new Set(clusterRows.map((row) => row.name));
    if (!clusterNames.has('claim_key')) {
      this.db.exec(`ALTER TABLE memory_clusters ADD COLUMN claim_key TEXT NOT NULL DEFAULT 'default';`);
    }
    if (!clusterNames.has('review_flags_json')) {
      this.db.exec(`ALTER TABLE memory_clusters ADD COLUMN review_flags_json TEXT NOT NULL DEFAULT '[]';`);
    }

    const edgeRows = this.db.prepare(`PRAGMA table_info(memory_edges)`).all() as Array<{ name: string }>;
    const edgeNames = new Set(edgeRows.map((row) => row.name));
    const edgeColumns: Array<[string, string]> = [
      ['base_weight', 'REAL NOT NULL DEFAULT 1'],
      ['stability', 'REAL NOT NULL DEFAULT 1'],
      ['activation', 'REAL NOT NULL DEFAULT 1'],
      ['valid_from', 'INTEGER NOT NULL DEFAULT 0'],
      ['valid_to', 'INTEGER'],
      ['version', 'INTEGER NOT NULL DEFAULT 1'],
      ['source_authority', "TEXT NOT NULL DEFAULT 'raw_evidence'"],
      ['updated_at', 'INTEGER NOT NULL DEFAULT 0'],
    ];
    for (const [name, definition] of edgeColumns) {
      if (!edgeNames.has(name)) this.db.exec(`ALTER TABLE memory_edges ADD COLUMN ${name} ${definition};`);
    }
    this.db.exec(`UPDATE memory_edges SET valid_from = created_at WHERE valid_from = 0;`);
    this.db.exec(`UPDATE memory_edges SET updated_at = created_at WHERE updated_at = 0;`);
  }
}

interface MemoryBindingRow {
  binding_id: string;
  event_id: string;
  project_id?: string | null;
  role?: string | null;
  raw_event_type?: string | null;
  entity_id?: string | null;
  entity_name?: string | null;
  entity_type?: MemoryEntityType | null;
  topic_path: string;
  binding_type: MemoryBindingRecord['bindingType'];
  confidence: number;
  source: MemoryBindingRecord['source'];
  signal: string;
  claim_key: string;
  binding_action: MemoryBindingRecord['bindingAction'];
  cluster_id?: string | null;
  related_event_ids_json?: string | null;
  created_at: number;
}

interface MemoryClusterRow {
  cluster_id: string;
  project_id?: string | null;
  topic_path: string;
  cluster_type: MemoryClusterRecord['clusterType'];
  title: string;
  summary: string;
  claim_key?: string | null;
  status: MemoryClusterRecord['status'];
  review_flags_json?: string | null;
  confidence: number;
  support_count: number;
  evidence_event_ids_json: string;
  created_at: number;
  updated_at: number;
}

interface MemoryEdgeRow {
  edge_id: string;
  project_id?: string | null;
  source_type: MemoryEdgeRecord['sourceType'];
  source_id: string;
  relation_type: MemoryEdgeRecord['relationType'];
  target_type: MemoryEdgeRecord['targetType'];
  target_id: string;
  confidence: number;
  base_weight?: number | null;
  stability?: number | null;
  activation?: number | null;
  evidence_event_ids_json: string;
  status: MemoryEdgeRecord['status'];
  created_at: number;
  updated_at?: number | null;
  valid_from?: number | null;
  valid_to?: number | null;
  version?: number | null;
  source_authority?: MemoryEdgeRecord['sourceAuthority'] | null;
}

interface CountRow {
  count: number;
}

function mapBindingRow(row: MemoryBindingRow): MemoryBindingRecord {
  return {
    bindingId: row.binding_id,
    eventId: row.event_id,
    projectId: row.project_id || undefined,
    role: row.role || undefined,
    rawEventType: row.raw_event_type || undefined,
    entityId: row.entity_id || undefined,
    entityName: row.entity_name || undefined,
    entityType: row.entity_type || undefined,
    topicPath: row.topic_path,
    bindingType: row.binding_type,
    confidence: Number(row.confidence),
    source: row.source,
    signal: row.signal,
    claimKey: row.claim_key || 'default',
    bindingAction: row.binding_action,
    clusterId: row.cluster_id || undefined,
    relatedEventIds: parseStringArray(row.related_event_ids_json),
    createdAt: Number(row.created_at),
  };
}

function mapClusterRow(row: MemoryClusterRow): MemoryClusterRecord {
  return {
    clusterId: row.cluster_id,
    projectId: row.project_id || undefined,
    topicPath: row.topic_path,
    clusterType: row.cluster_type,
    title: row.title,
    summary: row.summary,
    claimKey: row.claim_key || 'default',
    status: row.status,
    reviewFlags: parseStringArray(row.review_flags_json),
    confidence: Number(row.confidence),
    supportCount: Number(row.support_count),
    evidenceEventIds: parseStringArray(row.evidence_event_ids_json),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapEdgeRow(row: MemoryEdgeRow): MemoryEdgeRecord {
  return {
    edgeId: row.edge_id,
    projectId: row.project_id || undefined,
    sourceType: row.source_type,
    sourceId: row.source_id,
    relationType: row.relation_type,
    targetType: row.target_type,
    targetId: row.target_id,
    confidence: Number(row.confidence),
    baseWeight: Number(row.base_weight ?? 1),
    stability: Number(row.stability ?? 1),
    activation: Number(row.activation ?? 1),
    evidenceEventIds: parseStringArray(row.evidence_event_ids_json),
    status: row.status,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at ?? row.created_at),
    validFrom: Number(row.valid_from ?? row.created_at),
    validTo: row.valid_to == null ? undefined : Number(row.valid_to),
    version: Number(row.version ?? 1),
    sourceAuthority: row.source_authority || 'raw_evidence',
  };
}

function entityIdFor(projectId: string | undefined, entityType: MemoryEntityType, canonicalName: string): string {
  return `entity-${hash([projectId || '', entityType, canonicalName.toLowerCase()].join('\0'))}`;
}

function bindingIdFor(input: MemoryBindingInput): string {
  return `binding-${hash([
    input.eventId,
    input.topicPath,
    input.bindingType,
    input.entityName || input.entityId || '',
  ].join('\0'))}`;
}

function clusterIdFor(
  projectId: string | undefined,
  topicPath: string,
  clusterType: MemoryClusterRecord['clusterType'],
  claimKey: string,
): string {
  return `cluster-${hash([projectId || '', topicPath, clusterType, claimKey].join('\0'))}`;
}

function edgeIdFor(input: UpsertMemoryEdgeInput): string {
  return `edge-${hash([
    input.projectId || '',
    input.sourceType,
    input.sourceId,
    input.relationType,
    input.targetType,
    input.targetId,
  ].join('\0'))}`;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parentPathFor(topicPath: string): string | undefined {
  const index = topicPath.lastIndexOf('/');
  return index > 0 ? topicPath.slice(0, index) : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
