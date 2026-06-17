import { createHash } from 'node:crypto';
import Database from 'bun:sqlite';
export class MemoryBindingStore {
    db;
    ownsDb;
    constructor(dbOrPath = ':memory:') {
        if (typeof dbOrPath === 'string') {
            this.db = new Database(dbOrPath);
            this.ownsDb = true;
        }
        else {
            this.db = dbOrPath;
            this.ownsDb = false;
        }
        this.initializeSchema();
    }
    upsertEntity(input) {
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
    `).run(entityId, input.projectId || null, input.canonicalName, input.entityType, JSON.stringify(aliases), input.stablePath || null, now, now);
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
    upsertTopic(input) {
        const now = input.now ?? Date.now();
        this.db.prepare(`
      INSERT INTO memory_topics (
        topic_path, project_id, project_id_key, parent_path, topic_type, summary, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(topic_path, project_id_key) DO UPDATE SET
        parent_path = COALESCE(excluded.parent_path, memory_topics.parent_path),
        summary = COALESCE(excluded.summary, memory_topics.summary),
        updated_at = excluded.updated_at
    `).run(input.topicPath, input.projectId || null, input.projectId || '', input.parentPath || parentPathFor(input.topicPath) || null, input.topicType, input.summary || null, now, now);
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
    insertBinding(input) {
        const now = input.createdAt ?? Date.now();
        const bindingId = bindingIdFor(input);
        this.db.prepare(`
      INSERT INTO memory_bindings (
        binding_id, event_id, project_id, role, raw_event_type, entity_id, entity_name, entity_type,
        topic_path, binding_type, confidence, source, signal, binding_action, cluster_id, related_event_ids_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(binding_id) DO UPDATE SET
        confidence = excluded.confidence,
        signal = excluded.signal,
        binding_action = excluded.binding_action,
        cluster_id = excluded.cluster_id,
        related_event_ids_json = excluded.related_event_ids_json
    `).run(bindingId, input.eventId, input.projectId || null, input.role || null, input.rawEventType || null, input.entityId || null, input.entityName || null, input.entityType || null, input.topicPath, input.bindingType, input.confidence, input.source, input.signal, input.bindingAction || 'create_new_cluster', input.clusterId || null, JSON.stringify(input.relatedEventIds || []), now);
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
            bindingAction: input.bindingAction || 'create_new_cluster',
            clusterId: input.clusterId,
            relatedEventIds: input.relatedEventIds || [],
            createdAt: now,
        };
    }
    upsertCluster(input) {
        const now = input.now ?? Date.now();
        const clusterId = clusterIdFor(input.projectId, input.topicPath, input.clusterType);
        const existing = this.getCluster(clusterId);
        const evidenceEventIds = existing
            ? Array.from(new Set([...existing.evidenceEventIds, input.eventId]))
            : [input.eventId];
        const createdAt = existing?.createdAt ?? now;
        const supportCount = evidenceEventIds.length;
        const confidence = existing ? Math.max(existing.confidence, input.confidence) : input.confidence;
        const status = existing?.status === 'possible_conflict' ? existing.status : input.status;
        this.db.prepare(`
      INSERT INTO memory_clusters (
        cluster_id, project_id, topic_path, cluster_type, title, summary, status,
        confidence, support_count, evidence_event_ids_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cluster_id) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        status = excluded.status,
        confidence = excluded.confidence,
        support_count = excluded.support_count,
        evidence_event_ids_json = excluded.evidence_event_ids_json,
        updated_at = excluded.updated_at
    `).run(clusterId, input.projectId || null, input.topicPath, input.clusterType, input.title, input.summary, status, confidence, supportCount, JSON.stringify(evidenceEventIds), createdAt, now);
        return {
            clusterId,
            projectId: input.projectId,
            topicPath: input.topicPath,
            clusterType: input.clusterType,
            title: input.title,
            summary: input.summary,
            status,
            confidence,
            supportCount,
            evidenceEventIds,
            createdAt,
            updatedAt: now,
        };
    }
    getCluster(clusterId) {
        const row = this.db.prepare(`
      SELECT *
      FROM memory_clusters
      WHERE cluster_id = ?
    `).get(clusterId);
        return row ? mapClusterRow(row) : null;
    }
    listClusters(options = {}) {
        const clauses = [];
        const params = [];
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
    `).all(...params, limit);
        return rows.map(mapClusterRow);
    }
    upsertEdge(input) {
        const now = input.createdAt ?? Date.now();
        const edgeId = edgeIdFor(input);
        const evidenceEventIds = Array.from(new Set(input.evidenceEventIds.filter(Boolean)));
        this.db.prepare(`
      INSERT INTO memory_edges (
        edge_id, project_id, source_type, source_id, relation_type, target_type, target_id,
        confidence, evidence_event_ids_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(edge_id) DO UPDATE SET
        confidence = MAX(memory_edges.confidence, excluded.confidence),
        evidence_event_ids_json = excluded.evidence_event_ids_json,
        status = excluded.status
    `).run(edgeId, input.projectId || null, input.sourceType, input.sourceId, input.relationType, input.targetType, input.targetId, input.confidence, JSON.stringify(evidenceEventIds), input.status || 'active', now);
        return {
            edgeId,
            projectId: input.projectId,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            relationType: input.relationType,
            targetType: input.targetType,
            targetId: input.targetId,
            confidence: input.confidence,
            evidenceEventIds,
            status: input.status || 'active',
            createdAt: now,
        };
    }
    listBindings(options = {}) {
        const clauses = [];
        const params = [];
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
    `).all(...params, limit);
        return rows.map(mapBindingRow);
    }
    getStats(projectId) {
        const params = projectId ? [projectId] : [];
        const where = projectId ? 'WHERE project_id = ?' : '';
        const bindings = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_bindings ${where}`).get(...params);
        const topics = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_topics ${where}`).get(...params);
        const entities = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_entities ${where}`).get(...params);
        const clusters = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_clusters ${where}`).get(...params);
        const edges = this.db.prepare(`SELECT COUNT(*) AS count FROM memory_edges ${where}`).get(...params);
        return {
            bindings: Number(bindings.count),
            topics: Number(topics.count),
            entities: Number(entities.count),
            clusters: Number(clusters.count),
            edges: Number(edges.count),
        };
    }
    deleteByProject(projectId) {
        const bindings = this.db.prepare(`DELETE FROM memory_bindings WHERE project_id = ?`).run(projectId);
        this.db.prepare(`DELETE FROM memory_clusters WHERE project_id = ?`).run(projectId);
        this.db.prepare(`DELETE FROM memory_edges WHERE project_id = ?`).run(projectId);
        this.db.prepare(`DELETE FROM memory_topics WHERE project_id = ?`).run(projectId);
        this.db.prepare(`DELETE FROM memory_entities WHERE project_id = ?`).run(projectId);
        return Number(bindings.changes ?? 0);
    }
    close() {
        if (this.ownsDb)
            this.db.close();
    }
    initializeSchema() {
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
        status TEXT NOT NULL,
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
        evidence_event_ids_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memory_edges_project_source
        ON memory_edges(project_id, source_type, source_id);

      CREATE INDEX IF NOT EXISTS idx_memory_edges_project_target
        ON memory_edges(project_id, target_type, target_id);
    `);
        this.ensureCompatibilityColumns();
    }
    ensureCompatibilityColumns() {
        const topicRows = this.db.prepare(`PRAGMA table_info(memory_topics)`).all();
        const topicNames = new Set(topicRows.map((row) => row.name));
        if (!topicNames.has('project_id_key')) {
            this.db.exec(`ALTER TABLE memory_topics ADD COLUMN project_id_key TEXT NOT NULL DEFAULT '';`);
            this.db.exec(`UPDATE memory_topics SET project_id_key = COALESCE(project_id, '');`);
        }
        const bindingRows = this.db.prepare(`PRAGMA table_info(memory_bindings)`).all();
        const bindingNames = new Set(bindingRows.map((row) => row.name));
        if (!bindingNames.has('binding_action')) {
            this.db.exec(`ALTER TABLE memory_bindings ADD COLUMN binding_action TEXT NOT NULL DEFAULT 'create_new_cluster';`);
        }
        if (!bindingNames.has('cluster_id')) {
            this.db.exec(`ALTER TABLE memory_bindings ADD COLUMN cluster_id TEXT;`);
        }
        if (!bindingNames.has('related_event_ids_json')) {
            this.db.exec(`ALTER TABLE memory_bindings ADD COLUMN related_event_ids_json TEXT NOT NULL DEFAULT '[]';`);
        }
    }
}
function mapBindingRow(row) {
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
        bindingAction: row.binding_action,
        clusterId: row.cluster_id || undefined,
        relatedEventIds: parseStringArray(row.related_event_ids_json),
        createdAt: Number(row.created_at),
    };
}
function mapClusterRow(row) {
    return {
        clusterId: row.cluster_id,
        projectId: row.project_id || undefined,
        topicPath: row.topic_path,
        clusterType: row.cluster_type,
        title: row.title,
        summary: row.summary,
        status: row.status,
        confidence: Number(row.confidence),
        supportCount: Number(row.support_count),
        evidenceEventIds: parseStringArray(row.evidence_event_ids_json),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
    };
}
function entityIdFor(projectId, entityType, canonicalName) {
    return `entity-${hash([projectId || '', entityType, canonicalName.toLowerCase()].join('\0'))}`;
}
function bindingIdFor(input) {
    return `binding-${hash([
        input.eventId,
        input.topicPath,
        input.bindingType,
        input.entityName || input.entityId || '',
    ].join('\0'))}`;
}
function clusterIdFor(projectId, topicPath, clusterType) {
    return `cluster-${hash([projectId || '', topicPath, clusterType].join('\0'))}`;
}
function edgeIdFor(input) {
    return `edge-${hash([
        input.projectId || '',
        input.sourceType,
        input.sourceId,
        input.relationType,
        input.targetType,
        input.targetId,
    ].join('\0'))}`;
}
function hash(value) {
    return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
function parseStringArray(value) {
    if (!value)
        return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    }
    catch {
        return [];
    }
}
function parentPathFor(topicPath) {
    const index = topicPath.lastIndexOf('/');
    return index > 0 ? topicPath.slice(0, index) : undefined;
}
