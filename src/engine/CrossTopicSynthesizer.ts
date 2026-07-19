import { NeuronFactory } from '../core/Neuron.js';
import type { MemoryGraph } from '../core/MemoryGraph.js';
import type { BrainRecallResult } from '../types/BrainRecallResult.js';
import type { IterativeLLMClarifier } from '../routing/IterativeLLMClarifier.js';
import type { CrossTopicTrigger } from './CrossTopicTrigger.js';
import { matchesProjectScope } from '../topology/ProjectScope.js';

export interface CrossSynthesisInput {
  projectId: string;
  semanticNeuronIds: string[];
  distinctTopics: string[];
}

export interface CrossSynthesisResult {
  principleNeuronId: string;
  principle: string;
  sourceTopics: string[];
  createdAt: number;
}

export class CrossTopicSynthesizer {
  constructor(
    private readonly memoryGraph: MemoryGraph,
    private readonly trigger: CrossTopicTrigger,
    private readonly clarifier: IterativeLLMClarifier,
    private readonly options: { maxSourceNeuronsPerBatch?: number } = {}
  ) {}

  async run(projectId: string): Promise<{ principleNeuronsCreated: number }> {
    let principleNeuronsCreated = 0;
    for (const batch of this.trigger.findCandidateBatches(projectId)) {
      const result = await this.synthesize({ projectId, ...batch });
      if (result) principleNeuronsCreated += 1;
    }
    return { principleNeuronsCreated };
  }

  private async synthesize(input: CrossSynthesisInput): Promise<CrossSynthesisResult | null> {
    const sources = input.semanticNeuronIds
      .map((id) => this.memoryGraph.getNeuron(id))
      .filter((neuron): neuron is NonNullable<typeof neuron> => Boolean(neuron))
      .filter((neuron) => matchesProjectScope(input.projectId, neuron.metadata.projectId))
      .slice(0, this.options.maxSourceNeuronsPerBatch ?? 20);
    if (sources.length === 0) return null;
    const prompt = [
      'Synthesize these semantic consolidations into one cross-domain principle.',
      'Return the principle as plain text only.',
      `Topics: ${input.distinctTopics.join(', ')}`,
      JSON.stringify(sources.map((neuron) => ({ id: neuron.id, topic: neuron.metadata.topicPath, content: neuron.content.slice(0, 400) })))
    ].join('\n');
    const result = await this.clarifier.clarify(prompt, emptyRecallResult(prompt));
    const principle = result.finalAnswer.trim() || 'Multiple topics share a durable cross-domain operating principle.';
    const createdAt = Date.now();
    const neuron = NeuronFactory.create(principle, this.memoryGraph.getLatestNeuronSelfHash(input.projectId) || 'genesis', { T: createdAt, S: [0, 0, 0], V: [] }, {
      projectId: input.projectId,
      topicPath: 'cross_domain',
      type: 'cross_domain_principle',
      createdAt,
      updatedAt: createdAt,
      status: 'active',
      tags: ['cross_domain', ...input.distinctTopics],
      sourceType: 'llm_inference',
      importanceLevel: 'permanent',
      isPinned: true,
      stability: 1,
      lastReinforcedAt: createdAt,
      aaak_summary: principle
    });
    this.memoryGraph.addNeuron(neuron);
    for (const source of sources) this.memoryGraph.addSynapse(neuron.id, { targetId: source.id, type: 'Referenced', weight: 1 });
    return { principleNeuronId: neuron.id, principle, sourceTopics: input.distinctTopics, createdAt };
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
