import type { MemoryKernel, MemoryKernelNavigationResult } from '../factory.js';
import type { MemoryEventContext, MemorySourceRef } from '../types/index.js';
import { type AgentRecallDecisionTrace } from '../agent/AgentMemoryBackend.js';
import type { AgentRecallQueryPlan } from '../agent/AgentRecallQueryCompiler.js';
import { type RecallGovernanceSuppressionReason } from './RecallGovernance.js';
export interface RecallExplanationOptions {
    query: string;
    projectId?: string;
    agentId?: string;
    collection?: string;
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
    sourceAnchor?: RecallExplanationSourceAnchor;
    activationPath?: string[];
    whyMatched?: string[];
}
export interface RecallExplanationFilteredEvidence {
    id: string;
    text?: string;
    projectId?: string;
    tags: string[];
    source?: string;
    sourceAnchor?: RecallExplanationSourceAnchor;
    reason: 'agent_scope_mismatch' | 'collection_scope_mismatch' | 'over_context_limit' | 'status_suppressed';
    governanceReason?: RecallGovernanceSuppressionReason;
}
export interface RecallExplanationSourceAnchor {
    eventId: string;
    sourceEventType?: string;
    sourceRefs: MemorySourceRef[];
    context?: MemoryEventContext;
}
export interface RecallExplanation {
    query: string;
    projectId?: string;
    agentId?: string;
    collection?: string;
    recallMode: MemoryKernelNavigationResult['recallMode'] | 'raw_ledger_fallback';
    fallbackUsed: boolean;
    narrative?: NonNullable<MemoryKernelNavigationResult['navigation']>['narrative'];
    pulseTrace?: NonNullable<MemoryKernelNavigationResult['navigation']>['pulse']['trace'];
    temporalTraversal?: NonNullable<MemoryKernelNavigationResult['navigation']>['branchSearch']['temporalTraversal'];
    runtime?: NonNullable<MemoryKernelNavigationResult['navigation']>['runtime'];
    evidence: RecallExplanationEvidence[];
    filteredEvidence?: RecallExplanationFilteredEvidence[];
    queryPlan?: AgentRecallQueryPlan;
    decisionTrace?: AgentRecallDecisionTrace;
}
export declare function explainRecallWithKernel(kernel: MemoryKernel, options: RecallExplanationOptions): RecallExplanation;
//# sourceMappingURL=RecallExplanation.d.ts.map