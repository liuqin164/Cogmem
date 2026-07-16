import type { TopologyStore } from '../store/TopologyStore.js';
import type { TemporalAdjacencyStore, TemporalSurfaceSegment } from '../store/TemporalAdjacencyStore.js';

export interface TemporalTraversalSegment extends TemporalSurfaceSegment {
  branchIds: string[];
  taskIds: string[];
  clusterIds: string[];
}

export interface TemporalBranchSearchResult {
  neuronIds: string[];
  branchIds: string[];
  taskIds: string[];
  clusterIds: string[];
  temporalTraversal: {
    bucketType: 'day' | 'week' | 'month';
    bucketIds: string[];
    labels: string[];
    neuronIds: string[];
    segments: TemporalTraversalSegment[];
    traversalMode: 'surface' | 'adjacent_fallback' | 'nearest_fallback';
  };
  denseJointNeuronIds: string[];
  reasons: string[];
}

export class TemporalBranchSearch {
  constructor(
    private topologyStore: TopologyStore,
    private temporalAdjacencyStore: TemporalAdjacencyStore
  ) {}

  search(input: {
    projectId?: string;
    startTime?: number;
    endTime?: number;
    terms: string[];
    temporalBucketIds?: string[];
    entityNeuronIds?: string[];
  }): TemporalBranchSearchResult {
    const candidates = this.topologyStore.collectCandidateNeuronIds({
      projectId: input.projectId,
      startTime: input.startTime,
      endTime: input.endTime,
      terms: input.terms,
      limit: 120
    });

    const branches = this.topologyStore.collectBranchNavigation({
      projectId: input.projectId,
      terms: input.terms,
      limit: 80,
      siblingDepth: 1
    });
    const aggregatedBranchIds = new Set<string>(branches.branchIds);
    const aggregatedTaskIds = new Set<string>(branches.taskIds);
    const aggregatedClusterIds = new Set<string>(branches.clusterIds);
    const aggregatedNeuronIds = new Set<string>([...candidates, ...branches.neuronIds]);

    const temporalSurface = this.temporalAdjacencyStore.collectContinuousSurface({
      projectId: input.projectId,
      bucketIds: input.temporalBucketIds || [],
      startTime: input.startTime,
      endTime: input.endTime,
      preferredBucketType: 'day',
      hopLimit: input.startTime || input.endTime ? 3 : 2,
      limit: 72
    });
    const fallbackLabels =
      temporalSurface.labels.length > 0
        ? temporalSurface.labels
        : input.startTime || input.endTime
          ? [this.formatTemporalWindow(input.startTime, input.endTime)]
          : [];
    const fallbackBucketIds =
      temporalSurface.bucketIds.length > 0
        ? temporalSurface.bucketIds
        : fallbackLabels.map((_, index) => `derived:${index}:${input.startTime || 0}:${input.endTime || 0}`);
    const fallbackTemporalNeuronIds =
      temporalSurface.neuronIds.length > 0
        ? temporalSurface.neuronIds
        : branches.neuronIds.slice(0, 24);
    const traversalMode: TemporalBranchSearchResult['temporalTraversal']['traversalMode'] =
      temporalSurface.segments.some((segment) => segment.source === 'window' || segment.source === 'seed')
        ? 'surface'
        : temporalSurface.segments.some((segment) => segment.source === 'adjacent')
          ? 'adjacent_fallback'
          : 'nearest_fallback';
    const linkedSegments: TemporalTraversalSegment[] = temporalSurface.segments.map((segment) => {
      const navigation = this.topologyStore.collectNavigationFromNeuronIds({
        neuronIds: segment.neuronIds,
        projectId: input.projectId,
        limit: 16,
        siblingDepth: 0
      });

      for (const branchId of navigation.branchIds) aggregatedBranchIds.add(branchId);
      for (const taskId of navigation.taskIds) aggregatedTaskIds.add(taskId);
      for (const clusterId of navigation.clusterIds) aggregatedClusterIds.add(clusterId);
      for (const neuronId of navigation.neuronIds) aggregatedNeuronIds.add(neuronId);

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
        input.startTime || input.endTime ? 'continuous temporal surface navigation across adjacent windows' : 'term-only branch traversal',
        input.entityNeuronIds?.length ? 'dense time-branch-entity joint search' : 'branch-local dense search'
      ]
    };
  }

  private formatTemporalWindow(startTime?: number, endTime?: number): string {
    if (!startTime && !endTime) return 'temporal window';
    const startLabel = startTime ? new Date(startTime).toISOString().slice(0, 10) : 'open';
    const endLabel = endTime ? new Date(endTime).toISOString().slice(0, 10) : 'open';
    return `${startLabel}..${endLabel}`;
  }
}
