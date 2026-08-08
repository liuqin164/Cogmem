import type { SnapshotMeta } from './SnapshotHeader.js';
export interface SnapshotExporterOptions {
    embeddingDimension: number;
    coreVersion?: string;
}
export declare class SnapshotExporter {
    private readonly options;
    constructor(options: SnapshotExporterOptions);
    export(dbPath: string, outputPath: string): Promise<SnapshotMeta>;
    private removeForgottenRows;
    private readSchemaVersion;
    private readNeuronCount;
}
//# sourceMappingURL=SnapshotExporter.d.ts.map