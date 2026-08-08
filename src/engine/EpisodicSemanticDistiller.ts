import { NeuronFactory } from '../core/Neuron.js';
import type { MemoryGraph } from '../core/MemoryGraph.js';
import { matchesProjectScope } from '../topology/ProjectScope.js';
import type { BrainRecallResult } from '../types/BrainRecallResult.js';
import type { IterativeLLMClarifier } from '../routing/IterativeLLMClarifier.js';

export interface DistillationInput {
  projectId: string;
  episodicNeuronIds: string[];
  topicPath?: string;
}

export interface DistillationResult {
  semanticNeuronId: string;
  principle: string;
  sourceNeuronCount: number;
  createdAt: number;
}

export class EpisodicSemanticDistiller {
  private readonly maxEpisodicPerBatch: number;
  private readonly minBatchSize: number;

  constructor(
    private readonly memoryGraph: MemoryGraph,
    private readonly clarifier: IterativeLLMClarifier,
    options: { maxEpisodicPerBatch?: number; minBatchSize?: number } = {}
  ) {
    this.maxEpisodicPerBatch = options.maxEpisodicPerBatch ?? 50;
    this.minBatchSize = options.minBatchSize ?? 5;
  }

  async distill(input: DistillationInput): Promise<DistillationResult | null> {
    const sources = input.episodicNeuronIds
      .map((id) => this.memoryGraph.getNeuron(id))
      .filter((neuron): neuron is NonNullable<typeof neuron> => Boolean(neuron))
      .filter((neuron) => matchesProjectScope(input.projectId, neuron.metadata.projectId))
      .slice(0, this.maxEpisodicPerBatch);
    if (sources.length < this.minBatchSize) return null;

    const prompt = [
      'Distill these episodic memories into one durable semantic principle.',
      'Return the principle as plain text only.',
      `Project: ${input.projectId}`,
      input.topicPath ? `Topic: ${input.topicPath}` : '',
      JSON.stringify(sources.map((neuron) => ({ id: neuron.id, content: neuron.content.slice(0, 400) })))
    ].filter(Boolean).join('\n');
    const result = await this.clarifier.clarify(prompt, emptyRecallResult(prompt));
    const principle = result.finalAnswer.trim() || 'Repeated episodes share a durable behavioral principle.';
    const createdAt = Date.now();
    const topicPath = input.topicPath || sources[0]?.metadata.topicPath || 'global';
    const neuron = NeuronFactory.create(
      principle,
      this.memoryGraph.getLatestNeuronSelfHash(input.projectId) || 'genesis',
      { T: createdAt, S: [0, 0, 0], V: [] },
      {
        projectId: input.projectId,
        topicPath,
        type: 'semantic_consolidation',
        createdAt,
        updatedAt: createdAt,
        status: 'active',
        tags: ['consolidated', `topic:${topicPath}`, topicPath],
        sourceType: 'llm_inference',
        importanceLevel: 'important',
        isPinned: true,
        stability: 1,
        aaak_summary: principle
      }
    );
    this.memoryGraph.addNeuron(neuron);
    for (const source of sources) {
      this.memoryGraph.addSynapse(neuron.id, { targetId: source.id, type: 'Referenced', weight: 1 });
    }
    return {
      semanticNeuronId: neuron.id,
      principle,
      sourceNeuronCount: sources.length,
      createdAt
    };
  }
}

function emptyRecallResult(query: string): BrainRecallResult {
  return {
    query,
    strategy: { primaryLevel: 'compiled_memory', fallbackUsed: false },
    compiledMemory: { beliefs: [], facts: [], events: [], entityTimeline: [] },
    rawEvidence: [],
    fallbackSnippets: [],
    profileSignals: [],
    profileSurface: { userProfile: [], agentPersona: [] }
  };
}
