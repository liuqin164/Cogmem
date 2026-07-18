import type Database from 'bun:sqlite';
export declare function dreamLedgerProjectKey(projectId?: string): string;
export interface DreamBacklogStatus {
    projectId?: string;
    rawEventCount: number;
    dreamedRawCount: number;
    undreamedRawCount: number;
    dreamCoverageRate: number;
    lastDreamedGlobalSeq?: number;
    lastDreamedAt?: number;
    updatedAt?: number;
}
export declare class DreamLedgerStore {
    private readonly db;
    constructor(db: Database);
    getStatus(projectId?: string): DreamBacklogStatus;
    markDreamed(projectId: string | undefined, globalSeq: number, dreamedAt?: number): DreamBacklogStatus;
    private initializeSchema;
    private getState;
    private countRawEvents;
}
//# sourceMappingURL=DreamLedgerStore.d.ts.map