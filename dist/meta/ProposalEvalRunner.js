import { BenchmarkReport } from '../benchmark/BenchmarkReport.js';
import { BenchmarkRunner } from '../benchmark/BenchmarkRunner.js';
import { BENCHMARK_GROUPS } from '../benchmark/BenchmarkRegistry.js';
const DEFAULT_SUITES = [
    'memory_recall',
];
export class ProposalEvalRunner {
    ledger;
    evalRunner;
    benchmarkRunner;
    report = new BenchmarkReport();
    constructor(ledger, evalRunner, benchmarkRunner) {
        this.ledger = ledger;
        this.evalRunner = evalRunner;
        this.benchmarkRunner = benchmarkRunner ?? new BenchmarkRunner(this.evalRunner);
    }
    async evaluate(proposalId, overlay) {
        const proposal = this.ledger.get(proposalId);
        if (!proposal) {
            throw new Error(`Unknown proposal: ${proposalId}`);
        }
        this.ledger.updateStatus(proposalId, 'under_eval');
        const groupsToRun = this.resolveGroupsToRun(proposal.evalPlan);
        const runBenchmarks = async () => Promise.all(groupsToRun.map((group) => this.benchmarkRunner.runGroup(group.name)));
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
    resolveGroupsToRun(evalPlan) {
        const suites = evalPlan && evalPlan.length > 0 ? evalPlan : DEFAULT_SUITES;
        const groups = BENCHMARK_GROUPS.filter((group) => suites.includes(group.suiteName));
        if (groups.length === 0) {
            return [...BENCHMARK_GROUPS];
        }
        return groups;
    }
}
