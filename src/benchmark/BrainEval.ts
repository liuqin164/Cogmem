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
  bindingChecks?: Array<{ expectedTopicPath: string; selectedTopicPath: string }>;
  entityMergeChecks?: Array<{ accepted: boolean; correct: boolean }>;
  beliefOwnershipChecks?: Array<{ ownership: 'user' | 'project' | 'system'; hasExplicitUserEvidence: boolean }>;
  temporalTruthChecks?: Array<{ expectedVersionId: string; selectedVersionId: string }>;
  contextPollutionChecks?: Array<{ memoryId: string; polluted: boolean }>;
  sourceFidelityChecks?: Array<{ expectedEventId: string; resolvedEventId: string }>;
  episodeGroupingChecks?: Array<{ expectedGroup: string; selectedGroup: string }>;
  episodeBoundaryChecks?: Array<{ expectedSealed: boolean; selectedSealed: boolean }>;
  episodeEvidenceChecks?: Array<{ sourceEventIds: string[]; candidateEvidenceEventIds: string[] }>;
  episodeAssignmentChecks?: Array<{ assigned: boolean }>;
  dreamCandidateChecks?: Array<{ grounded: boolean; bypassedGovernance: boolean }>;
  hermesImportParityChecks?: Array<{ liveShape: string; importedShape: string }>;
  topicMutationIsolationChecks?: Array<{ crossProjectMutation: boolean }>;
  topicAuditRollbackChecks?: Array<{ audited: boolean; rollbackRestored: boolean }>;
  repairInvalidationChecks?: Array<{ oldCandidatesStale: boolean; dreamRequeued: boolean }>;
  importResumeChecks?: Array<{ resumedWithoutDuplicate: boolean; checkpointComplete: boolean }>;
  hooklessWarningChecks?: Array<{ ingestionMissing: boolean; warningPresent: boolean }>;
  atlasChecks?: Array<{
    crossProjectLeak: boolean;
    nodeCount: number;
    maxNodes: number;
    hopCount: number;
    maxHops: number;
    evidenceEventIdPresent: boolean;
    drilldownPresent: boolean;
    expectedPathConnected: boolean;
    actualPathConnected: boolean;
    matchedFacetCount: number;
    coldNodeReturned: boolean;
    canonicalSourceMutated: boolean;
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
  episodeGroupingAccuracy: number;
  episodeBoundaryAccuracy: number;
  episodeEvidenceCoverage: number;
  unassignedRawRate: number;
  dreamCandidateGrounding: number;
  dreamBypassRate: number;
  hermesImportParity: number;
  topicMutationLeakageRate: number;
  topicAuditRollbackCompliance: number;
  repairInvalidationCompliance: number;
  importResumeReliability: number;
  hooklessWarningCoverage: number;
  atlasScopeIsolation: number;
  atlasBoundCompliance: number;
  atlasEvidenceCoverage: number;
  atlasPathReconstruction: number;
  atlasFacetedResurrection: number;
  atlasCanonicalImmutability: number;
}

export interface BrainEvalReport {
  passed: boolean;
  sampleCount: number;
  metrics: BrainEvalMetrics;
  failedMetrics: Array<keyof BrainEvalMetrics>;
}

const THRESHOLDS: Record<keyof BrainEvalMetrics, { operator: '>=' | '='; value: number }> = {
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
  episodeGroupingAccuracy: { operator: '>=', value: 0.9 },
  episodeBoundaryAccuracy: { operator: '>=', value: 0.9 },
  episodeEvidenceCoverage: { operator: '>=', value: 0.95 },
  unassignedRawRate: { operator: '=', value: 0 },
  dreamCandidateGrounding: { operator: '=', value: 1 },
  dreamBypassRate: { operator: '=', value: 0 },
  hermesImportParity: { operator: '=', value: 1 },
  topicMutationLeakageRate: { operator: '=', value: 0 },
  topicAuditRollbackCompliance: { operator: '=', value: 1 },
  repairInvalidationCompliance: { operator: '=', value: 1 },
  importResumeReliability: { operator: '=', value: 1 },
  hooklessWarningCoverage: { operator: '=', value: 1 },
  atlasScopeIsolation: { operator: '=', value: 1 },
  atlasBoundCompliance: { operator: '=', value: 1 },
  atlasEvidenceCoverage: { operator: '=', value: 1 },
  atlasPathReconstruction: { operator: '=', value: 1 },
  atlasFacetedResurrection: { operator: '=', value: 1 },
  atlasCanonicalImmutability: { operator: '=', value: 1 },
};

