import type { IngestInput, Neuron } from '../types/index.js';
import { type SourceAdapterDiagnostic, type SourceDefinition } from '../adapters/index.js';
import type { IngestionCursorStore } from './IngestionCursorStore.js';
import type { OfflineConsolidationOutput } from '../engine/OfflineConsolidationPipeline.js';
export interface BatchConsolidationWindow {
    start: number;
    end: number;
    label: string;
}
export interface BatchConsolidationRunOptions {
    window: BatchConsolidationWindow;
    sources?: SourceDefinition[];
}
export interface BatchConsolidationSummary {
    window: BatchConsolidationWindow;
    sourcesScanned: number;
    sourcesChanged: number;
    recordsParsed: number;
    recordsIngested: number;
    skippedRecords: number;
    processedSourceIds: string[];
    adapterDiagnostics: SourceAdapterDiagnostic[];
    sourceResults: BatchSourceResult[];
    offline: OfflineConsolidationOutput;
}
export interface BatchSourceResult {
    sourceId: string;
    sourcePath: string;
    adapterKind: SourceDefinition['adapterKind'];
    recordsParsed: number;
    recordsIngested: number;
    skippedRecords: number;
    diagnostics: SourceAdapterDiagnostic[];
}
export type BatchProgressEvent = {
    stage: 'source:start';
    sourceIndex: number;
    totalSources: number;
    sourcePath: string;
    adapterKind: SourceDefinition['adapterKind'];
} | {
    stage: 'source:parsed';
    sourceIndex: number;
    totalSources: number;
    sourcePath: string;
    adapterKind: SourceDefinition['adapterKind'];
    recordsParsed: number;
    pendingRecords: number;
    skippedRecords: number;
} | {
    stage: 'source:ingest:start';
    sourceIndex: number;
    totalSources: number;
    sourcePath: string;
    adapterKind: SourceDefinition['adapterKind'];
    pendingRecords: number;
} | {
    stage: 'source:ingest:complete';
    sourceIndex: number;
    totalSources: number;
    sourcePath: string;
    adapterKind: SourceDefinition['adapterKind'];
    ingestedRecords: number;
    totalRecordsIngested: number;
} | {
    stage: 'offline:start';
    recordsIngested: number;
} | {
    stage: 'offline:complete';
    recordsIngested: number;
};
interface InstalledBatchProcessorDependencies {
    cursorStore: IngestionCursorStore;
    ingestBatch: (inputs: IngestInput[]) => Promise<Neuron[]>;
    runOfflineWindow: (window: BatchConsolidationWindow) => Promise<OfflineConsolidationOutput>;
    onProgress?: (event: BatchProgressEvent) => void;
}
export declare class InstalledBatchProcessor {
    private readonly deps;
    private readonly loader;
    private readonly adapters;
    constructor(deps: InstalledBatchProcessorDependencies);
    runOnce(options: BatchConsolidationRunOptions): Promise<BatchConsolidationSummary>;
}
export {};
//# sourceMappingURL=InstalledBatchProcessor.d.ts.map