// ============================================
// 向量存储 - hnswlib-node 实现
// ============================================
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { config } from '../utils/Config.js';
import { logger } from '../utils/Logger.js';
const require = createRequire(import.meta.url);
let HierarchicalNSWClass = null;
try {
    ({ HierarchicalNSW: HierarchicalNSWClass } = require('hnswlib-node'));
}
catch {
    HierarchicalNSWClass = null;
}
export class VectorStore {
    index;
    dimension;
    maxElements;
    efConstruction;
    efSearch;
    neuronIdMap = new Map();
    idIndexMap = new Map();
    tombstones = new Set();
    fallbackVectors = new Map();
    nextLabel = 0;
    deletedLabelCount = 0;
    constructor(dimension = config.vector.dimension, maxElements = config.vector.maxElements, efConstruction = config.vector.efConstruction, efSearch = config.vector.efSearch) {
        this.dimension = dimension;
        this.maxElements = maxElements;
        this.efConstruction = efConstruction;
        this.efSearch = efSearch;
        if (HierarchicalNSWClass) {
            this.index = new HierarchicalNSWClass('cosine', dimension);
            this.index.initIndex(maxElements, 16, efConstruction);
            this.index.setEf(efSearch);
        }
        else {
            logger?.warn?.('hnswlib-node not available, VectorStore falling back to exact search');
            this.index = null;
        }
    }
    addVector(neuronId, vector) {
        if (vector.length !== this.dimension) {
            throw new Error(`Vector dimension mismatch: expected ${this.dimension}, got ${vector.length}`);
        }
        if (this.idIndexMap.has(neuronId)) {
            this.removePoint(neuronId);
        }
        this.ensureCapacity(this.nextLabel + 1);
        const label = this.nextLabel++;
        if (this.index) {
            this.index.addPoint(vector, label);
        }
        this.fallbackVectors.set(neuronId, [...vector]);
        this.neuronIdMap.set(label, neuronId);
        this.idIndexMap.set(neuronId, label);
        this.tombstones.delete(neuronId);
        this.compactIfNeeded();
    }
    addVectors(vectors) {
        for (const item of vectors)
            this.addVector(item.id, item.vector);
    }
    removePoint(neuronId) {
        const label = this.idIndexMap.get(neuronId);
        if (label === undefined)
            return;
        if (this.index) {
            try {
                this.index.markDelete(label);
                this.deletedLabelCount += 1;
            }
            catch (error) {
                logger.warn(`Failed to mark vector deleted for ${neuronId}:`, error);
            }
        }
        this.idIndexMap.delete(neuronId);
        this.neuronIdMap.delete(label);
        this.tombstones.add(neuronId);
        this.fallbackVectors.delete(neuronId);
    }
    search(queryVector, k = config.vector.topK) {
        if (queryVector.length !== this.dimension) {
            throw new Error(`Query vector dimension mismatch: expected ${this.dimension}, got ${queryVector.length}`);
        }
        if (this.idIndexMap.size === 0)
            return [];
        if (this.index) {
            const rawK = Math.max(k * 3, k);
            const result = this.index.searchKnn(queryVector, Math.min(rawK, this.idIndexMap.size));
            const ranked = [];
            for (let i = 0; i < result.neighbors.length; i++) {
                const label = result.neighbors[i];
                const neuronId = this.neuronIdMap.get(label);
                if (!neuronId || this.tombstones.has(neuronId))
                    continue;
                ranked.push({
                    id: neuronId,
                    score: 1 - result.distances[i]
                });
                if (ranked.length >= k)
                    break;
            }
            return ranked;
        }
        return Array.from(this.fallbackVectors.entries())
            .filter(([id]) => !this.tombstones.has(id))
            .map(([id, vector]) => ({
            id,
            score: this.cosineSimilarity(queryVector, vector)
        }))
            .sort((a, b) => b.score - a.score)
            .slice(0, k);
    }
    cosineSimilarity(a, b) {
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < this.dimension; i++) {
            const av = a[i] || 0;
            const bv = b[i] || 0;
            dot += av * bv;
            normA += av * av;
            normB += bv * bv;
        }
        if (normA === 0 || normB === 0)
            return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }
    size() {
        return this.idIndexMap.size;
    }
    getCurrentCount() {
        return this.size();
    }
    async saveIndex(filePath) {
        if (!this.index)
            return;
        const generation = `${filePath}.generation-${randomUUID()}`;
        await this.index.writeIndex(generation);
        const indexBytes = await readFile(generation);
        await writeFile(`${generation}.meta.json`, JSON.stringify({
            version: 2,
            generation,
            dimension: this.dimension,
            nextLabel: this.nextLabel,
            labelCount: this.neuronIdMap.size,
            indexChecksum: createHash('sha256').update(indexBytes).digest('hex'),
            labels: [...this.neuronIdMap.entries()],
            vectors: [...this.fallbackVectors.entries()],
        }));
        const pointer = `${filePath}.current`;
        const temporaryPointer = `${pointer}.${randomUUID()}.tmp`;
        await writeFile(temporaryPointer, JSON.stringify({ generation }));
        await rename(temporaryPointer, pointer);
    }
    async loadIndex(filePath) {
        if (!this.index)
            return;
        let generation = filePath;
        try {
            const pointer = JSON.parse(await readFile(`${filePath}.current`, 'utf8'));
            if (pointer.generation)
                generation = pointer.generation;
        }
        catch { }
        const metadata = JSON.parse(await readFile(`${generation}.meta.json`, 'utf8'));
        const indexBytes = await readFile(generation);
        const checksum = createHash('sha256').update(indexBytes).digest('hex');
        if (metadata.version !== 2 || metadata.generation !== generation || metadata.dimension !== this.dimension
            || metadata.indexChecksum !== checksum || metadata.labelCount !== metadata.labels?.length
            || !Array.isArray(metadata.labels) || !Array.isArray(metadata.vectors)) {
            throw new Error('vector_index_metadata_mismatch');
        }
        await this.index.readIndex(generation);
        this.index.setEf(this.efSearch);
        this.neuronIdMap = new Map(metadata.labels);
        this.idIndexMap = new Map(metadata.labels.map(([label, neuronId]) => [neuronId, label]));
        this.nextLabel = metadata.nextLabel ?? Math.max(0, ...metadata.labels.map(([label]) => label + 1));
        this.tombstones.clear();
        this.fallbackVectors = new Map(metadata.vectors);
        this.deletedLabelCount = 0;
    }
    getStats() {
        return {
            backend: 'hnswlib',
            size: this.size(),
            dimension: this.dimension,
            maxElements: this.maxElements,
            efConstruction: this.efConstruction,
            efSearch: this.efSearch,
            tombstones: this.deletedLabelCount
        };
    }
    clear() {
        if (HierarchicalNSWClass) {
            this.index = new HierarchicalNSWClass('cosine', this.dimension);
            this.index.initIndex(this.maxElements, 16, this.efConstruction);
            this.index.setEf(this.efSearch);
        }
        else {
            this.index = null;
        }
        this.neuronIdMap.clear();
        this.idIndexMap.clear();
        this.tombstones.clear();
        this.fallbackVectors.clear();
        this.nextLabel = 0;
        this.deletedLabelCount = 0;
    }
    checkIntegrity() {
        try {
            if (this.idIndexMap.size === 0)
                return true;
            const dummyVector = new Array(this.dimension).fill(0);
            this.search(dummyVector, 1);
            return true;
        }
        catch (error) {
            logger.error('Vector store integrity check failed:', error);
            return false;
        }
    }
    async rebuildIndex(neurons) {
        this.clear();
        this.addVectors(neurons);
    }
    ensureCapacity(requiredTotal) {
        if (!this.index)
            return;
        if (requiredTotal <= this.maxElements)
            return;
        let nextCapacity = this.maxElements;
        while (nextCapacity < requiredTotal) {
            nextCapacity = Math.max(nextCapacity * 2, requiredTotal);
        }
        this.index.resizeIndex(nextCapacity);
        this.maxElements = nextCapacity;
    }
    compactIfNeeded() {
        if (!this.index || this.deletedLabelCount < 64 || this.deletedLabelCount <= this.idIndexMap.size / 2)
            return;
        const live = [...this.fallbackVectors.entries()].map(([id, vector]) => ({ id, vector }));
        this.clear();
        this.addVectors(live);
    }
}
