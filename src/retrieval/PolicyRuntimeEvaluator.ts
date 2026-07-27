import { ConditionDslEvaluator, type ConditionEvaluationContext } from './ConditionDslEvaluator.js';
import { PlanDslExecutor, type PlanExecutionContext } from './PlanDslExecutor.js';
import type { PlanRuntimeStore } from '../store/PlanRuntimeStore.js';
import { NoopPolicySideEffectExecutor, type PolicySideEffectExecutor, type PolicySideEffectResult } from './PolicySideEffectExecutor.js';

export interface PolicyRuntimeContext extends ConditionEvaluationContext, PlanExecutionContext {
  projectId: string;
}

export interface PolicyRuntimeDecision {
  runtimeId?: string;
  allowed: boolean;
  executionReady: boolean;
  reasons: string[];
  policyActions: Array<{ policy: string; action: 'allow' | 'deny' | 'prefer' }>;
  blockedSteps: Array<{ step: string; reasons: string[] }>;
  executableSteps: string[];
  mergeReadiness: Array<{ into: string; ready: boolean; missing: string[] }>;
  validationReadiness: Array<{ target: string; ready: boolean; missingChecks: string[] }>;
  executedEffects: PolicySideEffectResult[];
}

export class PolicyRuntimeEvaluator {
  static evaluate(
    input: {
      conditionDsl?: unknown;
      planDsl?: unknown;
      runtimeId?: string;
      runtimeStore?: PlanRuntimeStore;
    },
    context: PolicyRuntimeContext
  ): PolicyRuntimeDecision {
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
      PlanDslExecutor.persistAnalysis(input.runtimeId, plan, input.runtimeStore);
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

  static async evaluateAndExecute(
    input: {
      conditionDsl?: unknown;
      planDsl?: unknown;
      runtimeId?: string;
      runtimeStore?: PlanRuntimeStore;
      sideEffectExecutor?: PolicySideEffectExecutor;
    },
    context: PolicyRuntimeContext
  ): Promise<PolicyRuntimeDecision> {
    const decision = this.evaluate(input, context);
    const executor = input.sideEffectExecutor || new NoopPolicySideEffectExecutor();

    if (!decision.allowed || !decision.executionReady) {
      return decision;
    }

    const planDsl = (input.planDsl && typeof input.planDsl === 'object')
      ? input.planDsl as Record<string, unknown>
      : {};
    const policyRuntime = Array.isArray(planDsl.policyRuntime)
      ? planDsl.policyRuntime as Array<{ policy?: string; target?: string; mode?: string }>
      : [];

    const executedEffects: PolicySideEffectResult[] = [];
    for (const policyAction of decision.policyActions) {
      const target = policyRuntime.find((item) => item.policy === policyAction.policy)?.target
        || decision.executableSteps[0];

      const result = await executor.execute({
        projectId: context.projectId,
        runtimeId: decision.runtimeId,
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
