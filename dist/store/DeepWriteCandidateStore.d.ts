import type Database from 'bun:sqlite';
export type DeepWriteRunStatus = 'running' | 'staged' | 'succeeded' | 'failed' | 'skipped' | 'abandoned';
export type DeepWriteCandidateStatus = 'staged' | 'shadow' | 'candidate' | 'promoting' | 'promoted' | 'rejected' | 'needs_confirmation' | 'superseded';
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
    sourceEpisodeId?: string;
    dreamJobLeaseId?: string;
    leaseUntil?: number;
    attemptGeneration?: number;
    updatedAt?: number;
}
export interface DeepWriteCandidateInput {
    candidateId?: string;
    runId: string;
    candidateType: string;
    status: DeepWriteCandidateStatus;
    publishStatus?: Exclude<DeepWriteCandidateStatus, 'staged'>;
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
    after?: {
        createdAt: number;
        candidateId: string;
    };
}
export declare class DeepWriteCandidateStore {
    private readonly db;
    constructor(db: Database);
    getDatabase(): Database;
    countActivePromotions(targetType: string, targetId: string, excludingCandidateId?: string): number;
    recoverStalePromoting(before: number, updatedAt: number): number;
    initSchema(): void;
    insertRun(input: DeepWriteRunInput): DeepWriteRunRecord;
    insertCandidates(inputs: DeepWriteCandidateInput[]): DeepWriteCandidateRecord[];
    getRun(runId: string): DeepWriteRunRecord | null;
    listCandidatesByRun(runId: string): DeepWriteCandidateRecord[];
    getCandidate(candidateId: string): DeepWriteCandidateRecord | null;
    claimCandidate(candidateId: string, updatedAt?: number): boolean;
    listCandidatesByStatus(statuses: DeepWriteCandidateStatus[], options?: {
        candidateTypes?: string[];
        limit?: number;
    }): DeepWriteCandidateRecord[];
    listCandidates(options?: DeepWriteCandidateListOptions): DeepWriteCandidateRecord[];
    countCandidates(options?: Omit<DeepWriteCandidateListOptions, 'limit'>): number;
    /**
     * `promotionTarget.type` names one of three classes:
     * - the referent this candidate became or was replaced by (`fact`, `belief`, `summary`, `entity`,
     *   `graph_edge`, `replacement_candidate`); its id is the stored row's id;
     * - the locator the candidate is about (`semantic_tags`, `indexing_decision`, `semantic_relation`,
     *   `edge_adjustment`); its id is an event id (`evt-…`) or a topic path (`memory/auditability`),
     *   not a row id;
     * - the reason class, for a candidate retired without a successor (`review_queue_expiry`,
     *   `diagnostic_conclusion`); it carries no id.
     * `promotionTarget.id` is written only for a referent or a locator; a row is never its own
     * promotion target. Omitted fields keep their previous value (COALESCE below), which is what an
     * automatic closure wants: it is not replacing anything.
     */
    updateCandidateStatus(candidateId: string, status: DeepWriteCandidateStatus, promotionTarget?: {
        type?: string;
        id?: string;
        reason?: string;
        reviewAfter?: number | null;
        updatedAt?: number;
    }, expectedStatus?: DeepWriteCandidateStatus): void;
    publishStagedCandidates(runId: string, candidateIds: string[], updatedAt: number): void;
    failStagedRun(runId: string, now: number, reason: string): void;
    updateRunStatus(runId: string, expected: DeepWriteRunStatus, next: DeepWriteRunStatus): void;
    abandonStaleStagedRuns(before: number, updatedAt: number, projectId?: string): number;
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