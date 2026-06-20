import { randomUUID } from 'node:crypto';
import { StrategyTemplateRegistry } from './StrategyTemplateRegistry.js';
export class StrategyCortex {
    registry;
    constructor(registry = new StrategyTemplateRegistry()) {
        this.registry = registry;
    }
    plan(input) {
        const template = this.registry.forIntent(input.intent);
        return {
            version: 'strategy_capsule.v1',
            capsuleId: `strategy-${randomUUID()}`,
            templateId: template.templateId,
            intent: input.intent,
            objective: template.objective,
            projectId: normalizeProjectId(input.projectId),
            primaryLayers: template.primaryLayers,
            secondaryLayers: template.secondaryLayers,
            excludedLayers: this.registry.excludedLayers(template),
            retrievalPolicy: template.retrievalPolicy,
            sourcePolicy: template.sourcePolicy,
            maxMemoryRatio: template.maxMemoryRatio,
            maxItems: template.maxItems,
            instructionAuthority: 'none',
            persistAllowed: false,
            generatedBy: 'deterministic',
            fixedWithinTurn: true,
            revision: 1,
            maxReplans: 1,
            createdAt: input.createdAt ?? Date.now(),
        };
    }
    replan(current, observation) {
        const reason = replanReason(current, observation);
        if (!reason || current.revision > current.maxReplans)
            return { replanned: false, capsule: current };
        const next = this.plan({
            query: '',
            intent: observation.intent,
            projectId: observation.projectId,
            createdAt: current.createdAt,
        });
        next.capsuleId = current.capsuleId;
        next.revision = current.revision + 1;
        next.replanReason = reason;
        if (reason === 'source_requirement_unmet') {
            next.retrievalPolicy = {
                allowedLanes: ['raw_source', 'graph'],
                preferredLanes: ['raw_source', 'graph'],
                requiredLane: 'raw_source',
            };
            next.primaryLayers = ['raw_source', 'graph'];
            next.secondaryLayers = [];
            next.excludedLayers = this.registry.excludedLayers({
                ...this.registry.get('source-first'), primaryLayers: next.primaryLayers, secondaryLayers: [],
            });
            next.maxMemoryRatio = 0.3;
        }
        return { replanned: true, reason, capsule: next };
    }
}
function replanReason(current, observation) {
    if (observation.intent !== current.intent)
        return 'intent_changed';
    if (normalizeProjectId(observation.projectId) !== current.projectId)
        return 'project_changed';
    if (current.sourcePolicy === 'required' && observation.sourceRequirementSatisfied === false)
        return 'source_requirement_unmet';
    if (observation.evidenceConflict)
        return 'evidence_conflict';
    if (observation.budgetSatisfied === false)
        return 'budget_unsatisfied';
    return undefined;
}
function normalizeProjectId(value) {
    const normalized = value?.trim();
    return normalized || undefined;
}
