export class PlanDslExecutor {
    static analyze(planDsl, context) {
        const normalized = this.normalizeContext(context);
        const dsl = (planDsl && typeof planDsl === 'object') ? planDsl : {};
        const entrySteps = this.asStringArray(dsl.entrySteps);
        const executionGuards = this.asArray(dsl.executionGuards);
        const retryPolicies = this.asArray(dsl.retryPolicies);
        const mergeConstraints = this.asArray(dsl.mergeConstraints);
        const mergePropagation = this.asArray(dsl.mergePropagation);
        const runtimeValidation = this.asArray(dsl.runtimeValidation);
        const executorBindings = this.asArray(dsl.executorBindings);
        const policyRuntime = this.asArray(dsl.policyRuntime);
        const stateMachines = this.asArray(dsl.stateMachines);
        const blockedSteps = [];
        const executableSteps = [];
        for (const step of entrySteps) {
            const reasons = [];
            const guard = executionGuards.find((item) => item.target === step);
            if (guard) {
                const missing = (guard.requires || []).filter((requirement) => !this.hasArtifact(normalized, requirement));
                if (missing.length > 0)
                    reasons.push(`guard_missing:${missing.join(',')}`);
            }
            const validation = runtimeValidation.find((item) => item.target === step);
            if (validation) {
                const missingChecks = (validation.checks || []).filter((check) => !this.hasArtifact(normalized, check));
                if (missingChecks.length > 0)
                    reasons.push(`validation_missing:${missingChecks.join(',')}`);
            }
            const binding = executorBindings.find((item) => item.target === step);
            if (binding?.executor && !normalized.executors.has(binding.executor)) {
                reasons.push(`executor_missing:${binding.executor}`);
            }
            if (reasons.length > 0)
                blockedSteps.push({ step, reasons });
            else
                executableSteps.push(step);
        }
        const mergeReadiness = mergeConstraints.map((constraint) => {
            const requires = (constraint.requires || []).filter(Boolean);
            const missing = requires.filter((requirement) => !this.hasArtifact(normalized, requirement));
            return {
                into: String(constraint.into || ''),
                ready: missing.length === 0,
                missing
            };
        }).filter((item) => item.into);
        const propagationTargets = mergePropagation.map((propagation) => ({
            into: String(propagation.into || ''),
            propagates: (propagation.propagates || []).filter(Boolean)
        })).filter((item) => item.into && item.propagates.length > 0);
        const validationReadiness = runtimeValidation.map((validation) => {
            const checks = (validation.checks || []).filter(Boolean);
            const missingChecks = checks.filter((check) => !this.hasArtifact(normalized, check));
            return {
                target: String(validation.target || ''),
                ready: missingChecks.length === 0,
                missingChecks
            };
        }).filter((item) => item.target);
        const executorMatches = executorBindings.map((binding) => ({
            target: String(binding.target || ''),
            executor: String(binding.executor || ''),
            mode: binding.mode,
            matched: Boolean(binding.executor && normalized.executors.has(binding.executor))
        })).filter((item) => item.target && item.executor);
        const policyCoverage = policyRuntime.map((runtime) => ({
            target: String(runtime.target || ''),
            policy: String(runtime.policy || ''),
            mode: runtime.mode,
            matched: Boolean(runtime.policy && normalized.policies.has(runtime.policy))
        })).filter((item) => item.target && item.policy);
        const stateProgress = stateMachines.map((machine) => {
            const entity = String(machine.entity || '');
            const current = entity ? normalized.entityStates.get(entity) : undefined;
            const states = (machine.states || []).filter(Boolean);
            return {
                entity,
                current,
                matched: Boolean(current && states.includes(current)),
                states
            };
        }).filter((item) => item.entity);
        const retryableTargets = retryPolicies
            .filter((policy) => policy.target && typeof policy.maxAttempts === 'number')
            .map((policy) => ({
            target: String(policy.target),
            maxAttempts: Number(policy.maxAttempts),
            backoff: policy.backoff
        }));
        return {
            executableSteps,
            blockedSteps,
            retryableTargets,
            mergeReadiness,
            propagationTargets,
            executorMatches,
            validationReadiness,
            policyCoverage,
            stateProgress
        };
    }
    static persistAnalysis(projectId, runtimeId, analysis, store) {
        for (const step of analysis.executableSteps) {
            this.writeState(store, projectId, runtimeId, 'step', step, 'ready', { executable: true });
        }
        for (const blocked of analysis.blockedSteps) {
            this.writeState(store, projectId, runtimeId, 'step', blocked.step, 'blocked', { reasons: blocked.reasons });
        }
        for (const merge of analysis.mergeReadiness) {
            this.writeState(store, projectId, runtimeId, 'merge', merge.into, merge.ready ? 'ready' : 'blocked', { missing: merge.missing });
        }
        for (const validation of analysis.validationReadiness) {
            this.writeState(store, projectId, runtimeId, 'validation', validation.target, validation.ready ? 'ready' : 'blocked', {
                missingChecks: validation.missingChecks
            });
        }
        for (const executor of analysis.executorMatches) {
            this.writeState(store, projectId, runtimeId, 'executor', executor.target, executor.matched ? 'matched' : 'missing', {
                executor: executor.executor,
                mode: executor.mode
            });
        }
        for (const policy of analysis.policyCoverage) {
            this.writeState(store, projectId, runtimeId, 'policy', policy.target, policy.matched ? 'matched' : 'missing', {
                policy: policy.policy,
                mode: policy.mode
            });
        }
        for (const state of analysis.stateProgress) {
            this.writeState(store, projectId, runtimeId, 'state_machine', state.entity, state.matched ? 'matched' : 'pending', {
                current: state.current,
                states: state.states
            });
        }
        for (const propagation of analysis.propagationTargets) {
            store.recordTransition({
                projectId,
                runtimeId,
                entityType: 'merge',
                entityKey: propagation.into,
                transitionType: 'merge_propagation',
                toStatus: 'ready',
                payload: { propagates: propagation.propagates }
            });
        }
        return {
            runtimeId,
            ...analysis
        };
    }
    static writeState(store, projectId, runtimeId, entityType, entityKey, status, metadata) {
        store.upsertState({
            projectId,
            runtimeId,
            entityType,
            entityKey,
            status,
            metadata
        });
    }
    static normalizeContext(context) {
        const normalizeSet = (items) => new Set((items || []).map((item) => item.trim().toLowerCase()).filter(Boolean));
        const entityStates = new Map();
        for (const [entity, state] of Object.entries(context.entityStates || {})) {
            if (!entity || !state)
                continue;
            entityStates.set(entity.trim().toLowerCase(), state.trim().toLowerCase());
        }
        return {
            completed: normalizeSet(context.completedSteps),
            checks: normalizeSet(context.availableChecks),
            approvals: normalizeSet(context.approvals),
            executors: normalizeSet(context.availableExecutors),
            policies: normalizeSet(context.activePolicies),
            mergeArtifacts: normalizeSet(context.mergeArtifacts),
            entityStates
        };
    }
    static hasArtifact(normalized, value) {
        const item = value.trim().toLowerCase();
        return normalized.completed.has(item)
            || normalized.checks.has(item)
            || normalized.approvals.has(item)
            || normalized.mergeArtifacts.has(item)
            || normalized.policies.has(item);
    }
    static asArray(value) {
        return Array.isArray(value) ? value : [];
    }
    static asStringArray(value) {
        return Array.isArray(value)
            ? value.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
            : [];
    }
}
