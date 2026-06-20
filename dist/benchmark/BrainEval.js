const THRESHOLDS = {
    recall: { operator: '>=', value: 0.9 },
    precision: { operator: '>=', value: 0.8 },
    provenanceCoverage: { operator: '>=', value: 0.95 },
    contextBudgetCompliance: { operator: '=', value: 1 },
    staleLeakageRate: { operator: '=', value: 0 },
    crossProjectLeakageRate: { operator: '=', value: 0 },
    prospectiveFalseActivationRate: { operator: '=', value: 0 },
    bindingPurity: { operator: '>=', value: 0.9 },
    entityFalseMergeRate: { operator: '=', value: 0 },
    beliefOwnershipCompliance: { operator: '=', value: 1 },
    temporalCurrentTruthAccuracy: { operator: '>=', value: 0.95 },
    contextPollutionRate: { operator: '=', value: 0 },
    sourceFidelity: { operator: '=', value: 1 },
};
export class BrainEvalRunner {
    evaluate(samples) {
        let expectedCount = 0;
        let selectedCount = 0;
        let relevantSelectedCount = 0;
        let selectedWithEvidenceCount = 0;
        let staleSelectedCount = 0;
        let crossProjectSelectedCount = 0;
        let prospectiveTriggeredCount = 0;
        let falseProspectiveActivationCount = 0;
        let bindingCheckCount = 0;
        let correctBindingCount = 0;
        let acceptedEntityMergeCount = 0;
        let falseEntityMergeCount = 0;
        let entityMergeCheckCount = 0;
        let userBeliefCheckCount = 0;
        let validUserBeliefCount = 0;
        let temporalTruthCheckCount = 0;
        let correctTemporalTruthCount = 0;
        let contextPollutionCheckCount = 0;
        let pollutedContextCount = 0;
        let sourceFidelityCheckCount = 0;
        let exactSourceCount = 0;
        for (const sample of samples) {
            const expected = new Set(sample.expectedIds);
            const selected = new Set(sample.selectedIds);
            const selectedWithEvidence = new Set(sample.selectedWithEvidenceIds);
            const stale = new Set(sample.staleSelectedIds);
            const crossProject = new Set(sample.crossProjectSelectedIds);
            const prospectiveTriggered = new Set(sample.prospectiveTriggeredIds);
            const confirmedProspective = new Set(sample.confirmedProspectiveIds);
            expectedCount += expected.size;
            selectedCount += selected.size;
            relevantSelectedCount += [...selected].filter((id) => expected.has(id)).length;
            selectedWithEvidenceCount += [...selected].filter((id) => selectedWithEvidence.has(id)).length;
            staleSelectedCount += [...selected].filter((id) => stale.has(id)).length;
            crossProjectSelectedCount += [...selected].filter((id) => crossProject.has(id)).length;
            prospectiveTriggeredCount += prospectiveTriggered.size;
            falseProspectiveActivationCount += [...prospectiveTriggered].filter((id) => !confirmedProspective.has(id)).length;
            for (const check of sample.bindingChecks ?? []) {
                bindingCheckCount += 1;
                if (check.expectedTopicPath === check.selectedTopicPath)
                    correctBindingCount += 1;
            }
            for (const check of sample.entityMergeChecks ?? []) {
                entityMergeCheckCount += 1;
                if (!check.accepted)
                    continue;
                acceptedEntityMergeCount += 1;
                if (!check.correct)
                    falseEntityMergeCount += 1;
            }
            for (const check of sample.beliefOwnershipChecks ?? []) {
                if (check.ownership !== 'user')
                    continue;
                userBeliefCheckCount += 1;
                if (check.hasExplicitUserEvidence)
                    validUserBeliefCount += 1;
            }
            for (const check of sample.temporalTruthChecks ?? []) {
                temporalTruthCheckCount += 1;
                if (check.expectedVersionId === check.selectedVersionId)
                    correctTemporalTruthCount += 1;
            }
            for (const check of sample.contextPollutionChecks ?? []) {
                contextPollutionCheckCount += 1;
                if (check.polluted)
                    pollutedContextCount += 1;
            }
            for (const check of sample.sourceFidelityChecks ?? []) {
                sourceFidelityCheckCount += 1;
                if (check.expectedEventId === check.resolvedEventId)
                    exactSourceCount += 1;
            }
        }
        const metrics = {
            recall: expectedCount === 0 ? 1 : relevantSelectedCount / expectedCount,
            precision: selectedCount === 0 ? (expectedCount === 0 ? 1 : 0) : relevantSelectedCount / selectedCount,
            provenanceCoverage: selectedCount === 0 ? 1 : selectedWithEvidenceCount / selectedCount,
            contextBudgetCompliance: samples.length === 0 ? 1 : samples.filter((sample) => sample.usedTokens <= sample.budgetTokens).length / samples.length,
            staleLeakageRate: selectedCount === 0 ? 0 : staleSelectedCount / selectedCount,
            crossProjectLeakageRate: selectedCount === 0 ? 0 : crossProjectSelectedCount / selectedCount,
            prospectiveFalseActivationRate: prospectiveTriggeredCount === 0
                ? 0
                : falseProspectiveActivationCount / prospectiveTriggeredCount,
            bindingPurity: bindingCheckCount === 0 ? 0 : correctBindingCount / bindingCheckCount,
            entityFalseMergeRate: entityMergeCheckCount === 0 ? 1 : (acceptedEntityMergeCount === 0 ? 0 : falseEntityMergeCount / acceptedEntityMergeCount),
            beliefOwnershipCompliance: userBeliefCheckCount === 0 ? 0 : validUserBeliefCount / userBeliefCheckCount,
            temporalCurrentTruthAccuracy: temporalTruthCheckCount === 0 ? 0 : correctTemporalTruthCount / temporalTruthCheckCount,
            contextPollutionRate: contextPollutionCheckCount === 0 ? 1 : pollutedContextCount / contextPollutionCheckCount,
            sourceFidelity: sourceFidelityCheckCount === 0 ? 0 : exactSourceCount / sourceFidelityCheckCount,
        };
        const failedMetrics = Object.keys(metrics).filter((key) => {
            const threshold = THRESHOLDS[key];
            return threshold.operator === '>=' ? metrics[key] < threshold.value : Math.abs(metrics[key] - threshold.value) > 0.000001;
        });
        return { passed: failedMetrics.length === 0, sampleCount: samples.length, metrics, failedMetrics };
    }
}
