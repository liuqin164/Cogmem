import { describe, expect, test } from 'bun:test';
import type { BrainRecallResult } from '../src/recall/BrainRecall.js';
import { ExecutionLoop } from '../src/routing/ExecutionLoop.js';
import type { TaskPlan } from '../src/routing/TaskPlan.js';

const makeRecall = (factCount: number, confidence: number): BrainRecallResult =>
  ({
    query: 'test',
    strategy: { primaryLevel: 'compiled_memory', fallbackUsed: false },
    compiledMemory: {
      facts: Array.from({ length: factCount }, (_, i) => ({
        factId: `f${i}`,
        confidence,
        subject: 'device',
        predicateFamily: 'has_issue',
        predicateValue: 'test',
        validFrom: Date.now(),
        status: 'verified',
        neuronId: `n${i}`,
        unitId: `u${i}`,
        object: 'it',
        certaintyLevel: 'certain',
        sourceText: 'test'
      })),
      beliefs: [],
      events: [],
      entityTimeline: []
    },
    rawEvidence: [],
    fallbackSnippets: [],
    profileSignals: [],
    profileSurface: { userProfile: [], agentPersona: [] }
  }) as BrainRecallResult;

function makePlan(step3Type: 'llm_clarify' | 'graph_traverse' = 'llm_clarify'): TaskPlan {
  const steps =
    step3Type === 'graph_traverse'
      ? [
          {
            id: 'step_1',
            type: 'memory_recall' as const,
            label: 'Recall memory',
            inputs: { query: 'test query', entityHint: 'device', projectId: 'p1' },
            mayCallLLM: false
          },
          {
            id: 'step_2',
            type: 'confidence_check' as const,
            label: 'Check confidence',
            inputs: { query: 'test query', entityHint: 'device', projectId: 'p1' },
            mayCallLLM: false
          },
          {
            id: 'step_3',
            type: 'graph_traverse' as const,
            label: 'Traverse graph',
            inputs: { query: 'test query', entityHint: 'device', projectId: 'p1' },
            mayCallLLM: false
          },
          {
            id: 'step_4',
            type: 'confidence_check' as const,
            label: 'Check graph confidence',
            inputs: { query: 'test query', entityHint: 'device', projectId: 'p1' },
            mayCallLLM: false
          },
          {
            id: 'step_5',
            type: 'llm_clarify' as const,
            label: 'Clarify if needed',
            inputs: { query: 'test query', entityHint: 'device', projectId: 'p1' },
            triggerCondition: {
              dependsOnStepId: 'step_4',
              metric: 'confidence_score' as const,
              operator: 'lt' as const,
              threshold: 0.6
            },
            mayCallLLM: true
          },
          {
            id: 'step_6',
            type: 'answer_assemble' as const,
            label: 'Assemble answer',
            inputs: {},
            mayCallLLM: false
          }
        ]
      : [
          {
            id: 'step_1',
            type: 'memory_recall' as const,
            label: 'Recall memory',
            inputs: { query: 'test query', entityHint: 'device', projectId: 'p1' },
            mayCallLLM: false
          },
          {
            id: 'step_2',
            type: 'confidence_check' as const,
            label: 'Check confidence',
            inputs: { query: 'test query', entityHint: 'device', projectId: 'p1' },
            mayCallLLM: false
          },
          {
            id: 'step_3',
            type: 'llm_clarify' as const,
            label: 'Clarify if needed',
            inputs: { query: 'test query', entityHint: 'device', projectId: 'p1' },
            triggerCondition: {
              dependsOnStepId: 'step_2',
              metric: 'confidence_score' as const,
              operator: 'lt' as const,
              threshold: 0.6
            },
            mayCallLLM: true
          },
          {
            id: 'step_4',
            type: 'answer_assemble' as const,
            label: 'Assemble answer',
            inputs: {},
            mayCallLLM: false
          }
        ];

  return {
    planId: 'plan_1',
    intentType: 'factual_recall',
    query: 'test query',
    steps,
    estimatedLLMCalls: 1
  };
}

