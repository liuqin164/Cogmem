import { config } from '../utils/Config.js';
export class SqliteVecStore {
    db;
    dimension;
    constructor(db, dimension = config.vector.dimension) {
        this.db = db;
        this.dimension = dimension;
        this.initSchema();
    }
    addVector(neuronId, vector) {
        this.assertDimension(vector, 'Vector');
        this.db.prepare(`
      INSERT OR REPLACE INTO vector_index (
        neuron_id, dimensions, vector_blob, updated_at
      ) VALUES (?, ?, ?, ?)
    `).run(neuronId, this.dimension, Buffer.from(new Float32Array(vector).buffer), Date.now());
    }
    addVectors(vectors) {
        const insert = this.db.prepare(`
      INSERT OR REPLACE INTO vector_index (
        neuron_id, dimensions, vector_blob, updated_at
      ) VALUES (?, ?, ?, ?)
    `);
        const write = this.db.transaction((items) => {
            const now = Date.now();
            for (const item of items) {
                this.assertDimension(item.vector, 'Vector');
                insert.run(item.id, this.dimension, Buffer.from(new Float32Array(item.vector).buffer), now);
            }
        });
        write(vectors);
    }
    removePoint(neuronId) {
        this.db.prepare(`DELETE FROM vector_index WHERE neuron_id = ?`).run(neuronId);
    }
    search(queryVector, k = config.vector.topK) {
        this.assertDimension(queryVector, 'Query vector');
        if (k <= 0)
            return [];
        const query = new Float32Array(queryVector);
        const hasCanonicalNeurons = Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='neurons'`).get());
        const rows = this.db.prepare(hasCanonicalNeurons ? `
      SELECT v.neuron_id, v.vector_blob FROM vector_index v
      JOIN neurons n ON n.id=v.neuron_id AND n.is_deleted=0 WHERE v.dimensions = ?
    ` : `SELECT neuron_id,vector_blob FROM vector_index WHERE dimensions=?`).all(this.dimension);
        return rows
            .map((row) => ({
            id: row.neuron_id,
            score: cosineSimilarity(query, decodeVector(row.vector_blob)),
        }))
            .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
            .slice(0, k);
    }
    getStats() {
        return {
            backend: 'sqlite-vec',
            size: this.getCurrentCount(),
            dimension: this.dimension,
            tombstones: 0,
        };
    }
    getCurrentCount() {
        const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM vector_index WHERE dimensions = ?
    `).get(this.dimension);
        return Number(row?.count ?? 0);
    }
    clear() {
        this.db.prepare(`DELETE FROM vector_index WHERE dimensions = ?`).run(this.dimension);
    }
    checkIntegrity() {
        try {
            const rows = this.db.prepare(`
        SELECT vector_blob FROM vector_index WHERE dimensions = ? LIMIT 100
      `).all(this.dimension);
            return rows.every((row) => decodeVector(row.vector_blob).length === this.dimension);
        }
        catch {
            return false;
        }
    }
    async rebuildIndex(neurons) {
        const insert = this.db.prepare(`
      INSERT INTO vector_index (neuron_id, dimensions, vector_blob, updated_at)
      VALUES (?, ?, ?, ?)
    `);
        this.db.transaction(() => {
            this.clear();
            const now = Date.now();
            for (const neuron of neurons) {
                this.assertDimension(neuron.vector, 'Vector');
                insert.run(neuron.id, this.dimension, Buffer.from(new Float32Array(neuron.vector).buffer), now);
            }
        })();
    }
    initSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS vector_index (
        neuron_id TEXT PRIMARY KEY,
        dimensions INTEGER NOT NULL,
        vector_blob BLOB NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_vector_index_dimensions
        ON vector_index(dimensions);
    `);
        if (this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='neurons'`).get()) {
            this.db.exec(`DELETE FROM vector_index WHERE neuron_id NOT IN (SELECT id FROM neurons WHERE is_deleted=0)`);
        }
    }
    assertDimension(vector, label) {
        if (vector.length !== this.dimension) {
            throw new Error(`${label} dimension mismatch: expected ${this.dimension}, got ${vector.length}`);
        }
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
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
