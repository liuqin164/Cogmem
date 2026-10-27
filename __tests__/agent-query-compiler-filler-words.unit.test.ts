import { expect, test } from 'bun:test';

import { compileAgentRecallQuery } from '../src/agent/AgentRecallQueryCompiler.js';

/**
 * Dropping a filler word must not cut a letter out of a real one.
 *
 * The fillers are stripped by substring replacement, so an English article like
 * "a" matches the "a" inside "quarterly" and leaves "qu rterly". The search text
 * is what the recall lanes actually query with, so a mangled word is a word the
 * memory is searched for and never contains.
 */

test('an English article inside a word does not split that word', () => {
  const compiled = compileAgentRecallQuery({ query: 'quarterly revenue forecast' });

  expect(compiled.keywords).toEqual(['quarterly', 'revenue', 'forecast']);
  // Every search text the lanes use must still contain the words the person said.
  for (const text of compiled.searchTexts) {
    expect(text).not.toMatch(/\bqu\b/u);
    expect(text).not.toMatch(/\bforec\b/u);
  }
  expect(compiled.searchTexts.join(' ')).toContain('quarterly');
  expect(compiled.searchTexts.join(' ')).toContain('forecast');
});

test('a filler that stands as its own word is still dropped', () => {
  const compiled = compileAgentRecallQuery({ query: 'what is the pelican migration window' });

  // "the" is a filler and goes away; the words around it survive whole.
  expect(compiled.searchTexts.join(' ')).toContain('pelican');
  expect(compiled.searchTexts.join(' ')).toContain('migration');
  expect(compiled.searchTexts.join(' ')).toContain('window');
  for (const text of compiled.searchTexts) {
    expect(text).not.toMatch(/\bpeli\b|\bcan\b/u);
  }
});

test('a word that only looks like a filler is not removed', () => {
  // "an" is a filler; "annual" and "analysis" merely start with it.
  const compiled = compileAgentRecallQuery({ query: 'annual analysis of candidate ranking' });

  const joined = compiled.searchTexts.join(' ');
  expect(joined).toContain('annual');
  expect(joined).toContain('analysis');
  expect(joined).toContain('candidate');
});
