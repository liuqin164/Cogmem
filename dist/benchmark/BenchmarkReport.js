export class BenchmarkReport {
    formatConsole(results) {
        return this.formatConsoleFromPersisted(this.toPersistedReport(results));
    }
    formatConsoleFromPersisted(report) {
        const lines = [
            'cogmem v0.8 Benchmark Report',
            '=================================='
        ];
        for (const result of report.groups) {
            if (!result.measured) {
                // Said in words rather than skipped: a group that vanishes from the report
                // looks like a group that passed, and this one did not run.
                lines.push(`${result.name.padEnd(26)} not measured — no suite is implemented`);
                continue;
            }
            const firstBaseline = result.baselines[0];
            if (!firstBaseline) {
                continue;
            }
            lines.push(this.formatBaselineLine(result.name, firstBaseline, result.passed));
            for (let index = 1; index < result.baselines.length; index += 1) {
                const baseline = result.baselines[index];
                if (!baseline) {
                    continue;
                }
                lines.push(this.formatBaselineLine('', baseline, baseline.passed));
            }
        }
        lines.push('');
        const measured = report.groups.filter((group) => group.measured);
        lines.push(measured.length === 0
            ? `No benchmark suite is implemented, so nothing was measured (${report.groups.length} group(s)).`
            : measured.every((group) => group.passed)
                ? `All ${measured.length} measured benchmark suite(s) passed. ✓`
                : `${measured.filter((group) => !group.passed).length} suite(s) FAILED. ✗`);
        return lines.join('\n');
    }
    formatJson(results) {
        return JSON.stringify(this.toPersistedReport(results), null, 2);
    }
    async writeJson(results, outputPath) {
        await Bun.write(outputPath, `${this.formatJson(results)}\n`);
    }
    async readJson(inputPath) {
        const raw = await Bun.file(inputPath).text();
        return JSON.parse(raw);
    }
    toPersistedReport(results) {
        return {
            generatedAt: Date.now(),
            version: '0.8',
            passed: results.every((result) => result.passed),
            groups: results.map((result) => ({
                name: result.group.name,
                passed: result.passed,
                measured: result.measured,
                baselines: result.baselineResults
            }))
        };
    }
    formatBaselineLine(groupName, baseline, passed) {
        const mark = passed ? '✓' : '✗';
        return `${groupName.padEnd(26)} ${baseline.label}=${baseline.formatted.padEnd(10)} (baseline ${this.formatBaselineDesc(baseline)}) ${mark}`;
    }
    formatBaselineDesc(baseline) {
        const threshold = baseline.formatAs === 'ms'
            ? `${baseline.threshold}ms`
            : `${(baseline.threshold * 100).toFixed(1)}%`;
        return `${baseline.operator}${threshold}`;
    }
}
