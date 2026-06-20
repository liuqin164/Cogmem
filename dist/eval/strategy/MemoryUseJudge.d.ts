import type { ContextIntent, ContextLayer } from '../../context/ContextCortex.js';
import type { StrategyCapsule, StrategyTemplateId } from '../../strategy/StrategyCapsule.js';
export type MemoryUseViolation = 'exact_quote_without_source' | 'superseded_memory_used' | 'cross_project_memory_used' | 'assistant_only_user_belief' | 'memory_budget_exceeded' | 'required_layer_missing' | 'strategy_layer_mismatch' | 'unconfirmed_prospective_used' | 'strategy_context_persisted';
export interface JudgedMemorySelection {
    id: string;
    layer: ContextLayer;
    hasSourceEvidence: boolean;
    superseded?: boolean;
    crossProject?: boolean;
    ownership?: 'user' | 'project' | 'system';
    sourceRoles?: string[];
    prospectiveConfirmed?: boolean;
    containsStrategyContext?: boolean;
}
export interface MemoryUseJudgeInput {
    receiptId: string;
    capsule: StrategyCapsule;
    selected: JudgedMemorySelection[];
    usedTokens: number;
    budgetTokens: number;
    latencyMs: number;
    exactSourceMatched?: boolean;
    createdAt?: number;
}
export interface StrategyRolloutOutcome {
    outcomeId: string;
    receiptId: string;
    projectId?: string;
    strategyId: string;
    strategyTemplate: StrategyTemplateId;
    intent: ContextIntent;
    score: number;
    followedStrategy: boolean;
    violations: MemoryUseViolation[];
    usefulMemoryIds: string[];
    harmfulMemoryIds: string[];
    missingLayers: ContextLayer[];
    sourceFidelity: number;
    unsafeLeak: boolean;
    staleLeak: boolean;
    crossProjectLeak: boolean;
    overBudget: boolean;
    latencyMs: number;
    createdAt: number;
}
export declare class MemoryUseJudge {
    judge(input: MemoryUseJudgeInput): StrategyRolloutOutcome;
}
//# sourceMappingURL=MemoryUseJudge.d.ts.map