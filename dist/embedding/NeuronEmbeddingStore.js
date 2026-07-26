export class NeuronEmbeddingStore {
    db;
    constructor(db) {
        this.db = db;
        this.initSchema();
    }
    initSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS neuron_embeddings (
        neuron_id TEXT NOT NULL,
        project_id TEXT,
        model_id TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector_blob BLOB NOT NULL,
        status TEXT NOT NULL DEFAULT 'done',
        retry_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (neuron_id, model_id)
      );

      CREATE INDEX IF NOT EXISTS idx_neuron_embeddings_project
        ON neuron_embeddings(project_id, model_id);
    `);
        this.ensureProgressColumns();
    }
    upsert(neuronId, modelId, vector, projectId) {
        const resolvedProjectId = projectId ?? this.lookupProjectId(neuronId);
        const bytes = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
        if (this.hasTable('neurons')) {
            const result = this.db.prepare(`
        INSERT OR REPLACE INTO neuron_embeddings (
          neuron_id, project_id, model_id, dimensions, vector_blob, status, retry_count, updated_at
        )
        SELECT id, COALESCE(project_id,''), ?, ?, ?, 'done', 0, ?
        FROM neurons
        WHERE id=? AND is_deleted=0 AND COALESCE(project_id,'')=?
      `).run(modelId, vector.length, bytes, Date.now(), neuronId, resolvedProjectId ?? '');
            return Number(result.changes) > 0;
        }
        const result = this.db.prepare(`
      INSERT OR REPLACE INTO neuron_embeddings (
        neuron_id, project_id, model_id, dimensions, vector_blob, status, retry_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'done', 0, ?)
    `).run(neuronId, resolvedProjectId ?? null, modelId, vector.length, bytes, Date.now());
        return Number(result.changes) > 0;
    }
    hasTable(name) {
        return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name));
    }
    getProgress() {
        const total = this.readCount(`SELECT COUNT(*) AS count FROM neuron_embeddings`);
        const completed = this.readCount(`SELECT COUNT(*) AS count FROM neuron_embeddings WHERE status = 'done'`);
        const failed = this.readCount(`SELECT COUNT(*) AS count FROM neuron_embeddings WHERE status = 'failed'`);
        const row = this.db.prepare(`SELECT MAX(updated_at) AS updatedAt FROM neuron_embeddings`).get();
        return {
            total,
            completed,
            failed,
            lastUpdatedAt: new Date(Number(row?.updatedAt ?? 0)).toISOString(),
        };
    }
    findNearest(queryVector, projectId, topK, modelId) {
        const rows = this.readRows(projectId, modelId);
        return rows
            .map((row) => ({
            neuronId: row.neuron_id,
            score: cosineSimilarity(queryVector, decodeVector(row.vector_blob))
        }))
            .filter((row) => row.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }
    hasStaleVectors(currentModelId) {
        const row = this.db.prepare(`
      SELECT 1 FROM neuron_embeddings
      WHERE model_id <> ?
      LIMIT 1
    `).get(currentModelId);
        return Boolean(row);
    }
    countStaleVectors(currentModelId, projectId) {
        const row = projectId !== undefined
            ? this.db.prepare(`
          SELECT COUNT(*) AS count FROM neuron_embeddings
          WHERE COALESCE(project_id,'') = ? AND model_id <> ?
        `).get(projectId, currentModelId)
            : this.db.prepare(`
          SELECT COUNT(*) AS count FROM neuron_embeddings
          WHERE model_id <> ?
        `).get(currentModelId);
        return Number(row?.count || 0);
    }
    listStaleNeuronIds(currentModelId, projectId, afterNeuronId, limit) {
        const rows = this.db.prepare(`
      SELECT neuron_id FROM neuron_embeddings
      WHERE project_id = ?
        AND model_id <> ?
        AND neuron_id > ?
      GROUP BY neuron_id
      ORDER BY neuron_id ASC
      LIMIT ?
    `).all(projectId, currentModelId, afterNeuronId, limit);
        return rows.map((row) => row.neuron_id);
    }
    listProjectsWithStaleVectors(currentModelId) {
        const rows = this.db.prepare(`
      SELECT DISTINCT project_id FROM neuron_embeddings
      WHERE model_id <> ? AND project_id IS NOT NULL
      ORDER BY project_id ASC
    `).all(currentModelId);
        return rows.map((row) => row.project_id);
    }
    deleteNeuronEmbedding(neuronId, modelId) {
        if (modelId) {
            this.db.prepare(`DELETE FROM neuron_embeddings WHERE neuron_id = ? AND model_id = ?`).run(neuronId, modelId);
            return;
        }
        this.db.prepare(`DELETE FROM neuron_embeddings WHERE neuron_id = ?`).run(neuronId);
    }
    deleteStaleEmbeddingsForNeuron(neuronId, currentModelId) {
        this.db.prepare(`DELETE FROM neuron_embeddings WHERE neuron_id = ? AND model_id <> ?`).run(neuronId, currentModelId);
    }
    listLatestEmbeddings() {
        const rows = this.db.prepare(`
      SELECT e.neuron_id, e.project_id, e.model_id, e.dimensions, e.vector_blob, e.updated_at
      FROM neuron_embeddings e
      JOIN (
        SELECT neuron_id, MAX(updated_at) AS updated_at
        FROM neuron_embeddings
        GROUP BY neuron_id
      ) latest
        ON latest.neuron_id = e.neuron_id
       AND latest.updated_at = e.updated_at
      ORDER BY e.neuron_id ASC
    `).all();
        return rows.map((row) => ({
            neuronId: row.neuron_id,
            projectId: row.project_id == null ? undefined : String(row.project_id),
            modelId: row.model_id,
            dimensions: Number(row.dimensions),
            vector: decodeVector(row.vector_blob),
            updatedAt: Number(row.updated_at),
        }));
    }
    readRows(projectId, modelId) {
        if (projectId !== undefined && modelId) {
            return this.db.prepare(`
        SELECT neuron_id, vector_blob FROM neuron_embeddings
        WHERE COALESCE(project_id, '') = ? AND model_id = ?
      `).all(projectId, modelId);
        }
        if (projectId !== undefined) {
            return this.db.prepare(`
        SELECT neuron_id, vector_blob FROM neuron_embeddings
        WHERE COALESCE(project_id, '') = ?
      `).all(projectId);
        }
        if (modelId) {
            return this.db.prepare(`
        SELECT neuron_id, vector_blob FROM neuron_embeddings
        WHERE model_id = ?
      `).all(modelId);
        }
        return this.db.prepare(`SELECT neuron_id, vector_blob FROM neuron_embeddings`).all();
    }
    lookupProjectId(neuronId) {
        try {
            const row = this.db.prepare(`SELECT project_id FROM neurons WHERE id = ?`).get(neuronId);
            return row?.project_id == null ? undefined : String(row.project_id);
        }
        catch {
            return undefined;
        }
    }
    ensureProgressColumns() {
        const columns = this.db.prepare(`PRAGMA table_info(neuron_embeddings)`).all();
        const names = new Set(columns.map((column) => column.name));
        if (!names.has('status'))
            this.db.exec(`ALTER TABLE neuron_embeddings ADD COLUMN status TEXT NOT NULL DEFAULT 'done';`);
        if (!names.has('retry_count'))
            this.db.exec(`ALTER TABLE neuron_embeddings ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;`);
    }
    readCount(sql) {
        const row = this.db.prepare(sql).get();
        return Number(row?.count ?? 0);
    }
}
function decodeVector(blob) {
    if (blob instanceof ArrayBuffer)
        return new Float32Array(blob);
    const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
    const copied = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new Float32Array(copied);
}
function cosineSimilarity(a, b) {
    if (a.length !== b.length || a.length === 0)
        return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let index = 0; index < a.length; index += 1) {
        dot += a[index] * b[index];
        magA += a[index] * a[index];
        magB += b[index] * b[index];
    }
    if (magA === 0 || magB === 0)
        return 0;
    return Math.max(0, Math.min(1, dot / (Math.sqrt(magA) * Math.sqrt(magB))));
}
