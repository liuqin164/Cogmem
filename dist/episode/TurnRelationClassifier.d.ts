import type { EpisodeCandidateType, EpisodeType, TurnRelation } from './EpisodeTypes.js';
export interface TurnClassificationContext {
    currentUserText?: string;
    currentAssistantText?: string;
    previousUserText?: string;
    previousAssistantText?: string;
    activeEpisodeSummary?: string;
    activeEpisodeTopicPath?: string;
    currentTopicPath?: string;
    recentRelations?: TurnRelation[];
    topicPathMatch?: boolean;
    entityOverlap?: number;
    projectMatch?: boolean;
    semanticSimilarity?: number;
}
export interface TurnRelationDecision {
    relation: TurnRelation;
    confidence: number;
    signals: string[];
    needsLlmReview: boolean;
    candidateTypes: EpisodeCandidateType[];
    topicPath?: string;
    closureCandidate: boolean;
    switchKind?: 'hard' | 'subtopic' | 'ambiguous';
    episodeType: EpisodeType;
    importance: number;
    importanceSignals: string[];
    rationale: string;
}
export interface TurnRelationAdvisoryReviewer {
    review(input: {
        context: TurnClassificationContext;
        cpuDecision: TurnRelationDecision;
    }): Promise<unknown>;
}
export type TurnRelationReviewStatus = 'not_invoked' | 'accepted' | 'failed' | 'invalid' | 'stale_ignored';
export interface TurnRelationHybridTrace {
    cpuDecision: TurnRelationDecision;
    reviewerInvoked: boolean;
    reviewerRawResultStatus: TurnRelationReviewStatus;
    reviewerDecision?: TurnRelationDecision;
    finalDecision: TurnRelationDecision;
}
export declare function classifyTurnRelation(input: string | TurnClassificationContext): TurnRelationDecision;
export declare function classifyAssistantRelation(text: string, role?: string): TurnRelation;
/** Background-only semantic review. The reviewer can suggest classification fields but cannot mutate memory. */
export declare function classifyTurnRelationHybrid(context: TurnClassificationContext, reviewer?: TurnRelationAdvisoryReviewer): Promise<TurnRelationDecision>;
export declare function classifyTurnRelationHybridTrace(context: TurnClassificationContext, reviewer?: TurnRelationAdvisoryReviewer): Promise<TurnRelationHybridTrace>;
//# sourceMappingURL=TurnRelationClassifier.d.ts.map