import { beforeEach, describe, expect, mock, test } from 'bun:test';
import Database from 'bun:sqlite';
import type { EvalSuiteName, EvalSuiteResult } from '../../eval/runners/EvalRunner.js';
import { ProposalBoard } from '../src/boards/ProposalBoard.js';
import { BoardEventBus } from '../src/boards/BoardEventBus.js';
import { BenchmarkRunner, type BenchmarkBaselineResult, type BenchmarkGroupResult } from '../src/benchmark/BenchmarkRunner.js';
import { BENCHMARK_GROUPS, type BenchmarkGroup } from '../src/benchmark/BenchmarkRegistry.js';
import { MetaObservationCollector } from '../src/meta/MetaObservationCollector.js';
import { PolicyProposalGenerator } from '../src/meta/PolicyProposalGenerator.js';
import { ProposalEvalRunner } from '../src/meta/ProposalEvalRunner.js';
import { ProposalLedger } from '../src/meta/ProposalLedger.js';
import type { ObservationPattern, PolicyProposal } from '../src/meta/types.js';
import { TraceStore } from '../src/observability/TraceStore.js';

const MEMORY_RECALL_GROUP_NAMES = BENCHMARK_GROUPS
  .filter((group) => group.suiteName === 'memory_recall')
  .map((group) => group.name);

class MockBenchmarkRunner extends BenchmarkRunner {
  readonly runCalls: string[] = [];

