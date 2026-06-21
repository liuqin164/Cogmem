import { describe, expect, test } from 'bun:test';

import { BrainEvalRunner, type BrainEvalSample } from '../src/benchmark/BrainEval.js';

describe('BrainEval multilingual release fixture', () => {
  test('keeps canonical binding, ownership, current truth, context, and source identity intact', () => {
    const fixture: BrainEvalSample[] = [
      {
        expectedIds: ['zh-memory', 'ja-memory', 'en-memory'],
        selectedIds: ['zh-memory', 'ja-memory', 'en-memory'],
        selectedWithEvidenceIds: ['zh-memory', 'ja-memory', 'en-memory'],
        staleSelectedIds: [], crossProjectSelectedIds: [], usedTokens: 720, budgetTokens: 800,
        prospectiveTriggeredIds: ['release-review'], confirmedProspectiveIds: ['release-review'],
        bindingChecks: [
          { expectedTopicPath: 'PROJECT/Cogmem/memory-write-pipeline', selectedTopicPath: 'PROJECT/Cogmem/memory-write-pipeline' },
          { expectedTopicPath: 'PROJECT/Cogmem/memory-write-pipeline', selectedTopicPath: 'PROJECT/Cogmem/memory-write-pipeline' },
          { expectedTopicPath: 'PROJECT/Cogmem/memory-write-pipeline', selectedTopicPath: 'PROJECT/Cogmem/memory-write-pipeline' },
        ],
        entityMergeChecks: [{ accepted: true, correct: true }, { accepted: false, correct: false }],
        beliefOwnershipChecks: [{ ownership: 'user', hasExplicitUserEvidence: true }],
        temporalTruthChecks: [{ expectedVersionId: 'belief-v3', selectedVersionId: 'belief-v3' }],
        contextPollutionChecks: [
          { memoryId: 'zh-memory', polluted: false },
          { memoryId: 'ja-memory', polluted: false },
          { memoryId: 'en-memory', polluted: false },
        ],
        sourceFidelityChecks: [
          { expectedEventId: 'evt-zh-original', resolvedEventId: 'evt-zh-original' },
          { expectedEventId: 'evt-ja-original', resolvedEventId: 'evt-ja-original' },
          { expectedEventId: 'evt-en-original', resolvedEventId: 'evt-en-original' },
        ],
        episodeGroupingChecks: [{ expectedGroup: 'release-episode', selectedGroup: 'release-episode' }],
        episodeBoundaryChecks: [{ expectedSealed: true, selectedSealed: true }],
        episodeEvidenceChecks: [{
          sourceEventIds: ['evt-zh-original', 'evt-ja-original', 'evt-en-original'],
          candidateEvidenceEventIds: ['evt-zh-original', 'evt-ja-original', 'evt-en-original'],
        }],
        episodeAssignmentChecks: [{ assigned: true }, { assigned: true }, { assigned: true }],
        dreamCandidateChecks: [{ grounded: true, bypassedGovernance: false }],
        hermesImportParityChecks: [{ liveShape: 'episode.v1', importedShape: 'episode.v1' }],
        topicMutationIsolationChecks: [{ crossProjectMutation: false }],
        topicAuditRollbackChecks: [{ audited: true, rollbackRestored: true }],
        repairInvalidationChecks: [{ oldCandidatesStale: true, dreamRequeued: true }],
        importResumeChecks: [{ resumedWithoutDuplicate: true, checkpointComplete: true }],
        hooklessWarningChecks: [{ ingestionMissing: true, warningPresent: true }],
        atlasChecks: [{ crossProjectLeak: false, nodeCount: 8, maxNodes: 30, hopCount: 2, maxHops: 2,
          evidenceEventIdPresent: true, drilldownPresent: true, expectedPathConnected: true, actualPathConnected: true,
          matchedFacetCount: 3, coldNodeReturned: true, canonicalSourceMutated: false }],
      },
    ];

    const report = new BrainEvalRunner().evaluate(fixture);
    expect(report.passed).toBe(true);
    expect(report.failedMetrics).toEqual([]);
  });
});
