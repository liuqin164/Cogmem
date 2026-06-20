import type { EpisodeType, TurnRelation } from './EpisodeTypes.js';
export interface TurnRelationDecision {
    relation: TurnRelation;
    confidence: number;
    episodeType: EpisodeType;
    importance: number;
    rationale: string;
}
export declare function classifyTurnRelation(text: string): TurnRelationDecision;
//# sourceMappingURL=TurnRelationClassifier.d.ts.map