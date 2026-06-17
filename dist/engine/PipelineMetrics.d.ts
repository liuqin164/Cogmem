import type Database from 'bun:sqlite';
export interface StepTiming {
    stepName: string;
    durationMs: number;
    completedAt: number;
}
export interface NonFatalPipelineEventInput {
    kind: string;
    projectId?: string;
    message?: string;
    details?: Record<string, unknown>;
    occurredAt?: number;
}
export declare class PipelineMetrics {
    private readonly db;
    constructor(db: Database);
    initSchema(): void;
    record(runId: string, steps: StepTiming[], totalMs: number, aborted: boolean): void;
    getPipelineP99(recentN?: number): number;
    getLastRun(): {
        completedAt: number;
        aborted: boolean;
        totalMs: number;
    } | undefined;
    getStepAverages(): Record<string, number>;
    recordNonFatal(kind: string, input?: Omit<NonFatalPipelineEventInput, 'kind'>): void;
    getNonFatalCount(kind?: string, options?: {
        projectId?: string;
    }): number;
    cleanup(retentionMs?: number): void;
}
//# sourceMappingURL=PipelineMetrics.d.ts.map