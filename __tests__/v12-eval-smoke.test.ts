import { describe, expect, it } from 'bun:test';
import { BenchmarkRunner } from '../src/benchmark/BenchmarkRunner.js';
import { BENCHMARK_GROUPS } from '../src/benchmark/BenchmarkRegistry.js';

describe('v1.2 eval smoke', () => {
  it('registers tool_use_quality benchmark group', () => {
    expect(BENCHMARK_GROUPS.some((group) => group.name === 'tool_use_quality')).toBe(true);
  });

  it('runs tool_use_quality through BenchmarkRunner without claiming a result', async () => {
    const result = await new BenchmarkRunner().runGroup('tool_use_quality');
    expect(result.group.suiteName).toBe('tool_use_quality');
    // This used to assert `passed === true`. It passed because the suite returned a
    // fixed table of values, not because anything was measured (#71): the group is
    // wired through, and it reports that it has no result to give.
    expect(result.measured).toBe(false);
    expect(result.passed).toBe(false);
  });
});
