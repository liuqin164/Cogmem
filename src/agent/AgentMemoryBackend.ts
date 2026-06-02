import type { MemoryKernel, MemoryKernelNavigationResult } from '../factory.js';
import { isRecallableMemoryEvidence } from '../recall/RecallGovernance.js';

export interface AgentTurnMemory {
  agentId: string;
  projectId: string;
  sessionId: string;
  userText: string;
  assistantText?: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentRecallQuery {
  agentId: string;
  projectId: string;
  query: string;
  limit?: number;
  startTime?: number;
  endTime?: number;
}

export interface AgentRecallItem {
  id: string;
  text: string;
  projectId?: string;
  topicPath?: string;
  tags: string[];
  source?: string;
}

export interface AgentRecallResult {
  recallMode: MemoryKernelNavigationResult['recallMode'];
  items: AgentRecallItem[];
  narrative?: NonNullable<MemoryKernelNavigationResult['navigation']>['narrative'];
  pulseTrace?: NonNullable<MemoryKernelNavigationResult['navigation']>['pulse']['trace'];
  temporalTraversal?: NonNullable<MemoryKernelNavigationResult['navigation']>['branchSearch']['temporalTraversal'];
  runtime?: NonNullable<MemoryKernelNavigationResult['navigation']>['runtime'];
  fallbackUsed: boolean;
}

export class KernelAgentMemoryBackend {
  constructor(private readonly kernel: MemoryKernel) {}

  async rememberTurn(turn: AgentTurnMemory): Promise<void> {
    const content = [
      `User: ${turn.userText}`,
      turn.assistantText ? `Agent: ${turn.assistantText}` : '',
    ].filter(Boolean).join('\n');

    await this.kernel.ingest({
      content,
      projectId: turn.projectId,
      createdAt: turn.timestamp,
      source: `${turn.agentId}:${turn.sessionId}`,
      tags: [
        `agent:${turn.agentId}`,
        `session:${turn.sessionId}`,
      ],
    });
  }

  recall(query: AgentRecallQuery): AgentRecallResult {
    const limit = query.limit ?? 5;
    const retrievalLimit = Math.max(limit * 4, 24);
    const result = this.kernel.navigateMemory(query.query, {
      projectId: query.projectId,
      limit: retrievalLimit,
      startTime: query.startTime,
      endTime: query.endTime,
    });
    const scopedEvidence = this.filterAgentEvidence(result.rawEvidence, query.agentId).slice(0, limit);
    if (scopedEvidence.length > 0) {
      return {
        recallMode: result.recallMode,
        items: scopedEvidence.map((neuron) => this.toAgentRecallItem(neuron)),
        narrative: result.navigation?.narrative,
        pulseTrace: result.navigation?.pulse.trace,
        temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
        runtime: result.navigation?.runtime,
        fallbackUsed: result.fallbackUsed,
      };
    }

    const fallback = this.kernel.recall(query.query, {
      projectId: query.projectId,
      limit: retrievalLimit,
    });

    return {
      recallMode: 'brain_recall_fallback',
      items: this.filterAgentEvidence(fallback.rawEvidence, query.agentId)
        .slice(0, limit)
        .map((neuron) => this.toAgentRecallItem(neuron)),
      narrative: result.navigation?.narrative,
      pulseTrace: result.navigation?.pulse.trace,
      temporalTraversal: result.navigation?.branchSearch.temporalTraversal,
      runtime: result.navigation?.runtime,
      fallbackUsed: true,
    };
  }

  private filterAgentEvidence(
    neurons: MemoryKernelNavigationResult['rawEvidence'],
    agentId: string
  ): MemoryKernelNavigationResult['rawEvidence'] {
    return neurons.filter((neuron) => {
      if (!isRecallableMemoryEvidence(neuron)) return false;
      const tags = neuron.metadata.tags || [];
      const explicitAgentTags = tags.filter((tag) => tag.startsWith('agent:'));
      if (explicitAgentTags.length === 0) return true;
      return explicitAgentTags.includes(`agent:${agentId}`) || tags.includes(agentId);
    });
  }

  private toAgentRecallItem(neuron: MemoryKernelNavigationResult['rawEvidence'][number]): AgentRecallItem {
    return {
      id: neuron.id,
      text: neuron.content,
      projectId: neuron.metadata.projectId,
      topicPath: neuron.metadata.topicPath,
      tags: neuron.metadata.tags || [],
      source: neuron.metadata.filePath || neuron.metadata.sourceEventId,
    };
  }
}
