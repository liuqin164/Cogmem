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
        topic_path, binding_type, confidence, source, signal, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(binding_id) DO UPDATE SET
        confidence = excluded.confidence,
        signal = excluded.signal
    `).run(bindingId, input.eventId, input.projectId || null, input.role || null, input.rawEventType || null, input.entityId || null, input.entityName || null, input.entityType || null, input.topicPath, input.bindingType, input.confidence, input.source, input.signal, now);
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
        return {
            bindings: Number(bindings.count),
            topics: Number(topics.count),
            entities: Number(entities.count),
        };
    }
    deleteByProject(projectId) {
        const bindings = this.db.prepare(`DELETE FROM memory_bindings WHERE project_id = ?`).run(projectId);
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
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memory_bindings_project_topic
        ON memory_bindings(project_id, topic_path, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_memory_bindings_event
        ON memory_bindings(event_id);

      CREATE INDEX IF NOT EXISTS idx_memory_bindings_entity
        ON memory_bindings(project_id, entity_name);
    `);
        this.ensureCompatibilityColumns();
    }
    ensureCompatibilityColumns() {
        const rows = this.db.prepare(`PRAGMA table_info(memory_topics)`).all();
        const names = new Set(rows.map((row) => row.name));
        if (!names.has('project_id_key')) {
            this.db.exec(`ALTER TABLE memory_topics ADD COLUMN project_id_key TEXT NOT NULL DEFAULT '';`);
            this.db.exec(`UPDATE memory_topics SET project_id_key = COALESCE(project_id, '');`);
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
        createdAt: Number(row.created_at),
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
function hash(value) {
    return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
function parentPathFor(topicPath) {
    const index = topicPath.lastIndexOf('/');
    return index > 0 ? topicPath.slice(0, index) : undefined;
}
