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
export declare function explainRecallWithKernel(kernel: MemoryKernel, options: RecallExplanationOptions): RecallExplanation;
//# sourceMappingURL=RecallExplanation.d.ts.map