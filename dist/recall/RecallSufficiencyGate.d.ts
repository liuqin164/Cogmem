import type { BrainRecallResult } from '../types/BrainRecallResult.js';
export interface RecallSufficiencyInput {
    query: string;
    layer1Result: BrainRecallResult;
    recentTurns: Array<{
        role: 'user' | 'assistant';
        content: string;
        timestamp: number;
    }>;
    projectId?: string;
}
export interface RecallSufficiencySignals {
    coverage: number;
    topConfidence: number;
    coReferenceHit: boolean;
    topicalDriftHit: boolean;
}
export interface RecallSufficiencyDecision {
    sufficient: boolean;
    reason: string;
    signals: RecallSufficiencySignals;
    suggestedFollowupQueries: string[];
}
export interface RecallSufficiencyGateConfig {
    coverageThreshold: number;
    topConfidenceThreshold: number;
    maxSuggestedFollowups: number;
}
export declare class RecallSufficiencyGate {
    private readonly config;
    private readonly compiler;
    constructor(config?: Partial<RecallSufficiencyGateConfig>);
    evaluate(input: RecallSufficiencyInput): RecallSufficiencyDecision;
    private calculateTopConfidence;
    private detectTopicalDrift;
    private buildDriftContext;
    private buildFollowups;
    private collectEvidenceText;
}
//# sourceMappingURL=RecallSufficiencyGate.d.ts.map