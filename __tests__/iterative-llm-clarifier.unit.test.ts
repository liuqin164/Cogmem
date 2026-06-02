/**
 * iterative-llm-clarifier.unit.test.ts
 * Unit tests for IterativeLLMClarifier — Phase 47
 */

import { describe, expect, it, mock } from 'bun:test';
import {
  IterativeLLMClarifier,
  MAX_ITERATIONS,
  type BrainToolDispatcherLike,
  type ClarifierResult,
} from '../src/routing/IterativeLLMClarifier.js';
import type { BrainToolCall, BrainToolResult } from '../src/routing/LLMToolSchema.js';
import type { BrainRecallResult } from '../src/recall/BrainRecall.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmptyRecall(query = 'test query'): BrainRecallResult {
  return {
    query,
    strategy: { primaryLevel: 'compiled_memory', fallbackUsed: false },
    compiledMemory: { beliefs: [], facts: [], events: [], entityTimeline: [] },
    rawEvidence: [],
    fallbackSnippets: [],
    profileSignals: [],
    profileSurface: { userProfile: [], agentPersona: [] },
  };
}

function makeMockDispatcher(result: Partial<BrainToolResult> = {}): BrainToolDispatcherLike {
  return {
    async dispatch(call: BrainToolCall): Promise<BrainToolResult> {
      return {
        toolName: call.action,
        callId: `call-${Date.now()}`,
        success: true,
        result: { facts: [], events: [] },
        durationMs: 1,
        ...result,
      };
    },
  };
}

/** LLM that always returns a final answer immediately */
function finalAnswerLLM(answer = '最终回答'): (prompt: string) => Promise<string> {
  return async () => answer;
}

/** LLM that returns a tool call JSON on the first N calls, then a final answer */
function toolCallThenAnswerLLM(
  toolCalls: BrainToolCall[],
  finalAnswer = '最终回答'
): (prompt: string) => Promise<string> {
  let callCount = 0;
  return async () => {
    if (callCount < toolCalls.length) {
      return JSON.stringify(toolCalls[callCount++]);
    }
    return finalAnswer;
  };
}

const BRAIN_RECALL_CALL: BrainToolCall = {
  action: 'brain_recall',
  query: '蓝牙耳机连接问题',
};

const NEURON_CONTEXT_CALL: BrainToolCall = {
  action: 'get_neuron_context',
  neuron_id: 'nrn-001',
};

const EXPAND_ENTITY_CALL: BrainToolCall = {
  action: 'expand_entity',
  entity_name: 'Alice',
};

// ---------------------------------------------------------------------------
// Tests: basic flow
// ---------------------------------------------------------------------------

describe('IterativeLLMClarifier — direct final answer', () => {
  it('returns final answer on first iteration when LLM gives no tool call', async () => {
    const clarifier = new IterativeLLMClarifier(
      finalAnswerLLM('直接回答'),
      makeMockDispatcher(),
      { maxIterations: 3 }
    );

    const result: ClarifierResult = await clarifier.clarify('问题', makeEmptyRecall());

    expect(result.finalAnswer).toBe('直接回答');
    expect(result.iterationsUsed).toBe(1);
    expect(result.toolCallLog).toHaveLength(0);
    expect(result.stoppedByMaxIter).toBe(false);
  });

  it('toolCallLog is empty when no tool calls were made', async () => {
    const clarifier = new IterativeLLMClarifier(
      finalAnswerLLM(),
      makeMockDispatcher(),
    );
    const result = await clarifier.clarify('问题', makeEmptyRecall());
    expect(result.toolCallLog).toEqual([]);
  });
});

