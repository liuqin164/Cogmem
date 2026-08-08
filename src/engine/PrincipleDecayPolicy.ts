import type { MemoryGraph } from '../core/MemoryGraph.js';
import { matchesProjectScope } from '../topology/ProjectScope.js';
import type { Neuron } from '../types/index.js';

export interface PrincipleDecayPolicyOptions {
  staleDaysMs?: number;
  reinforcementOverlapThreshold?: number;
}

export interface PrincipleDecayPolicyResult {
  reinforced: number;
  degraded: number;
  markedStale: number;
}

export class PrincipleDecayPolicy {
  constructor(
    private readonly memoryGraph: MemoryGraph,
    private readonly options: PrincipleDecayPolicyOptions = {}
  ) {}

  async run(projectId: string): Promise<PrincipleDecayPolicyResult> {
    const now = Date.now();
    const staleDaysMs = this.options.staleDaysMs ?? 90 * 24 * 60 * 60 * 1000;
    const overlapThreshold = this.options.reinforcementOverlapThreshold ?? 0.3;
    const neurons = this.memoryGraph.getAllNeurons().filter((neuron) => matchesProjectScope(projectId, neuron.metadata.projectId));
    const principles = neurons.filter((neuron) => neuron.metadata.type === 'cross_domain_principle');
    const semantics = neurons.filter((neuron) => neuron.metadata.type === 'semantic_consolidation');
    let reinforced = 0;
    let degraded = 0;
    let markedStale = 0;

    for (const principle of principles) {
      const principleTopics = sourceTopics(principle);
      const lastReinforcedAt = principle.metadata.lastReinforcedAt ?? principle.metadata.createdAt ?? 0;
      const reinforcingSemantic = semantics.find((semantic) =>
        (semantic.metadata.createdAt || 0) > lastReinforcedAt
        && tagOverlap(principleTopics, semanticTags(semantic)) >= overlapThreshold
      );
      if (reinforcingSemantic) {
        this.memoryGraph.updateNeuronMetadata(principle.id, { lastReinforcedAt: now });
        principle.metadata.lastReinforcedAt = now;
        reinforced += 1;
      }

      const referencedSources = principle.synapses
        .filter((synapse) => synapse.type === 'Referenced')
        .map((synapse) => this.memoryGraph.getNeuron(synapse.targetId))
        .filter((neuron): neuron is Neuron => Boolean(neuron))
        .filter((neuron) => neuron.metadata.type === 'semantic_consolidation');
      if (
        referencedSources.length > 0
        && referencedSources.every((source) => source.metadata.status === 'cold' || source.metadata.status === 'suspect' || source.metadata.status === 'archived')
        && principle.metadata.status !== 'suspect'
      ) {
        this.memoryGraph.updateNeuronMetadata(principle.id, { status: 'suspect' });
        principle.metadata.status = 'suspect';
        markedStale += 1;
      }

      // v1.9.4 principles predate lastReinforcedAt; use createdAt so legacy
      // principles age naturally instead of being permanently exempt.
      const effectiveLastReinforcedAt = principle.metadata.lastReinforcedAt ?? principle.metadata.createdAt ?? 0;
      if (
        principle.metadata.importanceLevel === 'permanent'
        && effectiveLastReinforcedAt < now - staleDaysMs
      ) {
        this.memoryGraph.updateNeuronMetadata(principle.id, { importanceLevel: 'important' });
        principle.metadata.importanceLevel = 'important';
        degraded += 1;
      }
    }

    return { reinforced, degraded, markedStale };
  }
}

function sourceTopics(neuron: Neuron): string[] {
  return (neuron.metadata.tags || []).filter((tag) => tag !== 'cross_domain');
}

function semanticTags(neuron: Neuron): string[] {
  return Array.from(new Set([...(neuron.metadata.tags || []), neuron.metadata.topicPath].filter((tag): tag is string => Boolean(tag))));
}

function tagOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  return left.filter((tag) => rightSet.has(tag)).length / Math.max(left.length, right.length);
}
