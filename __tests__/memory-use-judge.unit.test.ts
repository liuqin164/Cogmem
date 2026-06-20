import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';

import { ContextOutcomeStore, MemoryUseJudge } from '../src/eval/strategy/index.js';
import { StrategyCortex } from '../src/strategy/index.js';

describe('memory use judge', () => {
  test('flags source, safety, budget, and strategy-adherence violations deterministically', () => {
    const capsule = new StrategyCortex().plan({ query: 'quote the original', intent: 'exact_quote', projectId: 'brain' });
    const outcome = new MemoryUseJudge().judge({
      receiptId: 'receipt-1', capsule,
      selected: [
        { id: 'old', layer: 'belief', hasSourceEvidence: false, superseded: true },
        { id: 'cross', layer: 'graph', hasSourceEvidence: false, crossProject: true },
        { id: 'guess', layer: 'belief', hasSourceEvidence: false, ownership: 'user', sourceRoles: ['assistant'] },
      ],
      usedTokens: 120, budgetTokens: 100, latencyMs: 50,
    });

    expect(outcome.followedStrategy).toBe(false);
    expect(outcome.violations).toEqual(expect.arrayContaining([
      'exact_quote_without_source', 'superseded_memory_used', 'cross_project_memory_used',
      'assistant_only_user_belief', 'memory_budget_exceeded', 'required_layer_missing',
    ]));
    expect(outcome.score).toBeLessThan(0.5);
  });

  test('outcome telemetry persists without a durable-memory mutation API', () => {
    const db = new Database(':memory:');
    const store = new ContextOutcomeStore(db);
    const capsule = new StrategyCortex().plan({ query: 'project status', intent: 'project_status', projectId: 'brain' });
    const outcome = new MemoryUseJudge().judge({
      receiptId: 'receipt-safe', capsule,
      selected: [{ id: 'belief', layer: 'belief', hasSourceEvidence: true }],
      usedTokens: 10, budgetTokens: 100, latencyMs: 5,
    });
    store.record(outcome);

    expect(store.get(outcome.outcomeId)?.receiptId).toBe('receipt-safe');
    expect(Object.hasOwn(store, 'updateBelief')).toBe(false);
  });
});
