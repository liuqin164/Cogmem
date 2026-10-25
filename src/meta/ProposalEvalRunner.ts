import { EvalRunner, type EvalSuiteName, type EvalSuiteResult } from '../eval/runners/EvalRunner.js';
import { BenchmarkReport } from '../benchmark/BenchmarkReport.js';
import { BenchmarkRunner, type BenchmarkGroupResult } from '../benchmark/BenchmarkRunner.js';
import { BENCHMARK_GROUPS, type BenchmarkGroup } from '../benchmark/BenchmarkRegistry.js';
import { ProposalConfigOverlay } from './ProposalConfigOverlay.js';
import { ProposalLedger } from './ProposalLedger.js';

export interface RegressionDetail {
  groupName: string;
  metricLabel: string;
  currentValue: number;
  threshold: number;
  operator: string;
}

export interface ProposalVerdict {
  proposalId: string;
  ranAt: number;
  evalResults: EvalSuiteResult[];
  benchmarkResults: BenchmarkGroupResult[];
  regressions: RegressionDetail[];
  passed: boolean;
  reportText: string;
  reportPath?: string;
}

const DEFAULT_SUITES: EvalSuiteName[] = [
  'memory_recall',
];

export class ProposalEvalRunner {
  private readonly benchmarkRunner: BenchmarkRunner;
  private readonly report = new BenchmarkReport();

  constructor(
    private ledger: ProposalLedger,
    private evalRunner: EvalRunner,
    benchmarkRunner?: BenchmarkRunner
  ) {
    this.benchmarkRunner = benchmarkRunner ?? new BenchmarkRunner(this.evalRunner);
  }

  async evaluate(proposalId: string, overlay?: ProposalConfigOverlay): Promise<ProposalVerdict> {
    const proposal = this.ledger.get(proposalId);
    if (!proposal) {
      throw new Error(`Unknown proposal: ${proposalId}`);
    }

    this.ledger.updateStatus(proposalId, 'under_eval');

    const groupsToRun = this.resolveGroupsToRun(proposal.evalPlan);
    const runBenchmarks = async (): Promise<BenchmarkGroupResult[]> => Promise.all(
      groupsToRun.map((group) => this.benchmarkRunner.runGroup(group.name))
    );

    const benchmarkResults = proposal.applyMode === 'patch_only' || !overlay
      ? await runBenchmarks()
      : await overlay.withOverlay(overlay.entries(), runBenchmarks);

    const evalResults = benchmarkResults.map((result) => result.suiteResult);
    const regressions = benchmarkResults.flatMap((result) => result.baselineResults
      .filter((baseline) => !baseline.passed)
      .map((baseline) => ({
        groupName: result.group.name,
        metricLabel: baseline.label,
        currentValue: baseline.value,
        threshold: baseline.threshold,
        operator: baseline.operator
      })));
    // A proposal is not accepted on unmeasured groups (#71): with no
    // measurement there are no regressions either, and "no regressions" used to be
    // enough to pass.
    const measured = benchmarkResults.every((result) => result.measured);
    const passed = measured && regressions.length === 0;
    const reportText = this.report.formatConsole(benchmarkResults);
    const ranAt = Math.max(...evalResults.map((result) => result.runAt));

    this.ledger.updateStatus(proposalId, passed ? 'passed_eval' : 'failed_eval', {
      evalReport: reportText
    });

    return {
      proposalId,
      ranAt,
      evalResults,
      benchmarkResults,
      regressions,
      passed,
      reportText
    };
  }

  private resolveGroupsToRun(evalPlan?: EvalSuiteName[]): BenchmarkGroup[] {
    const suites = evalPlan && evalPlan.length > 0 ? evalPlan : DEFAULT_SUITES;
    const groups = BENCHMARK_GROUPS.filter((group) => suites.includes(group.suiteName));
    if (groups.length === 0) {
      return [...BENCHMARK_GROUPS];
    }
    return groups;
  }
}
