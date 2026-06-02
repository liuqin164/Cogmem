import type { MemoryKernel, MemoryKernelNavigationResult } from '../factory.js';
import { type RecallGovernanceSuppressionReason } from './RecallGovernance.js';
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
    activationPath?: string[];
    whyMatched?: string[];
}
export interface RecallExplanationFilteredEvidence {
    id: string;
    text?: string;
    projectId?: string;
    tags: string[];
    source?: string;
    reason: 'agent_scope_mismatch' | 'over_context_limit' | 'status_suppressed';
    governanceReason?: RecallGovernanceSuppressionReason;
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
    filteredEvidence?: RecallExplanationFilteredEvidence[];
}
export declare function explainRecallWithKernel(kernel: MemoryKernel, options: RecallExplanationOptions): RecallExplanation;
//# sourceMappingURL=RecallExplanation.d.ts.map