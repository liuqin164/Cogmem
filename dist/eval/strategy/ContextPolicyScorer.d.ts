import type { ContextIntent } from '../../context/ContextCortex.js';
import type { StrategyTemplateId } from '../../strategy/StrategyCapsule.js';
import type { StrategyRolloutOutcome } from './MemoryUseJudge.js';
export interface ContextPolicyScore {
    strategyId: string;
    strategyTemplate: StrategyTemplateId;
    intent: ContextIntent;
    sampleCount: number;
    medianScore: number;
    topFractionScore: number;
    worstDecileScore: number;
    sourceFidelityRate: number;
    unsafeLeakRate: number;
    overBudgetRate: number;
    staleLeakageRate: number;
    crossProjectLeakageRate: number;
    strategyAdherenceRate: number;
    latencyP95Ms: number;
    passed: boolean;
    failedGates: string[];
}
export declare class ContextPolicyScorer {
    score(outcomes: StrategyRolloutOutcome[]): ContextPolicyScore;
}
//# sourceMappingURL=ContextPolicyScorer.d.ts.map