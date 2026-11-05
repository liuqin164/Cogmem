import { describe, expect, mock, test } from 'bun:test';
import Database from 'bun:sqlite';
import type { EvalSuiteName, EvalSuiteResult } from '../../eval/runners/EvalRunner.js';
import { BenchmarkRunner, type BenchmarkBaselineResult, type BenchmarkGroupResult } from '../src/benchmark/BenchmarkRunner.js';
import { BENCHMARK_GROUPS, type BenchmarkGroup } from '../src/benchmark/BenchmarkRegistry.js';
import { ProposalConfigOverlay } from '../src/meta/ProposalConfigOverlay.js';
import { ProposalEvalRunner } from '../src/meta/ProposalEvalRunner.js';
import { ProposalLedger } from '../src/meta/ProposalLedger.js';
import type { PolicyProposal, ProposalStatus } from '../src/meta/types.js';

const MEMORY_RECALL_GROUP_NAMES = BENCHMARK_GROUPS
  .filter((group) => group.suiteName === 'memory_recall')
  .map((group) => group.name);

class RecordingProposalLedger extends ProposalLedger {
  readonly statusUpdates: Array<{ id: string; status: ProposalStatus; evalReport?: string }> = [];

  override updateStatus(
    id: string,
    status: ProposalStatus,
    extras: {
      evalReport?: string;
      approvedAt?: number;
      appliedAt?: number;
      rolledBackAt?: number;
      rejectedAt?: number;
      previousValue?: unknown;
    } = {}
  ): void {
    this.statusUpdates.push({ id, status, evalReport: extras.evalReport });
    super.updateStatus(id, status, extras);
  }
}

class MockBenchmarkRunner extends BenchmarkRunner {
  readonly runCalls: string[] = [];

  constructor(private results: Record<string, BenchmarkGroupResult>) {
    super({ runSuite: async () => makeSuiteResult('memory_recall') } as never);
  }

  override async runGroup(groupName: string): Promise<BenchmarkGroupResult> {
    this.runCalls.push(groupName);
    const result = this.results[groupName];
    if (!result) {
      return makeGroupResult(groupName);
    }
    return result;
  }
}

class SpyOverlay extends ProposalConfigOverlay {
  readonly calls: Array<Array<{ key: string; value: unknown }>> = [];

  override async withOverlay<T>(entries: Array<{ key: string; value: unknown }>, fn: () => Promise<T>): Promise<T> {
    this.calls.push(entries);
    return super.withOverlay(entries, fn);
  }
}

function makeLedger(): RecordingProposalLedger {
  const ledger = new RecordingProposalLedger(new Database(':memory:'));
  ledger.initSchema();
  return ledger;
}

function makeProposal(overrides: Partial<PolicyProposal> = {}): PolicyProposal {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    proposedAt: overrides.proposedAt ?? 1000,
    category: overrides.category ?? 'benchmark_threshold',
    summary: overrides.summary ?? 'summary',
    evidence: overrides.evidence ?? [{ traceEventId: 'evt-1', note: 'evidence' }],
    suggestedChange: overrides.suggestedChange ?? { action: 'adjust' },
    status: overrides.status ?? 'pending',
    evalReport: overrides.evalReport,
    appliedAt: overrides.appliedAt,
    rejectedAt: overrides.rejectedAt,
    evalPlan: overrides.evalPlan,
    riskLevel: overrides.riskLevel ?? 'medium',
    applyMode: overrides.applyMode ?? 'patch_only'
  };
}

function makeSuiteResult(suiteName: EvalSuiteName, overrides: Partial<EvalSuiteResult> = {}): EvalSuiteResult {
  return {
    suiteName,
    runAt: overrides.runAt ?? 100,
    passed: overrides.passed ?? true,
    // The fixture supplies metrics, so it stands for a suite that measured
    // something; the real suites report measured:false and cannot pass (#71).
    measured: overrides.measured ?? true,
    metrics: overrides.metrics ?? {}
  };
}

function getGroup(groupName: string): BenchmarkGroup {
  const group = BENCHMARK_GROUPS.find((entry) => entry.name === groupName);
  if (!group) {
    throw new Error(`Unknown group in test: ${groupName}`);
  }
  return group;
}

