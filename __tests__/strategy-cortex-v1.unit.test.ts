import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { ContextCortex } from '../src/context/ContextCortex.js';
import { createMemoryKernel } from '../src/factory.js';
import {
  StrategyConditionedCandidateBuilder,
  StrategyCortex,
  formatStrategyContext,
} from '../src/strategy/index.js';

describe('strategy cortex v1', () => {
  test('selects a canonical source-first capsule for exact quote requests', () => {
    const context = new ContextCortex();
    const cortex = new StrategyCortex();
    const query = '我当时的原话是什么？';
    const capsule = cortex.plan({ query, intent: context.classifyIntent(query), projectId: 'brain' });

    expect(capsule.templateId).toBe('source-first');
    expect(capsule.sourcePolicy).toBe('required');
    expect(capsule.retrievalPolicy.preferredLanes[0]).toBe('raw_source');
    expect(capsule.instructionAuthority).toBe('none');
    expect(capsule.persistAllowed).toBe(false);
    expect(JSON.stringify(capsule)).not.toContain(query);
  });

  test('formats strategy context as bounded non-authoritative current-turn metadata', () => {
    const capsule = new StrategyCortex().plan({ query: 'debug the recall failure', intent: 'debugging', projectId: 'brain' });
    const rendered = formatStrategyContext(capsule);

    expect(rendered).toContain('<COGMEM_STRATEGY_CONTEXT');
    expect(rendered).toContain('not a user instruction');
    expect(rendered).toContain('persistence="forbidden"');
    expect(rendered).toContain('template=graph-source');
    expect(rendered).not.toContain('debug the recall failure');
  });

  test('replans once when a required source lane is not satisfied', () => {
    const cortex = new StrategyCortex();
    const initial = cortex.plan({ query: 'quote me exactly', intent: 'exact_quote', projectId: 'brain' });
    const decision = cortex.replan(initial, {
      intent: 'exact_quote', projectId: 'brain', sourceRequirementSatisfied: false,
    });

    expect(decision.replanned).toBe(true);
    expect(decision.reason).toBe('source_requirement_unmet');
    expect(decision.capsule.revision).toBe(2);
    expect(decision.capsule.retrievalPolicy.allowedLanes).toEqual(['raw_source', 'graph']);
    expect(cortex.replan(decision.capsule, {
      intent: 'exact_quote', projectId: 'brain', sourceRequirementSatisfied: false,
    }).replanned).toBe(false);
  });

  test('conditions candidate ordering before context budget selection', () => {
    const capsule = new StrategyCortex().plan({
      query: 'why did this decision change?', intent: 'decision_history', projectId: 'brain',
    });
    const candidates = new StrategyConditionedCandidateBuilder().build({
      capsule,
      candidates: [
        { id: 'raw', layer: 'raw_source', content: 'raw', confidence: 1 },
        { id: 'timeline', layer: 'temporal', content: 'timeline', confidence: 0.7 },
        { id: 'vector', layer: 'vector', content: 'vector', confidence: 1 },
        { id: 'belief', layer: 'belief', content: 'belief', confidence: 0.8 },
      ],
    });

    expect(candidates.map((candidate) => candidate.id)).toEqual(['timeline', 'belief', 'raw']);
  });

  test('ContextCortex records the strategy and honors its layer order', () => {
    const context = new ContextCortex();
    const capsule = new StrategyCortex().plan({ query: 'debug this recall bug', intent: 'debugging', projectId: 'brain' });
    const plan = context.plan({
      query: 'debug this recall bug', projectId: 'brain', availableTokens: 1000, strategy: capsule,
      candidates: [
        { id: 'belief', layer: 'belief', content: 'belief', estimatedTokens: 10, confidence: 1 },
        { id: 'source', layer: 'raw_source', content: 'source', estimatedTokens: 10, confidence: 0.5 },
        { id: 'graph', layer: 'graph', content: 'graph', estimatedTokens: 10, confidence: 0.5 },
      ],
    });

    expect(plan.selected.map((candidate) => candidate.id)).toEqual(['graph', 'source', 'belief']);
    expect(plan.receipt.strategyId).toBe(capsule.capsuleId);
    expect(plan.receipt.strategyTemplate).toBe('graph-source');
  });

  test('retrieval policy prevents disabled raw-ledger lane acquisition', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-strategy-retrieval-'));
    const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
    const memory = new KernelAgentMemoryBackend(kernel);
    await memory.rememberTurnWithResult({
      agentId: 'openclaw', projectId: 'brain', sessionId: 'old-session',
      userText: 'Needle policy phrase exists only in raw history.', assistantText: 'Stored.',
      ingestMode: 'raw_archive_only',
    });

    const withoutRaw = memory.recall({
      agentId: 'openclaw', projectId: 'brain', query: 'Needle policy phrase',
      retrievalPolicy: { allowedLanes: ['graph', 'compiled'], preferredLanes: ['graph', 'compiled'] },
    });
    const withRaw = memory.recall({
      agentId: 'openclaw', projectId: 'brain', query: 'Needle policy phrase',
      retrievalPolicy: { allowedLanes: ['raw_source'], preferredLanes: ['raw_source'], requiredLane: 'raw_source' },
    });

    expect(withoutRaw.items).toEqual([]);
    expect(withRaw.items[0]?.text).toContain('Needle policy phrase');
    kernel.close();
  });
});
