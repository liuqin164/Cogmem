// @ts-nocheck
// ============================================
// 记忆图谱 - SQLite 持久化 + 流式索引恢复
// ============================================
import Database from 'bun:sqlite';
import { createHash } from 'crypto';
import { IMPORTANCE_STABILITY_MAP } from './ImportanceLevels.js';
import { ENTITY_TYPE_LEXICON, extractIssueRankingTokensFromText, extractRelativeReferences, normalizeLexiconText } from '../lexicon/coreMemoryLexicon.js';
import { logger } from '../utils/Logger.js';
export class MemoryGraph {
    db;
    timeIndex = new Map();
    projectIndex = new Map();
    anchorIndex = new Map();
    topicReclassifiedListeners = new Set();
    constructor(dbPath = ':memory:') {
        let lastError;
        for (let attempt = 0; attempt < 6; attempt += 1) {
            try {
                this.db = new Database(dbPath);
                this.initializeSchema();
                this.rebuildIndexes();
                return;
            }
            catch (error) {
                lastError = error;
                try {
                    this.db?.close();
                }
                catch { }
                if (!isSqliteBusy(error) || attempt === 5)
                    break;
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
            }
        }
        logger.error('Failed to initialize MemoryGraph:', lastError);
        throw new Error(`MemoryGraph initialization failed: ${lastError}`);
    }
    initializeSchema() {
        this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS neurons (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        self_hash TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        spatial_x REAL NOT NULL,
        spatial_y REAL NOT NULL,
        spatial_z REAL NOT NULL,
        vector_blob BLOB,
        project_id TEXT,
        topic_path TEXT,
        file_id TEXT,
        file_path TEXT,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        last_activated INTEGER,
        activation_count INTEGER NOT NULL DEFAULT 0,
        aaak_summary TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        tags TEXT,
        file_size INTEGER,
        mime_type TEXT,
        original_name TEXT,
        blob_path TEXT,
        confidence REAL NOT NULL DEFAULT 1.0,
        source_type TEXT,
        source_event_id TEXT,
        importance_level TEXT NOT NULL DEFAULT 'normal',
        is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
        stability REAL NOT NULL DEFAULT 1.0,
        repetitions INTEGER NOT NULL DEFAULT 0,
        procedural_link_json TEXT,
        community_id TEXT,
        last_reinforced_at INTEGER,
        is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1))
      );

      CREATE INDEX IF NOT EXISTS idx_neurons_temporal ON neurons(timestamp);
      CREATE INDEX IF NOT EXISTS idx_neurons_project ON neurons(project_id);
      CREATE INDEX IF NOT EXISTS idx_neurons_type_project_created ON neurons(type, project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_neurons_status ON neurons(status, last_activated DESC);
      CREATE INDEX IF NOT EXISTS idx_neurons_stability ON neurons(stability DESC);
      CREATE INDEX IF NOT EXISTS idx_neurons_repetitions ON neurons(repetitions DESC);
      CREATE INDEX IF NOT EXISTS idx_neurons_not_deleted ON neurons(is_deleted, updated_at DESC);

      CREATE TABLE IF NOT EXISTS synapses (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL,
        weight REAL NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        PRIMARY KEY (source_id, target_id, type)
      );

      CREATE INDEX IF NOT EXISTS idx_synapses_source ON synapses(source_id);
      CREATE INDEX IF NOT EXISTS idx_synapses_target ON synapses(target_id);

      CREATE TABLE IF NOT EXISTS anchors (
        id TEXT PRIMARY KEY,
        neuron_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        prev_anchor_id TEXT,
        summary_hash TEXT NOT NULL,
        project_id TEXT,
        version TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS neurons_fts USING fts5(
        id UNINDEXED,
        content,
        aaak_summary,
        project_id UNINDEXED,
        file_path UNINDEXED,
        tokenize='unicode61'
      );
    `);
        this.ensureCompatibilityColumns();
    }
    ensureCompatibilityColumns() {
        const columns = this.db.prepare(`PRAGMA table_info(neurons)`).all();
        const names = new Set(columns.map((column) => column.name));
        if (!names.has('topic_path')) {
            this.db.exec(`ALTER TABLE neurons ADD COLUMN topic_path TEXT;`);
        }
        if (!names.has('importance_level')) {
            this.db.exec(`ALTER TABLE neurons ADD COLUMN importance_level TEXT NOT NULL DEFAULT 'normal';`);
        }
        if (!names.has('is_pinned')) {
            this.db.exec(`ALTER TABLE neurons ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1));`);
        }
        if (!names.has('procedural_link_json')) {
            this.db.exec(`ALTER TABLE neurons ADD COLUMN procedural_link_json TEXT;`);
        }
        if (!names.has('community_id')) {
            this.db.exec(`ALTER TABLE neurons ADD COLUMN community_id TEXT;`);
        }
        if (!names.has('last_reinforced_at')) {
            this.db.exec(`ALTER TABLE neurons ADD COLUMN last_reinforced_at INTEGER;`);
        }
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_neurons_topic_path ON neurons(project_id, topic_path);`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_neurons_pinned ON neurons(is_pinned) WHERE is_pinned = 1;`);
    }
    addNeuron(neuron) {
        this.insertNeuron(neuron);
        this.insertIntoFTS(neuron);
        this.updateMemoryIndexes(neuron);
        for (const synapse of neuron.synapses)
            this.addSynapse(neuron.id, synapse);
    }
    addNeuronInTransaction(neuron) {
        this.insertNeuron(neuron);
        this.insertIntoFTS(neuron);
        for (const synapse of neuron.synapses)
            this.addSynapse(neuron.id, synapse);
    }
    insertNeuron(neuron) {
        const vectorBuffer = neuron.coordinates.V.length > 0
            ? Buffer.from(new Float32Array(neuron.coordinates.V).buffer)
            : null;
        const importanceLevel = neuron.metadata.importanceLevel || 'normal';
        const isPinned = neuron.metadata.isPinned ?? (importanceLevel !== 'normal' && importanceLevel !== 'low');
        const stability = neuron.metadata.type === 'semantic_consolidation'
            ? (neuron.metadata.stability ?? 1)
            : importanceLevel === 'normal'
                ? (neuron.metadata.stability ?? IMPORTANCE_STABILITY_MAP.normal)
                : IMPORTANCE_STABILITY_MAP[importanceLevel];
        this.db.prepare(`
      INSERT INTO neurons (
        id, content, prev_hash, self_hash, timestamp, spatial_x, spatial_y, spatial_z,
        vector_blob, project_id, topic_path, file_id, file_path, type, created_at, updated_at,
        last_activated, activation_count, aaak_summary, status, tags, file_size,
        mime_type, original_name, blob_path, confidence, source_type, source_event_id,
        importance_level, is_pinned, stability, repetitions, procedural_link_json, community_id, last_reinforced_at, is_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(neuron.id, neuron.content, neuron.prev_hash, neuron.self_hash, neuron.coordinates.T, neuron.coordinates.S[0], neuron.coordinates.S[1], neuron.coordinates.S[2], vectorBuffer, neuron.metadata.projectId || null, neuron.metadata.topicPath || null, neuron.metadata.fileId || null, neuron.metadata.filePath || null, neuron.metadata.type, neuron.metadata.createdAt, neuron.metadata.updatedAt || neuron.metadata.createdAt, neuron.metadata.lastActivated || null, neuron.metadata.activationCount || 0, this.encodeAaakSummary(neuron.metadata) || null, neuron.metadata.status || 'active', neuron.metadata.tags?.join(',') || null, neuron.metadata.fileSize || null, neuron.metadata.mimeType || null, neuron.metadata.originalName || null, neuron.metadata.blobPath || null, neuron.metadata.confidence ?? 1, neuron.metadata.sourceType || null, neuron.metadata.sourceEventId || null, importanceLevel, isPinned ? 1 : 0, stability, neuron.metadata.repetitions ?? 0, neuron.metadata.proceduralLink ? JSON.stringify(neuron.metadata.proceduralLink) : null, neuron.metadata.communityId || null, neuron.metadata.lastReinforcedAt || null, 0);
    }
    insertIntoFTS(neuron) {
        this.db.prepare(`
      INSERT INTO neurons_fts (id, content, aaak_summary, project_id, file_path)
      VALUES (?, ?, ?, ?, ?)
    `).run(neuron.id, neuron.content, neuron.metadata.aaak_summary || null, neuron.metadata.projectId || null, neuron.metadata.filePath || null);
    }
    rebuildIndexes() {
        this.timeIndex.clear();
        this.projectIndex.clear();
        const rows = this.db.prepare(`
      SELECT id, timestamp, project_id
      FROM neurons
      WHERE is_deleted = 0
    `).all();
        for (const row of rows) {
            const dateKey = new Date(row.timestamp).toDateString();
            if (!this.timeIndex.has(dateKey))
                this.timeIndex.set(dateKey, new Set());
            this.timeIndex.get(dateKey).add(row.id);
            if (row.project_id) {
                if (!this.projectIndex.has(row.project_id))
                    this.projectIndex.set(row.project_id, new Set());
                this.projectIndex.get(row.project_id).add(row.id);
            }
        }
    }
    updateMemoryIndexes(neuron) {
        const dateKey = new Date(neuron.coordinates.T).toDateString();
        if (!this.timeIndex.has(dateKey))
            this.timeIndex.set(dateKey, new Set());
        this.timeIndex.get(dateKey).add(neuron.id);
        if (neuron.metadata.projectId) {
            if (!this.projectIndex.has(neuron.metadata.projectId))
                this.projectIndex.set(neuron.metadata.projectId, new Set());
            this.projectIndex.get(neuron.metadata.projectId).add(neuron.id);
        }
    }
    addSynapse(sourceId, synapse) {
        this.db.prepare(`
      INSERT OR REPLACE INTO synapses (source_id, target_id, type, weight, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sourceId, synapse.targetId, synapse.type, synapse.weight, Date.now());
    }
    getNeuron(id) {
        const row = this.db.prepare(`SELECT * FROM neurons WHERE id = ? AND is_deleted = 0`).get(id);
        return row ? this.mapNeuron(row) : null;
    }
    getNeuronIdsByProject(projectId) {
        const ids = this.projectIndex.get(projectId);
        if (ids)
            return Array.from(ids);
        return this.db.prepare(`
      SELECT id FROM neurons
      WHERE project_id = ? AND is_deleted = 0
      ORDER BY created_at DESC
    `).all(projectId).map((row) => row.id);
    }
    listTimeProjectionNeurons(projectId, options = {}) {
        const hasCursor = options.afterCreatedAt !== undefined && options.afterId !== undefined;
        const rows = hasCursor ? this.db.prepare(`
      SELECT id, project_id, created_at, COALESCE(NULLIF(aaak_summary, ''), substr(content, 1, 120), id) AS title
      FROM neurons
      WHERE project_id = ? AND is_deleted = 0
        AND (created_at > ? OR (created_at = ? AND id > ?))
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(projectId, options.afterCreatedAt, options.afterCreatedAt, options.afterId, options.limit ?? 500) : this.db.prepare(`
      SELECT id, project_id, created_at, COALESCE(NULLIF(aaak_summary, ''), substr(content, 1, 120), id) AS title
      FROM neurons
      WHERE project_id = ? AND is_deleted = 0
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(projectId, options.limit ?? 500);
        return rows.map((row) => ({
            id: row.id,
            projectId: row.project_id,
            createdAt: row.created_at,
            title: row.title,
        }));
    }
    getSynapses(sourceId) {
        const rows = this.db.prepare(`SELECT * FROM synapses WHERE source_id = ?`).all(sourceId);
        return rows.map((row) => ({ targetId: row.target_id, type: row.type, weight: row.weight }));
    }
    getAllNeurons() {
        const rows = this.db.prepare(`SELECT * FROM neurons WHERE is_deleted = 0`).all();
        return rows.map((row) => this.mapNeuron(row));
    }
    findNeuronsByType(type, options = {}) {
        const limit = options.limit ?? 10;
        const clauses = ['is_deleted = 0', 'type = ?'];
        const values = [type];
        if (options.projectId) {
            clauses.push('project_id = ?');
            values.push(options.projectId);
        }
        if (options.topicPath) {
            clauses.push(`(
        topic_path = ?
        OR (tags IS NOT NULL AND (',' || tags || ',') LIKE ?)
      )`);
            values.push(options.topicPath, `%,topic:${options.topicPath},%`);
        }
        values.push(limit);
        const rows = this.db.prepare(`
      SELECT *
      FROM neurons
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(...values);
        return rows.map((row) => this.mapNeuron(row));
    }
    listNeuronsByTimeRange(startTime, endTime, projectId) {
        const rows = projectId
            ? this.db.prepare(`
          SELECT *
          FROM neurons
          WHERE is_deleted = 0
            AND timestamp >= ?
            AND timestamp < ?
            AND project_id = ?
          ORDER BY timestamp ASC, created_at ASC
        `).all(startTime, endTime, projectId)
            : this.db.prepare(`
          SELECT *
          FROM neurons
          WHERE is_deleted = 0
            AND timestamp >= ?
            AND timestamp < ?
          ORDER BY timestamp ASC, created_at ASC
        `).all(startTime, endTime);
        return rows.map((row) => this.mapNeuron(row));
    }
    mapNeuron(row) {
        const synapses = this.getSynapses(row.id);
        const V = row.vector_blob ? this.decodeVectorBlob(row.vector_blob) : [];
        const parsedAaak = this.decodeAaakSummary(row.aaak_summary || undefined, row.type);
        return {
            id: row.id,
            content: row.content,
            prev_hash: row.prev_hash,
            self_hash: row.self_hash,
            coordinates: {
                T: row.timestamp,
                S: [row.spatial_x, row.spatial_y, row.spatial_z],
                V
            },
            synapses,
            metadata: {
                projectId: row.project_id || undefined,
                topicPath: row.topic_path || undefined,
                fileId: row.file_id || undefined,
                filePath: row.file_path || undefined,
                type: row.type,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                lastActivated: row.last_activated || undefined,
                activationCount: row.activation_count,
                aaak_summary: parsedAaak.aaakSummary,
                status: row.status,
                tags: row.tags ? String(row.tags).split(',').filter(Boolean) : undefined,
                fileSize: row.file_size || undefined,
                mimeType: row.mime_type || undefined,
                originalName: row.original_name || undefined,
                blobPath: row.blob_path || undefined,
                confidence: row.confidence ?? 1,
                sourceType: row.source_type || undefined,
                sourceEventId: row.source_event_id || undefined,
                importanceLevel: row.importance_level || 'normal',
                isPinned: Boolean(row.is_pinned),
                stability: row.stability ?? 1,
                repetitions: row.repetitions ?? 0,
                skillMeta: parsedAaak.skillMeta,
                proceduralLink: this.decodeProceduralLink(row.procedural_link_json || undefined),
                communityId: row.community_id || undefined,
                lastReinforcedAt: row.last_reinforced_at || undefined
            }
        };
    }
    encodeAaakSummary(metadata) {
        if (metadata.skillMeta) {
            return `skill_meta:${JSON.stringify(metadata.skillMeta)}`;
        }
        return metadata.aaak_summary || undefined;
    }
    decodeAaakSummary(value, type) {
        if (type === 'skill' && value?.startsWith('skill_meta:')) {
            try {
                const skillMeta = JSON.parse(value.slice('skill_meta:'.length));
                return { aaakSummary: skillMeta?.description, skillMeta };
            }
            catch {
                return { aaakSummary: value };
            }
        }
        return { aaakSummary: value || undefined };
    }
    decodeProceduralLink(value) {
        if (!value)
            return undefined;
        try {
            const parsed = JSON.parse(value);
            return parsed?.skillId && parsed?.linkType ? parsed : undefined;
        }
        catch {
            return undefined;
        }
    }
    decodeVectorBlob(blob) {
        if (blob instanceof ArrayBuffer)
            return Array.from(new Float32Array(blob));
        const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob.buffer, blob.byteOffset, blob.byteLength);
        const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return Array.from(new Float32Array(arrayBuffer));
    }
    createAnchor(neuronIds, projectId) {
        const anchor = {
            id: `anchor-${Date.now()}`,
            neuronCount: neuronIds.length,
            createdAt: Date.now(),
            summaryHash: this.computeAnchorSummary(neuronIds, projectId),
            metadata: { projectId, version: '0.3.0' }
        };
        this.db.prepare(`
      INSERT INTO anchors (id, neuron_count, created_at, prev_anchor_id, summary_hash, project_id, version)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(anchor.id, anchor.neuronCount, anchor.createdAt, anchor.prevAnchorId || null, anchor.summaryHash, anchor.metadata.projectId || null, anchor.metadata.version);
        this.anchorIndex.set(anchor.id, anchor);
        return anchor;
    }
    computeAnchorSummary(neuronIds, projectId) {
        return createHash('sha256')
            .update(JSON.stringify({ neuronIds: [...neuronIds].sort(), projectId, timestamp: Date.now() }))
            .digest('hex');
    }
    getLatestAnchor(projectId) {
        const query = projectId
            ? `SELECT * FROM anchors WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`
            : `SELECT * FROM anchors ORDER BY created_at DESC LIMIT 1`;
        const row = projectId ? this.db.prepare(query).get(projectId) : this.db.prepare(query).get();
        if (!row)
            return null;
        return {
            id: row.id,
            neuronCount: row.neuron_count,
            createdAt: row.created_at,
            prevAnchorId: row.prev_anchor_id || undefined,
            summaryHash: row.summary_hash,
            metadata: { projectId: row.project_id || undefined, version: row.version }
        };
    }
    getLatestNeuronSelfHash(projectId) {
        const sql = projectId
            ? `SELECT self_hash FROM neurons WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`
            : `SELECT self_hash FROM neurons ORDER BY created_at DESC, id DESC LIMIT 1`;
        const row = projectId
            ? this.db.prepare(sql).get(projectId)
            : this.db.prepare(sql).get();
        return row?.self_hash || null;
    }
    fullTextSearch(query, projectId, limit = 10) {
        const sanitizedQuery = this.toFTSQuery(query);
        const fallbackTokens = this.extractFallbackSearchTokens(query);
        if (!sanitizedQuery)
            return this.fallbackTextSearch(fallbackTokens, projectId, limit);
        let sql = `SELECT id FROM neurons_fts WHERE neurons_fts MATCH ?`;
        const params = [sanitizedQuery];
        if (projectId) {
            sql += ` AND project_id = ?`;
            params.push(projectId);
        }
        sql += ` LIMIT ?`;
        params.push(limit);
        const ids = this.db.prepare(sql).all(...params).map((row) => row.id);
        if (ids.length > 0 || fallbackTokens.length === 0)
            return ids;
        return this.fallbackTextSearch(fallbackTokens, projectId, limit);
    }
    toFTSQuery(query) {
        const tokens = normalizeLexiconText(query)
            .toLowerCase()
            .split(/[\s,，。！？、:：?？!！/]+/)
            .map((token) => token.replace(/[^\p{L}\p{N}_\-.]/gu, '').trim())
            .filter((token) => token.length >= 2);
        if (tokens.length === 0)
            return '';
        return tokens.map((token) => `"${token}"`).join(' OR ');
    }
    extractFallbackSearchTokens(query) {
        const normalized = normalizeLexiconText(query).toLowerCase();
        const splitTokens = normalized
            .split(/[\s,，。！？、:：?？!！/]+/)
            .map((token) => token.replace(/[^\p{L}\p{N}_\-.]/gu, '').trim())
            .filter((token) => token.length >= 2);
        const lexiconTokens = Object.values(ENTITY_TYPE_LEXICON)
            .flat()
            .filter((token) => normalized.includes(token.toLowerCase()));
        return Array.from(new Set([
            ...splitTokens,
            ...extractRelativeReferences(query).map((token) => normalizeLexiconText(token).toLowerCase()),
            ...extractIssueRankingTokensFromText(query),
            ...lexiconTokens.map((token) => token.toLowerCase())
        ]));
    }
    fallbackTextSearch(tokens, projectId, limit) {
        if (tokens.length === 0)
            return [];
        const rows = projectId
            ? this.db.prepare(`
          SELECT id, content, aaak_summary
          FROM neurons
          WHERE is_deleted = 0 AND project_id = ?
          ORDER BY created_at DESC
          LIMIT 200
        `).all(projectId)
            : this.db.prepare(`
          SELECT id, content, aaak_summary
          FROM neurons
          WHERE is_deleted = 0
          ORDER BY created_at DESC
          LIMIT 200
        `).all();
        return rows
            .map((row) => {
            const haystack = normalizeLexiconText(`${row.content} ${row.aaak_summary || ''}`).toLowerCase();
            const score = tokens.filter((token) => haystack.includes(token)).length;
            return { id: row.id, score };
        })
            .filter((row) => row.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((row) => row.id);
    }
    transaction(fn) {
        this.db.transaction(fn)();
    }
    close() {
        try {
            this.db.close();
        }
        catch (error) {
            logger.error('Failed to close database:', error);
        }
    }
    getStats() {
        return {
            neuronCount: this.db.prepare(`SELECT COUNT(*) AS count FROM neurons WHERE is_deleted = 0`).get().count,
            synapseCount: this.db.prepare(`SELECT COUNT(*) AS count FROM synapses`).get().count,
            anchorCount: this.db.prepare(`SELECT COUNT(*) AS count FROM anchors`).get().count
        };
    }
    findSimilarNeurons(vector, topK) {
        const results = [];
        for (const page of this.iterateNeuronVectors(500, { includeStatuses: ['active'], onlyNotDeleted: true })) {
            for (const neuron of page) {
                if (neuron.vector.length !== vector.length)
                    continue;
                const score = this.cosineSimilarity(vector, neuron.vector);
                if (score > 0.5)
                    results.push({ id: neuron.id, score });
            }
        }
        return results.sort((a, b) => b.score - a.score).slice(0, topK);
    }
    cosineSimilarity(a, b) {
        const dotProduct = a.reduce((sum, value, index) => sum + value * (b[index] || 0), 0);
        const magnitudeA = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
        const magnitudeB = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0));
        if (magnitudeA === 0 || magnitudeB === 0)
            return 0;
        return dotProduct / (magnitudeA * magnitudeB);
    }
    updateNeuronStatus(neuronId, status) {
        this.db.prepare(`
      UPDATE neurons
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(status, Date.now(), neuronId);
    }
    updateNeuronMetadata(neuronId, metadata) {
        const updates = [];
        const values = [];
        const previousNeuron = metadata.topicPath !== undefined ? this.getNeuron(neuronId) : null;
        if (metadata.projectId !== undefined) {
            updates.push('project_id = ?');
            values.push(metadata.projectId || null);
        }
        if (metadata.topicPath !== undefined) {
            updates.push('topic_path = ?');
            values.push(metadata.topicPath || null);
        }
        if (metadata.fileId !== undefined) {
            updates.push('file_id = ?');
            values.push(metadata.fileId || null);
        }
        if (metadata.filePath !== undefined) {
            updates.push('file_path = ?');
            values.push(metadata.filePath || null);
        }
        if (metadata.lastActivated !== undefined) {
            updates.push('last_activated = ?');
            values.push(metadata.lastActivated || null);
        }
        if (metadata.activationCount !== undefined) {
            updates.push('activation_count = ?');
            values.push(metadata.activationCount);
        }
        if (metadata.aaak_summary !== undefined || metadata.skillMeta !== undefined) {
            updates.push('aaak_summary = ?');
            values.push(this.encodeAaakSummary(metadata) || null);
        }
        if (metadata.status !== undefined) {
            updates.push('status = ?');
            values.push(metadata.status);
        }
        if (metadata.tags !== undefined) {
            updates.push('tags = ?');
            values.push(metadata.tags ? metadata.tags.join(',') : null);
        }
        if (metadata.fileSize !== undefined) {
            updates.push('file_size = ?');
            values.push(metadata.fileSize || null);
        }
        if (metadata.mimeType !== undefined) {
            updates.push('mime_type = ?');
            values.push(metadata.mimeType || null);
        }
        if (metadata.originalName !== undefined) {
            updates.push('original_name = ?');
            values.push(metadata.originalName || null);
        }
        if (metadata.blobPath !== undefined) {
            updates.push('blob_path = ?');
            values.push(metadata.blobPath || null);
        }
        if (metadata.confidence !== undefined) {
            updates.push('confidence = ?');
            values.push(metadata.confidence);
        }
        if (metadata.sourceType !== undefined) {
            updates.push('source_type = ?');
            values.push(metadata.sourceType || null);
        }
        if (metadata.sourceEventId !== undefined) {
            updates.push('source_event_id = ?');
            values.push(metadata.sourceEventId || null);
        }
        if (metadata.importanceLevel !== undefined) {
            updates.push('importance_level = ?');
            values.push(metadata.importanceLevel);
        }
        if (metadata.isPinned !== undefined) {
            updates.push('is_pinned = ?');
            values.push(metadata.isPinned ? 1 : 0);
        }
        if (metadata.stability !== undefined) {
            updates.push('stability = ?');
            values.push(metadata.stability);
        }
        if (metadata.repetitions !== undefined) {
            updates.push('repetitions = ?');
            values.push(metadata.repetitions);
        }
        if (metadata.proceduralLink !== undefined) {
            updates.push('procedural_link_json = ?');
            values.push(metadata.proceduralLink ? JSON.stringify(metadata.proceduralLink) : null);
        }
        if (metadata.communityId !== undefined) {
            updates.push('community_id = ?');
            values.push(metadata.communityId || null);
        }
        if (metadata.lastReinforcedAt !== undefined) {
            updates.push('last_reinforced_at = ?');
            values.push(metadata.lastReinforcedAt || null);
        }
        if (metadata.updatedAt !== undefined) {
            updates.push('updated_at = ?');
            values.push(metadata.updatedAt);
        }
        if (updates.length === 0)
            return;
        if (metadata.updatedAt === undefined) {
            updates.push('updated_at = ?');
            values.push(Date.now());
        }
        values.push(neuronId);
        this.db.prepare(`UPDATE neurons SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        if (metadata.topicPath !== undefined && previousNeuron) {
            const updatedNeuron = this.getNeuron(neuronId);
            const from = previousNeuron.metadata.topicPath;
            const to = updatedNeuron?.metadata.topicPath;
            if (from !== to) {
                const observation = {
                    type: 'TopicReclassified',
                    neuronId,
                    projectId: updatedNeuron?.metadata.projectId ?? previousNeuron.metadata.projectId,
                    from,
                    to,
                    content: updatedNeuron?.content ?? previousNeuron.content,
                    timestamp: Date.now()
                };
                for (const listener of this.topicReclassifiedListeners) {
                    listener(observation);
                }
            }
        }
    }
    onTopicReclassified(listener) {
        this.topicReclassifiedListeners.add(listener);
        return () => this.topicReclassifiedListeners.delete(listener);
    }
    getTopicPaths(projectId) {
        const rows = projectId
            ? this.db.prepare(`
          SELECT topic_path, COUNT(*) AS count
          FROM neurons
          WHERE is_deleted = 0 AND project_id = ? AND topic_path IS NOT NULL AND topic_path <> ''
          GROUP BY topic_path
          ORDER BY count DESC, topic_path ASC
        `).all(projectId)
            : this.db.prepare(`
          SELECT topic_path, COUNT(*) AS count
          FROM neurons
          WHERE is_deleted = 0 AND topic_path IS NOT NULL AND topic_path <> ''
          GROUP BY topic_path
          ORDER BY count DESC, topic_path ASC
        `).all();
        return rows.map((row) => row.topic_path);
    }
    getNeuronIdsByTopicPrefix(prefix, projectId) {
        const normalized = prefix.replace(/^\/+|\/+$/g, '');
        if (!normalized)
            return [];
        const likePrefix = `${normalized}/%`;
        const rows = projectId
            ? this.db.prepare(`
          SELECT id
          FROM neurons
          WHERE is_deleted = 0
            AND project_id = ?
            AND (topic_path = ? OR topic_path LIKE ?)
          ORDER BY created_at DESC, id DESC
        `).all(projectId, normalized, likePrefix)
            : this.db.prepare(`
          SELECT id
          FROM neurons
          WHERE is_deleted = 0
            AND (topic_path = ? OR topic_path LIKE ?)
          ORDER BY created_at DESC, id DESC
        `).all(normalized, likePrefix);
        return rows.map((row) => row.id);
    }
    buildTopicTree(projectId) {
        return this.getTopicPaths(projectId).map((path) => ({
            path,
            segments: path.split('/').filter(Boolean),
            neuronCount: this.getNeuronIdsByTopicPrefix(path, projectId).length,
            projectId
        }));
    }
    updateNeuronContent(neuronId, content) {
        const now = Date.now();
        this.db.prepare(`
      UPDATE neurons
      SET content = ?, updated_at = ?
      WHERE id = ? AND is_deleted = 0
    `).run(content, now, neuronId);
        this.db.prepare(`DELETE FROM neurons_fts WHERE id = ?`).run(neuronId);
        const neuron = this.getNeuron(neuronId);
        if (neuron)
            this.insertIntoFTS(neuron);
    }
    updateNeuronImportance(neuronId, importanceLevel, isPinned = importanceLevel !== 'normal' && importanceLevel !== 'low') {
        this.updateNeuronMetadata(neuronId, {
            importanceLevel,
            isPinned,
            stability: IMPORTANCE_STABILITY_MAP[importanceLevel],
            status: isPinned ? 'active' : undefined
        });
    }
    listPinnedNeurons(options = 20) {
        const limit = typeof options === 'number' ? options : options.limit ?? 20;
        const projectId = typeof options === 'number' ? undefined : options.projectId;
        const rows = projectId
            ? this.db.prepare(`
          SELECT *
          FROM neurons
          WHERE is_deleted = 0 AND is_pinned = 1 AND project_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `).all(projectId, limit)
            : this.db.prepare(`
          SELECT *
          FROM neurons
          WHERE is_deleted = 0 AND is_pinned = 1
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `).all(limit);
        return rows.map((row) => this.mapNeuron(row));
    }
    getRecentNeurons(options = {}) {
        const limit = options.limit ?? 20;
        const since = Date.now() - (options.sinceMs ?? 5 * 60 * 1000);
        const rows = options.projectId
            ? this.db.prepare(`
          SELECT *
          FROM neurons
          WHERE is_deleted = 0 AND project_id = ? AND created_at >= ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `).all(options.projectId, since, limit)
            : this.db.prepare(`
          SELECT *
          FROM neurons
          WHERE is_deleted = 0 AND created_at >= ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `).all(since, limit);
        return rows.map((row) => this.mapNeuron(row));
    }
    hasSynapse(sourceId, targetId) {
        const row = this.db.prepare(`
      SELECT 1 FROM synapses WHERE source_id = ? AND target_id = ? LIMIT 1
    `).get(sourceId, targetId);
        return row !== null && row !== undefined;
    }
    getNeuronEnergy(neuronId) {
        return this.getSynapses(neuronId).reduce((sum, synapse) => sum + synapse.weight, 0);
    }
    getOrphanNeuronIds(limit) {
        const rows = this.db.prepare(`
      SELECT n.id
      FROM neurons n
      LEFT JOIN synapses s ON n.id = s.source_id
      WHERE s.source_id IS NULL AND n.status = 'active' AND n.is_deleted = 0
      ORDER BY COALESCE(n.last_activated, n.created_at) ASC
      LIMIT ?
    `).all(limit);
        return rows.map((row) => row.id);
    }
    getNeuronIdsForReinforcement(limit) {
        const rows = this.db.prepare(`
      SELECT id
      FROM neurons
      WHERE activation_count >= 10 AND status = 'active' AND is_deleted = 0
      ORDER BY COALESCE(last_activated, created_at) ASC
      LIMIT ?
    `).all(limit);
        return rows.map((row) => row.id);
    }
    getNeuronIdsForTransition(limit) {
        const rows = this.db.prepare(`
      SELECT id
      FROM neurons
      WHERE (status IN ('active', 'cold') OR is_pinned = 1) AND is_deleted = 0
      ORDER BY COALESCE(last_activated, created_at) ASC
      LIMIT ?
    `).all(limit);
        return rows.map((row) => row.id);
    }
    getArchivedFileNeurons() {
        const rows = this.db.prepare(`
      SELECT * FROM neurons
      WHERE type = 'file' AND status = 'archived' AND is_deleted = 0
    `).all();
        return rows.map((row) => this.mapNeuron(row));
    }
    iterateNeuronVectors(pageSize, options = {}) {
        const includeStatuses = options.includeStatuses ?? ['active', 'cold'];
        const onlyNotDeleted = options.onlyNotDeleted ?? true;
        const statusPlaceholders = includeStatuses.map(() => '?').join(', ');
        const sql = `
      SELECT id, vector_blob
      FROM neurons
      WHERE id > ?
        AND vector_blob IS NOT NULL
        ${onlyNotDeleted ? 'AND is_deleted = 0' : ''}
        ${options.projectId ? 'AND project_id = ?' : ''}
        AND status IN (${statusPlaceholders})
      ORDER BY id ASC
      LIMIT ?
    `;
        const stmt = this.db.prepare(sql);
        let lastId = '';
        const self = this;
        return (function* iterate() {
            while (true) {
                const params = [lastId];
                if (options.projectId)
                    params.push(options.projectId);
                params.push(...includeStatuses);
                params.push(pageSize);
                const rows = stmt.all(...params);
                if (rows.length === 0)
                    return;
                const page = rows.map((row) => ({
                    id: row.id,
                    vector: self.decodeVectorBlob(row.vector_blob)
                }));
                yield page;
                lastId = rows[rows.length - 1].id;
            }
        })();
    }
    async forEachNeuronVectorPage(pageSize, onPage, options) {
        for (const page of this.iterateNeuronVectors(pageSize, options)) {
            await onPage(page);
        }
    }
}
function isSqliteBusy(error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error?.code;
    return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED' || /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message);
}