describe('IterativeLLMClarifier — one tool call then answer', () => {
  it('iterationsUsed = 2 when one tool call then final answer', async () => {
    const clarifier = new IterativeLLMClarifier(
      toolCallThenAnswerLLM([BRAIN_RECALL_CALL], '第二轮答案'),
      makeMockDispatcher(),
      { maxIterations: 3 }
    );

    const result = await clarifier.clarify('问题', makeEmptyRecall());

    expect(result.iterationsUsed).toBe(2);
    expect(result.toolCallLog).toHaveLength(1);
    expect(result.toolCallLog[0].call.action).toBe('brain_recall');
    expect(result.stoppedByMaxIter).toBe(false);
    expect(result.finalAnswer).toBe('第二轮答案');
  });

  it('tool call result is recorded in log', async () => {
    const dispatcher = makeMockDispatcher({ success: true, result: { facts: [{ factId: 'f1' }] } });
    const clarifier = new IterativeLLMClarifier(
      toolCallThenAnswerLLM([BRAIN_RECALL_CALL]),
      dispatcher,
      { maxIterations: 3 }
    );

    const result = await clarifier.clarify('问题', makeEmptyRecall());
    expect(result.toolCallLog[0].result.success).toBe(true);
  });

  it('supports get_neuron_context tool call', async () => {
    const clarifier = new IterativeLLMClarifier(
      toolCallThenAnswerLLM([NEURON_CONTEXT_CALL]),
      makeMockDispatcher(),
      { maxIterations: 3 }
    );

    const result = await clarifier.clarify('查神经元', makeEmptyRecall());
    expect(result.toolCallLog[0].call.action).toBe('get_neuron_context');
  });

  it('supports expand_entity tool call', async () => {
    const clarifier = new IterativeLLMClarifier(
      toolCallThenAnswerLLM([EXPAND_ENTITY_CALL]),
      makeMockDispatcher(),
      { maxIterations: 3 }
    );

    const result = await clarifier.clarify('展开实体', makeEmptyRecall());
    expect(result.toolCallLog[0].call.action).toBe('expand_entity');
  });
});

describe('IterativeLLMClarifier — max iterations', () => {
  it('stoppedByMaxIter = true when all iterations are tool calls', async () => {
    const calls: BrainToolCall[] = [
      { action: 'brain_recall', query: 'query1' },
      { action: 'brain_recall', query: 'query2' },
      { action: 'brain_recall', query: 'query3' },
    ];
    const clarifier = new IterativeLLMClarifier(
      toolCallThenAnswerLLM(calls, '不会到达'),
      makeMockDispatcher(),
      { maxIterations: 3 }
    );

    const result = await clarifier.clarify('问题', makeEmptyRecall());
    expect(result.stoppedByMaxIter).toBe(true);
  });

  it('maxIterations is capped at MAX_ITERATIONS (5)', () => {
    const clarifier = new IterativeLLMClarifier(
      finalAnswerLLM(),
      makeMockDispatcher(),
      { maxIterations: 99 }
    );
    // Access private field via casting for test verification
    const internal = clarifier as unknown as { maxIterations: number };
    expect(internal.maxIterations).toBeLessThanOrEqual(MAX_ITERATIONS);
    expect(internal.maxIterations).toBe(MAX_ITERATIONS);
  });

  it('MAX_ITERATIONS constant equals 5', () => {
    expect(MAX_ITERATIONS).toBe(5);
  });

  it('default maxIterations is 3 when not specified', () => {
    const clarifier = new IterativeLLMClarifier(
      finalAnswerLLM(),
      makeMockDispatcher(),
    );
    const internal = clarifier as unknown as { maxIterations: number };
    expect(internal.maxIterations).toBe(3);
  });
});

describe('IterativeLLMClarifier — loop detection (SI-17)', () => {
  it('terminates when same call signature appears twice consecutively', async () => {
    // LLM issues the same brain_recall query twice — should be caught
    const sameCall: BrainToolCall = { action: 'brain_recall', query: 'same query' };
    const calls: BrainToolCall[] = [sameCall, sameCall, sameCall];
    const clarifier = new IterativeLLMClarifier(
      toolCallThenAnswerLLM(calls),
      makeMockDispatcher(),
      { maxIterations: 5 }
    );

    const result = await clarifier.clarify('问题', makeEmptyRecall());
    expect(result.stoppedByMaxIter).toBe(true);
    // Should stop early (before 3 tool calls)
    expect(result.toolCallLog.length).toBeLessThan(3);
  });
});

