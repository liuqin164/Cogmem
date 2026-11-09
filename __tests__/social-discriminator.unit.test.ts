import { expect, test } from 'bun:test';
import { discriminativeProbes, overlapIsOnlySmallTalk } from '../src/agent/AgentMemoryBackend.js';
import { setConfiguredLanguage } from '../src/config/LanguagePacks.js';

test('a question reduces to probes that can tell small talk from an answer', () => {
  const probes = discriminativeProbes('好的收到，归档保留期几年');
  expect(probes).toContain('好的');
  expect(probes).toContain('好的收到');
  expect(probes).toContain('归档');
  expect(discriminativeProbes('deploy window retry')).toEqual(expect.arrayContaining(['deploy', 'window', 'retry']));
  expect(discriminativeProbes('窗口改到 2025-11-04')).toContain('2025');
});

test('a hit whose whole overlap with the question is small talk is not a hit', () => {
  const frequent = new Set(['好的', '好的收到', '收到']);
  // The pleasantry pile: everything it shares with the question is used everywhere in this project.
  expect(overlapIsOnlySmallTalk(['好的', '好的收到'], frequent)).toBe(true);
  // The red line: an answer that shares an answer-carrying word is never discarded.
  expect(overlapIsOnlySmallTalk(['好的', '归档'], frequent)).toBe(false);
  // Frequency alone is not evidence. This is the case the suite's own corpus argued for — an answer
  // worded like seven others overlaps only through common words, and must stay retrievable.
  expect(overlapIsOnlySmallTalk(['retry'], new Set(['retry']))).toBe(false);
  // Nothing readable: nothing demonstrated, so nothing discarded.
  expect(overlapIsOnlySmallTalk([], frequent)).toBe(false);
});

/**
 * #174: the probe reads the same pack `classifySocialTurn` reads, at call time.
 *
 * `cheers` is an English pleasantry the Chinese pack does not carry, so it is the word that tells the two packs
 * apart. The old code froze the vocabulary into a module constant at import — before `MemoryKernel` set the
 * project language — so an `en` project token-checked against Chinese and this word was not a filler; the
 * verdict next to it came from the English pack.
 */
test('the filler probe follows the configured language, not an import-time snapshot', () => {
  const frequent = new Set(['cheers']);
  try {
    setConfiguredLanguage('en');
    expect(overlapIsOnlySmallTalk(['cheers'], frequent)).toBe(true);
    setConfiguredLanguage('zh');
    expect(overlapIsOnlySmallTalk(['cheers'], frequent)).toBe(false);
    // And the Chinese pack still answers for Chinese words, so the switch is not a one-way door.
    setConfiguredLanguage('zh');
    expect(overlapIsOnlySmallTalk(['好的'], new Set(['好的']))).toBe(true);
  } finally {
    setConfiguredLanguage('zh');
  }
});