describe('ExecutionLoop', () => {
  test('high-confidence result resolves on CPU and skips llm_clarify', async () => {
    const recallFn = () => makeRecall(2, 0.9);
    const loop = new ExecutionLoop(recallFn, {
      onLLMClarify: async () => 'unused',
      confidenceThreshold: 0.6
    });

    const result = await loop.execute(makePlan());
    const llmStep = result.steps.find((step) => step.stepType === 'llm_clarify');

    expect(result.verdict).toBe('cpu_resolved');
    expect(result.llmCallCount).toBe(0);
    expect(llmStep?.executed).toBe(false);
    expect(llmStep?.skippedReason).toBe('cpu_sufficient');
  });

  test('low-confidence result uses llm callback when available', async () => {
    const recallFn = () => makeRecall(0, 0);
    let llmCalls = 0;
    const loop = new ExecutionLoop(recallFn, {
      onLLMClarify: async () => {
        llmCalls += 1;
        return 'clarified';
      },
      confidenceThreshold: 0.6
    });

    const result = await loop.execute(makePlan());

    expect(result.verdict).toBe('llm_assisted');
    expect(result.llmCallCount).toBe(1);
    expect(llmCalls).toBe(1);
  });

  test('awaits async recall functions before confidence and LLM steps', async () => {
    let recallResolved = false;
    const recallFn = async () => {
      await Promise.resolve();
      recallResolved = true;
      return makeRecall(2, 0.9);
    };
    const loop = new ExecutionLoop(recallFn, {
      onLLMClarify: async () => 'unused',
      confidenceThreshold: 0.6
    });

    const result = await loop.execute(makePlan());

    expect(recallResolved).toBe(true);
    expect(result.verdict).toBe('cpu_resolved');
    expect(result.finalRecallResult?.compiledMemory.facts).toHaveLength(2);
  });

  test('low-confidence result without llm callback remains incomplete', async () => {
    const recallFn = () => makeRecall(0, 0);
    const loop = new ExecutionLoop(recallFn, {
      confidenceThreshold: 0.6
    });

    const result = await loop.execute(makePlan());
    const llmStep = result.steps.find((step) => step.stepType === 'llm_clarify');

    expect(result.verdict).toBe('incomplete');
    expect(result.llmCallCount).toBe(0);
    expect(llmStep?.executed).toBe(false);
    expect(llmStep?.skippedReason).toBe('no_llm_callback');
  });

  test('cross-domain plan enables persistent gain edges for graph traversal', async () => {
    const calls: Array<{ query: string; options?: Parameters<typeof loopRecall>[1] }> = [];
    const loopRecall = (
      query: string,
      options?: {
        projectId?: string;
        entityHint?: string;
        limit?: number;
        enablePersistentGainEdges?: boolean;
      }
    ) => {
      calls.push({ query, options });
      return makeRecall(0, 0);
    };
    const loop = new ExecutionLoop(loopRecall, { confidenceThreshold: 0.6 });

    await loop.execute(makePlan('graph_traverse'));

    const graphCall = calls.find((call) => call.options?.enablePersistentGainEdges === true);
    expect(graphCall).toBeDefined();
  });

  test('recall gate requests session turns without a fixed six-turn cap', async () => {
    const requestedLimits: Array<number | undefined> = [];
    const loop = new ExecutionLoop(() => makeRecall(2, 0.9), {
      onLLMClarify: async () => 'unused',
      confidenceThreshold: 0.6,
      session: {
        getRecentTurns(limit?: number) {
          requestedLimits.push(limit);
          return Array.from({ length: 8 }, (_, index) => ({
            role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
            content: `turn ${index}`,
            timestamp: index,
          }));
        },
      },
    });

    await loop.execute(makePlan());

    expect(requestedLimits).toHaveLength(1);
    expect(requestedLimits[0]).toBeUndefined();
  });

  test('legacy LLM prompt uses cue-driven bounded session context instead of raw history', async () => {
    let seenPrompt = '';
    const loop = new ExecutionLoop(() => makeRecall(0, 0), {
      onLLMClarify: async (prompt) => {
        seenPrompt = prompt;
        return 'clarified';
      },
      confidenceThreshold: 0.6,
      session: {
        getRecentTurns() {
          return [
            {
              role: 'user' as const,
              content: 'Atlas deployment status was waiting on canary checks.',
              timestamp: 1,
            },
            {
              role: 'user' as const,
              content: 'UNRELATED_RAW_HISTORY_SECRET '.repeat(400),
              timestamp: 2,
            },
          ];
        },
        getContextForLLM() {
          return 'UNRELATED_RAW_HISTORY_SECRET '.repeat(800);
        },
      },
      recallGateDisabled: true,
    });

    const plan = makePlan();
    plan.query = 'Atlas deployment status';
    plan.steps[0]!.inputs.query = 'Atlas deployment status';
    plan.steps[2]!.inputs.query = 'Atlas deployment status';

    await loop.execute(plan);

    expect(seenPrompt).toContain('Atlas deployment status was waiting on canary checks.');
    expect(seenPrompt).not.toContain('UNRELATED_RAW_HISTORY_SECRET');
  });

  test('record count matches plan length and total duration is non-negative', async () => {
    const loop = new ExecutionLoop(() => makeRecall(0, 0), {
      confidenceThreshold: 0.6
    });
    const plan = makePlan();

    const result = await loop.execute(plan);

    expect(result.steps).toHaveLength(plan.steps.length);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});
