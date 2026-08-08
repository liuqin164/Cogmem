import type { MemoryGraph } from '../core/MemoryGraph.js';
import { matchesProjectScope } from '../topology/ProjectScope.js';

export interface CrossTopicTriggerOptions {
  semanticThreshold?: number;
  minDistinctTopics?: number;
  cooldownMs?: number;
}

export class CrossTopicTrigger {
  private readonly lastTriggeredByBatch = new Map<string, number>();

  constructor(
    private readonly memoryGraph: MemoryGraph,
    private readonly options: CrossTopicTriggerOptions = {}
  ) {}

  findCandidateBatches(projectId: string): Array<{ semanticNeuronIds: string[]; distinctTopics: string[] }> {
    const semanticThreshold = this.options.semanticThreshold ?? 8;
    const minDistinctTopics = this.options.minDistinctTopics ?? 3;
    const cooldownMs = this.options.cooldownMs ?? 48 * 60 * 60 * 1000;
    const semantic = this.memoryGraph.getAllNeurons()
      .filter((neuron) => matchesProjectScope(projectId, neuron.metadata.projectId))
      .filter((neuron) => neuron.metadata.type === 'semantic_consolidation')
      .sort((a, b) => (b.metadata.createdAt || 0) - (a.metadata.createdAt || 0));
    const topics = Array.from(new Set(semantic.map((neuron) => neuron.metadata.topicPath || topicFromTags(neuron.metadata.tags || [])).filter((topic): topic is string => Boolean(topic))));
    const ids = semantic.map((neuron) => neuron.id);
    const key = ids.slice().sort().join('|');
    const lastTriggered = this.lastTriggeredByBatch.get(key) || 0;
    if (semantic.length < semanticThreshold || topics.length < minDistinctTopics || Date.now() - lastTriggered < cooldownMs) return [];
    this.lastTriggeredByBatch.set(key, Date.now());
    return [{ semanticNeuronIds: ids, distinctTopics: topics }];
  }
}

function topicFromTags(tags: string[]): string | undefined {
  return tags.find((tag) => tag.startsWith('topic:'))?.slice('topic:'.length);
}
