import { expect, test } from 'bun:test';

import { BenchmarkReport } from '../src/benchmark/BenchmarkReport.js';
import { BenchmarkRunner } from '../src/benchmark/BenchmarkRunner.js';
import { BENCHMARK_GROUPS } from '../src/benchmark/BenchmarkRegistry.js';
import { EvalRunner, type EvalSuiteName, type EvalSuiteResult } from '../src/eval/runners/EvalRunner.js';

const SUITES: EvalSuiteName[] = ['memory_recall', 'context_pack', 'long_horizon', 'fast_path', 'workspace_isolation', 'surface_latency', 'notification_delivery', 'session_continuity', 'tool_use_quality', 'longmemeval'];

/**
 * #71: the suites returned a fixed table of plausible values, so every comparison
 * built on them — benchmark group baselines, and the proposal verdicts that read
 * those — compared constants to thresholds. A group whose threshold is "at most
 * zero" passed without anything having been run.
 *
 * These assertions are about what *cannot* be claimed without data: no metric, no
 * pass, and the report saying so in words.
 */
test('no suite reports a metric it did not measure', async () => {
  const runner = new EvalRunner();
  for (const suite of SUITES) {
    const result = await runner.runSuite(suite);
    expect({ suite, keys: Object.keys(result.metrics), measured: result.measured, passed: result.passed })
      .toEqual({ suite, keys: [], measured: false, passed: false });
    expect(result.unmeasuredReason).toBe('suite_not_implemented');
  }
});

test('a group cannot pass when its suite measured nothing', async () => {
  const runner = new BenchmarkRunner();
  for (const group of BENCHMARK_GROUPS) {
    const result = await runner.runGroup(group.name);
    expect({ group: group.name, measured: result.measured, passed: result.passed, baselines: result.baselineResults.length })
      .toEqual({ group: group.name, measured: false, passed: false, baselines: 0 });
  }
  // …and the report says so rather than printing nothing, which would read as a pass.
  const report = new BenchmarkReport();
  const text = report.formatConsole(await Promise.all(BENCHMARK_GROUPS.map((group) => runner.runGroup(group.name))));
  expect(text).toContain('not measured');
  expect(text).toContain('No benchmark suite is implemented');
  expect(text).not.toContain('passed');
});

test('the comparison still works when a suite does measure something', async () => {
  // The path is not disabled, it is gated: an injected measurement is compared
  // exactly as before, so implementing a suite later needs no change here.
  const measured: EvalSuiteResult = {
    suiteName: 'memory_recall',
    runAt: Date.now(),
    metrics: { brain_stale_leakage: 0, brain_vs_dump_stale_leakage_ratio: 0 },
    passed: true,
    measured: true,
  };
  const runner = new BenchmarkRunner({ runSuite: async () => measured } as unknown as EvalRunner);
  const group = BENCHMARK_GROUPS.find((candidate) => candidate.suiteName === 'memory_recall')!;
  const result = await runner.runGroup(group.name);

  expect(result.measured).toBe(true);
  expect(result.baselineResults.length).toBeGreaterThan(0);
  expect(result.baselineResults.every((baseline) => typeof baseline.passed === 'boolean')).toBe(true);
});
