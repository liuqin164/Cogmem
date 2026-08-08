import { type ConditionEvaluationContext } from './ConditionDslEvaluator.js';
import { type PlanExecutionContext } from './PlanDslExecutor.js';
import type { PlanRuntimeStore } from '../store/PlanRuntimeStore.js';
import { type PolicySideEffectExecutor, type PolicySideEffectResult } from './PolicySideEffectExecutor.js';
export interface PolicyRuntimeContext extends ConditionEvaluationContext, PlanExecutionContext {
    projectId: string;
}
export interface PolicyRuntimeDecision {
    runtimeId?: string;
    allowed: boolean;
    executionReady: boolean;
    reasons: string[];
    policyActions: Array<{
        policy: string;
        action: 'allow' | 'deny' | 'prefer';
    }>;
    blockedSteps: Array<{
        step: string;
        reasons: string[];
    }>;
    executableSteps: string[];
    mergeReadiness: Array<{
        into: string;
        ready: boolean;
        missing: string[];
    }>;
    validationReadiness: Array<{
        target: string;
        ready: boolean;
        missingChecks: string[];
    }>;
    executedEffects: PolicySideEffectResult[];
}
export declare class PolicyRuntimeEvaluator {
    static evaluate(input: {
        conditionDsl?: unknown;
        planDsl?: unknown;
        runtimeId?: string;
        runtimeStore?: PlanRuntimeStore;
    }, context: PolicyRuntimeContext): PolicyRuntimeDecision;
    static evaluateAndExecute(input: {
        conditionDsl?: unknown;
        planDsl?: unknown;
        runtimeId?: string;
        runtimeStore?: PlanRuntimeStore;
        sideEffectExecutor?: PolicySideEffectExecutor;
    }, context: PolicyRuntimeContext): Promise<PolicyRuntimeDecision>;
}
//# sourceMappingURL=PolicyRuntimeEvaluator.d.ts.map