import { isRecallableMemoryEvidence, recallGovernanceReasonsFor, recallSuppressionReasonFor, } from './RecallGovernance.js';
export function explainRecallWithKernel(kernel, options) {
    const limit = Math.max(1, options.limit ?? 8);
    if (options.agentId) {
        const projectId = options.projectId || options.agentId;
        const retrievalLimit = Math.max(limit * 4, 24);
        const navigated = kernel.navigateMemory(options.query, {
            projectId,
            limit: retrievalLimit,
            startTime: options.startTime,
            endTime: options.endTime,
        });
        const scoped = navigated.rawEvidence.filter((neuron) => isInAgentScope(neuron, options.agentId));
        const included = scoped.slice(0, limit);
        const filteredEvidence = uniqueFilteredEvidence([
            ...toNavigationFilteredEvidence(navigated),
            ...navigated.rawEvidence
                .filter((neuron) => !isInAgentScope(neuron, options.agentId))
                .map((neuron) => toFilteredEvidence(neuron, 'agent_scope_mismatch')),
            ...scoped
                .slice(limit)
                .map((neuron) => toFilteredEvidence(neuron, 'over_context_limit')),
        ]);
        if (included.length > 0) {
            return {
                query: options.query,
                projectId: options.projectId,
                agentId: options.agentId,
                recallMode: navigated.recallMode,
                fallbackUsed: navigated.fallbackUsed,
                narrative: navigated.navigation?.narrative,
                pulseTrace: navigated.navigation?.pulse.trace,
                temporalTraversal: navigated.navigation?.branchSearch.temporalTraversal,
                runtime: navigated.navigation?.runtime,
                evidence: included.map((neuron) => toEvidence(neuron, navigated, options.agentId)),
                filteredEvidence,
            };
        }
        const fallback = kernel.recall(options.query, {
            projectId,
            limit: retrievalLimit,
            includeRawEvidence: true,
        });
        const fallbackRawEvidence = fallback.rawEvidence
            .filter((neuron) => !projectId || neuron.metadata.projectId === projectId);
        const fallbackRecallable = fallbackRawEvidence.filter((neuron) => isRecallableMemoryEvidence(neuron));
        const fallbackScoped = fallbackRecallable.filter((neuron) => isInAgentScope(neuron, options.agentId));
        return {
            query: options.query,
            projectId: options.projectId,
            agentId: options.agentId,
            recallMode: 'brain_recall_fallback',
            fallbackUsed: true,
            narrative: navigated.navigation?.narrative,
            pulseTrace: navigated.navigation?.pulse.trace,
            temporalTraversal: navigated.navigation?.branchSearch.temporalTraversal,
            runtime: navigated.navigation?.runtime,
            evidence: fallbackScoped
                .slice(0, limit)
                .map((neuron) => toEvidence(neuron, navigated, options.agentId)),
            filteredEvidence: uniqueFilteredEvidence([
                ...filteredEvidence,
                ...fallbackRawEvidence
                    .filter((neuron) => !isRecallableMemoryEvidence(neuron))
                    .map((neuron) => toFilteredEvidence(neuron, 'status_suppressed')),
                ...fallbackRecallable
                    .filter((neuron) => !isInAgentScope(neuron, options.agentId))
                    .map((neuron) => toFilteredEvidence(neuron, 'agent_scope_mismatch')),
                ...fallbackScoped
                    .slice(limit)
                    .map((neuron) => toFilteredEvidence(neuron, 'over_context_limit')),
            ]),
        };
    }
    const retrievalLimit = Math.max(limit * 4, 24);
    const navigated = kernel.navigateMemory(options.query, {
        projectId: options.projectId,
        limit: retrievalLimit,
        startTime: options.startTime,
        endTime: options.endTime,
    });
    const included = navigated.rawEvidence.slice(0, limit);
    const filteredEvidence = uniqueFilteredEvidence([
        ...toNavigationFilteredEvidence(navigated),
        ...navigated.rawEvidence
            .slice(limit)
            .map((neuron) => toFilteredEvidence(neuron, 'over_context_limit')),
    ]);
    return {
        query: options.query,
        projectId: options.projectId,
        recallMode: navigated.recallMode,
        fallbackUsed: navigated.fallbackUsed,
        narrative: navigated.navigation?.narrative,
        pulseTrace: navigated.navigation?.pulse.trace,
        temporalTraversal: navigated.navigation?.branchSearch.temporalTraversal,
        runtime: navigated.navigation?.runtime,
        evidence: included.map((neuron) => toEvidence(neuron, navigated)),
        filteredEvidence,
    };
}
function isInAgentScope(neuron, agentId) {
    const tags = neuron.metadata.tags || [];
    const explicitAgentTags = tags.filter((tag) => tag.startsWith('agent:'));
    if (explicitAgentTags.length === 0)
        return true;
    return explicitAgentTags.includes(`agent:${agentId}`) || tags.includes(agentId);
}
function toEvidence(neuron, result, agentId) {
    return {
        id: neuron.id,
        text: neuron.content,
        projectId: neuron.metadata.projectId,
        topicPath: neuron.metadata.topicPath,
        tags: neuron.metadata.tags || [],
        source: neuron.metadata.filePath || neuron.metadata.sourceEventId,
        activationPath: activationPathFor(result),
        whyMatched: whyMatchedFor(neuron, result, agentId),
    };
}
function toFilteredEvidence(neuron, reason, governanceReason) {
    return {
        id: neuron.id,
        text: neuron.content,
        projectId: neuron.metadata.projectId,
        tags: neuron.metadata.tags || [],
        source: neuron.metadata.filePath || neuron.metadata.sourceEventId,
        reason,
        governanceReason: governanceReason ?? (reason === 'status_suppressed' ? recallSuppressionReasonFor(neuron) : undefined),
    };
}
function toNavigationFilteredEvidence(result) {
    return (result.filteredEvidence || []).map((item) => (toFilteredEvidence(item.neuron, item.reason, item.governanceReason)));
}
function uniqueFilteredEvidence(items) {
    const seen = new Set();
    const uniqueItems = [];
    for (const item of items) {
        const key = `${item.id}:${item.reason}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        uniqueItems.push(item);
    }
    return uniqueItems;
}
function activationPathFor(result) {
    const runtimePath = result.navigation?.runtime.path || [];
    const narrativePath = result.navigation?.narrative.path || [];
    return runtimePath.length > 0
        ? runtimePath
        : narrativePath.length > 0
            ? narrativePath
            : [`recall:${result.recallMode}`];
}
function whyMatchedFor(neuron, result, agentId) {
    const reasons = new Set();
    if (agentId && isInAgentScope(neuron, agentId))
        reasons.add(`agent_scope:${agentId}`);
    if (neuron.metadata.sourceEventId)
        reasons.add('provenance:source_event');
    for (const reason of recallGovernanceReasonsFor(neuron))
        reasons.add(reason);
    if (result.navigation?.pulse.fusedIds.includes(neuron.id))
        reasons.add('pulse:fused');
    if (result.navigation?.branchSearch.neuronIds.includes(neuron.id))
        reasons.add('temporal_branch:candidate');
    if (result.navigation?.branchSearch.temporalTraversal.neuronIds.includes(neuron.id)) {
        reasons.add('temporal_traversal:candidate');
    }
    for (const reason of result.navigation?.narrative.whyMatched || [])
        reasons.add(reason);
    if (reasons.size === 0)
        reasons.add(`recall_mode:${result.recallMode}`);
    return Array.from(reasons);
}
