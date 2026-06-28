import type Database from 'bun:sqlite';
import type { DeepWriteCandidateStatus } from './DeepWriteCandidateStore.js';
export type CandidateReviewAction = 'approve' | 'reject' | 'defer' | 'supersede' | 'relink';
export interface CandidateReviewRecord {
    reviewId: string;
    candidateId: string;
    projectId?: string;
    action: CandidateReviewAction;
    actor: string;
    reason: string;
    fromStatus: DeepWriteCandidateStatus;
    toStatus: DeepWriteCandidateStatus;
    confirmationEventId?: string;
    targetBeliefId?: string;
    replacementCandidateId?: string;
    reviewAfter?: number;
    decision: Record<string, unknown>;
    createdAt: number;
}
export declare class CandidateReviewStore {
    private readonly db;
    constructor(db: Database);
    insert(input: Omit<CandidateReviewRecord, 'reviewId' | 'createdAt'> & {
        reviewId?: string;
        createdAt?: number;
    }): CandidateReviewRecord;
    list(options?: {
        projectId?: string;
        candidateId?: string;
        limit?: number;
    }): CandidateReviewRecord[];
}
//# sourceMappingURL=CandidateReviewStore.d.ts.map