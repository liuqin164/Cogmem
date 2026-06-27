import type Database from 'bun:sqlite';
import type { DeepWritePromotionDecision, DeepWritePromotionPolicy } from '../engine/DeepWritePromotionPolicy.js';
import type { MemoryEvent } from '../types/index.js';
import type { CandidateReviewAction, CandidateReviewRecord, CandidateReviewStore } from '../store/CandidateReviewStore.js';
import type { DeepWriteCandidateRecord, DeepWriteCandidateStore } from '../store/DeepWriteCandidateStore.js';
export interface CandidateReviewInput {
    candidateId: string;
    projectId: string;
    action: CandidateReviewAction;
    actor: string;
    reason: string;
    confirmationEventId?: string;
    targetBeliefId?: string;
    replacementCandidateId?: string;
    reviewAfter?: number;
}
export interface CandidateReviewResult {
    review: CandidateReviewRecord;
    candidate: DeepWriteCandidateRecord;
    decision?: DeepWritePromotionDecision;
}
export declare class CandidateReviewService {
    private readonly db;
    private readonly candidates;
    private readonly reviews;
    private readonly promotion;
    private readonly eventLookup;
    constructor(db: Database, candidates: DeepWriteCandidateStore, reviews: CandidateReviewStore, promotion: DeepWritePromotionPolicy, eventLookup: (eventId: string) => MemoryEvent | null);
    review(input: CandidateReviewInput): CandidateReviewResult;
    private requireUserConfirmation;
    private requireReplacement;
}
//# sourceMappingURL=CandidateReviewService.d.ts.map