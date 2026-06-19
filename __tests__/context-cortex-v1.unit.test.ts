import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';

import { ContextCortex } from '../src/context/ContextCortex.js';

describe('context cortex v1', () => {
  test('suppresses all memory for greetings', () => {
    const cortex = new ContextCortex();
    const plan = cortex.plan({
      query: 'hi', availableTokens: 1000,
      candidates: [{ id: 'belief', layer: 'belief', content: 'long-term preference', estimatedTokens: 20, confidence: 1 }],
    });

    expect(plan.intent).toBe('greeting');
    expect(plan.selected).toEqual([]);
    expect(plan.receipt.suppressed[0]?.reason).toBe('intent_suppresses_memory');
  });

  test('uses only session state and turn bridge for short same-topic followups', () => {
    const cortex = new ContextCortex();
    const plan = cortex.plan({
      query: '继续', availableTokens: 1000, topicRelation: 'same',
      candidates: [
        { id: 'state', layer: 'session_state', content: 'current work', estimatedTokens: 20, confidence: 1 },
        { id: 'bridge', layer: 'turn_bridge', content: 'prior reasoning bridge', estimatedTokens: 20, confidence: 1 },
        { id: 'raw', layer: 'raw_source', content: 'old transcript', estimatedTokens: 20, confidence: 1 },
      ],
    });

    expect(plan.intent).toBe('short_followup');
    expect(plan.selected.map((item) => item.id)).toEqual(['state', 'bridge']);
    expect(plan.receipt.suppressed.find((item) => item.id === 'raw')?.reason).toBe('layer_not_activated');
  });

  test('prioritizes exact raw source for quote requests and stays inside budget', () => {
    const cortex = new ContextCortex();
    const plan = cortex.plan({
      query: '我当时的原话是什么？', availableTokens: 400, maxMemoryRatio: 0.25,
      candidates: [
        { id: 'summary', layer: 'belief', content: 'summary', estimatedTokens: 60, confidence: 1 },
        { id: 'raw', layer: 'raw_source', content: 'exact user quote', estimatedTokens: 70, confidence: 0.8 },
        { id: 'graph', layer: 'graph', content: 'source anchor', estimatedTokens: 25, confidence: 0.9 },
      ],
    });

    expect(plan.intent).toBe('exact_quote');
    expect(plan.selected.map((item) => item.id)).toEqual(['raw', 'graph']);
    expect(plan.usedTokens).toBeLessThanOrEqual(100);
    expect(plan.receipt.suppressed.find((item) => item.id === 'summary')?.reason).toBe('budget_exceeded');
  });

  test('applies hard safety filters before ranking', () => {
    const cortex = new ContextCortex();
    const plan = cortex.plan({
      query: 'What are my project preferences?', projectId: 'brain', currentSessionId: 'session-now',
      availableTokens: 1000,
      candidates: [
        { id: 'cross', layer: 'belief', content: 'other project', projectId: 'other', estimatedTokens: 10, confidence: 1 },
        { id: 'stale', layer: 'belief', content: 'old belief', projectId: 'brain', superseded: true, estimatedTokens: 10, confidence: 1 },
        { id: 'echo', layer: 'raw_source', content: 'same session', projectId: 'brain', sessionId: 'session-now', estimatedTokens: 10, confidence: 1 },
        { id: 'fake-user', layer: 'belief', content: 'assistant guessed preference', projectId: 'brain', ownership: 'user', sourceRoles: ['assistant'], estimatedTokens: 10, confidence: 1 },
        { id: 'private', layer: 'belief', content: 'sensitive person data', projectId: 'brain', sensitive: true, estimatedTokens: 10, confidence: 1 },
        { id: 'safe', layer: 'belief', content: 'explicit user preference', projectId: 'brain', ownership: 'user', sourceRoles: ['user'], estimatedTokens: 10, confidence: 0.8 },
      ],
    });

    expect(plan.selected.map((item) => item.id)).toEqual(['safe']);
    expect(new Set(plan.receipt.suppressed.map((item) => item.reason))).toEqual(new Set([
      'project_boundary', 'superseded', 'current_session_echo', 'user_belief_without_user_evidence', 'sensitive_without_need',
    ]));
  });

  test('persists an explainable activation receipt when configured with a database', () => {
    const db = new Database(':memory:');
    const cortex = new ContextCortex(db);
    const plan = cortex.plan({
      query: 'Why did the project decision change?', projectId: 'brain', availableTokens: 1000,
      candidates: [{ id: 'timeline', layer: 'temporal', content: 'decision changed at v3', estimatedTokens: 20, confidence: 0.9 }],
    });
    const receipt = cortex.getReceipt(plan.receipt.receiptId);

    expect(receipt?.intent).toBe('decision_history');
    expect(receipt?.selected[0]?.id).toBe('timeline');
    expect(receipt?.budgetTokens).toBe(250);
  });
});
