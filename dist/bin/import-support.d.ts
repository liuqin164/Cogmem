import { type SourceAdapterDiagnostic, type SourceAdapterKind } from '../adapters/index.js';
type AgentKind = 'openclaw' | 'hermes';
export interface ParsedArgs {
    values: Record<string, string | boolean>;
    lists: Record<string, string[]>;
}
export interface AgentImportResult {
    agent: AgentKind;
    workspaceRoot: string;
    projectId: string;
    dbPath?: string;
    dryRun: boolean;
    window: {
        start: number;
        end: number;
        label: string;
    };
    sourcesScanned: number;
    sourcesChanged: number;
    recordsParsed: number;
    recordsWouldIngest: number;
    recordsIngested: number;
    skippedRecords: number;
    rawRecordsAnchored?: number;
    emptyEpisodesSkipped?: number;
    reindexRaw?: boolean;
    processedSourceIds: string[];
    diagnostics: SourceAdapterDiagnostic[];
    sourceResults: Array<{
        sourceId: string;
        sourcePath: string;
        adapterKind: SourceAdapterKind;
        recordsParsed: number;
        recordsWouldIngest: number;
        recordsIngested: number;
        skippedRecords: number;
        diagnostics: SourceAdapterDiagnostic[];
    }>;
}
export declare function parseArgs(argv: string[]): ParsedArgs;
export declare function runOpenClawImport(argv: string[]): Promise<void>;
export declare function runHermesImport(argv: string[]): Promise<void>;
export {};
//# sourceMappingURL=import-support.d.ts.map