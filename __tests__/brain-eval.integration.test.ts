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
      },
    ];

    const report = new BrainEvalRunner().evaluate(fixture);
    expect(report.passed).toBe(true);
    expect(report.failedMetrics).toEqual([]);
  });
});
