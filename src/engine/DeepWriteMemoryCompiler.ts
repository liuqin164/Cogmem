import type { TextGenerateFn } from '../models/ModelRole.js';
import { truncate } from '../utils/Values.js';

export interface DeepWriteTurnInput {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  turnId?: string;
}

export interface DeepWriteRecallInput {
  facts: unknown[];
  beliefs: unknown[];
  entities: unknown[];
  rawEvidence: Array<{
    neuronId: string;
    content: string;
    createdAt: number;
    tags?: string[];
  }>;
}

export interface DeepWriteMemoryCompilerInput {
  projectId?: string;
  sessionId?: string;
  currentExchange: {
    userTurnId?: string;
    assistantTurnId?: string;
    userText: string;
    assistantText?: string;
    createdAt: number;
  };
  recentTurns: DeepWriteTurnInput[];
  recalledMemory: DeepWriteRecallInput;
}

export interface DeepWriteMemoryCompilerResult {
  output: Record<string, unknown>;
  rawOutput: string;
  systemPrompt: string;
  userPrompt: string;
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() || trimmed;
}

export class DeepWriteMemoryCompiler {
  constructor(private readonly generate: TextGenerateFn) {}

  async compile(input: DeepWriteMemoryCompilerInput): Promise<DeepWriteMemoryCompilerResult> {
    const systemPrompt = [
      'You are the write-time memory compiler for cogmem.',
      'Return JSON only.',
      'Do not invent facts.',
      'Every candidate must include evidence.',
      'Distinguish explicit user statements from assistant claims and model inference.',
      'Treat metaphors, emotions, and causal links as interpretations unless directly stated.',
      'Do not store small talk as long-term memory unless it reveals a durable preference, goal, constraint, relationship, plan, or state.',
      'Use these top-level arrays when applicable: summary, entities, facts, relations, causalLinks, preferences, emotionalSignals, metaphorInterpretations, contradictions, unresolvedQuestions.',
      'Each item should include confidence, evidence, source, durability, and risk.'
    ].join('\n');

    const userPrompt = truncate(JSON.stringify({
      projectId: input.projectId,
      sessionId: input.sessionId,
      currentExchange: input.currentExchange,
      recentTurns: input.recentTurns,
      recalledMemory: input.recalledMemory
    }, null, 2), 24000);

    const rawOutput = await this.generate(systemPrompt, userPrompt);
    const parsed = JSON.parse(stripJsonFence(rawOutput || '{}')) as Record<string, unknown>;
    return {
      output: parsed && typeof parsed === 'object' ? parsed : {},
      rawOutput,
      systemPrompt,
      userPrompt
    };
  }
}
