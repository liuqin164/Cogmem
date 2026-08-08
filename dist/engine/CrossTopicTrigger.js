import { matchesProjectScope } from '../topology/ProjectScope.js';
export class CrossTopicTrigger {
    memoryGraph;
    options;
    lastTriggeredByBatch = new Map();
    constructor(memoryGraph, options = {}) {
        this.memoryGraph = memoryGraph;
        this.options = options;
    }
    findCandidateBatches(projectId) {
        const semanticThreshold = this.options.semanticThreshold ?? 8;
        const minDistinctTopics = this.options.minDistinctTopics ?? 3;
        const cooldownMs = this.options.cooldownMs ?? 48 * 60 * 60 * 1000;
        const semantic = this.memoryGraph.getAllNeurons()
            .filter((neuron) => matchesProjectScope(projectId, neuron.metadata.projectId))
            .filter((neuron) => neuron.metadata.type === 'semantic_consolidation')
            .sort((a, b) => (b.metadata.createdAt || 0) - (a.metadata.createdAt || 0));
        const topics = Array.from(new Set(semantic.map((neuron) => neuron.metadata.topicPath || topicFromTags(neuron.metadata.tags || [])).filter((topic) => Boolean(topic))));
        const ids = semantic.map((neuron) => neuron.id);
        const key = ids.slice().sort().join('|');
        const lastTriggered = this.lastTriggeredByBatch.get(key) || 0;
        if (semantic.length < semanticThreshold || topics.length < minDistinctTopics || Date.now() - lastTriggered < cooldownMs)
            return [];
        this.lastTriggeredByBatch.set(key, Date.now());
        return [{ semanticNeuronIds: ids, distinctTopics: topics }];
    }
}
function topicFromTags(tags) {
    return tags.find((tag) => tag.startsWith('topic:'))?.slice('topic:'.length);
}
