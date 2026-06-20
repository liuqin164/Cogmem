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

export class ContextPolicyScorer {
  score(outcomes: StrategyRolloutOutcome[]): ContextPolicyScore {
    if (outcomes.length === 0) throw new Error('strategy_outcomes_required');
    const first = outcomes[0];
    const scores = outcomes.map((item) => item.score).sort((a, b) => a - b);
    const topCount = Math.max(1, Math.ceil(scores.length * 0.5));
    const worstCount = Math.max(1, Math.ceil(scores.length * 0.1));
    const score: ContextPolicyScore = {
      strategyId: first.strategyId,
      strategyTemplate: first.strategyTemplate,
      intent: first.intent,
      sampleCount: outcomes.length,
      medianScore: quantile(scores, 0.5),
      topFractionScore: mean(scores.slice(-topCount)),
      worstDecileScore: mean(scores.slice(0, worstCount)),
      sourceFidelityRate: mean(outcomes.map((item) => item.sourceFidelity)),
      unsafeLeakRate: rate(outcomes, (item) => item.unsafeLeak),
      overBudgetRate: rate(outcomes, (item) => item.overBudget),
      staleLeakageRate: rate(outcomes, (item) => item.staleLeak),
      crossProjectLeakageRate: rate(outcomes, (item) => item.crossProjectLeak),
      strategyAdherenceRate: rate(outcomes, (item) => item.followedStrategy),
      latencyP95Ms: quantile(outcomes.map((item) => item.latencyMs).sort((a, b) => a - b), 0.95),
      passed: false,
      failedGates: [],
    };
    const gates: Array<[string, boolean]> = [
      ['medianScore', score.medianScore >= 0.8],
      ['worstDecileScore', score.worstDecileScore >= 0.5],
      ['sourceFidelityRate', score.sourceFidelityRate === 1],
      ['unsafeLeakRate', score.unsafeLeakRate === 0],
      ['overBudgetRate', score.overBudgetRate === 0],
      ['staleLeakageRate', score.staleLeakageRate === 0],
      ['crossProjectLeakageRate', score.crossProjectLeakageRate === 0],
      ['strategyAdherenceRate', score.strategyAdherenceRate >= 0.95],
      ['latencyP95Ms', score.latencyP95Ms <= 250],
    ];
    score.failedGates = gates.filter(([, passed]) => !passed).map(([name]) => name);
    score.passed = score.failedGates.length === 0;
    return score;
  }
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate<T>(values: T[], predicate: (value: T) => boolean): number {
  return values.length === 0 ? 0 : values.filter(predicate).length / values.length;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}
