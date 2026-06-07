export type AgentRecallIntent = 'memory_recall' | 'previous_session_summary' | 'forensic_quote';
export interface AgentRecallQueryCompileInput {
    query: string;
    intent?: AgentRecallIntent;
    anchorText?: string;
}
export interface AgentRecallQueryPlan {
    originalQuery: string;
    intent: AgentRecallIntent;
    primarySearchText: string;
    searchTexts: string[];
    keywords: string[];
    anchorUsed: boolean;
}
export declare function compileAgentRecallQuery(input: AgentRecallQueryCompileInput): AgentRecallQueryPlan;
export declare function inferAgentRecallIntent(query: string): AgentRecallIntent;
export declare function extractRecallKeywords(text: string): string[];
//# sourceMappingURL=AgentRecallQueryCompiler.d.ts.map