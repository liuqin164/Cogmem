// ============================================
// 向量存储 - hnswlib-node 实现
// ============================================

import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { config } from '../utils/Config.js';
import { logger } from '../utils/Logger.js';
import type { IVectorStore, VectorSearchResult, VectorStoreStats } from './IVectorStore.js';

const require = createRequire(import.meta.url);
let HierarchicalNSWClass: any = null;

try {
  ({ HierarchicalNSW: HierarchicalNSWClass } = require('hnswlib-node'));
} catch {
  HierarchicalNSWClass = null;
}

export class VectorStore implements IVectorStore {
  private index: any;
  private dimension: number;
  private maxElements: number;
  private efConstruction: number;
  private efSearch: number;
  private neuronIdMap = new Map<number, string>();
  private idIndexMap = new Map<string, number>();
  private tombstones = new Set<string>();
  private fallbackVectors = new Map<string, number[]>();
  private nextLabel = 0;

  constructor(
    dimension: number = config.vector.dimension,
    maxElements: number = config.vector.maxElements,
    efConstruction: number = config.vector.efConstruction,
    efSearch: number = config.vector.efSearch
  ) {
    this.dimension = dimension;
    this.maxElements = maxElements;
    this.efConstruction = efConstruction;
    this.efSearch = efSearch;

    if (HierarchicalNSWClass) {
      this.index = new HierarchicalNSWClass('cosine', dimension);
      this.index.initIndex(maxElements, 16, efConstruction);
      this.index.setEf(efSearch);
    } else {
      logger?.warn?.('hnswlib-node not available, VectorStore falling back to exact search');
      this.index = null;
    }
  }

  addVector(neuronId: string, vector: number[]): void {
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
    } else {
      this.fallbackVectors.set(neuronId, [...vector]);
    }
    this.neuronIdMap.set(label, neuronId);
    this.idIndexMap.set(neuronId, label);
    this.tombstones.delete(neuronId);
  }

  addVectors(vectors: Array<{ id: string; vector: number[] }>): void {
    for (const item of vectors) this.addVector(item.id, item.vector);
  }

  removePoint(neuronId: string): void {
    const label = this.idIndexMap.get(neuronId);
    if (label === undefined) return;

    if (this.index) {
      try {
        this.index.markDelete(label);
      } catch (error) {
        logger.warn(`Failed to mark vector deleted for ${neuronId}:`, error);
      }
    }

    this.idIndexMap.delete(neuronId);
    this.neuronIdMap.delete(label);
    this.tombstones.add(neuronId);
    this.fallbackVectors.delete(neuronId);
  }

  search(queryVector: number[], k: number = config.vector.topK): VectorSearchResult[] {
    if (queryVector.length !== this.dimension) {
      throw new Error(`Query vector dimension mismatch: expected ${this.dimension}, got ${queryVector.length}`);
    }

    if (this.idIndexMap.size === 0) return [];

    if (this.index) {
      const rawK = Math.max(k * 3, k);
      const result = this.index.searchKnn(queryVector, Math.min(rawK, this.nextLabel));
      const ranked: VectorSearchResult[] = [];

      for (let i = 0; i < result.neighbors.length; i++) {
        const label = result.neighbors[i]!;
        const neuronId = this.neuronIdMap.get(label);
        if (!neuronId || this.tombstones.has(neuronId)) continue;
        ranked.push({
          id: neuronId,
          score: 1 - result.distances[i]!
        });
        if (ranked.length >= k) break;
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

  private cosineSimilarity(a: number[], b: number[]): number {
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

    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  size(): number {
    return this.idIndexMap.size;
  }

  getCurrentCount(): number {
    return this.size();
  }

  async saveIndex(filePath: string): Promise<void> {
    if (!this.index) return;
    await this.index.writeIndex(filePath);
    await writeFile(`${filePath}.meta.json`, JSON.stringify({
      version: 1,
      dimension: this.dimension,
      nextLabel: this.nextLabel,
      labels: [...this.neuronIdMap.entries()],
    }));
  }

  async loadIndex(filePath: string): Promise<void> {
    if (!this.index) return;
    const metadata = JSON.parse(await readFile(`${filePath}.meta.json`, 'utf8')) as {
      version?: number; dimension?: number; nextLabel?: number; labels?: Array<[number, string]>;
    };
    if (metadata.version !== 1 || metadata.dimension !== this.dimension || !Array.isArray(metadata.labels)) {
      throw new Error('vector_index_metadata_mismatch');
    }
    await this.index.readIndex(filePath);
    this.index.setEf(this.efSearch);
    this.neuronIdMap = new Map(metadata.labels);
    this.idIndexMap = new Map(metadata.labels.map(([label, neuronId]) => [neuronId, label]));
    this.nextLabel = metadata.nextLabel ?? Math.max(0, ...metadata.labels.map(([label]) => label + 1));
    this.tombstones.clear();
  }

  getStats(): VectorStoreStats {
    return {
      backend: 'hnswlib',
      size: this.size(),
      dimension: this.dimension,
      maxElements: this.maxElements,
      efConstruction: this.efConstruction,
      efSearch: this.efSearch,
      tombstones: this.tombstones.size
    };
  }

  clear(): void {
    if (HierarchicalNSWClass) {
      this.index = new HierarchicalNSWClass('cosine', this.dimension);
      this.index.initIndex(this.maxElements, 16, this.efConstruction);
      this.index.setEf(this.efSearch);
    } else {
      this.index = null;
    }
    this.neuronIdMap.clear();
    this.idIndexMap.clear();
    this.tombstones.clear();
    this.fallbackVectors.clear();
    this.nextLabel = 0;
  }

  checkIntegrity(): boolean {
    try {
      if (this.idIndexMap.size === 0) return true;
      const dummyVector = new Array(this.dimension).fill(0);
      this.search(dummyVector, 1);
      return true;
    } catch (error) {
      logger.error('Vector store integrity check failed:', error);
      return false;
    }
  }

  async rebuildIndex(neurons: Array<{ id: string; vector: number[] }>): Promise<void> {
    this.clear();
    this.addVectors(neurons);
  }

  private ensureCapacity(requiredTotal: number): void {
    if (!this.index) return;
    if (requiredTotal <= this.maxElements) return;
    let nextCapacity = this.maxElements;
    while (nextCapacity < requiredTotal) {
      nextCapacity = Math.max(nextCapacity * 2, requiredTotal);
    }
    this.index.resizeIndex(nextCapacity);
    this.maxElements = nextCapacity;
  }
}