function makeBaseline(
  groupName: string,
  label: string,
  overrides: Partial<BenchmarkBaselineResult> = {}
): BenchmarkBaselineResult {
  const group = getGroup(groupName);
  const baseline = group.baselines.find((entry) => entry.label === label);
  if (!baseline) {
    throw new Error(`Unknown baseline ${label} in ${groupName}`);
  }

  const threshold = overrides.threshold ?? baseline.threshold;
  const value = overrides.value ?? threshold;
  const formatAs = overrides.formatAs ?? baseline.formatAs;

  return {
    metricKey: overrides.metricKey ?? baseline.metricKey,
    label,
    value,
    passed: overrides.passed ?? true,
    formatted: overrides.formatted ?? (formatAs === 'ms' ? `${value}ms` : `${(value * 100).toFixed(1)}%`),
    operator: overrides.operator ?? baseline.operator,
    threshold,
    formatAs
  };
}

function makeGroupResult(
  groupName: string,
  overrides: Partial<BenchmarkGroupResult> & { baselineResults?: BenchmarkBaselineResult[] } = {}
): BenchmarkGroupResult {
  const group = getGroup(groupName);
  return {
    group,
    suiteResult: overrides.suiteResult ?? makeSuiteResult(group.suiteName, {
      runAt: 100 + BENCHMARK_GROUPS.findIndex((entry) => entry.name === groupName)
    }),
    baselineResults: overrides.baselineResults ?? group.baselines.map((baseline) => makeBaseline(groupName, baseline.label)),
    passed: overrides.passed ?? true,
    measured: overrides.measured ?? true
  };
}

function makeRunner(results: BenchmarkGroupResult[]): MockBenchmarkRunner {
  return new MockBenchmarkRunner(
    Object.fromEntries(results.map((result) => [result.group.name, result]))
  );
}

function makeEvalRunnerStub() {
  return {
    runAll: mock(async () => []),
    runSuite: mock(async (name: EvalSuiteName) => makeSuiteResult(name))
  } as never;
}

