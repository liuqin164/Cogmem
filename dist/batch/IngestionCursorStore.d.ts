import type { SourceAdapterKind, SourceDefinition } from '../adapters/types.js';
export interface IngestionSourceCursor {
    sourceId: string;
    sourcePath: string;
    sourceType: SourceAdapterKind;
    projectId?: string;
    enabled: boolean;
    lastProcessedAt?: number;
    lastSeenHash?: string;
    lastSeenMtime?: number;
    contentWindowStart?: number;
    contentWindowEnd?: number;
    updatedAt: number;
}
export interface ProcessedSourceRecord {
    recordHash: string;
    sourceId: string;
    sourcePath: string;
    sourceType: SourceAdapterKind;
    contentHash: string;
    contentWindowStart: number;
    contentWindowEnd: number;
    processedAt: number;
    neuronId?: string;
}
export declare class IngestionCursorStore {
    private db;
    private closed;
    constructor(dbPath?: string);
    private initializeSchema;
    registerSource(source: SourceDefinition): void;
    listRegisteredSources(): IngestionSourceCursor[];
    getCursor(sourceId: string): IngestionSourceCursor | null;
    hasProcessedRecord(recordHash: string): boolean;
    markRecordProcessed(record: ProcessedSourceRecord): void;
    updateCursor(input: {
        sourceId: string;
        sourcePath: string;
        sourceType: SourceAdapterKind;
        projectId?: string;
        lastProcessedAt: number;
        lastSeenHash: string;
        lastSeenMtime: number;
        contentWindowStart: number;
        contentWindowEnd: number;
    }): void;
    listProcessedRecordHashes(sourceId: string, windowStart: number, windowEnd: number): Set<string>;
    listRecentUnprocessedSources(since: number): IngestionSourceCursor[];
    close(): void;
    private mapCursor;
}
//# sourceMappingURL=IngestionCursorStore.d.ts.map