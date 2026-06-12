import { describe, expect, it } from 'bun:test';
import { injectContradictions } from '../src/eval/datasets/contradiction_injection.ts';
import { generateNoisyCorpus } from '../src/eval/datasets/noisy_tool_output_corpus.ts';
import { generateSyntheticConversation } from '../src/eval/datasets/synthetic_long_conversation.ts';

describe('Eval dataset generators', () => {
  it('generateSyntheticConversation(10) returns 10 turns', () => {
    const dataset = generateSyntheticConversation(10);
    expect(dataset.conversation).toHaveLength(10);
  });

  it('generateSyntheticConversation(10) annotates every turn with groundTruth labels', () => {
    const dataset = generateSyntheticConversation(10);
    expect(dataset.conversation.every((turn) => turn.groundTruth.length > 0)).toBe(true);
  });

  it('generateSyntheticConversation(50) includes context switch scenes', () => {
    const dataset = generateSyntheticConversation(50);
    expect(dataset.conversation.some((turn) => turn.scene === 'context_switch')).toBe(true);
  });

  it('generateSyntheticConversation(200) succeeds and includes approval pause scenes', () => {
    const dataset = generateSyntheticConversation(200);
    expect(dataset.conversation).toHaveLength(200);
    expect(dataset.hasApprovalPause).toBe(true);
  });

  it('generateSyntheticConversation marks critical facts for long-horizon evaluation', () => {
    const dataset = generateSyntheticConversation(200);
    expect(dataset.criticalFacts.length).toBeGreaterThan(0);
  });

  it('injectContradictions marks older contradictory facts as superseded', () => {
    const injected = injectContradictions(generateSyntheticConversation(50));
    expect(injected.conversation.some((turn) => turn.isSuperseded === true)).toBe(true);
  });

  it('injectContradictions keeps a canonical non-superseded replacement fact', () => {
    const injected = injectContradictions(generateSyntheticConversation(50));
    expect(injected.conversation.some((turn) => turn.factValue === 'right ear static' && turn.isSuperseded !== true)).toBe(true);
  });

  it('injectContradictions updates recall cases with superseded phrases', () => {
    const injected = injectContradictions(generateSyntheticConversation(50));
    expect(injected.recallCases.some((item) => item.supersededPhrases.includes('left ear has static'))).toBe(true);
  });

  it('generateNoisyCorpus respects the requested size', () => {
    const corpus = generateNoisyCorpus(12);
    expect(corpus.items).toHaveLength(12);
  });

  it('generateNoisyCorpus annotates every record with shouldFilter', () => {
    const corpus = generateNoisyCorpus(12);
    expect(corpus.items.every((item) => typeof item.shouldFilter === 'boolean')).toBe(true);
  });

  it('generateNoisyCorpus contains both filtered and accepted entries', () => {
    const corpus = generateNoisyCorpus(12);
    expect(corpus.items.some((item) => item.shouldFilter)).toBe(true);
    expect(corpus.items.some((item) => !item.shouldFilter)).toBe(true);
  });
});
