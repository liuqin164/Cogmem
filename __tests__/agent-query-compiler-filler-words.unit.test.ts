import { expect, test } from 'bun:test';

import { compileAgentRecallQuery } from '../src/agent/AgentRecallQueryCompiler.js';

/**
 * Dropping a filler word must not cut a letter out of a real one.
 *
 * The fillers are stripped by substring replacement, so an English article like
 * "a" matches the "a" inside "quarterly" and leaves "qu rterly". The corruption
 * lands in `primarySearchText`, which is what the recall lanes actually query
 * with — so a mangled word is a word the memory is searched for and never
 * contains.
 *
 * These assertions read `primarySearchText` deliberately. An earlier version of
 * this file read `searchTexts`, which for these queries is always the original
 * query, so every assertion passed with the fix reverted and the bug was free to
 * come back. `primarySearchText` is derived from the same keywords and is where
 * the damage shows.
 */

test('an English article inside a word does not split that word', () => {
  const compiled = compileAgentRecallQuery({ query: 'quarterly revenue forecast' });

  expect(compiled.keywords).toEqual(['quarterly', 'revenue', 'forecast']);
  expect(compiled.primarySearchText).toContain('quarterly');
  expect(compiled.primarySearchText).toContain('forecast');
  // The split fragments, spelled out: these are what the search used to receive.
  expect(compiled.primarySearchText).not.toMatch(/\bqu\b/u);
  expect(compiled.primarySearchText).not.toMatch(/\bforec\b/u);
});

test('a filler that stands as its own word is still dropped', () => {
  const compiled = compileAgentRecallQuery({ query: 'what is the pelican migration window' });

  expect(compiled.primarySearchText).toContain('pelican');
  expect(compiled.primarySearchText).toContain('migration');
  expect(compiled.primarySearchText).toContain('window');
  for (const text of [compiled.primarySearchText, ...compiled.searchTexts]) {
    expect(text).not.toMatch(/\bpeli\b|\bcan\b/u);
  }
});

test('a word that only looks like a filler is not removed', () => {
  // "an" is a filler; "annual" and "analysis" merely start with it.
  const compiled = compileAgentRecallQuery({ query: 'annual analysis of candidate ranking' });

  expect(compiled.primarySearchText).toContain('annual');
  expect(compiled.primarySearchText).toContain('analysis');
  expect(compiled.primarySearchText).toContain('candidate');
  // The old bug left the fragment "king" standing where "ranking" had been; a
  // word-boundary match, because "ranking" itself contains those letters.
  expect(compiled.primarySearchText).not.toMatch(/\bking\b/u);
});