  constructor(private readonly results: Record<string, BenchmarkGroupResult>) {
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

function makeHarness() {
  const db = new Database(':memory:');
  const traceStore = new TraceStore(db);
  traceStore.initSchema();
  const collector = new MetaObservationCollector(traceStore);
  const ledger = new ProposalLedger(db);
  ledger.initSchema();
  return { db, traceStore, collector, ledger };
}

function makeSuiteResult(suiteName: EvalSuiteName, overrides: Partial<EvalSuiteResult> = {}): EvalSuiteResult {
  return {
    suiteName,
    runAt: overrides.runAt ?? Date.now(),
    passed: overrides.passed ?? true,
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

function makeBaseline(groupName: string, label: string, overrides: Partial<BenchmarkBaselineResult> = {}): BenchmarkBaselineResult {
  const group = getGroup(groupName);
  const baseline = group.baselines.find((entry) => entry.label === label);
  if (!baseline) {
    throw new Error(`Unknown baseline ${label} in ${groupName}`);
  }

  return {
    metricKey: overrides.metricKey ?? baseline.metricKey,
    label,
    value: overrides.value ?? baseline.threshold,
    passed: overrides.passed ?? true,
    formatted: overrides.formatted ?? 'ok',
    operator: overrides.operator ?? baseline.operator,
    threshold: overrides.threshold ?? baseline.threshold,
    formatAs: overrides.formatAs ?? baseline.formatAs
  };
}

function makeGroupResult(
  groupName: string,
  overrides: Partial<BenchmarkGroupResult> & { baselineResults?: BenchmarkBaselineResult[] } = {}
): BenchmarkGroupResult {
  const group = getGroup(groupName);
  return {
    group,
    suiteResult: overrides.suiteResult ?? makeSuiteResult(group.suiteName),
    baselineResults: overrides.baselineResults ?? group.baselines.map((baseline) => makeBaseline(groupName, baseline.label)),
    passed: overrides.passed ?? true,
    measured: overrides.measured ?? true
  };
}

function makeProposal(overrides: Partial<PolicyProposal> = {}): PolicyProposal {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    proposedAt: overrides.proposedAt ?? Date.now(),
    category: overrides.category ?? 'benchmark_threshold',
    summary: overrides.summary ?? 'proposal',
    evidence: overrides.evidence ?? [{ traceEventId: 'evt-1', note: 'evidence' }],
    suggestedChange: overrides.suggestedChange ?? { action: 'adjust' },
    status: overrides.status ?? 'pending',
    evalReport: overrides.evalReport,
    approvedAt: overrides.approvedAt,
    appliedAt: overrides.appliedAt,
    rolledBackAt: overrides.rolledBackAt,
    rejectedAt: overrides.rejectedAt,
    previousValue: overrides.previousValue,
    evalPlan: overrides.evalPlan,
    riskLevel: overrides.riskLevel ?? 'medium',
    applyMode: overrides.applyMode ?? 'patch_only'
  };
}

describe('v0.9 integration acceptance', () => {
  let harness: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    harness = makeHarness();
  });

  test('MetaObservationCollector converts fast_path.miss traces into fast_path_miss_pattern', () => {
    harness.traceStore.append({
      id: 'fp-1',
      timestamp: Date.now(),
      eventType: 'fast_path.miss' as never,
      payload: { hitRate: 0.2, totalDecisions: 8 }
    });

    const patterns = harness.collector.collectPatterns();

    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.type).toBe('fast_path_miss_pattern');
  });

  test('MetaObservationCollector.collectFromBenchmarkResults creates benchmark_regression pattern', () => {
    const patterns = harness.collector.collectFromBenchmarkResults([
      makeGroupResult('fast_path', {
        suiteResult: makeSuiteResult('fast_path', {
          metrics: { hit_rate: 0.2, misclassification_rate: 0.0 }
        })
      })
    ]);

    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({ type: 'benchmark_regression', metricName: 'hit_rate' });
  });

  test('PolicyProposalGenerator maps fast_path_miss_pattern to context_pack_policy', () => {
    const proposals = new PolicyProposalGenerator().generate([{
      type: 'fast_path_miss_pattern',
      occurrenceCount: 3,
      evidenceEventIds: ['evt-1']
    }]);

    expect(proposals[0]?.category).toBe('context_pack_policy');
  });

  test('PolicyProposalGenerator maps benchmark_regression to benchmark_threshold', () => {
    const proposals = new PolicyProposalGenerator().generate([{
      type: 'benchmark_regression',
      metricName: 'hit_rate',
      currentValue: 0.2,
      baselineValue: 0.375,
      occurrenceCount: 1,
      evidenceEventIds: []
    }]);

    expect(proposals[0]?.category).toBe('benchmark_threshold');
  });

  test('all generated proposals keep a non-empty evalPlan', () => {
    const patterns: ObservationPattern[] = [
      {
        type: 'fast_path_miss_pattern',
        occurrenceCount: 1,
        evidenceEventIds: ['evt-1']
      },
      {
        type: 'benchmark_regression',
        metricName: 'hit_rate',
        currentValue: 0.2,
        baselineValue: 0.375,
        occurrenceCount: 1,
        evidenceEventIds: ['evt-2']
      }
    ];

    const proposals = new PolicyProposalGenerator().generate(patterns);

    expect(proposals.every((proposal) => (proposal.evalPlan?.length ?? 0) >= 1)).toBe(true);
  });

  test('risk_rule proposals are always patch_only', () => {
    const [proposal] = new PolicyProposalGenerator().generate([{
      type: 'repeated_approval_reject',
      capabilityId: 'shell_exec',
      occurrenceCount: 3,
      evidenceEventIds: ['evt-1', 'evt-2', 'evt-3']
    }]);

    expect(proposal?.category).toBe('risk_rule');
    expect(proposal?.applyMode).toBe('patch_only');
  });

  test('observation_filter proposals are always patch_only', () => {
    const [proposal] = new PolicyProposalGenerator().generate([{
      type: 'repeated_url_filter',
      url: 'https://blocked.example',
      occurrenceCount: 3,
      evidenceEventIds: ['evt-1', 'evt-2', 'evt-3']
    }]);

    expect(proposal?.category).toBe('observation_filter');
    expect(proposal?.applyMode).toBe('patch_only');
  });

  test('ProposalEvalRunner only runs groups mapped from evalPlan', async () => {
    const proposal = makeProposal({ evalPlan: ['fast_path', 'memory_recall'] });
    harness.ledger.save(proposal);
    const runner = new MockBenchmarkRunner({
      fast_path: makeGroupResult('fast_path'),
      memory_governance: makeGroupResult('memory_governance')
    });

    await new ProposalEvalRunner(harness.ledger, { runSuite: mock(async (name: EvalSuiteName) => makeSuiteResult(name)) } as never, runner)
      .evaluate(proposal.id);

    expect(runner.runCalls).toEqual([...MEMORY_RECALL_GROUP_NAMES, 'fast_path']);
  });

  test('regression benchmark result produces passed=false and failed_eval status', async () => {
    const proposal = makeProposal({ evalPlan: ['fast_path'] });
    harness.ledger.save(proposal);
    const runner = new MockBenchmarkRunner({
      fast_path: makeGroupResult('fast_path', {
        passed: false,
        baselineResults: [makeBaseline('fast_path', 'hit_rate', { passed: false, value: 0.2, threshold: 0.375 })]
      })
    });

    const verdict = await new ProposalEvalRunner(harness.ledger, { runSuite: mock(async (name: EvalSuiteName) => makeSuiteResult(name)) } as never, runner)
      .evaluate(proposal.id);

    expect(verdict.passed).toBe(false);
    expect(harness.ledger.get(proposal.id)?.status).toBe('failed_eval');
  });

  test('clean benchmark result produces passed=true and passed_eval status', async () => {
    const proposal = makeProposal({ evalPlan: ['memory_recall'] });
    harness.ledger.save(proposal);
    const runner = new MockBenchmarkRunner({
      memory_governance: makeGroupResult('memory_governance')
    });

    const verdict = await new ProposalEvalRunner(harness.ledger, { runSuite: mock(async (name: EvalSuiteName) => makeSuiteResult(name)) } as never, runner)
      .evaluate(proposal.id);

    expect(verdict.passed).toBe(true);
    expect(harness.ledger.get(proposal.id)?.status).toBe('passed_eval');
  });

  test('ledger apply protects the approved precondition', () => {
    const proposal = makeProposal({ status: 'passed_eval' });
    harness.ledger.save(proposal);

    expect(() => harness.ledger.apply(proposal.id, {})).toThrow(Error);
  });

  test('ProposalBoard.stream receives proposal.created events from the event bus', () => {
    const eventBus = new BoardEventBus();
    const board = new ProposalBoard(harness.ledger, eventBus);
    const callback = mock(() => {});

    board.stream(callback);
    eventBus.emit({
      boardId: 'proposals',
      eventType: 'proposal.created',
      payload: { proposalId: 'proposal-1' },
      timestamp: Date.now()
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
