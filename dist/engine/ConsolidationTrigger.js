import { matchesProjectScope } from '../topology/ProjectScope.js';
export class ConsolidationTrigger {
    memoryGraph;
    episodicThreshold;
    cooldownMs;
    constructor(memoryGraph, options = {}) {
        this.memoryGraph = memoryGraph;
        this.episodicThreshold = options.episodicThreshold ?? 20;
        this.cooldownMs = options.cooldownMs ?? 6 * 60 * 60 * 1000;
    }
    findCandidates(projectId) {
        const now = Date.now();
        const grouped = new Map();
        const neurons = this.memoryGraph.getAllNeurons()
            .filter((neuron) => matchesProjectScope(projectId, neuron.metadata.projectId))
            .filter((neuron) => isEpisodic(neuron));
        for (const neuron of neurons) {
            const topicPath = neuron.metadata.topicPath || 'global';
            const bucket = grouped.get(topicPath) || [];
            bucket.push(neuron);
            grouped.set(topicPath, bucket);
        }
        const semantic = this.memoryGraph.getAllNeurons()
            .filter((neuron) => matchesProjectScope(projectId, neuron.metadata.projectId) && neuron.metadata.type === 'semantic_consolidation');
        return Array.from(grouped.entries())
            .filter(([topicPath, items]) => items.length >= this.episodicThreshold && !this.inCooldown(topicPath, semantic, now))
            .map(([topicPath, items]) => ({
            topicPath,
            episodicNeuronIds: items.map((neuron) => neuron.id)
        }));
    }
    inCooldown(topicPath, semantic, now) {
        return semantic.some((neuron) => (neuron.metadata.tags || []).includes(`topic:${topicPath}`)
            && now - (neuron.metadata.createdAt || 0) < this.cooldownMs);
    }
}
function isEpisodic(neuron) {
    return neuron.metadata.type === 'chat'
        || neuron.metadata.type === 'agent_finding'
        || neuron.metadata.type === 'agent_observation'
        || neuron.metadata.type === 'doc';
}
