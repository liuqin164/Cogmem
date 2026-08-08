import type Database from 'bun:sqlite';
export interface NearestNeuronEmbedding {
    neuronId: string;
    score: number;
}
export interface StoredNeuronEmbedding {
    neuronId: string;
    projectId?: string;
    modelId: string;
    dimensions: number;
    vector: Float32Array;
    updatedAt: number;
}
export declare class NeuronEmbeddingStore {
    private readonly db;
    constructor(db: Database);
    initSchema(): void;
    upsert(neuronId: string, modelId: string, vector: Float32Array, projectId?: string): boolean;
    private hasTable;
    getProgress(): {
        total: number;
        completed: number;
        failed: number;
        lastUpdatedAt: string;
    };
    findNearest(queryVector: Float32Array, projectId: string | undefined, topK: number, modelId?: string): NearestNeuronEmbedding[];
    hasStaleVectors(currentModelId: string): boolean;
    countStaleVectors(currentModelId: string, projectId?: string): number;
    listStaleNeuronIds(currentModelId: string, projectId: string, afterNeuronId: string, limit: number): string[];
    listProjectsWithStaleVectors(currentModelId: string): string[];
    deleteNeuronEmbedding(neuronId: string, modelId?: string): void;
    deleteStaleEmbeddingsForNeuron(neuronId: string, currentModelId: string): void;
    listLatestEmbeddings(): StoredNeuronEmbedding[];
    private readRows;
    private lookupProjectId;
    private ensureProgressColumns;
    private readCount;
}
//# sourceMappingURL=NeuronEmbeddingStore.d.ts.map