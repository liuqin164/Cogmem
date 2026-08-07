import type { Neuron } from '../types/index.js';
export type RecallGovernanceSuppressionReason = 'archived' | 'operational_noise' | 'imported_summary_support' | 'suspect_llm_inference' | 'suspect_external_tool_observation' | 'suspect_unverified_claim' | 'non_recallable_status';
export declare function isRecallableMemoryEvidence(neuron: Neuron | null | undefined): neuron is Neuron;
export declare function recallGovernanceReasonsFor(neuron: Neuron): string[];
export declare function recallSuppressionReasonFor(neuron: Neuron | null | undefined): RecallGovernanceSuppressionReason | undefined;
export declare function isRawUserUtteranceEvidence(neuron: Neuron): boolean;
export declare function isOperationalNoiseMemoryEvidence(neuron: Neuron): boolean;
export declare function isImportedSummarySupportMemoryEvidence(neuron: Neuron): boolean;
export declare function isOperationalNoiseText(text: string | null | undefined): boolean;
export declare function recallableNeuronSql(alias: string, columns: ReadonlySet<string>): string;
//# sourceMappingURL=RecallGovernance.d.ts.map