import { describe, expect, it } from 'bun:test';
import { RecallSufficiencyGate } from '../src/recall/RecallSufficiencyGate.js';
import type { BrainRecallResult } from '../src/recall/BrainRecall.js';

function recall(overrides: Partial<BrainRecallResult> = {}): BrainRecallResult {
  return {
    query: 'Atlas auth',
    strategy: { primaryLevel: 'compiled_memory', fallbackUsed: false },
    compiledMemory: {
      beliefs: [],
      facts: [],
      events: [],
      entityTimeline: []
    },
    rawEvidence: [],
    fallbackSnippets: [],
    profileSignals: [],
    profileSurface: { userProfile: [], agentPersona: [] },
    ...overrides
  };
}

describe('RecallSufficiencyGate', () => {
  it('marks layer1 sufficient when coverage and top confidence pass', () => {
    const gate = new RecallSufficiencyGate({ coverageThreshold: 0.6, topConfidenceThreshold: 0.3 });
    const decision = gate.evaluate({
      query: 'Atlas 项目 auth 问题',
      layer1Result: recall({
        compiledMemory: {
          beliefs: [],
          events: [],
          entityTimeline: [{ entityId: 'e1', canonicalName: 'Atlas', type: 'project', mentionId: 'm1', mentionType: 'referenced', createdAt: 1 }],
          facts: [
            {
              factId: 'f1',
              neuronId: 'n1',
              subject: 'Atlas',
              predicateFamily: 'has_issue',
              object: 'auth 问题',
              validFrom: 1,
              certaintyLevel: 'probable',
              confidence: 0.95,
              status: 'provisional',
              sourceText: 'Atlas has auth issue'
            }
          ]
        }
      }),
      recentTurns: [],
      projectId: 'p1'
    });

    expect(decision.sufficient).toBe(true);
    expect(decision.reason).toBe('layer1_sufficient');
  });

  it('escalates on Chinese and English coreference cues', () => {
    const gate = new RecallSufficiencyGate({ topConfidenceThreshold: 0 });
    expect(gate.evaluate({ query: '你之前说的那个呢', layer1Result: recall(), recentTurns: [] }).sufficient).toBe(false);
    expect(gate.evaluate({ query: 'remember when we discussed Atlas?', layer1Result: recall(), recentTurns: [] }).sufficient).toBe(false);
  });

  it('detects topical drift with temporal references and low trigram overlap', () => {
    const gate = new RecallSufficiencyGate({ topConfidenceThreshold: 0 });
    const decision = gate.evaluate({
      query: '上周那个部署后来怎么样',
      layer1Result: recall(),
      recentTurns: [{ role: 'user', content: '今天在讨论完全不同的蓝牙耳机', timestamp: 1 }]
    });
    expect(decision.signals.topicalDriftHit).toBe(true);
    expect(decision.suggestedFollowupQueries.length).toBeGreaterThan(0);
  });

  it('uses older relevant turns instead of a fixed recent-six drift window', () => {
    const gate = new RecallSufficiencyGate({ topConfidenceThreshold: 0 });
    const decision = gate.evaluate({
      query: 'last week deployment status',
      layer1Result: recall(),
      recentTurns: [
        { role: 'user', content: 'last week deployment status was waiting on canary checks', timestamp: 1 },
        { role: 'user', content: 'today we discussed bluetooth pairing noise', timestamp: 2 },
        { role: 'assistant', content: 'bluetooth note stored', timestamp: 3 },
        { role: 'user', content: 'headset battery replacement details', timestamp: 4 },
        { role: 'assistant', content: 'battery note stored', timestamp: 5 },
        { role: 'user', content: 'keyboard layout preference', timestamp: 6 },
        { role: 'assistant', content: 'keyboard note stored', timestamp: 7 },
      ]
    });

    expect(decision.signals.topicalDriftHit).toBe(false);
  });

  it('deduplicates and caps suggested followup queries', () => {
    const gate = new RecallSufficiencyGate({ maxSuggestedFollowups: 3, topConfidenceThreshold: 1 });
    const decision = gate.evaluate({
      query: 'Atlas 上周 之前 Auth Review',
      layer1Result: recall(),
      recentTurns: [{ role: 'user', content: 'Atlas Atlas Auth Review', timestamp: 1 }],
      projectId: 'p1'
    });
    expect(decision.sufficient).toBe(false);
    expect(decision.suggestedFollowupQueries.length).toBeLessThanOrEqual(3);
    expect(new Set(decision.suggestedFollowupQueries).size).toBe(decision.suggestedFollowupQueries.length);
  });
});
