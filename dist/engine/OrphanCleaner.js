import { matchesProjectScope } from '../topology/ProjectScope.js';
export class OrphanCleaner {
    memoryGraph;
    options;
    constructor(memoryGraph, options = {}) {
        this.memoryGraph = memoryGraph;
        this.options = options;
    }
    async run(projectId) {
        const cutoff = Date.now() - (this.options.orphanAgeMs ?? 72 * 60 * 60 * 1000);
        const batchSize = this.options.batchSize ?? 200;
        const candidates = this.memoryGraph.getAllNeurons()
            .filter((neuron) => matchesProjectScope(projectId, neuron.metadata.projectId))
            .filter((neuron) => neuron.metadata.status === 'active')
            .filter((neuron) => (neuron.metadata.createdAt || 0) < cutoff)
            .filter((neuron) => neuron.metadata.importanceLevel === 'low' || neuron.metadata.importanceLevel === 'normal' || !neuron.metadata.importanceLevel)
            .filter((neuron) => neuron.metadata.type !== 'semantic_consolidation' && neuron.metadata.type !== 'cross_domain_principle' && neuron.metadata.type !== 'skill')
            .filter((neuron) => this.degree(neuron.id) === 0)
            .slice(0, batchSize);
        for (const neuron of candidates)
            this.memoryGraph.updateNeuronMetadata(neuron.id, { status: 'suspect' });
        return { orphansMarked: candidates.length };
    }
    degree(neuronId) {
        return this.memoryGraph.getSynapses(neuronId).length
            + this.memoryGraph.getAllNeurons().filter((neuron) => neuron.synapses.some((synapse) => synapse.targetId === neuronId)).length;
    }
}
