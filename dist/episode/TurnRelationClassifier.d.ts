import type { EpisodeCandidateType, EpisodeType, TurnRelation } from './EpisodeTypes.js';
export interface TurnClassificationContext {
    currentUserText?: string;
    currentAssistantText?: string;
    previousUserText?: string;
    previousAssistantText?: string;
    activeEpisodeSummary?: string;
    activeEpisodeTopicPath?: string;
    recentRelations?: TurnRelation[];
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
    rationale: string;
}
export interface TurnRelationAdvisoryReviewer {
    review(input: {
        context: TurnClassificationContext;
        cpuDecision: TurnRelationDecision;
    }): Promise<unknown>;
}
export declare function classifyTurnRelation(input: string | TurnClassificationContext): TurnRelationDecision;
export declare function classifyAssistantRelation(text: string, role?: string): TurnRelation;
/** Background-only semantic review. The reviewer can suggest classification fields but cannot mutate memory. */
export declare function classifyTurnRelationHybrid(context: TurnClassificationContext, reviewer?: TurnRelationAdvisoryReviewer): Promise<TurnRelationDecision>;
//# sourceMappingURL=TurnRelationClassifier.d.ts.map