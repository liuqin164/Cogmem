import { describe, expect, test } from 'bun:test';
import { BENCHMARK_GROUPS } from '../src/benchmark/BenchmarkRegistry.js';
import { BenchmarkRunner } from '../src/benchmark/BenchmarkRunner.js';

function createMockEvalRunner(overrides: Record<string, number> = {}) {
  return {
    async runSuite(name: string) {
      return {
        suiteName: name,
        passed: true,
        // The mock supplies metrics, so it stands for a suite that measured
        // something. `measured: false` is what the real runner returns today (#71),
        // and the comparison path is deliberately gated on this flag.
        measured: true,
        runAt: Date.now(),
        metrics: {
          brain_vs_dump_token_ratio: 0.049,
          brain_stale_leakage: 0,
          resume_success_rate: 1,
          resume_success_rate_200_turns: 1,
          hit_rate: 0.375,
          misclassification_rate: 0,
          cross_workspace_leakage_rate: 0,
          stream_p99_ms: 80,
          delivery_rate: 1,
          continuity_rate: 1,
          brain_avg_tokens: 100,
          dump_all_avg_tokens: 2000,
          brain_vs_dump_stale_leakage_ratio: 0,
          dump_all_stale_leakage: 0,
          decision_consistency: 1,
          critical_memory_recall_rate: 1,
          old_but_important_recall_rate: 1,
          stale_memory_leakage_rate: 0,
          superseded_fact_leakage_rate: 0,
          suspect_memory_leakage_rate: 0,
          cross_project_leakage_rate: 0,
          provenance_completeness_rate: 1,
          context_budget_efficiency: 0.95,
          pulse_activation_useful_expansion_rate: 0.7,
          inhibition_correctness_rate: 1,
          tool_call_usefulness_rate: 0.75,
          unnecessary_tool_call_rate: 0.1,
          policy_rejection_rate: 0.2,
          avg_evidence_budget_utilization: 0.62,
          sanitization_hit_rate: 0,
          accuracy: 0.4,
          accuracy_temporal: 0.3,
          ...overrides
        }
      };
    }
  };
}

describe('BenchmarkRunner', () => {
  test('runGroup context_pack_efficiency passes at baseline edge', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner() as never);
    const result = await runner.runGroup('context_pack_efficiency');

    expect(result.passed).toBe(true);
    expect(result.baselineResults[0]?.value).toBe(0.049);
  });

  test('runGroup context_pack_efficiency fails when token ratio exceeds threshold', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner({
      brain_vs_dump_token_ratio: 0.06
    }) as never);
    const result = await runner.runGroup('context_pack_efficiency');

    expect(result.passed).toBe(false);
    expect(result.baselineResults[0]?.passed).toBe(false);
  });

  test('runGroup memory_governance passes when stale leakage is zero', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner() as never);
    const result = await runner.runGroup('memory_governance');

    expect(result.passed).toBe(true);
    expect(result.baselineResults[0]?.label).toBe('stale_leakage');
  });

  test('runGroup memory_natural_emergence covers recall, inhibition, leakage, provenance, and budget metrics', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner() as never);
    const result = await runner.runGroup('memory_natural_emergence');

    expect(result.passed).toBe(true);
    expect(result.baselineResults.map((item) => item.metricKey)).toEqual([
      'critical_memory_recall_rate',
      'old_but_important_recall_rate',
      'stale_memory_leakage_rate',
      'superseded_fact_leakage_rate',
      'suspect_memory_leakage_rate',
      'cross_project_leakage_rate',
      'provenance_completeness_rate',
      'context_budget_efficiency',
      'pulse_activation_useful_expansion_rate',
      'inhibition_correctness_rate',
    ]);
  });

  test('runGroup long_horizon_task passes when resume rate is 100%', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner() as never);
    const result = await runner.runGroup('long_horizon_task');

    expect(result.passed).toBe(true);
  });

  test('runGroup fast_path passes when both baselines pass', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner() as never);
    const result = await runner.runGroup('fast_path');

    expect(result.passed).toBe(true);
    expect(result.baselineResults).toHaveLength(2);
    expect(result.baselineResults.every((baseline) => baseline.passed)).toBe(true);
  });

  test('runGroup fast_path fails when hit rate is too low', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner({
      hit_rate: 0.3
    }) as never);
    const result = await runner.runGroup('fast_path');

    expect(result.passed).toBe(false);
    expect(result.baselineResults[0]?.passed).toBe(false);
  });

  test('runGroup fast_path fails when misclassification rate is non-zero', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner({
      misclassification_rate: 0.1
    }) as never);
    const result = await runner.runGroup('fast_path');

    expect(result.passed).toBe(false);
    expect(result.baselineResults[1]?.passed).toBe(false);
  });

  test('runGroup workspace_isolation passes when leakage is zero', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner() as never);
    const result = await runner.runGroup('workspace_isolation');

    expect(result.passed).toBe(true);
  });

  test('runGroup surface_latency passes when p99 is under 100ms', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner() as never);
    const result = await runner.runGroup('surface_latency');

    expect(result.passed).toBe(true);
    expect(result.baselineResults[0]?.formatted).toBe('80ms');
  });

  test('runGroup surface_latency fails when p99 exceeds baseline', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner({
      stream_p99_ms: 120
    }) as never);
    const result = await runner.runGroup('surface_latency');

    expect(result.passed).toBe(false);
  });

  test('runGroup unknown_suite throws a clear error', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner() as never);

    await expect(runner.runGroup('unknown_suite')).rejects.toThrow('Unknown benchmark group');
  });

  test('runAll returns all benchmark results', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner() as never);
    const results = await runner.runAll();

    expect(results).toHaveLength(BENCHMARK_GROUPS.length);
  });

  test('runAll marks every result passed when all baselines pass', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner() as never);
    const results = await runner.runAll();

    expect(results.every((result) => result.passed)).toBe(true);
  });

  test('baseline formatted values include percent suffix for percent metrics', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner() as never);
    const result = await runner.runGroup('notification_delivery');

    expect(result.baselineResults[0]?.formatted).toBe('100.0%');
  });

  test('runGroup notification_delivery passes when delivery rate is 100%', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner() as never);
    const result = await runner.runGroup('notification_delivery');

    expect(result.passed).toBe(true);
  });

  test('runGroup session_continuity passes when continuity rate is 100%', async () => {
    const runner = new BenchmarkRunner(createMockEvalRunner() as never);
    const result = await runner.runGroup('session_continuity');

    expect(result.passed).toBe(true);
  });
});
