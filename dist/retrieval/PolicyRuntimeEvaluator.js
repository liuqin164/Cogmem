import { ConditionDslEvaluator } from './ConditionDslEvaluator.js';
import { PlanDslExecutor } from './PlanDslExecutor.js';
import { NoopPolicySideEffectExecutor } from './PolicySideEffectExecutor.js';
export class PolicyRuntimeEvaluator {
    static evaluate(input, context) {
        const condition = input.conditionDsl
            ? ConditionDslEvaluator.evaluate(input.conditionDsl, context)
            : {
                matched: true,
                score: 0,
                reasons: [],
                executionReady: true,
                normalizedContext: {},
                policyActions: []
            };
        const plan = input.planDsl
            ? PlanDslExecutor.analyze(input.planDsl, context)
            : {
                executableSteps: [],
                blockedSteps: [],
                retryableTargets: [],
                mergeReadiness: [],
                propagationTargets: [],
                executorMatches: [],
                validationReadiness: [],
                policyCoverage: [],
                stateProgress: []
            };
        if (input.runtimeId && input.runtimeStore) {
            PlanDslExecutor.persistAnalysis(context.projectId, input.runtimeId, plan, input.runtimeStore);
        }
        const failedPolicies = plan.policyCoverage.filter((item) => !item.matched).map((item) => `policy_missing:${item.policy}`);
        const missingExecutors = plan.executorMatches.filter((item) => !item.matched).map((item) => `executor_missing:${item.executor}`);
        const blockedMerges = plan.mergeReadiness.filter((item) => !item.ready).map((item) => `merge_blocked:${item.into}`);
        const failedValidation = plan.validationReadiness.filter((item) => !item.ready).map((item) => `validation_blocked:${item.target}`);
        const reasons = [
            ...condition.reasons,
            ...failedPolicies,
            ...missingExecutors,
            ...blockedMerges,
            ...failedValidation,
            ...plan.blockedSteps.flatMap((item) => item.reasons.map((reason) => `${item.step}:${reason}`))
        ];
        const allowed = condition.matched
            && failedPolicies.length === 0
            && missingExecutors.length === 0
            && blockedMerges.length === 0
            && failedValidation.length === 0
            && plan.blockedSteps.length === 0;
        return {
            runtimeId: input.runtimeId,
            allowed,
            executionReady: allowed && condition.executionReady,
            reasons,
            policyActions: condition.policyActions,
            blockedSteps: plan.blockedSteps,
            executableSteps: plan.executableSteps,
            mergeReadiness: plan.mergeReadiness,
            validationReadiness: plan.validationReadiness,
            executedEffects: []
        };
    }
    static async evaluateAndExecute(input, context) {
        const decision = this.evaluate(input, context);
        const executor = input.sideEffectExecutor || new NoopPolicySideEffectExecutor();
        if (!decision.allowed || !decision.executionReady) {
            return decision;
        }
        const planDsl = (input.planDsl && typeof input.planDsl === 'object')
            ? input.planDsl
            : {};
        const policyRuntime = Array.isArray(planDsl.policyRuntime)
            ? planDsl.policyRuntime
            : [];
        const executedEffects = [];
        for (const policyAction of decision.policyActions) {
            const target = policyRuntime.find((item) => item.policy === policyAction.policy)?.target
                || decision.executableSteps[0];
            const result = await executor.execute({
                projectId: context.projectId,
                runtimeId: decision.runtimeId,
                stableOperationId: decision.runtimeId
                    ? `${decision.runtimeId}:${policyAction.policy}:${policyAction.action}:${target ?? ''}`
                    : undefined,
                policy: policyAction.policy,
                action: policyAction.action,
                target,
                metadata: {
                    executableSteps: decision.executableSteps,
                    blockedSteps: decision.blockedSteps
                }
            });
            executedEffects.push(result);
        }
        return {
            ...decision,
            executedEffects
        };
    }
}
