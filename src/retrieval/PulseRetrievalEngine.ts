import type { RetrievalExecutionPlan } from './RetrievalPlanner.js';
import type { QueryIR } from '../types/query-ir.js';
import type { TemporalAdjacencyStore } from '../store/TemporalAdjacencyStore.js';
import type { EntityActivationIndex } from './EntityActivationIndex.js';
import { EvidenceFusionRanker, type EvidenceSourceScore } from './EvidenceFusionRanker.js';

export interface PulseRetrievalResult {
  pulse0Ids: string[];
  pulse1Ids: string[];
  pulse2Ids: string[];
  fusedIds: string[];
  reasonsByNeuronId: Map<string, string[]>;
  trace: Array<{
    pulse: 0 | 1 | 2 | 3;
    stage: string;
    candidateCount: number;
    reason: string;
  }>;
}

export class PulseRetrievalEngine {
  private fusionRanker: EvidenceFusionRanker;

  constructor(
    private temporalAdjacencyStore: TemporalAdjacencyStore,
    private entityActivationIndex: EntityActivationIndex,
    fusionRanker?: EvidenceFusionRanker
  ) {
    this.fusionRanker = fusionRanker || new EvidenceFusionRanker();
  }

  run(input: {
    projectId?: string;
    plan: RetrievalExecutionPlan;
    ir: QueryIR;
    entityIds: string[];
    topologyIds: string[];
    branchIds: string[];
    temporalBucketIds: string[];
    temporalNeuronIds: string[];
    graphIds: string[];
    cognitiveGraphIds: string[];
    entityNeuronIds: string[];
  }): PulseRetrievalResult {
    const pulse0Ids = Array.from(new Set([
      ...input.entityNeuronIds,
      ...input.topologyIds,
      ...input.branchIds,
      ...input.temporalNeuronIds
    ])).slice(0, 120);

    const activation = this.entityActivationIndex.activate(
      input.entityIds,
      input.ir.semantics.predicateHint === 'fact' ? ['has_issue', 'owns', 'worked_on'] : undefined
    );
    const pulse1Ids = Array.from(new Set([
      ...activation.neuronIds,
      ...input.entityNeuronIds,
      ...input.graphIds.slice(0, input.plan.topK.graph),
      ...input.cognitiveGraphIds.slice(0, input.plan.topK.graph)
    ])).slice(0, 120);

    const temporalAdjacentIds = this.temporalAdjacencyStore.collectAdjacentNeuronIds(input.temporalBucketIds, 48, input.projectId);
    const pulse2Ids = Array.from(new Set([
      ...temporalAdjacentIds,
      ...input.branchIds,
      ...input.graphIds,
      ...input.cognitiveGraphIds
    ])).slice(0, 120);

    const scored: EvidenceSourceScore[] = [];
    pulse0Ids.forEach((id, index) => scored.push({ neuronId: id, score: 3.2 - index * 0.02, source: 'pulse0', reason: 'hard constraint narrowing' }));
    pulse1Ids.forEach((id, index) => scored.push({ neuronId: id, score: 2.3 - index * 0.015, source: 'pulse1', reason: 'direct entity/fact activation' }));
    pulse2Ids.forEach((id, index) => scored.push({ neuronId: id, score: 1.4 - index * 0.01, source: 'pulse2', reason: 'local temporal/graph expansion' }));

    const fused = this.fusionRanker.rank(scored, 120);
    return {
      pulse0Ids,
      pulse1Ids,
      pulse2Ids,
      fusedIds: fused.neuronIds,
      reasonsByNeuronId: fused.reasonsByNeuronId,
      trace: [
        { pulse: 0, stage: 'hard_constraints', candidateCount: pulse0Ids.length, reason: 'time/entity/project constraints shrink the local universe' },
        { pulse: 1, stage: 'direct_activation', candidateCount: pulse1Ids.length, reason: 'entity -> fact -> neuron direct activation' },
        { pulse: 2, stage: 'local_expansion', candidateCount: pulse2Ids.length, reason: 'temporal adjacency and local graph expansion' },
        { pulse: 3, stage: 'evidence_fusion', candidateCount: fused.neuronIds.length, reason: 'evidence fusion ranker combined pulse outputs' }
      ]
    };
  }
}
