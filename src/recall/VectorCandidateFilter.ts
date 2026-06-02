import type { MemoryGraph } from '../core/MemoryGraph.js';
import type { Neuron } from '../types/index.js';
import { isRecallableMemoryEvidence } from './RecallGovernance.js';

export interface VectorFilterContext {
  projectId?: string;
  topicPath?: string;
  queryTime: number;
  maxStaleMs?: number;
  entityHints?: string[];
}

export interface VectorFilterRule {
  name: string;
  filter(neuronIds: string[], context: VectorFilterContext): string[];
}

export class VectorCandidateFilter {
  constructor(private readonly rules: VectorFilterRule[] = []) {}

  filter(neuronIds: string[], ctx: VectorFilterContext): string[] {
    return this.rules.reduce((ids, rule) => rule.filter(ids, ctx), neuronIds);
  }
}

abstract class MemoryGraphVectorFilterRule implements VectorFilterRule {
  abstract readonly name: string;
  abstract filter(neuronIds: string[], context: VectorFilterContext): string[];
  constructor(protected readonly memoryGraph: MemoryGraph) {}

  protected neuron(id: string): Neuron | null {
    return this.memoryGraph.getNeuron(id);
  }
}

export class WorkspaceFilter extends MemoryGraphVectorFilterRule {
  readonly name = 'workspace';

  filter(neuronIds: string[], context: VectorFilterContext): string[] {
    if (!context.projectId) return neuronIds;
    return neuronIds.filter((id) => this.neuron(id)?.metadata.projectId === context.projectId);
  }
}

export class TopicFilter extends MemoryGraphVectorFilterRule {
  readonly name = 'topic';

  filter(neuronIds: string[], context: VectorFilterContext): string[] {
    if (!context.topicPath) return neuronIds;
    const prefix = context.topicPath;
    return neuronIds.filter((id) => {
      const topicPath = this.neuron(id)?.metadata.topicPath;
      if (!topicPath) return false;
      return topicPath === prefix || topicPath.startsWith(`${prefix}/`);
    });
  }
}

export class StaleFilter extends MemoryGraphVectorFilterRule {
  readonly name = 'stale';

  filter(neuronIds: string[], context: VectorFilterContext): string[] {
    const maxStaleMs = context.maxStaleMs ?? 90 * 24 * 60 * 60 * 1000;
    const cutoff = context.queryTime - maxStaleMs;
    return neuronIds.filter((id) => (this.neuron(id)?.metadata.createdAt ?? 0) >= cutoff);
  }
}

export class StatusFilter extends MemoryGraphVectorFilterRule {
  readonly name = 'status';

  filter(neuronIds: string[], _context: VectorFilterContext): string[] {
    return neuronIds.filter((id) => {
      const neuron = this.neuron(id);
      return isRecallableMemoryEvidence(neuron);
    });
  }
}

export class CredibilityFilter extends MemoryGraphVectorFilterRule {
  readonly name = 'credibility';

  constructor(memoryGraph: MemoryGraph, private readonly threshold = 0.3) {
    super(memoryGraph);
  }

  filter(neuronIds: string[], _context: VectorFilterContext): string[] {
    return neuronIds.filter((id) => (this.neuron(id)?.metadata.confidence ?? 1) >= this.threshold);
  }
}

export function createDefaultVectorCandidateFilter(memoryGraph: MemoryGraph): VectorCandidateFilter {
  return new VectorCandidateFilter([
    new WorkspaceFilter(memoryGraph),
    new TopicFilter(memoryGraph),
    new StaleFilter(memoryGraph),
    new StatusFilter(memoryGraph),
    new CredibilityFilter(memoryGraph),
  ]);
}
