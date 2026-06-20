import { describe, expect, test } from 'bun:test';

import { BrainEvalRunner } from '../src/benchmark/BrainEval.js';

describe('brain eval v1', () => {
  test('passes a clean memory-brain sample set', () => {
    const report = new BrainEvalRunner().evaluate([
      {
        expectedIds: ['a', 'b'], selectedIds: ['a', 'b'], selectedWithEvidenceIds: ['a', 'b'],
        usedTokens: 200, budgetTokens: 250, staleSelectedIds: [], crossProjectSelectedIds: [],
        prospectiveTriggeredIds: ['p1'], confirmedProspectiveIds: ['p1'],
        bindingChecks: [{ expectedTopicPath: 'PROJECT/Cogmem', selectedTopicPath: 'PROJECT/Cogmem' }],
        entityMergeChecks: [{ accepted: true, correct: true }],
        beliefOwnershipChecks: [{ ownership: 'user', hasExplicitUserEvidence: true }],
        temporalTruthChecks: [{ expectedVersionId: 'v2', selectedVersionId: 'v2' }],
        contextPollutionChecks: [{ memoryId: 'a', polluted: false }],
        sourceFidelityChecks: [{ expectedEventId: 'evt-a', resolvedEventId: 'evt-a' }],
      },
      {
        expectedIds: ['c'], selectedIds: ['c'], selectedWithEvidenceIds: ['c'],
        usedTokens: 100, budgetTokens: 250, staleSelectedIds: [], crossProjectSelectedIds: [],
        prospectiveTriggeredIds: [], confirmedProspectiveIds: [],
      },
    ]);

    expect(report.passed).toBe(true);
    expect(report.metrics.recall).toBe(1);
    expect(report.metrics.provenanceCoverage).toBe(1);
    expect(report.metrics.contextBudgetCompliance).toBe(1);
    expect(report.metrics.prospectiveFalseActivationRate).toBe(0);
    expect(report.metrics.bindingPurity).toBe(1);
    expect(report.metrics.entityFalseMergeRate).toBe(0);
    expect(report.metrics.beliefOwnershipCompliance).toBe(1);
    expect(report.metrics.temporalCurrentTruthAccuracy).toBe(1);
    expect(report.metrics.contextPollutionRate).toBe(0);
    expect(report.metrics.sourceFidelity).toBe(1);
  });

  test('fails stale, cross-project, over-budget, unprovenanced, and unconfirmed prospective activation', () => {
    const report = new BrainEvalRunner().evaluate([{
      expectedIds: ['a', 'b'], selectedIds: ['a', 'stale', 'cross'], selectedWithEvidenceIds: ['a'],
      usedTokens: 300, budgetTokens: 200, staleSelectedIds: ['stale'], crossProjectSelectedIds: ['cross'],
      prospectiveTriggeredIds: ['p1'], confirmedProspectiveIds: [],
      bindingChecks: [{ expectedTopicPath: 'PROJECT/Cogmem', selectedTopicPath: 'PROJECT/Other' }],
      entityMergeChecks: [{ accepted: true, correct: false }],
      beliefOwnershipChecks: [{ ownership: 'user', hasExplicitUserEvidence: false }],
      temporalTruthChecks: [{ expectedVersionId: 'v2', selectedVersionId: 'v1' }],
      contextPollutionChecks: [{ memoryId: 'stale', polluted: true }],
      sourceFidelityChecks: [{ expectedEventId: 'evt-original', resolvedEventId: 'evt-summary' }],
    }]);

    expect(report.passed).toBe(false);
    expect(report.failedMetrics).toEqual(expect.arrayContaining([
      'staleLeakageRate', 'crossProjectLeakageRate', 'contextBudgetCompliance',
      'provenanceCoverage', 'prospectiveFalseActivationRate',
      'bindingPurity', 'entityFalseMergeRate', 'beliefOwnershipCompliance',
      'temporalCurrentTruthAccuracy', 'contextPollutionRate', 'sourceFidelity',
    ]));
  });

  test('scores repeated memory ids independently per sample', () => {
    const report = new BrainEvalRunner().evaluate([
      {
        expectedIds: ['same'], selectedIds: ['same'], selectedWithEvidenceIds: ['same'],
        usedTokens: 1, budgetTokens: 10, staleSelectedIds: [], crossProjectSelectedIds: [],
        prospectiveTriggeredIds: [], confirmedProspectiveIds: [],
      },
      {
        expectedIds: ['same'], selectedIds: [], selectedWithEvidenceIds: [],
        usedTokens: 1, budgetTokens: 10, staleSelectedIds: [], crossProjectSelectedIds: [],
        prospectiveTriggeredIds: [], confirmedProspectiveIds: [],
      },
    ]);

    expect(report.metrics.recall).toBe(0.5);
    expect(report.passed).toBe(false);
  });

  test('fails closed when release fixtures omit domain-specific brain checks', () => {
    const report = new BrainEvalRunner().evaluate([{
      expectedIds: ['a'], selectedIds: ['a'], selectedWithEvidenceIds: ['a'],
      usedTokens: 1, budgetTokens: 10, staleSelectedIds: [], crossProjectSelectedIds: [],
      prospectiveTriggeredIds: [], confirmedProspectiveIds: [],
    }]);

    expect(report.passed).toBe(false);
    expect(report.failedMetrics).toEqual(expect.arrayContaining([
      'bindingPurity', 'entityFalseMergeRate', 'beliefOwnershipCompliance',
      'temporalCurrentTruthAccuracy', 'contextPollutionRate', 'sourceFidelity',
    ]));
  });
});
