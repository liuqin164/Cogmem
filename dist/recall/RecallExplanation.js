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
        const agentScoped = navigated.rawEvidence.filter((neuron) => isInAgentScope(neuron, options.agentId));
        const scoped = agentScoped.filter((neuron) => isInCollectionScope(neuron, options.collection));
        const scopedRecallable = scoped.filter((neuron) => isRecallableMemoryEvidence(neuron));
        const included = scopedRecallable.slice(0, limit);
        const filteredEvidence = uniqueFilteredEvidence([
            ...toNavigationFilteredEvidence(navigated, kernel),
            ...scoped
                .filter((neuron) => !isRecallableMemoryEvidence(neuron))
                .map((neuron) => toFilteredEvidence(neuron, 'status_suppressed', undefined, kernel)),
            ...navigated.rawEvidence
                .filter((neuron) => !isInAgentScope(neuron, options.agentId))
                .map((neuron) => toFilteredEvidence(neuron, 'agent_scope_mismatch', undefined, kernel)),
            ...agentScoped
                .filter((neuron) => !isInCollectionScope(neuron, options.collection))
                .map((neuron) => toFilteredEvidence(neuron, 'collection_scope_mismatch', undefined, kernel)),
            ...scopedRecallable
                .slice(limit)
                .map((neuron) => toFilteredEvidence(neuron, 'over_context_limit', undefined, kernel)),
        ]);
        if (included.length > 0) {
            return {
                query: options.query,
                projectId: options.projectId,
                agentId: options.agentId,
                collection: normalizedCollection(options.collection),
                recallMode: navigated.recallMode,
                fallbackUsed: navigated.fallbackUsed,
                narrative: navigated.navigation?.narrative,
                pulseTrace: navigated.navigation?.pulse.trace,
                temporalTraversal: navigated.navigation?.branchSearch.temporalTraversal,
                runtime: navigated.navigation?.runtime,
                evidence: included.map((neuron) => toEvidence(neuron, navigated, options.agentId, kernel)),
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
        const fallbackAgentScoped = fallbackRecallable.filter((neuron) => isInAgentScope(neuron, options.agentId));
        const fallbackScoped = fallbackAgentScoped.filter((neuron) => isInCollectionScope(neuron, options.collection));
        return {
            query: options.query,
            projectId: options.projectId,
            agentId: options.agentId,
            collection: normalizedCollection(options.collection),
            recallMode: 'brain_recall_fallback',
            fallbackUsed: true,
            narrative: navigated.navigation?.narrative,
            pulseTrace: navigated.navigation?.pulse.trace,
            temporalTraversal: navigated.navigation?.branchSearch.temporalTraversal,
            runtime: navigated.navigation?.runtime,
            evidence: fallbackScoped
                .slice(0, limit)
                .map((neuron) => toEvidence(neuron, navigated, options.agentId, kernel)),
            filteredEvidence: uniqueFilteredEvidence([
                ...filteredEvidence,
                ...fallbackRawEvidence
                    .filter((neuron) => !isRecallableMemoryEvidence(neuron))
                    .map((neuron) => toFilteredEvidence(neuron, 'status_suppressed', undefined, kernel)),
                ...fallbackRecallable
                    .filter((neuron) => !isInAgentScope(neuron, options.agentId))
                    .map((neuron) => toFilteredEvidence(neuron, 'agent_scope_mismatch', undefined, kernel)),
                ...fallbackAgentScoped
                    .filter((neuron) => !isInCollectionScope(neuron, options.collection))
                    .map((neuron) => toFilteredEvidence(neuron, 'collection_scope_mismatch', undefined, kernel)),
                ...fallbackScoped
                    .slice(limit)
                    .map((neuron) => toFilteredEvidence(neuron, 'over_context_limit', undefined, kernel)),
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
    const collectionScoped = navigated.rawEvidence.filter((neuron) => isInCollectionScope(neuron, options.collection));
    const included = collectionScoped.slice(0, limit);
    const filteredEvidence = uniqueFilteredEvidence([
        ...toNavigationFilteredEvidence(navigated, kernel),
        ...navigated.rawEvidence
            .filter((neuron) => !isInCollectionScope(neuron, options.collection))
            .map((neuron) => toFilteredEvidence(neuron, 'collection_scope_mismatch', undefined, kernel)),
        ...collectionScoped
            .slice(limit)
            .map((neuron) => toFilteredEvidence(neuron, 'over_context_limit', undefined, kernel)),
    ]);
    return {
        query: options.query,
        projectId: options.projectId,
        collection: normalizedCollection(options.collection),
        recallMode: navigated.recallMode,
        fallbackUsed: navigated.fallbackUsed,
        narrative: navigated.navigation?.narrative,
        pulseTrace: navigated.navigation?.pulse.trace,
        temporalTraversal: navigated.navigation?.branchSearch.temporalTraversal,
        runtime: navigated.navigation?.runtime,
        evidence: included.map((neuron) => toEvidence(neuron, navigated, undefined, kernel)),
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
function isInCollectionScope(neuron, collection) {
    const tags = neuron.metadata.tags || [];
    const collectionTags = tags.filter((tag) => tag.startsWith('collection:'));
    const requested = normalizedCollection(collection);
    if (requested) {
        if (requested === 'anchor' && collectionTags.length === 0)
            return true;
        return collectionTags.includes(`collection:${requested}`);
    }
    return collectionTags.length === 0 || collectionTags.includes('collection:anchor');
}
function normalizedCollection(collection) {
    const normalized = String(collection || '').trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');
    return normalized || undefined;
}
function toEvidence(neuron, result, agentId, kernel) {
    return {
        id: neuron.id,
        text: neuron.content,
        projectId: neuron.metadata.projectId,
        topicPath: neuron.metadata.topicPath,
        tags: neuron.metadata.tags || [],
        source: neuron.metadata.filePath || neuron.metadata.sourceEventId,
        sourceAnchor: sourceAnchorFor(neuron, kernel),
        activationPath: activationPathFor(result),
        whyMatched: whyMatchedFor(neuron, result, agentId),
    };
}
function toFilteredEvidence(neuron, reason, governanceReason, kernel) {
    return {
        id: neuron.id,
        text: neuron.content,
        projectId: neuron.metadata.projectId,
        tags: neuron.metadata.tags || [],
        source: neuron.metadata.filePath || neuron.metadata.sourceEventId,
        sourceAnchor: sourceAnchorFor(neuron, kernel),
        reason,
        governanceReason: governanceReason ?? (reason === 'status_suppressed' ? recallSuppressionReasonFor(neuron) : undefined),
    };
}
function toNavigationFilteredEvidence(result, kernel) {
    return (result.filteredEvidence || []).map((item) => (toFilteredEvidence(item.neuron, item.reason, item.governanceReason, kernel)));
}
function sourceAnchorFor(neuron, kernel) {
    const eventId = neuron.metadata.sourceEventId;
    if (!eventId || !kernel)
        return undefined;
    const context = kernel.getEventContext(eventId, { before: 1, after: 1 }) || undefined;
    if (!context) {
        return { eventId, sourceRefs: [] };
    }
    const payload = context.event.payload;
    const sourceRefs = Array.isArray(payload.sourceRefs)
        ? payload.sourceRefs.filter((item) => Boolean(item && typeof item === 'object'))
        : [];
    return {
        eventId,
        sourceEventType: context.event.eventType,
        sourceRefs,
        context,
    };
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
