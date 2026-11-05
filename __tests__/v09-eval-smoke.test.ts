import { describe, expect, mock, test } from 'bun:test';
import Database from 'bun:sqlite';
import type { EvalSuiteName } from '../../eval/runners/EvalRunner.js';
import { ProposalBoard } from '../src/boards/ProposalBoard.js';
import { BoardEventBus } from '../src/boards/BoardEventBus.js';
import { BenchmarkRunner } from '../src/benchmark/BenchmarkRunner.js';
import { BENCHMARK_GROUPS } from '../src/benchmark/BenchmarkRegistry.js';
import { ProposalLedger } from '../src/meta/ProposalLedger.js';

const KNOWN_BASELINE_METRICS = {
  brain_vs_dump_token_ratio: 0.049,
  brain_stale_leakage: 0.0,
  brain_vs_dump_stale_leakage_ratio: 0.0,
  resume_success_rate: 1.0,
  hit_rate: 0.375,
  misclassification_rate: 0.0,
  cross_workspace_leakage_rate: 0.0,
  stream_p99_ms: 80,
  delivery_rate: 1.0,
  continuity_rate: 1.0,
  critical_memory_recall_rate: 1.0,
  old_but_important_recall_rate: 1.0,
  stale_memory_leakage_rate: 0.0,
  superseded_fact_leakage_rate: 0.0,
  suspect_memory_leakage_rate: 0.0,
  cross_project_leakage_rate: 0.0,
  provenance_completeness_rate: 1.0,
  context_budget_efficiency: 0.95,
  pulse_activation_useful_expansion_rate: 0.7,
  inhibition_correctness_rate: 1.0,
  tool_call_usefulness_rate: 0.75,
  unnecessary_tool_call_rate: 0.1,
  policy_rejection_rate: 0.2,
  avg_evidence_budget_utilization: 0.62,
  sanitization_hit_rate: 0.0,
  accuracy: 0.4,
  accuracy_temporal: 0.3
};

function makeMockEvalRunner() {
  return {
    runSuite: mock(async (name: EvalSuiteName) => ({
      suiteName: name,
      runAt: Date.now(),
      passed: true,
        measured: true,
      metrics: {
        ...KNOWN_BASELINE_METRICS,
        resume_success_rate_200_turns: 1.0
      }
    })),
    runAll: mock(async () => [{
      passed: true,
      // A mock that supplies metrics stands for a suite that measured something;
      // the real runner returns measured:false and cannot pass (#71).
      measured: true,
      metrics: KNOWN_BASELINE_METRICS
    }])
  };
}

describe('v0.9 eval baselines regression', () => {
  test('BenchmarkRunner.runAll passes all registered groups against known baselines', async () => {
    const mockEvalRunner = makeMockEvalRunner();
    const runner = new BenchmarkRunner(mockEvalRunner as never);

    const results = await runner.runAll();

    expect(results).toHaveLength(BENCHMARK_GROUPS.length);
    expect(BENCHMARK_GROUPS.some((group) => group.name === 'memory_natural_emergence')).toBe(true);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(KNOWN_BASELINE_METRICS.brain_vs_dump_token_ratio).toBeLessThanOrEqual(0.05);
    expect(KNOWN_BASELINE_METRICS.brain_stale_leakage).toBe(0.0);
    expect(KNOWN_BASELINE_METRICS.resume_success_rate).toBe(1.0);
    expect(KNOWN_BASELINE_METRICS.hit_rate).toBeGreaterThanOrEqual(0.375);
    expect(KNOWN_BASELINE_METRICS.misclassification_rate).toBe(0.0);
    expect(KNOWN_BASELINE_METRICS.cross_workspace_leakage_rate).toBe(0.0);
    expect(KNOWN_BASELINE_METRICS.stream_p99_ms).toBeLessThan(100);
    expect(KNOWN_BASELINE_METRICS.delivery_rate).toBe(1.0);
    expect(KNOWN_BASELINE_METRICS.continuity_rate).toBe(1.0);
    expect(mockEvalRunner.runAll).toHaveBeenCalledTimes(0);
  });
});

describe('ProposalBoard smoke', () => {
  test('snapshot returns proposals board data with numeric totalProposals', async () => {
    const db = new Database(':memory:');
    const ledger = new ProposalLedger(db);
    ledger.initSchema();
    const board = new ProposalBoard(ledger);

    const snapshot = await board.snapshot();

    expect(snapshot.boardId).toBe('proposals');
    expect(typeof snapshot.data.totalProposals).toBe('number');
  });

  test('stream unsubscribe prevents future callbacks', () => {
    const db = new Database(':memory:');
    const ledger = new ProposalLedger(db);
    ledger.initSchema();
    const eventBus = new BoardEventBus();
    const board = new ProposalBoard(ledger, eventBus);
    const callback = mock(() => {});

    const unsubscribe = board.stream(callback);
    unsubscribe();
    eventBus.emit({
      boardId: 'proposals',
      eventType: 'proposal.applied',
      payload: { proposalId: 'proposal-1' },
      timestamp: Date.now()
    });

    expect(callback).toHaveBeenCalledTimes(0);
  });

  test('proposal.applied events are forwarded to stream subscribers', () => {
    const db = new Database(':memory:');
    const ledger = new ProposalLedger(db);
    ledger.initSchema();
    const eventBus = new BoardEventBus();
    const board = new ProposalBoard(ledger, eventBus);
    const callback = mock(() => {});

    board.stream(callback);
    eventBus.emit({
      boardId: 'proposals',
      eventType: 'proposal.applied',
      payload: { proposalId: 'proposal-1' },
      timestamp: Date.now()
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
