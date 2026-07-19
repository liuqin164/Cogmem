import Database from 'bun:sqlite';
import type { ChunkDraft, FileChunkEvidence, FileChunkRecord, FileEvidence } from './types.js';
export interface InsertChunkInput extends ChunkDraft {
    chunkId: string;
    assetId: string;
    neuronId: string;
    chunkIndex: number;
    textHash: string;
}
export declare class FileChunkStore {
    private readonly db;
    constructor(db: Database);
    initSchema(): void;
    replaceChunks(assetId: string, chunks: InsertChunkInput[]): FileChunkRecord[];
    listByAsset(assetId: string): FileChunkRecord[];
    listContext(assetId: string, chunkIndex: number, radius?: number, projectId?: string): FileChunkEvidence[];
    listEvidenceByNeuronIds(neuronIds: string[]): FileChunkEvidence[];
    groupEvidenceByAsset(evidence: FileChunkEvidence[]): FileEvidence[];
    private insertSequentialEdges;
    private mapRow;
    private mapEvidenceRow;
}
//# sourceMappingURL=FileChunkStore.d.ts.map