describe('Phase 39 ProposalEvalRunner v2', () => {
  test('evalPlan memory_recall passes when the mapped group passes', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['memory_recall'] });
    ledger.save(proposal);
    const runner = makeRunner([makeGroupResult('memory_governance')]);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), runner).evaluate(proposal.id);

    expect(verdict.passed).toBe(true);
  });

  test('evalPlan memory_recall fails when one baseline fails', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['memory_recall'] });
    ledger.save(proposal);
    const runner = makeRunner([
      makeGroupResult('memory_governance', {
        passed: false,
        baselineResults: [
          makeBaseline('memory_governance', 'stale_leakage', {
            passed: false,
            value: 0.25
          })
        ]
      })
    ]);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), runner).evaluate(proposal.id);

    expect(verdict.passed).toBe(false);
    expect(verdict.regressions).toHaveLength(1);
  });

  test('evalPlan fast_path plus memory_recall passes when both groups pass', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['fast_path', 'memory_recall'] });
    ledger.save(proposal);
    const runner = makeRunner([
      makeGroupResult('fast_path'),
      makeGroupResult('memory_governance')
    ]);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), runner).evaluate(proposal.id);

    expect(verdict.passed).toBe(true);
  });

  test('evalPlan fast_path plus memory_recall fails when fast_path regresses', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['fast_path', 'memory_recall'] });
    ledger.save(proposal);
    const runner = makeRunner([
      makeGroupResult('fast_path', {
        passed: false,
        baselineResults: [
          makeBaseline('fast_path', 'hit_rate', { passed: false, value: 0.2 }),
          makeBaseline('fast_path', 'misclass_rate')
        ]
      }),
      makeGroupResult('memory_governance')
    ]);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), runner).evaluate(proposal.id);

    expect(verdict.passed).toBe(false);
    expect(verdict.regressions.some((entry) => entry.groupName === 'fast_path')).toBe(true);
  });

  test('undefined evalPlan falls back to memory_recall', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: undefined });
    ledger.save(proposal);
    const runner = makeRunner([makeGroupResult('memory_governance')]);

    await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), runner).evaluate(proposal.id);

    expect(runner.runCalls).toEqual(MEMORY_RECALL_GROUP_NAMES);
  });

  test('empty evalPlan falls back to memory_recall', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: [] });
    ledger.save(proposal);
    const runner = makeRunner([makeGroupResult('memory_governance')]);

    await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), runner).evaluate(proposal.id);

    expect(runner.runCalls).toEqual(MEMORY_RECALL_GROUP_NAMES);
  });

  test('unknown evalPlan suite falls back to all benchmark groups', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({
      evalPlan: ['totally_unknown_suite' as unknown as EvalSuiteName]
    });
    ledger.save(proposal);
    const runner = makeRunner(BENCHMARK_GROUPS.map((group) => makeGroupResult(group.name)));

    await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), runner).evaluate(proposal.id);

    expect(runner.runCalls).toHaveLength(BENCHMARK_GROUPS.length);
    expect(runner.runCalls).toEqual(BENCHMARK_GROUPS.map((group) => group.name));
  });

  test('passed=true updates ledger status to passed_eval', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['memory_recall'] });
    ledger.save(proposal);

    await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([makeGroupResult('memory_governance')]))
      .evaluate(proposal.id);

    expect(ledger.get(proposal.id)?.status).toBe('passed_eval');
  });

  test('passed=false updates ledger status to failed_eval', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['memory_recall'] });
    ledger.save(proposal);

    await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([
      makeGroupResult('memory_governance', {
        passed: false,
        baselineResults: [makeBaseline('memory_governance', 'stale_leakage', { passed: false, value: 0.1 })]
      })
    ])).evaluate(proposal.id);

    expect(ledger.get(proposal.id)?.status).toBe('failed_eval');
  });

  test('evaluate writes evalReport text to the ledger', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['memory_recall'] });
    ledger.save(proposal);

    await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([makeGroupResult('memory_governance')]))
      .evaluate(proposal.id);

    expect(ledger.get(proposal.id)?.evalReport).toBeTruthy();
  });

  test('reportText contains formatted benchmark output', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['memory_recall'] });
    ledger.save(proposal);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([makeGroupResult('memory_governance')]))
      .evaluate(proposal.id);

    expect(verdict.reportText).toContain('Benchmark Report');
    expect(verdict.reportText.length).toBeGreaterThan(0);
  });

  test('evalResults length matches the number of groups that ran', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['fast_path', 'memory_recall'] });
    ledger.save(proposal);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([
      makeGroupResult('fast_path'),
      makeGroupResult('memory_governance')
    ])).evaluate(proposal.id);

    expect(verdict.evalResults).toHaveLength(MEMORY_RECALL_GROUP_NAMES.length + 1);
  });

  test('regressions expose groupName metricLabel currentValue threshold and operator', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['fast_path'] });
    ledger.save(proposal);
    const runner = makeRunner([
      makeGroupResult('fast_path', {
        passed: false,
        baselineResults: [
          makeBaseline('fast_path', 'hit_rate', {
            passed: false,
            value: 0.2,
            threshold: 0.375,
            operator: '>='
          })
        ]
      })
    ]);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), runner).evaluate(proposal.id);

    expect(verdict.regressions[0]).toEqual({
      groupName: 'fast_path',
      metricLabel: 'hit_rate',
      currentValue: 0.2,
      threshold: 0.375,
      operator: '>='
    });
  });

  test('patch_only proposals skip overlay.withOverlay', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['memory_recall'], applyMode: 'patch_only' });
    ledger.save(proposal);
    const overlay = new SpyOverlay();
    overlay.set('policy.mode', 'patched');

    await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([makeGroupResult('memory_governance')]))
      .evaluate(proposal.id, overlay);

    expect(overlay.calls).toHaveLength(0);
  });

  test('config proposals call overlay.withOverlay when an overlay is provided', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['memory_recall'], applyMode: 'config' });
    ledger.save(proposal);
    const overlay = new SpyOverlay();
    overlay.set('policy.mode', 'candidate');

    await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([makeGroupResult('memory_governance')]))
      .evaluate(proposal.id, overlay);

    expect(overlay.calls).toHaveLength(1);
    expect(overlay.calls[0]).toEqual([{ key: 'policy.mode', value: 'candidate' }]);
  });

  test('withOverlay clears entries after success', async () => {
    const overlay = new ProposalConfigOverlay();

    await overlay.withOverlay([{ key: 'a', value: 1 }], async () => {
      expect(overlay.get('a')).toBe(1);
      return undefined;
    });

    expect(overlay.entries()).toEqual([]);
  });

  test('withOverlay clears entries after an exception', async () => {
    const overlay = new ProposalConfigOverlay();

    await expect(overlay.withOverlay([{ key: 'a', value: 1 }], async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    expect(overlay.entries()).toEqual([]);
  });

  test('overlay set stores a value', () => {
    const overlay = new ProposalConfigOverlay();
    overlay.set('threshold', 1);

    expect(overlay.get('threshold')).toBe(1);
  });

  test('overlay get returns undefined for unknown keys', () => {
    const overlay = new ProposalConfigOverlay();

    expect(overlay.get('missing')).toBeUndefined();
  });

  test('overlay entries returns every key and value', () => {
    const overlay = new ProposalConfigOverlay();
    overlay.set('a', 1);
    overlay.set('b', 2);

    expect(overlay.entries()).toEqual([
      { key: 'a', value: 1 },
      { key: 'b', value: 2 }
    ]);
  });

  test('overlay clear removes all entries', () => {
    const overlay = new ProposalConfigOverlay();
    overlay.set('a', 1);
    overlay.clear();

    expect(overlay.entries()).toEqual([]);
  });

  test('three failed baselines produce three regressions and a failed verdict', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['fast_path', 'memory_recall'] });
    ledger.save(proposal);
    const runner = makeRunner([
      makeGroupResult('fast_path', {
        passed: false,
        baselineResults: [
          makeBaseline('fast_path', 'hit_rate', { passed: false, value: 0.1 }),
          makeBaseline('fast_path', 'misclass_rate', { passed: false, value: 0.2 })
        ]
      }),
      makeGroupResult('memory_governance', {
        passed: false,
        baselineResults: [
          makeBaseline('memory_governance', 'stale_leakage', { passed: false, value: 0.3 })
        ]
      })
    ]);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), runner).evaluate(proposal.id);

    expect(verdict.regressions).toHaveLength(3);
    expect(verdict.passed).toBe(false);
  });

  test('ledger status updates occur in under_eval then terminal order', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['memory_recall'] });
    ledger.save(proposal);

    await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([makeGroupResult('memory_governance')]))
      .evaluate(proposal.id);

    expect(ledger.statusUpdates.map((entry) => entry.status)).toEqual(['under_eval', 'passed_eval']);
  });

  test('evaluate throws for an unknown proposal id', async () => {
    const ledger = makeLedger();

    await expect(new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([]))
      .evaluate('missing')).rejects.toThrow('Unknown proposal');
  });

  test('benchmarkResults are returned for every executed group', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['fast_path', 'memory_recall'] });
    ledger.save(proposal);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([
      makeGroupResult('fast_path'),
      makeGroupResult('memory_governance')
    ])).evaluate(proposal.id);

    expect(verdict.benchmarkResults.map((result) => result.group.name)).toEqual([
      ...MEMORY_RECALL_GROUP_NAMES,
      'fast_path',
    ]);
  });

  test('evalResults preserve suite names for backward compatibility', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['fast_path', 'memory_recall'] });
    ledger.save(proposal);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([
      makeGroupResult('fast_path'),
      makeGroupResult('memory_governance')
    ])).evaluate(proposal.id);

    expect(verdict.evalResults.map((result) => result.suiteName)).toEqual([
      ...MEMORY_RECALL_GROUP_NAMES.map(() => 'memory_recall'),
      'fast_path',
    ]);
  });

  test('ranAt uses the latest suiteResult timestamp', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['fast_path', 'memory_recall'] });
    ledger.save(proposal);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([
      makeGroupResult('memory_governance', { suiteResult: makeSuiteResult('memory_recall', { runAt: 150 }) }),
      makeGroupResult('fast_path', { suiteResult: makeSuiteResult('fast_path', { runAt: 320 }) })
    ])).evaluate(proposal.id);

    expect(verdict.ranAt).toBe(320);
  });

  test('reportText is also written into the final ledger update payload', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['memory_recall'] });
    ledger.save(proposal);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([makeGroupResult('memory_governance')]))
      .evaluate(proposal.id);

    expect(ledger.statusUpdates[1]?.evalReport).toBe(verdict.reportText);
  });

  test('no regressions are emitted when every baseline passes', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['memory_recall'] });
    ledger.save(proposal);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([makeGroupResult('memory_governance')]))
      .evaluate(proposal.id);

    expect(verdict.regressions).toEqual([]);
  });

  test('fallback to all groups returns every registered evalResult', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({
      evalPlan: ['unknown_suite' as unknown as EvalSuiteName]
    });
    ledger.save(proposal);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner(
      BENCHMARK_GROUPS.map((group) => makeGroupResult(group.name))
    )).evaluate(proposal.id);

    expect(verdict.evalResults).toHaveLength(BENCHMARK_GROUPS.length);
  });

  test('config proposal without overlay still runs benchmarks directly', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['memory_recall'], applyMode: 'config' });
    ledger.save(proposal);
    const runner = makeRunner([makeGroupResult('memory_governance')]);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), runner).evaluate(proposal.id);

    expect(verdict.passed).toBe(true);
    expect(runner.runCalls).toEqual(MEMORY_RECALL_GROUP_NAMES);
  });

  test('backward-compatible constructor works when benchmarkRunner is omitted', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['memory_recall'] });
    ledger.save(proposal);
    const evalRunner = makeEvalRunnerStub();
    const runner = new ProposalEvalRunner(ledger, evalRunner);
    (runner as unknown as { benchmarkRunner: BenchmarkRunner }).benchmarkRunner = makeRunner([makeGroupResult('memory_governance')]);

    const verdict = await runner.evaluate(proposal.id);

    expect(verdict.passed).toBe(true);
  });

  test('under_eval is persisted before terminal status', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['memory_recall'] });
    ledger.save(proposal);
    const runner = makeRunner([makeGroupResult('memory_governance')]);
    const originalRunGroup = runner.runGroup.bind(runner);
    const started = mock(async (groupName: string) => {
      expect(ledger.get(proposal.id)?.status).toBe('under_eval');
      return originalRunGroup(groupName);
    });
    runner.runGroup = started as unknown as MockBenchmarkRunner['runGroup'];

    await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), runner).evaluate(proposal.id);

    expect(started).toHaveBeenCalledTimes(MEMORY_RECALL_GROUP_NAMES.length);
  });

  test('fast_path report includes both baseline lines', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['fast_path'] });
    ledger.save(proposal);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([makeGroupResult('fast_path')]))
      .evaluate(proposal.id);

    expect(verdict.reportText).toContain('hit_rate=');
    expect(verdict.reportText).toContain('misclass_rate=');
  });

  test('regression detail preserves the failing threshold value', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['surface_latency'] });
    ledger.save(proposal);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([
      makeGroupResult('surface_latency', {
        passed: false,
        baselineResults: [
          makeBaseline('surface_latency', 'stream_p99', {
            passed: false,
            value: 120,
            threshold: 100,
            operator: '<',
            formatAs: 'ms'
          })
        ]
      })
    ])).evaluate(proposal.id);

    expect(verdict.regressions[0]?.threshold).toBe(100);
  });

  test('regression detail preserves the failing current value', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['surface_latency'] });
    ledger.save(proposal);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([
      makeGroupResult('surface_latency', {
        passed: false,
        baselineResults: [
          makeBaseline('surface_latency', 'stream_p99', {
            passed: false,
            value: 140,
            threshold: 100,
            operator: '<',
            formatAs: 'ms'
          })
        ]
      })
    ])).evaluate(proposal.id);

    expect(verdict.regressions[0]?.currentValue).toBe(140);
  });

  test('regression detail preserves the failing operator', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['surface_latency'] });
    ledger.save(proposal);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([
      makeGroupResult('surface_latency', {
        passed: false,
        baselineResults: [
          makeBaseline('surface_latency', 'stream_p99', {
            passed: false,
            value: 140,
            threshold: 100,
            operator: '<',
            formatAs: 'ms'
          })
        ]
      })
    ])).evaluate(proposal.id);

    expect(verdict.regressions[0]?.operator).toBe('<');
  });

  test('regression detail preserves the failing metric label', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['surface_latency'] });
    ledger.save(proposal);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([
      makeGroupResult('surface_latency', {
        passed: false,
        baselineResults: [
          makeBaseline('surface_latency', 'stream_p99', {
            passed: false,
            value: 140,
            threshold: 100,
            operator: '<',
            formatAs: 'ms'
          })
        ]
      })
    ])).evaluate(proposal.id);

    expect(verdict.regressions[0]?.metricLabel).toBe('stream_p99');
  });

  test('regression detail preserves the failing group name', async () => {
    const ledger = makeLedger();
    const proposal = makeProposal({ evalPlan: ['surface_latency'] });
    ledger.save(proposal);

    const verdict = await new ProposalEvalRunner(ledger, makeEvalRunnerStub(), makeRunner([
      makeGroupResult('surface_latency', {
        passed: false,
        baselineResults: [
          makeBaseline('surface_latency', 'stream_p99', {
            passed: false,
            value: 140,
            threshold: 100,
            operator: '<',
            formatAs: 'ms'
          })
        ]
      })
    ])).evaluate(proposal.id);

    expect(verdict.regressions[0]?.groupName).toBe('surface_latency');
  });
});
