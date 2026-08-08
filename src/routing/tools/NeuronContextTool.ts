/**
 * NeuronContextTool.ts
 * get_neuron_context tool — fetches a neuron's full content + 1-hop neighbors.
 * Phase 48 — v1.1
 */

import type { MemoryGraph } from '../../core/MemoryGraph.js';
import type { GraphEdgeStoreLike } from '../../types/ExtensionPoints.js';
import { matchesProjectScope } from '../../topology/ProjectScope.js';

/** SI-16: max content length returned per neuron */
const MAX_CONTENT_LENGTH = 2000;

export interface NeuronSummary {
  neuronId: string;
  content: string; // truncated to 200 chars
  tags: string[];
  type: string;
  projectId?: string;
}

export interface NeuronContextOutput {
  neuron: {
    neuronId: string;
    content: string;   // truncated to MAX_CONTENT_LENGTH
    tags: string[];
    type: string;
    createdAt: number;
    projectId?: string;
  };
  neighbors: NeuronSummary[];
}

export class NeuronContextTool {
  constructor(
    private readonly memoryGraph: MemoryGraph,
    private readonly graphEdgeStore?: GraphEdgeStoreLike
  ) {}

  execute(neuronId: string, projectId?: string): NeuronContextOutput | null {
    const neuron = this.memoryGraph.getNeuron(neuronId);
    if (!neuron) return null;
    if (!matchesProjectScope(projectId, neuron.metadata.projectId)) return null;

    // Truncate content per SI-16
    const truncatedContent = neuron.content.slice(0, MAX_CONTENT_LENGTH);

    // Find 1-hop neighbor IDs via plasticity graph edges
    const neighborIds = new Set<string>();
    if (this.graphEdgeStore?.list) {
      const activeEdges = this.graphEdgeStore.list({ status: 'active', limit: 200 });
      for (const edge of activeEdges) {
        if (edge.fromNodeId === neuronId && edge.toNodeId !== undefined) neighborIds.add(edge.toNodeId);
        if (edge.toNodeId === neuronId && edge.fromNodeId !== undefined) neighborIds.add(edge.fromNodeId);
      }
    }

    // Also include synapse-linked neurons
    for (const synapse of neuron.synapses) {
      neighborIds.add(synapse.targetId);
    }

    // Resolve neighbor neurons (skip self)
    const neighbors: NeuronSummary[] = [];
    for (const nid of neighborIds) {
      if (nid === neuronId) continue;
      const n = this.memoryGraph.getNeuron(nid);
      if (n && matchesProjectScope(projectId, n.metadata.projectId)) {
        neighbors.push({
          neuronId: n.id,
          content: n.content.slice(0, 200),
          tags: n.metadata.tags ?? [],
          type: n.metadata.type,
          projectId: n.metadata.projectId,
        });
      }
    }

    return {
      neuron: {
        neuronId: neuron.id,
        content: truncatedContent,
        tags: neuron.metadata.tags ?? [],
        type: neuron.metadata.type,
        createdAt: neuron.metadata.createdAt,
        projectId: neuron.metadata.projectId,
      },
      neighbors,
    };
  }
}
