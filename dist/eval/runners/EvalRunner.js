export class EvalRunner {
    async runAll() {
        return [
            await this.runSuite('memory_recall'),
            await this.runSuite('context_pack'),
            await this.runSuite('long_horizon'),
            await this.runSuite('surface_latency'),
            await this.runSuite('notification_delivery'),
            await this.runSuite('session_continuity'),
            await this.runSuite('tool_use_quality'),
            await this.runSuite('longmemeval'),
        ];
    }
    /**
     * No suite is implemented. This returns no metrics on purpose.
     *
     * A fixed table of plausible values is worse than an empty result: it reads as
     * a measurement, it satisfies thresholds, and it lets a proposal be accepted on
     * numbers that never depended on the proposal. Until a suite drives the kernel
     * over stated fixtures and computes its metrics from the outcomes, it says so
     * and fails closed.
     */
    async runSuite(name) {
        return {
            suiteName: name,
            runAt: Date.now(),
            metrics: {},
            passed: false,
            measured: false,
            unmeasuredReason: 'suite_not_implemented',
        };
    }
}
