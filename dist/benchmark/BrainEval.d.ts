export interface BrainEvalSample {
    expectedIds: string[];
    selectedIds: string[];
    selectedWithEvidenceIds: string[];
    staleSelectedIds: string[];
    crossProjectSelectedIds: string[];
    usedTokens: number;
    budgetTokens: number;
    prospectiveTriggeredIds: string[];
    confirmedProspectiveIds: string[];
    bindingChecks?: Array<{
        expectedTopicPath: string;
        selectedTopicPath: string;
    }>;
    entityMergeChecks?: Array<{
        accepted: boolean;
        correct: boolean;
    }>;
    beliefOwnershipChecks?: Array<{
        ownership: 'user' | 'project' | 'system';
        hasExplicitUserEvidence: boolean;
    }>;
    temporalTruthChecks?: Array<{
        expectedVersionId: string;
        selectedVersionId: string;
    }>;
    contextPollutionChecks?: Array<{
        memoryId: string;
        polluted: boolean;
    }>;
    sourceFidelityChecks?: Array<{
        expectedEventId: string;
        resolvedEventId: string;
    }>;
}
export interface BrainEvalMetrics {
    recall: number;
    precision: number;
    provenanceCoverage: number;
    contextBudgetCompliance: number;
    staleLeakageRate: number;
    crossProjectLeakageRate: number;
    prospectiveFalseActivationRate: number;
    bindingPurity: number;
    entityFalseMergeRate: number;
    beliefOwnershipCompliance: number;
    temporalCurrentTruthAccuracy: number;
    contextPollutionRate: number;
    sourceFidelity: number;
}
export interface BrainEvalReport {
    passed: boolean;
    sampleCount: number;
    metrics: BrainEvalMetrics;
    failedMetrics: Array<keyof BrainEvalMetrics>;
}
export declare class BrainEvalRunner {
    evaluate(samples: BrainEvalSample[]): BrainEvalReport;
}
//# sourceMappingURL=BrainEval.d.ts.map