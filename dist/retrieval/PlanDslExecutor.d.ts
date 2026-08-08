import type { PlanRuntimeStore } from '../store/PlanRuntimeStore.js';
export interface PlanExecutionContext {
    completedSteps?: string[];
    availableChecks?: string[];
    approvals?: string[];
    availableExecutors?: string[];
    activePolicies?: string[];
    entityStates?: Record<string, string>;
    mergeArtifacts?: string[];
}
export interface PlanExecutionAnalysis {
    executableSteps: string[];
    blockedSteps: Array<{
        step: string;
        reasons: string[];
    }>;
    retryableTargets: Array<{
        target: string;
        maxAttempts: number;
        backoff?: string;
    }>;
    mergeReadiness: Array<{
        into: string;
        ready: boolean;
        missing: string[];
    }>;
    propagationTargets: Array<{
        into: string;
        propagates: string[];
    }>;
    executorMatches: Array<{
        target: string;
        executor: string;
        mode?: string;
        matched: boolean;
    }>;
    validationReadiness: Array<{
        target: string;
        ready: boolean;
        missingChecks: string[];
    }>;
    policyCoverage: Array<{
        target: string;
        policy: string;
        matched: boolean;
        mode?: string;
    }>;
    stateProgress: Array<{
        entity: string;
        current?: string;
        matched: boolean;
        states: string[];
    }>;
}
export interface PersistedPlanExecution extends PlanExecutionAnalysis {
    runtimeId: string;
}
export declare class PlanDslExecutor {
    static analyze(planDsl: unknown, context: PlanExecutionContext): PlanExecutionAnalysis;
    static persistAnalysis(projectId: string, runtimeId: string, analysis: PlanExecutionAnalysis, store: PlanRuntimeStore): PersistedPlanExecution;
    private static writeState;
    private static normalizeContext;
    private static hasArtifact;
    private static asArray;
    private static asStringArray;
}
//# sourceMappingURL=PlanDslExecutor.d.ts.map