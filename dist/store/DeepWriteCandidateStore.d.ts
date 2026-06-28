import type Database from 'bun:sqlite';
export type DeepWriteRunStatus = 'succeeded' | 'failed' | 'skipped';
export type DeepWriteCandidateStatus = 'shadow' | 'candidate' | 'promoted' | 'rejected' | 'needs_confirmation' | 'superseded';
export interface DeepWriteRunInput {
    runId?: string;
    projectId?: string;
    sessionId?: string;
    sourceNeuronIds: string[];
    modelProvider?: string;
    modelName?: string;
    mode: string;
    promptHash: string;
    outputHash: string;
    status: DeepWriteRunStatus;
    error?: string;
    createdAt?: number;
}
export interface DeepWriteCandidateInput {
    candidateId?: string;
    runId: string;
    candidateType: string;
    status: DeepWriteCandidateStatus;
    confidence: number;
    content: unknown;
    evidence: unknown;
    promotionTargetType?: string;
    promotionTargetId?: string;
    statusReason?: string;
    reviewAfter?: number;
    createdAt?: number;
}
export interface DeepWriteRunRecord extends DeepWriteRunInput {
    runId: string;
    createdAt: number;
}
export interface DeepWriteCandidateRecord extends DeepWriteCandidateInput {
    candidateId: string;
    createdAt: number;
    updatedAt: number;
}
export interface DeepWriteCandidateListOptions {
    statuses?: DeepWriteCandidateStatus[];
    candidateTypes?: string[];
    projectId?: string;
    runId?: string;
    limit?: number;
}
export declare class DeepWriteCandidateStore {
    private readonly db;
    constructor(db: Database);
    initSchema(): void;
    insertRun(input: DeepWriteRunInput): DeepWriteRunRecord;
    insertCandidates(inputs: DeepWriteCandidateInput[]): DeepWriteCandidateRecord[];
    getRun(runId: string): DeepWriteRunRecord | null;
    listCandidatesByRun(runId: string): DeepWriteCandidateRecord[];
    getCandidate(candidateId: string): DeepWriteCandidateRecord | null;
    listCandidatesByStatus(statuses: DeepWriteCandidateStatus[], options?: {
        candidateTypes?: string[];
        limit?: number;
    }): DeepWriteCandidateRecord[];
    listCandidates(options?: DeepWriteCandidateListOptions): DeepWriteCandidateRecord[];
    countCandidates(options?: Omit<DeepWriteCandidateListOptions, 'limit'>): number;
    updateCandidateStatus(candidateId: string, status: DeepWriteCandidateStatus, promotionTarget?: {
        type?: string;
        id?: string;
        reason?: string;
        reviewAfter?: number | null;
        updatedAt?: number;
    }): void;
    updateCandidateReviewData(candidateId: string, input: {
        content: unknown;
        evidence: unknown;
        promotionTargetType?: string;
        promotionTargetId?: string;
        status: DeepWriteCandidateStatus;
        statusReason: string;
        reviewAfter?: number | null;
        updatedAt?: number;
    }): void;
    expireNeedsConfirmation(input: {
        projectId?: string;
        before: number;
        now?: number;
        limit?: number;
    }): {
        expired: number;
        candidateIds: string[];
        cutoff: number;
    };
    private mapRun;
    private mapCandidate;
    private ensureColumn;
}
//# sourceMappingURL=DeepWriteCandidateStore.d.ts.map