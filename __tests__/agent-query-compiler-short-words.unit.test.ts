import { expect, test } from 'bun:test';

import { compileAgentRecallQuery } from '../src/agent/AgentRecallQueryCompiler.js';

/**
 * A short word is not a filler word.
 *
 * The compiler discarded every Latin token shorter than three characters, which
 * silently removed the subject of the question: "CI 为什么不在 4.0 分支上跑"
 * compiled to "不在 分支上跑", and "pi 这个智能体为什么一开始接不上" compiled to
 * "这个智能体为什么一开始接不上". The search then ran without the one word that
 * identified what was being asked, so the answer ranked below memories that shared
 * only the Chinese words around it.
 *
 * These are the project's own nouns — CI, pi, git, DSH — and they are the shortest
 * and most specific part of a question. Length is not evidence that a word carries
 * no meaning.
 */

test('a two-letter subject survives compilation', () => {
  const compiled = compileAgentRecallQuery({ query: 'CI 为什么不在 4.0 分支上跑' });

  expect(compiled.keywords).toContain('CI');
  expect(compiled.primarySearchText).toContain('CI');
});

test('a two-letter agent name survives compilation', () => {
  const compiled = compileAgentRecallQuery({ query: 'pi 这个智能体为什么一开始接不上 cogmem' });

  expect(compiled.keywords).toContain('pi');
  expect(compiled.primarySearchText).toContain('pi');
});

test('a query made only of a short word is still that word', () => {
  const compiled = compileAgentRecallQuery({ query: 'CI' });

  // Nothing else is left to search for, so dropping it leaves nothing at all.
  expect(compiled.keywords).toEqual(['CI']);
  expect(compiled.primarySearchText).toBe('CI');
});

test('dropping short words does not resurrect the fillers', () => {
  // "a" and "an" are articles, not subjects; they must still not reach the search.
  const compiled = compileAgentRecallQuery({ query: 'a pelican migration window' });

  expect(compiled.keywords).not.toContain('a');
  expect(compiled.primarySearchText).toContain('pelican');
});