describe('IterativeLLMClarifier — onToolCall hook', () => {
  it('calls onToolCall hook for each tool dispatch', async () => {
    const hookCalls: Array<{ call: BrainToolCall; result: BrainToolResult }> = [];
    const clarifier = new IterativeLLMClarifier(
      toolCallThenAnswerLLM([BRAIN_RECALL_CALL, EXPAND_ENTITY_CALL], '完成'),
      makeMockDispatcher(),
      {
        maxIterations: 5,
        onToolCall: (call, result) => {
          hookCalls.push({ call, result });
        },
      }
    );

    await clarifier.clarify('问题', makeEmptyRecall());
    expect(hookCalls).toHaveLength(2);
    expect(hookCalls[0].call.action).toBe('brain_recall');
    expect(hookCalls[1].call.action).toBe('expand_entity');
  });
});

describe('IterativeLLMClarifier — prompt construction', () => {
  it('includes tool schema block in the prompt', async () => {
    const seenPrompts: string[] = [];
    const llmFn = async (prompt: string) => {
      seenPrompts.push(prompt);
      return '最终回答';
    };
    const clarifier = new IterativeLLMClarifier(llmFn, makeMockDispatcher());
    await clarifier.clarify('问题', makeEmptyRecall());
    expect(seenPrompts[0]).toContain('【可用工具】');
    expect(seenPrompts[0]).toContain('brain_recall');
  });

  it('includes persona block when provided', async () => {
    const seenPrompts: string[] = [];
    const llmFn = async (prompt: string) => {
      seenPrompts.push(prompt);
      return '答';
    };
    const clarifier = new IterativeLLMClarifier(llmFn, makeMockDispatcher(), {
      personaBlock: '你是一个助手',
    });
    await clarifier.clarify('问题', makeEmptyRecall());
    expect(seenPrompts[0]).toContain('你是一个助手');
  });

  it('includes previous tool results in subsequent prompts', async () => {
    const seenPrompts: string[] = [];
    let callCount = 0;
    const llmFn = async (prompt: string) => {
      seenPrompts.push(prompt);
      if (callCount === 0) {
        callCount++;
        return JSON.stringify(BRAIN_RECALL_CALL);
      }
      return '最终答案';
    };
    const clarifier = new IterativeLLMClarifier(llmFn, makeMockDispatcher(), { maxIterations: 3 });
    await clarifier.clarify('问题', makeEmptyRecall());
    // The second prompt should contain the tool call history
    expect(seenPrompts.length).toBe(2);
    expect(seenPrompts[1]).toContain('已执行工具查询');
  });

  it('uses cue-driven bounded session context instead of raw history', async () => {
    const seenPrompts: string[] = [];
    const clarifier = new IterativeLLMClarifier(
      async (prompt: string) => {
        seenPrompts.push(prompt);
        return '最终回答';
      },
      makeMockDispatcher(),
      {
        session: {
          getRecentTurns() {
            return [
              {
                role: 'user' as const,
                content: 'Atlas deployment status was waiting on canary checks.',
                timestamp: 1,
              },
              {
                role: 'assistant' as const,
                content: 'UNRELATED_RAW_HISTORY_SECRET '.repeat(400),
                timestamp: 2,
              },
            ];
          },
          getContextForLLM() {
            return 'UNRELATED_RAW_HISTORY_SECRET '.repeat(800);
          },
        },
      }
    );

    await clarifier.clarify('Atlas deployment status', makeEmptyRecall());

    expect(seenPrompts[0]).toContain('Atlas deployment status was waiting on canary checks.');
    expect(seenPrompts[0]).not.toContain('UNRELATED_RAW_HISTORY_SECRET');
  });
});
