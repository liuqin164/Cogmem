export type EvalSuiteName = 'memory_recall' | 'context_pack' | 'long_horizon' | 'fast_path' | 'workspace_isolation' | 'surface_latency' | 'notification_delivery' | 'session_continuity' | 'tool_use_quality' | 'longmemeval';
export interface EvalSuiteResult {
    suiteName: EvalSuiteName;
    runAt: number;
    metrics: Record<string, number>;
    passed: boolean;
    /**
     * Whether the numbers above came from running something (#71).
     *
     * The suites used to return a fixed table of plausible values, so every
     * comparison built on them — benchmark group baselines, and the proposal
     * verdicts that read those — compared constants to thresholds. Nothing can be
     * reported as a measurement now unless a suite actually measured it, and a
     * result that measured nothing cannot pass.
     */
    measured: boolean;
    unmeasuredReason?: string;
}
export declare class EvalRunner {
    runAll(): Promise<EvalSuiteResult[]>;
    /**
     * No suite is implemented. This returns no metrics on purpose.
     *
     * A fixed table of plausible values is worse than an empty result: it reads as
     * a measurement, it satisfies thresholds, and it lets a proposal be accepted on
     * numbers that never depended on the proposal. Until a suite drives the kernel
     * over stated fixtures and computes its metrics from the outcomes, it says so
     * and fails closed.
     */
    runSuite(name: EvalSuiteName): Promise<EvalSuiteResult>;
}
//# sourceMappingURL=EvalRunner.d.ts.map