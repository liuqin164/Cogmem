import { isRecallableMemoryEvidence } from './RecallGovernance.js';
export class VectorCandidateFilter {
    rules;
    constructor(rules = []) {
        this.rules = rules;
    }
    filter(neuronIds, ctx) {
        return this.rules.reduce((ids, rule) => rule.filter(ids, ctx), neuronIds);
    }
}
class MemoryGraphVectorFilterRule {
    memoryGraph;
    constructor(memoryGraph) {
        this.memoryGraph = memoryGraph;
    }
    neuron(id) {
        return this.memoryGraph.getNeuron(id);
    }
}
export class WorkspaceFilter extends MemoryGraphVectorFilterRule {
    name = 'workspace';
    filter(neuronIds, context) {
        if (!context.projectId)
            return neuronIds;
        return neuronIds.filter((id) => this.neuron(id)?.metadata.projectId === context.projectId);
    }
}
export class TopicFilter extends MemoryGraphVectorFilterRule {
    name = 'topic';
    filter(neuronIds, context) {
        if (!context.topicPath)
            return neuronIds;
        const prefix = context.topicPath;
        return neuronIds.filter((id) => {
            const topicPath = this.neuron(id)?.metadata.topicPath;
            if (!topicPath)
                return false;
            return topicPath === prefix || topicPath.startsWith(`${prefix}/`);
        });
    }
}
export class StaleFilter extends MemoryGraphVectorFilterRule {
    name = 'stale';
    filter(neuronIds, context) {
        const maxStaleMs = context.maxStaleMs ?? 90 * 24 * 60 * 60 * 1000;
        const cutoff = context.queryTime - maxStaleMs;
        return neuronIds.filter((id) => (this.neuron(id)?.metadata.createdAt ?? 0) >= cutoff);
    }
}
export class StatusFilter extends MemoryGraphVectorFilterRule {
    name = 'status';
    filter(neuronIds, _context) {
        return neuronIds.filter((id) => {
            const neuron = this.neuron(id);
            return isRecallableMemoryEvidence(neuron);
        });
    }
}
export class CredibilityFilter extends MemoryGraphVectorFilterRule {
    threshold;
    name = 'credibility';
    constructor(memoryGraph, threshold = 0.3) {
        super(memoryGraph);
        this.threshold = threshold;
    }
    filter(neuronIds, _context) {
        return neuronIds.filter((id) => (this.neuron(id)?.metadata.confidence ?? 1) >= this.threshold);
    }
}
export function createDefaultVectorCandidateFilter(memoryGraph) {
    return new VectorCandidateFilter([
        new WorkspaceFilter(memoryGraph),
        new TopicFilter(memoryGraph),
        new StaleFilter(memoryGraph),
        new StatusFilter(memoryGraph),
        new CredibilityFilter(memoryGraph),
    ]);
}
