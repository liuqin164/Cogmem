import type { IVectorStore, VectorSearchResult, VectorStoreStats } from './IVectorStore.js';
export declare class VectorStore implements IVectorStore {
    private index;
    private dimension;
    private maxElements;
    private efConstruction;
    private efSearch;
    private neuronIdMap;
    private idIndexMap;
    private tombstones;
    private fallbackVectors;
    private nextLabel;
    private deletedLabelCount;
    constructor(dimension?: number, maxElements?: number, efConstruction?: number, efSearch?: number);
    addVector(neuronId: string, vector: number[]): void;
    addVectors(vectors: Array<{
        id: string;
        vector: number[];
    }>): void;
    removePoint(neuronId: string): void;
    search(queryVector: number[], k?: number): VectorSearchResult[];
    private cosineSimilarity;
    size(): number;
    getCurrentCount(): number;
    saveIndex(filePath: string): Promise<void>;
    loadIndex(filePath: string): Promise<void>;
    getStats(): VectorStoreStats;
    clear(): void;
    checkIntegrity(): boolean;
    rebuildIndex(neurons: Array<{
        id: string;
        vector: number[];
    }>): Promise<void>;
    private ensureCapacity;
    private compactIfNeeded;
}
//# sourceMappingURL=VectorStore.d.ts.map