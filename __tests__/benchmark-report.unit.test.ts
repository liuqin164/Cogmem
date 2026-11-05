import { describe, expect, test } from 'bun:test';
import { BenchmarkReport } from '../src/benchmark/BenchmarkReport.js';
import type { BenchmarkGroupResult } from '../src/benchmark/BenchmarkRunner.js';
import { BENCHMARK_GROUPS } from '../src/benchmark/BenchmarkRegistry.js';

function makeResult(groupName: string, overrides: Partial<BenchmarkGroupResult> = {}): BenchmarkGroupResult {
  const group = BENCHMARK_GROUPS.find((entry) => entry.name === groupName);
  if (!group) {
    throw new Error(`Unknown benchmark group in test: ${groupName}`);
  }

  return {
    group,
    suiteResult: {
      suiteName: group.suiteName,
      runAt: 1,
      passed: true,
      // These fixtures stand for groups whose suite measured something; the report
      // renders "not measured" for the ones that did not (#71).
      measured: true,
      metrics: {}
    },
    baselineResults: group.baselines.map((baseline) => ({
      label: baseline.label,
      value: baseline.threshold,
      passed: true,
      formatted: baseline.formatAs === 'ms' ? `${baseline.threshold}ms` : `${(baseline.threshold * 100).toFixed(1)}%`,
      operator: baseline.operator,
      threshold: baseline.threshold,
      formatAs: baseline.formatAs
    })),
    passed: true,
    measured: true,
    ...overrides
  };
}

describe('BenchmarkReport', () => {
  test('formatConsole includes the benchmark report title', () => {
    const report = new BenchmarkReport();
    const output = report.formatConsole([makeResult('context_pack_efficiency')]);

    expect(output).toContain('cogmem v0.8 Benchmark Report');
  });

  test('formatConsole includes a separator line', () => {
    const report = new BenchmarkReport();
    const output = report.formatConsole([makeResult('context_pack_efficiency')]);

    expect(output).toContain('==================================');
  });

  test('formatConsole includes pass summary when all baselines pass', () => {
    const report = new BenchmarkReport();
    const output = report.formatConsole([
      makeResult('context_pack_efficiency'),
      makeResult('fast_path')
    ]);

    expect(output).toContain('All');
    expect(output).toContain('✓');
  });

  test('formatConsole includes failed summary when a suite fails', () => {
    const report = new BenchmarkReport();
    const output = report.formatConsole([
      makeResult('context_pack_efficiency'),
      makeResult('surface_latency', {
        passed: false,
        baselineResults: [{
          label: 'stream_p99',
          value: 120,
          passed: false,
          formatted: '120ms',
          operator: '<',
          threshold: 100,
          formatAs: 'ms'
        }]
      })
    ]);

    expect(output).toContain('FAILED');
    expect(output).toContain('✗');
  });

  test('formatJson returns valid JSON', () => {
    const report = new BenchmarkReport();
    const output = report.formatJson([makeResult('context_pack_efficiency')]);

    expect(() => JSON.parse(output)).not.toThrow();
  });

  test('formatJson includes passed field', () => {
    const report = new BenchmarkReport();
    const output = JSON.parse(report.formatJson([makeResult('context_pack_efficiency')])) as { passed?: boolean };

    expect(output.passed).toBe(true);
  });

  test('formatJson includes groups array', () => {
    const report = new BenchmarkReport();
    const output = JSON.parse(report.formatJson([makeResult('context_pack_efficiency')])) as { groups?: unknown[] };

    expect(Array.isArray(output.groups)).toBe(true);
  });

  test('formatJson includes version field', () => {
    const report = new BenchmarkReport();
    const output = JSON.parse(report.formatJson([makeResult('context_pack_efficiency')])) as { version?: string };

    expect(output.version).toBe('0.8');
  });

  test('writeJson writes a parseable JSON file to the target path', async () => {
    const report = new BenchmarkReport();
    const path = `/tmp/benchmark-report-${crypto.randomUUID()}.json`;

    await report.writeJson([makeResult('context_pack_efficiency')], path);

    expect(await Bun.file(path).exists()).toBe(true);
    const raw = await Bun.file(path).text();
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test('formatConsole renders two metric lines for fast_path', () => {
    const report = new BenchmarkReport();
    const output = report.formatConsole([makeResult('fast_path')]);
    const lines = output.split('\n').filter((line) => line.includes('hit_rate=') || line.includes('misclass_rate='));

    expect(lines).toHaveLength(2);
  });

  test('formatConsoleFromPersisted re-renders a stored report', async () => {
    const report = new BenchmarkReport();
    const path = `/tmp/benchmark-persisted-${crypto.randomUUID()}.json`;

    await report.writeJson([makeResult('notification_delivery')], path);
    const persisted = await report.readJson(path);
    const output = report.formatConsoleFromPersisted(persisted);

    expect(output).toContain('notification_delivery');
  });

  test('formatConsole includes baseline descriptions', () => {
    const report = new BenchmarkReport();
    const output = report.formatConsole([makeResult('context_pack_efficiency')]);

    expect(output).toContain('(baseline <=5.0%)');
  });

  test('formatConsole includes all group names when all groups are rendered', () => {
    const report = new BenchmarkReport();
    const output = report.formatConsole(BENCHMARK_GROUPS.map((group) => makeResult(group.name)));

    for (const group of BENCHMARK_GROUPS) {
      expect(output).toContain(group.name);
    }
  });
});
