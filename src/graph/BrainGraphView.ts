import type { MemoryEdgeRecord } from '../binding/MemoryBindingTypes.js';
import { MemoryBindingStore } from '../store/MemoryBindingStore.js';

export interface BrainGraphTraversalOptions {
  projectId?: string;
  maxHops?: number;
  limit?: number;
}

export interface BrainGraphTraversalResult {
  rootId: string;
  nodeIds: string[];
  edges: MemoryEdgeRecord[];
  evidenceEventIds: string[];
  truncated: boolean;
}

export class BrainGraphView {
  constructor(private readonly store: MemoryBindingStore) {}

  neighbors(rootId: string, options: BrainGraphTraversalOptions = {}): BrainGraphTraversalResult {
    const maxHops = Math.max(1, Math.min(2, Math.floor(options.maxHops ?? 1)));
    const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 20)));
    const visited = new Set([rootId]);
    let frontier = [rootId];
    const edges = new Map<string, MemoryEdgeRecord>();

    for (let hop = 0; hop < maxHops && frontier.length > 0 && edges.size < limit; hop += 1) {
      const next: string[] = [];
      for (const nodeId of frontier) {
        const candidates = [
          ...this.store.listEdges({ projectId: options.projectId, sourceId: nodeId, limit }),
          ...this.store.listEdges({ projectId: options.projectId, targetId: nodeId, limit }),
        ];
        for (const edge of candidates) {
          if (edge.status !== 'active' || edges.has(edge.edgeId)) continue;
          edges.set(edge.edgeId, edge);
          const neighborId = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            next.push(neighborId);
          }
          if (edges.size >= limit) break;
        }
        if (edges.size >= limit) break;
      }
      frontier = next;
    }

    const selectedEdges = [...edges.values()];
    return {
      rootId,
      nodeIds: [...visited],
      edges: selectedEdges,
      evidenceEventIds: [...new Set(selectedEdges.flatMap((edge) => edge.evidenceEventIds))],
      truncated: edges.size >= limit,
    };
  }
}
