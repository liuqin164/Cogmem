import Database from 'bun:sqlite';
export type SummaryScope = 'turn_window' | 'session' | 'day' | 'project';
export type SummaryStatus = 'provisional' | 'verified' | 'superseded' | 'rejected';
export interface SummaryRecord {
    summaryId: string;
    projectId?: string;
    sessionId?: string;
    scope: SummaryScope;
    windowStart?: number;
    windowEnd?: number;
    text: string;
    confidence: number;
    status: SummaryStatus;
    sourceNeuronIds: string[];
    deepWriteRunId?: string;
    deepWriteCandidateId?: string;
    createdAt: number;
    updatedAt: number;
    supersededBySummaryId?: string;
}
export interface SummaryInput {
    summaryId?: string;
    projectId?: string;
    sessionId?: string;
    scope: SummaryScope;
    windowStart?: number;
    windowEnd?: number;
    text: string;
    confidence: number;
    status: SummaryStatus;
    sourceNeuronIds: string[];
    deepWriteRunId?: string;
    deepWriteCandidateId?: string;
    createdAt?: number;
    updatedAt?: number;
}
export declare class SummaryStore {
    private readonly db;
    constructor(dbOrPath?: Database | string);
    initSchema(): void;
    migrateLegacyFactSummaries(): number;
    insertSummary(input: SummaryInput): SummaryRecord;
    getById(id: string): SummaryRecord | null;
    listByProject(projectId: string, options?: {
        scope?: SummaryScope;
        limit?: number;
    }): SummaryRecord[];
    listBySession(sessionId: string, projectId: string, options?: {
        limit?: number;
    }): SummaryRecord[];
    findRelevant(query: string, projectId?: string, limit?: number): SummaryRecord[];
    markSuperseded(summaryId: string, supersededBySummaryId?: string): SummaryRecord | null;
    private fallbackFindRelevant;
    private mapRow;
}
//# sourceMappingURL=SummaryStore.d.ts.map