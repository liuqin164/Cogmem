export interface ConversationTurn {
    turn: number;
    createdAt: number;
    type: 'chat' | 'doc' | 'agent_observation';
    content: string;
    groundTruth: string[];
    scene: 'normal' | 'approval_pause' | 'context_switch' | 'critical_anchor';
    factKey?: string;
    factValue?: string;
    isSuperseded?: boolean;
    canonicalFactKey?: string;
}
export interface RecallCase {
    id: string;
    query: string;
    relevantPhrases: string[];
    supersededPhrases: string[];
    canonicalPhrases: string[];
    minimalContext: string[];
    anchorTurn: number;
    critical: boolean;
}
export interface ConversationDataset {
    name: string;
    projectId: string;
    turns: 10 | 50 | 200;
    history: string[];
    conversation: ConversationTurn[];
    recallCases: RecallCase[];
    criticalFacts: Array<{
        query: string;
        expectedPhrases: string[];
        anchorTurn: number;
    }>;
    hasApprovalPause: boolean;
    hasContextSwitch: boolean;
    startedAt: number;
}
export declare function generateSyntheticConversation(turns: 10 | 50 | 200): ConversationDataset;
//# sourceMappingURL=synthetic_long_conversation.d.ts.map