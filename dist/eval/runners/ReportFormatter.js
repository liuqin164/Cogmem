import { existsSync, lstatSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
function formatPercent(value) {
    return `${(value * 100).toFixed(1)}%`;
}
function formatNumber(value) {
    return Number.isInteger(value) ? `${value}` : value.toFixed(3);
}
export class ReportFormatter {
    formatJson(results) {
        return JSON.stringify({
            generatedAt: Math.max(...results.map((result) => result.runAt)),
            results,
        }, null, 2);
    }
    formatMarkdown(results) {
        const memory = results.find((result) => result.suiteName === 'memory_recall');
        const context = results.find((result) => result.suiteName === 'context_pack');
        const horizon = results.find((result) => result.suiteName === 'long_horizon');
        return [
            '# Eval Report',
            '',
            '| Suite | Passed | Key metrics |',
            '| --- | --- | --- |',
            `| memory_recall | ${memory?.passed ? 'yes' : 'no'} | brain stale leakage ${formatPercent(memory?.metrics.brain_stale_leakage ?? 0)}, dump-all ${formatPercent(memory?.metrics.dump_all_stale_leakage ?? 0)}, ratio ${formatPercent(memory?.metrics.brain_vs_dump_stale_leakage_ratio ?? 0)} |`,
            `| context_pack | ${context?.passed ? 'yes' : 'no'} | brain avg tokens ${formatNumber(context?.metrics.brain_avg_tokens ?? 0)}, dump-all ${formatNumber(context?.metrics.dump_all_avg_tokens ?? 0)}, ratio ${formatPercent(context?.metrics.brain_vs_dump_token_ratio ?? 0)} |`,
            `| long_horizon | ${horizon?.passed ? 'yes' : 'no'} | resume 200-turn ${formatPercent(horizon?.metrics.resume_success_rate_200_turns ?? 0)}, decision consistency ${formatPercent(horizon?.metrics.decision_consistency ?? 0)}, critical recall ${formatPercent(horizon?.metrics.critical_memory_recall_rate ?? 0)} |`,
            '',
            '## Acceptance',
            '',
            `- BrainRecall stale leakage vs DumpAllHistory: ${formatPercent(memory?.metrics.brain_vs_dump_stale_leakage_ratio ?? 0)}`,
            `- ContextPack token ratio vs DumpAllHistory: ${formatPercent(context?.metrics.brain_vs_dump_token_ratio ?? 0)}`,
            `- Long-horizon 200-turn resume success: ${formatPercent(horizon?.metrics.resume_success_rate_200_turns ?? 0)}`,
        ].join('\n');
    }
    writeReports(results, rootDir = 'eval/reports') {
        const runAt = Math.max(...results.map((result) => result.runAt));
        const stamp = new Date(runAt).toISOString().replace(/[:.]/g, '-');
        const directory = join(rootDir, stamp);
        const jsonPath = join(directory, 'report.json');
        const markdownPath = join(directory, 'report.md');
        const latestPath = join(rootDir, 'latest');
        mkdirSync(directory, { recursive: true });
        writeFileSync(jsonPath, this.formatJson(results), 'utf8');
        writeFileSync(markdownPath, this.formatMarkdown(results), 'utf8');
        if (existsSync(latestPath)) {
            const stat = lstatSync(latestPath);
            if (stat.isSymbolicLink() || stat.isFile())
                unlinkSync(latestPath);
        }
        symlinkSync(stamp, latestPath, 'dir');
        return {
            directory,
            jsonPath,
            markdownPath,
            latestPath,
        };
    }
}
