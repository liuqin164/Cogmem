export interface VectorSearchResult {
    id: string;
    score: number;
}
export interface VectorStoreStats {
    backend: VectorBackend;
    size: number;
    dimension: number;
    maxElements?: number;
    efConstruction?: number;
    efSearch?: number;
    tombstones?: number;
}
export type VectorBackend = 'hnswlib' | 'sqlite-vec';
export interface IVectorStore {
    addVector(neuronId: string, vector: number[]): void;
    addVectors?(vectors: Array<{
        id: string;
        vector: number[];
    }>): void;
    removePoint(neuronId: string): void;
    search(queryVector: number[], k: number): VectorSearchResult[];
    getStats(): VectorStoreStats;
    getCurrentCount(): number;
    clear(): void;
    checkIntegrity?(): boolean;
    rebuildIndex(neurons: Array<{
        id: string;
        vector: number[];
    }>): Promise<void>;
}
//# sourceMappingURL=IVectorStore.d.ts.map