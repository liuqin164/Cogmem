import type { Neuron } from '../types/index.js';
export type RecallGovernanceSuppressionReason = 'archived' | 'suspect_llm_inference' | 'suspect_external_tool_observation' | 'suspect_unverified_claim' | 'non_recallable_status';
export declare function isRecallableMemoryEvidence(neuron: Neuron | null | undefined): neuron is Neuron;
export declare function recallGovernanceReasonsFor(neuron: Neuron): string[];
export declare function recallSuppressionReasonFor(neuron: Neuron | null | undefined): RecallGovernanceSuppressionReason | undefined;
export declare function isRawUserUtteranceEvidence(neuron: Neuron): boolean;
//# sourceMappingURL=RecallGovernance.d.ts.map