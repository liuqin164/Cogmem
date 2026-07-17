export class TemporalBranchSearch {
    topologyStore;
    temporalAdjacencyStore;
    constructor(topologyStore, temporalAdjacencyStore) {
        this.topologyStore = topologyStore;
        this.temporalAdjacencyStore = temporalAdjacencyStore;
    }
    search(input) {
        const candidates = this.topologyStore.collectCandidateNeuronIds({
            projectId: input.projectId,
            startTime: input.temporalEnabled === false ? undefined : input.startTime,
            endTime: input.temporalEnabled === false ? undefined : input.endTime,
            terms: input.terms,
            limit: 120
        });
        const branches = this.topologyStore.collectBranchNavigation({
            projectId: input.projectId,
            terms: input.terms,
            limit: 80,
            siblingDepth: 1
        });
        const aggregatedBranchIds = new Set(branches.branchIds);
        const aggregatedTaskIds = new Set(branches.taskIds);
        const aggregatedClusterIds = new Set(branches.clusterIds);
        const aggregatedNeuronIds = new Set([...candidates, ...branches.neuronIds]);
        const temporalSurface = input.temporalEnabled === false ? {
            bucketType: 'day',
            segments: [],
            bucketIds: [],
            labels: [],
            neuronIds: [],
        } : this.temporalAdjacencyStore.collectContinuousSurface({
            projectId: input.projectId,
            bucketIds: input.temporalBucketIds || [],
            startTime: input.startTime,
            endTime: input.endTime,
            preferredBucketType: 'day',
            hopLimit: input.startTime !== undefined || input.endTime !== undefined ? 3 : 2,
            limit: 72
        });
        const fallbackLabels = temporalSurface.labels.length > 0
            ? temporalSurface.labels
            : input.temporalEnabled !== false && (input.startTime !== undefined || input.endTime !== undefined)
                ? [this.formatTemporalWindow(input.startTime, input.endTime)]
                : [];
        const fallbackBucketIds = temporalSurface.bucketIds.length > 0
            ? temporalSurface.bucketIds
            : fallbackLabels.map((_, index) => `derived:${index}:${input.startTime ?? 0}:${input.endTime ?? 0}`);
        const fallbackTemporalNeuronIds = temporalSurface.neuronIds.length > 0
            ? temporalSurface.neuronIds
            : branches.neuronIds.slice(0, 24);
        const traversalMode = temporalSurface.segments.some((segment) => segment.source === 'window' || segment.source === 'seed')
            ? 'surface'
            : temporalSurface.segments.some((segment) => segment.source === 'adjacent')
                ? 'adjacent_fallback'
                : 'nearest_fallback';
        const linkedSegments = temporalSurface.segments.map((segment) => {
            const navigation = this.topologyStore.collectNavigationFromNeuronIds({
                neuronIds: segment.neuronIds,
                projectId: input.projectId,
                limit: 16,
                siblingDepth: 0
            });
            for (const branchId of navigation.branchIds)
                aggregatedBranchIds.add(branchId);
            for (const taskId of navigation.taskIds)
                aggregatedTaskIds.add(taskId);
            for (const clusterId of navigation.clusterIds)
                aggregatedClusterIds.add(clusterId);
            for (const neuronId of navigation.neuronIds)
                aggregatedNeuronIds.add(neuronId);
            return {
                ...segment,
                branchIds: navigation.branchIds,
                taskIds: navigation.taskIds,
                clusterIds: navigation.clusterIds
            };
        });
        const denseJointNeuronIds = Array.from(new Set([
            ...(input.entityNeuronIds || []).slice(0, 40),
            ...fallbackTemporalNeuronIds.slice(0, 40),
            ...branches.neuronIds.slice(0, 40)
        ])).slice(0, 120);
        return {
            neuronIds: Array.from(new Set([
                ...aggregatedNeuronIds,
                ...fallbackTemporalNeuronIds,
                ...denseJointNeuronIds
            ])).slice(0, 120),
            branchIds: Array.from(aggregatedBranchIds).slice(0, 80),
            taskIds: Array.from(aggregatedTaskIds).slice(0, 80),
            clusterIds: Array.from(aggregatedClusterIds).slice(0, 80),
            temporalTraversal: {
                bucketType: temporalSurface.bucketType,
                bucketIds: fallbackBucketIds,
                labels: fallbackLabels,
                neuronIds: fallbackTemporalNeuronIds,
                segments: linkedSegments,
                traversalMode
            },
            denseJointNeuronIds,
            reasons: [
                input.projectId ? 'project branch root constrained traversal' : 'global branch traversal',
                input.temporalEnabled === false
                    ? 'temporal projection unavailable; last-known-good non-temporal branches only'
                    : input.startTime !== undefined || input.endTime !== undefined
                        ? 'continuous temporal surface navigation across adjacent windows'
                        : 'term-only branch traversal',
                input.entityNeuronIds?.length ? 'dense time-branch-entity joint search' : 'branch-local dense search'
            ]
        };
    }
    formatTemporalWindow(startTime, endTime) {
        if (startTime === undefined && endTime === undefined)
            return 'temporal window';
        const startLabel = startTime !== undefined ? new Date(startTime).toISOString().slice(0, 10) : 'open';
        const endLabel = endTime !== undefined ? new Date(endTime).toISOString().slice(0, 10) : 'open';
        return `${startLabel}..${endLabel}`;
    }
}
