import type { MemoryGraph } from '../core/MemoryGraph.js';
import type { Neuron } from '../types/index.js';
import { matchesProjectScope } from '../topology/ProjectScope.js';

export interface GraphCommunityEngineOptions {
  maxIterations?: number;
  minCommunitySize?: number;
  excludeArchived?: boolean;
  incrementalWindowMs?: number;
}

export class GraphCommunityEngine {
  constructor(
    private readonly memoryGraph: MemoryGraph,
    private readonly options: GraphCommunityEngineOptions = {}
  ) {}

  async run(projectId: string): Promise<{ communitiesDetected: number; neuronsUpdated: number }> {
    const maxIterations = this.options.maxIterations ?? 20;
    const minCommunitySize = this.options.minCommunitySize ?? 3;
    const allProjectNeurons = this.memoryGraph.getAllNeurons()
      .filter((neuron) => matchesProjectScope(projectId, neuron.metadata.projectId))
      .filter((neuron) => this.options.excludeArchived === false || neuron.metadata.status !== 'archived');
    const incrementalWindowMs = this.options.incrementalWindowMs ?? 48 * 60 * 60 * 1000;
    const changedIds = incrementalWindowMs === 0
      ? new Set(allProjectNeurons.map((neuron) => neuron.id))
      : new Set(allProjectNeurons
          .filter((neuron) => (neuron.metadata.updatedAt || neuron.metadata.createdAt || 0) > Date.now() - incrementalWindowMs)
          .map((neuron) => neuron.id));
    const touchedIds = new Set(changedIds);
    const allById = new Map(allProjectNeurons.map((neuron) => [neuron.id, neuron]));
    for (const neuron of allProjectNeurons) {
      if (changedIds.has(neuron.id)) {
        for (const id of this.neighborIds(neuron, allById)) touchedIds.add(id);
      } else if (this.neighborIds(neuron, allById).some((id) => changedIds.has(id))) {
        touchedIds.add(neuron.id);
      }
    }
    const neurons = allProjectNeurons.filter((neuron) => touchedIds.has(neuron.id));
    const byId = new Map(neurons.map((neuron) => [neuron.id, neuron]));
    const neighbors = new Map(neurons.map((neuron) => [neuron.id, this.neighborIds(neuron, byId)]));
    const labels = new Map(neurons.map((neuron) => [neuron.id, neuron.id]));

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      let changed = false;
      for (const neuron of neurons) {
        const next = mostFrequent((neighbors.get(neuron.id) || []).map((id) => labels.get(id) || id));
        if (next && labels.get(neuron.id) !== next) {
          labels.set(neuron.id, next);
          changed = true;
        }
      }
      if (!changed) break;
    }

    this.mergeSmallCommunities(labels, neighbors, minCommunitySize);
    let neuronsUpdated = 0;
    for (const [neuronId, communityId] of labels) {
      if (byId.get(neuronId)?.metadata.communityId === communityId) continue;
      this.memoryGraph.updateNeuronMetadata(neuronId, { communityId });
      neuronsUpdated += 1;
    }
    return { communitiesDetected: new Set(labels.values()).size, neuronsUpdated };
  }

  getCommunityMembers(communityId: string, projectId?: string): string[] {
    return this.memoryGraph.getAllNeurons()
      .filter((neuron) => neuron.metadata.communityId === communityId)
      .filter((neuron) => matchesProjectScope(projectId, neuron.metadata.projectId))
      .map((neuron) => neuron.id);
  }

  private neighborIds(neuron: Neuron, byId: Map<string, Neuron>): string[] {
    const out = neuron.synapses.map((synapse) => synapse.targetId).filter((id) => byId.has(id));
    const incoming = Array.from(byId.values())
      .filter((other) => other.synapses.some((synapse) => synapse.targetId === neuron.id))
      .map((other) => other.id);
    return Array.from(new Set([...out, ...incoming]));
  }

  private mergeSmallCommunities(labels: Map<string, string>, neighbors: Map<string, string[]>, minSize: number): void {
    const sizes = countLabels(labels);
    for (const [neuronId, label] of labels) {
      if ((sizes.get(label) || 0) >= minSize) continue;
      const replacement = mostFrequent((neighbors.get(neuronId) || []).map((id) => labels.get(id) || id));
      if (replacement) labels.set(neuronId, replacement);
    }
  }
}

function mostFrequent(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

function countLabels(labels: Map<string, string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const label of labels.values()) counts.set(label, (counts.get(label) || 0) + 1);
  return counts;
}
