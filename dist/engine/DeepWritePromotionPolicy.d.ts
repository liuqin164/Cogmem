import type { BeliefStore } from '../belief/BeliefStore.js';
import type { FactStore } from '../store/FactStore.js';
import type { EntityStore } from '../store/EntityStore.js';
import type { SummaryStore } from '../store/SummaryStore.js';
import type { GraphEdgeStoreLike } from '../types/ExtensionPoints.js';
import { DeepWriteCandidateStore, type DeepWriteCandidateRecord } from '../store/DeepWriteCandidateStore.js';
export type DeepWritePromotionOutcome = 'promote_provisional' | 'promote_verified' | 'needs_confirmation' | 'keep_candidate' | 'reject';
export interface DeepWritePromotionDecision {
    outcome: DeepWritePromotionOutcome;
    reason: string;
    targetType?: string;
    targetId?: string;
}
export interface DeepWritePromotionPolicyDeps {
    candidateStore: DeepWriteCandidateStore;
    factStore?: FactStore;
    beliefStore?: BeliefStore;
    entityStore?: EntityStore;
    summaryStore?: SummaryStore;
    relationStore?: GraphEdgeStoreLike;
    minPromoteConfidence: number;
    promoteCausalLinks?: boolean;
}
export interface DeepWritePromotionOptions {
    projectId?: string;
}
export interface DeepWriteEvaluationOptions {
    reviewConfirmed?: boolean;
}
export declare class DeepWritePromotionPolicy {
    private readonly deps;
    constructor(deps: DeepWritePromotionPolicyDeps);
    promoteRun(runId: string): DeepWritePromotionDecision[];
    promotePending(limit?: number, options?: DeepWritePromotionOptions): DeepWritePromotionDecision[];
    evaluateAndApply(candidate: DeepWriteCandidateRecord, options?: DeepWriteEvaluationOptions): DeepWritePromotionDecision;
    private promoteOrganizationCandidate;
    private promoteFact;
    private promoteSummary;
    private promoteRelation;
    private promoteCausalLink;
    private promoteGraphEdge;
    private resolveEntity;
    private promotePreference;
    private promoteEntity;
    private keep;
    private mark;
}
//# sourceMappingURL=DeepWritePromotionPolicy.d.ts.map