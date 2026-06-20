import { describe, expect, test } from 'bun:test';

import {
  ContextPolicyScorer,
  StrategyDiversitySelector,
  StrategyRolloutEvaluator,
  type StrategyRolloutOutcome,
} from '../src/eval/strategy/index.js';

function outcome(input: Partial<StrategyRolloutOutcome> = {}): StrategyRolloutOutcome {
  return {
    outcomeId: crypto.randomUUID(), receiptId: crypto.randomUUID(), strategyId: 'source-first',
    strategyTemplate: 'source-first', intent: 'exact_quote', score: 1, followedStrategy: true,
    violations: [], usefulMemoryIds: ['raw'], harmfulMemoryIds: [], missingLayers: [],
    sourceFidelity: 1, unsafeLeak: false, staleLeak: false, crossProjectLeak: false,
    overBudget: false, latencyMs: 20, createdAt: Date.now(), ...input,
  };
}

describe('offline strategy policy evaluation', () => {
  test('selects semantically different strategy candidates by farthest point', () => {
    const selected = new StrategyDiversitySelector().select([
      { id: 'belief-a', vector: [1, 0] },
      { id: 'belief-b', vector: [0.99, 0.01] },
      { id: 'source', vector: [0, 1] },
    ], 2);
    expect(selected.map((item) => item.id)).toContain('source');
    expect(selected.filter((item) => item.id.startsWith('belief-'))).toHaveLength(1);
  });

  test('reports top-fraction potential but fails a policy with any unsafe leakage', () => {
    const outcomes = [
      outcome({ score: 1 }), outcome({ score: 0.95 }),
      outcome({ score: 0.2, followedStrategy: false, violations: ['cross_project_memory_used'], unsafeLeak: true, crossProjectLeak: true }),
    ];
    const score = new ContextPolicyScorer().score(outcomes);

    expect(score.topFractionScore).toBeGreaterThan(score.medianScore);
    expect(score.unsafeLeakRate).toBeGreaterThan(0);
    expect(score.passed).toBe(false);
    expect(score.failedGates).toContain('unsafeLeakRate');
  });

  test('compares precomputed rollouts without invoking an online model', () => {
    const report = new StrategyRolloutEvaluator().evaluate([
      outcome({ strategyId: 'source-first', strategyTemplate: 'source-first', score: 0.95 }),
      outcome({ strategyId: 'belief-first', strategyTemplate: 'user-belief-first', score: 0.7, sourceFidelity: 0 }),
    ]);

    expect(report.strategyCount).toBe(2);
    expect(report.ranking[0]?.strategyTemplate).toBe('source-first');
    expect(report.generatedOnlineRollouts).toBe(0);
  });

  test('requires at least one passing strategy for every evaluated intent', () => {
    const report = new StrategyRolloutEvaluator().evaluate([
      outcome({ strategyTemplate: 'source-first', intent: 'exact_quote', score: 0.95 }),
      outcome({
        strategyTemplate: 'graph-source', intent: 'debugging', score: 0.2,
        unsafeLeak: true, crossProjectLeak: true, violations: ['cross_project_memory_used'],
      }),
    ]);

    expect(report.passed).toBe(false);
  });
});
