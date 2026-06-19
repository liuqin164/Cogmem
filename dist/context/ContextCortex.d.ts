import Database from 'bun:sqlite';
export type ContextIntent = 'greeting' | 'short_followup' | 'exact_quote' | 'decision_history' | 'preference_lookup' | 'project_status' | 'debugging' | 'general_memory';
export type ContextLayer = 'session_state' | 'turn_bridge' | 'belief' | 'temporal' | 'graph' | 'raw_source' | 'vector';
export interface ContextCandidate {
    id: string;
    layer: ContextLayer;
    content: string;
    estimatedTokens?: number;
    confidence?: number;
    projectId?: string;
    sessionId?: string;
    ownership?: 'user' | 'project' | 'system';
    sourceRoles?: string[];
    sensitive?: boolean;
    superseded?: boolean;
}
export type ContextSuppressionReason = 'intent_suppresses_memory' | 'layer_not_activated' | 'project_boundary' | 'superseded' | 'current_session_echo' | 'user_belief_without_user_evidence' | 'sensitive_without_need' | 'budget_exceeded' | 'duplicate';
export interface ContextActivationReceipt {
    receiptId: string;
    query: string;
    intent: ContextIntent;
    projectId?: string;
    budgetTokens: number;
    usedTokens: number;
    selected: Array<{
        id: string;
        layer: ContextLayer;
        tokens: number;
        reason: string;
    }>;
    suppressed: Array<{
        id: string;
        layer: ContextLayer;
        reason: ContextSuppressionReason;
    }>;
    createdAt: number;
}
export interface ContextPlanInput {
    query: string;
    candidates: ContextCandidate[];
    availableTokens: number;
    maxMemoryRatio?: number;
    projectId?: string;
    currentSessionId?: string;
    topicRelation?: 'same' | 'new' | 'unknown';
    allowSensitive?: boolean;
}
export interface ContextActivationPlan {
    intent: ContextIntent;
    budgetTokens: number;
    usedTokens: number;
    selected: ContextCandidate[];
    receipt: ContextActivationReceipt;
}
export declare class ContextCortex {
    private readonly db?;
    constructor(db?: Database | undefined);
    classifyIntent(query: string): ContextIntent;
    plan(input: ContextPlanInput): ContextActivationPlan;
    getReceipt(receiptId: string): ContextActivationReceipt | null;
    private hardSuppressionReason;
    private estimateTokens;
    private persistReceipt;
    private initializeSchema;
}
//# sourceMappingURL=ContextCortex.d.ts.map