import { KernelAgentMemoryBackend } from '../agent/index.js';
import type { MemoryKernel, MemoryKernelNavigationResult } from '../factory.js';

export interface RecallExplanationOptions {
  query: string;
  projectId?: string;
  agentId?: string;
  limit?: number;
  startTime?: number;
  endTime?: number;
}

export interface RecallExplanationEvidence {
  id: string;
  text: string;
  projectId?: string;
  topicPath?: string;
  tags: string[];
  source?: string;
}

export interface RecallExplanation {
  query: string;
  projectId?: string;
  agentId?: string;
  recallMode: MemoryKernelNavigationResult['recallMode'];
  fallbackUsed: boolean;
  narrative?: NonNullable<MemoryKernelNavigationResult['navigation']>['narrative'];
  pulseTrace?: NonNullable<MemoryKernelNavigationResult['navigation']>['pulse']['trace'];
  temporalTraversal?: NonNullable<MemoryKernelNavigationResult['navigation']>['branchSearch']['temporalTraversal'];
  runtime?: NonNullable<MemoryKernelNavigationResult['navigation']>['runtime'];
  evidence: RecallExplanationEvidence[];
}

export function explainRecallWithKernel(
  kernel: MemoryKernel,
  options: RecallExplanationOptions,
): RecallExplanation {
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
