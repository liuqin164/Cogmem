import { ContextPolicyScorer, type ContextPolicyScore } from './ContextPolicyScorer.js';
import type { StrategyRolloutOutcome } from './MemoryUseJudge.js';
export interface StrategyRolloutReport {
    strategyCount: number;
    rolloutCount: number;
    generatedOnlineRollouts: 0;
    passed: boolean;
    ranking: ContextPolicyScore[];
}
export declare class StrategyRolloutEvaluator {
    private readonly scorer;
    constructor(scorer?: ContextPolicyScorer);
    evaluate(outcomes: StrategyRolloutOutcome[]): StrategyRolloutReport;
}
//# sourceMappingURL=StrategyRolloutEvaluator.d.ts.map