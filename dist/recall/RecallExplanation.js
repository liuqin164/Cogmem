import { KernelAgentMemoryBackend } from '../agent/index.js';
export function explainRecallWithKernel(kernel, options) {
    const limit = Math.max(1, options.limit ?? 8);
    if (options.agentId) {
        const memory = new KernelAgentMemoryBackend(kernel);
        const recalled = memory.recall({
            agentId: options.agentId,
            projectId: options.projectId || options.agentId,
            query: options.query,
            limit,
            startTime: options.startTime,
            endTime: options.endTime,
        });
        return {
            query: options.query,
            projectId: options.projectId,
            agentId: options.agentId,
            recallMode: recalled.recallMode,
            fallbackUsed: recalled.fallbackUsed,
            narrative: recalled.narrative,
            pulseTrace: recalled.pulseTrace,
            temporalTraversal: recalled.temporalTraversal,
            runtime: recalled.runtime,
            evidence: recalled.items.map((item) => ({
                id: item.id,
                text: item.text,
                projectId: item.projectId,
                topicPath: item.topicPath,
                tags: item.tags,
                source: item.source,
            })),
        };
    }
    const navigated = kernel.navigateMemory(options.query, {
        projectId: options.projectId,
        limit,
        startTime: options.startTime,
        endTime: options.endTime,
    });
    return {
        query: options.query,
        projectId: options.projectId,
        recallMode: navigated.recallMode,
        fallbackUsed: navigated.fallbackUsed,
        narrative: navigated.navigation?.narrative,
        pulseTrace: navigated.navigation?.pulse.trace,
        temporalTraversal: navigated.navigation?.branchSearch.temporalTraversal,
        runtime: navigated.navigation?.runtime,
        evidence: navigated.rawEvidence.map((neuron) => ({
            id: neuron.id,
            text: neuron.content,
            projectId: neuron.metadata.projectId,
            topicPath: neuron.metadata.topicPath,
            tags: neuron.metadata.tags || [],
            source: neuron.metadata.filePath,
        })),
    };
}