export class BrainEvalRunner {
  evaluate(samples: BrainEvalSample[]): BrainEvalReport {
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
    let episodeGroupingCount = 0;
    let correctEpisodeGroupingCount = 0;
    let episodeBoundaryCount = 0;
    let correctEpisodeBoundaryCount = 0;
    let episodeEvidenceExpectedCount = 0;
    let episodeEvidenceCoveredCount = 0;
    let episodeAssignmentCount = 0;
    let unassignedEpisodeCount = 0;
    let dreamCandidateCount = 0;
    let groundedDreamCandidateCount = 0;
    let dreamBypassCount = 0;
    let hermesParityCount = 0;
    let correctHermesParityCount = 0;
    let topicMutationChecks = 0; let topicMutationLeaks = 0;
    let topicAuditChecks = 0; let topicAuditPasses = 0;
    let repairChecks = 0; let repairPasses = 0;
    let importResumeCheckCount = 0; let importResumePasses = 0;
    let hooklessChecks = 0; let hooklessPasses = 0;
    let atlasChecks = 0; let atlasScopePasses = 0; let atlasBoundPasses = 0;
    let atlasEvidencePasses = 0; let atlasPathPasses = 0; let atlasResurrectionPasses = 0;
    let atlasImmutabilityPasses = 0;

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
        if (check.expectedTopicPath === check.selectedTopicPath) correctBindingCount += 1;
      }
      for (const check of sample.entityMergeChecks ?? []) {
        entityMergeCheckCount += 1;
        if (!check.accepted) continue;
        acceptedEntityMergeCount += 1;
        if (!check.correct) falseEntityMergeCount += 1;
      }
      for (const check of sample.beliefOwnershipChecks ?? []) {
        if (check.ownership !== 'user') continue;
        userBeliefCheckCount += 1;
        if (check.hasExplicitUserEvidence) validUserBeliefCount += 1;
      }
      for (const check of sample.temporalTruthChecks ?? []) {
        temporalTruthCheckCount += 1;
        if (check.expectedVersionId === check.selectedVersionId) correctTemporalTruthCount += 1;
      }
      for (const check of sample.contextPollutionChecks ?? []) {
        contextPollutionCheckCount += 1;
        if (check.polluted) pollutedContextCount += 1;
      }
      for (const check of sample.sourceFidelityChecks ?? []) {
        sourceFidelityCheckCount += 1;
        if (check.expectedEventId === check.resolvedEventId) exactSourceCount += 1;
      }
      for (const check of sample.episodeGroupingChecks ?? []) {
        episodeGroupingCount += 1;
        if (check.expectedGroup === check.selectedGroup) correctEpisodeGroupingCount += 1;
      }
      for (const check of sample.episodeBoundaryChecks ?? []) {
        episodeBoundaryCount += 1;
        if (check.expectedSealed === check.selectedSealed) correctEpisodeBoundaryCount += 1;
      }
      for (const check of sample.episodeEvidenceChecks ?? []) {
        const actual = new Set(check.candidateEvidenceEventIds);
        episodeEvidenceExpectedCount += check.sourceEventIds.length;
        episodeEvidenceCoveredCount += check.sourceEventIds.filter((id) => actual.has(id)).length;
      }
      for (const check of sample.episodeAssignmentChecks ?? []) {
        episodeAssignmentCount += 1;
        if (!check.assigned) unassignedEpisodeCount += 1;
      }
      for (const check of sample.dreamCandidateChecks ?? []) {
        dreamCandidateCount += 1;
        if (check.grounded) groundedDreamCandidateCount += 1;
        if (check.bypassedGovernance) dreamBypassCount += 1;
      }
      for (const check of sample.hermesImportParityChecks ?? []) {
        hermesParityCount += 1;
        if (check.liveShape === check.importedShape) correctHermesParityCount += 1;
      }
      for (const check of sample.topicMutationIsolationChecks ?? []) { topicMutationChecks += 1; if (check.crossProjectMutation) topicMutationLeaks += 1; }
      for (const check of sample.topicAuditRollbackChecks ?? []) { topicAuditChecks += 1; if (check.audited && check.rollbackRestored) topicAuditPasses += 1; }
      for (const check of sample.repairInvalidationChecks ?? []) { repairChecks += 1; if (check.oldCandidatesStale && check.dreamRequeued) repairPasses += 1; }
      for (const check of sample.importResumeChecks ?? []) { importResumeCheckCount += 1; if (check.resumedWithoutDuplicate && check.checkpointComplete) importResumePasses += 1; }
      for (const check of sample.hooklessWarningChecks ?? []) { hooklessChecks += 1; if (!check.ingestionMissing || check.warningPresent) hooklessPasses += 1; }
      for (const check of sample.atlasChecks ?? []) {
        atlasChecks += 1;
        if (!check.crossProjectLeak) atlasScopePasses += 1;
        if (check.nodeCount <= check.maxNodes && check.hopCount <= check.maxHops) atlasBoundPasses += 1;
        if (check.evidenceEventIdPresent && check.drilldownPresent) atlasEvidencePasses += 1;
        if (check.expectedPathConnected === check.actualPathConnected) atlasPathPasses += 1;
        if (check.matchedFacetCount < 2 || check.coldNodeReturned) atlasResurrectionPasses += 1;
        if (!check.canonicalSourceMutated) atlasImmutabilityPasses += 1;
      }
    }

    const metrics: BrainEvalMetrics = {
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
      episodeGroupingAccuracy: episodeGroupingCount === 0 ? 0 : correctEpisodeGroupingCount / episodeGroupingCount,
      episodeBoundaryAccuracy: episodeBoundaryCount === 0 ? 0 : correctEpisodeBoundaryCount / episodeBoundaryCount,
      episodeEvidenceCoverage: episodeEvidenceExpectedCount === 0 ? 0 : episodeEvidenceCoveredCount / episodeEvidenceExpectedCount,
      unassignedRawRate: episodeAssignmentCount === 0 ? 1 : unassignedEpisodeCount / episodeAssignmentCount,
      dreamCandidateGrounding: dreamCandidateCount === 0 ? 0 : groundedDreamCandidateCount / dreamCandidateCount,
      dreamBypassRate: dreamCandidateCount === 0 ? 1 : dreamBypassCount / dreamCandidateCount,
      hermesImportParity: hermesParityCount === 0 ? 0 : correctHermesParityCount / hermesParityCount,
      topicMutationLeakageRate: topicMutationChecks === 0 ? 1 : topicMutationLeaks / topicMutationChecks,
      topicAuditRollbackCompliance: topicAuditChecks === 0 ? 0 : topicAuditPasses / topicAuditChecks,
      repairInvalidationCompliance: repairChecks === 0 ? 0 : repairPasses / repairChecks,
      importResumeReliability: importResumeCheckCount === 0 ? 0 : importResumePasses / importResumeCheckCount,
      hooklessWarningCoverage: hooklessChecks === 0 ? 0 : hooklessPasses / hooklessChecks,
      atlasScopeIsolation: atlasChecks === 0 ? 0 : atlasScopePasses / atlasChecks,
      atlasBoundCompliance: atlasChecks === 0 ? 0 : atlasBoundPasses / atlasChecks,
      atlasEvidenceCoverage: atlasChecks === 0 ? 0 : atlasEvidencePasses / atlasChecks,
      atlasPathReconstruction: atlasChecks === 0 ? 0 : atlasPathPasses / atlasChecks,
      atlasFacetedResurrection: atlasChecks === 0 ? 0 : atlasResurrectionPasses / atlasChecks,
      atlasCanonicalImmutability: atlasChecks === 0 ? 0 : atlasImmutabilityPasses / atlasChecks,
    };
    const failedMetrics = (Object.keys(metrics) as Array<keyof BrainEvalMetrics>).filter((key) => {
      const threshold = THRESHOLDS[key];
      return threshold.operator === '>=' ? metrics[key] < threshold.value : Math.abs(metrics[key] - threshold.value) > 0.000001;
    });
    return { passed: failedMetrics.length === 0, sampleCount: samples.length, metrics, failedMetrics };
  }
}
