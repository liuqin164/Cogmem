import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCogmemConfig } from '../src/config/CogmemConfig.js';
import { resolveTaxonomy } from '../src/config/MemoryTaxonomy.js';
import { MEMORY_FRAME_EPISODE_KINDS } from '../src/semantic/MemoryFrameTypes.js';
import { memoryFrameSystemPrompt } from '../src/semantic/SemanticProcessorPrompt.js';
import { makeTempDir } from './helpers/tmp.js';

/** Writes a workspace with a project config, the way a user would. */
function withConfig(toml: string) {
  const dir = makeTempDir('cogmem-taxonomy-config-');
  mkdirSync(join(dir, '.cogmem'), { recursive: true });
  writeFileSync(join(dir, '.cogmem', 'config.toml'), toml);
  return join(dir, '.cogmem', 'config.toml');
}

/**
 * #132: a project can carry its own vocabulary, and a broken one must not stop the install. The fallback is
 * only honest if it is visible, so the resolution carries its source and reasons to `doctor`.
 */
test('a project config gives the kernel its own vocabulary', () => {
  const path = withConfig(`[taxonomy]\nepisode_kinds = [\n  { id = "story", description = "What the user told me about their day." },\n  { id = "mood", description = "How the user sounded." },\n]\n`);
  const loaded = loadCogmemConfig({ configPath: path, env: { HOME: '/nonexistent' } as never });
  expect(loaded.taxonomyStatus?.source).toBe('custom');
  expect(loaded.taxonomyStatus?.taxonomy.episodeKinds.map((kind) => kind.id)).toEqual(['story', 'mood']);
  expect(memoryFrameSystemPrompt(loaded.options.taxonomy?.taxonomy)).toContain('episodeKind must be one of story, mood.');
});

test('no taxonomy section means the shipped vocabulary, and nothing else changes', () => {
  const path = withConfig('[core]\n');
  const loaded = loadCogmemConfig({ configPath: path, env: { HOME: '/nonexistent' } as never });
  expect(loaded.taxonomyStatus?.source).toBe('default');
  expect(loaded.taxonomyStatus?.reason ?? loaded.taxonomyStatus?.reasons).toEqual([]);
  expect(loaded.options.taxonomy?.taxonomy.episodeKinds.map((kind) => kind.id)).toEqual([...MEMORY_FRAME_EPISODE_KINDS]);
});

test('a broken vocabulary falls back to the default and says why', () => {
  for (const [toml, reason] of [
    ['[taxonomy]\nepisode_kinds = [{ id = "a", description = "x" }]\nunknown_field = 1\n', 'unknown_field:unknown_field'],
    ['[taxonomy]\nepisode_kinds = [{ id = "a", description = "x" }, { id = "a", description = "y" }]\n', 'duplicate_id:a'],
    ['[taxonomy]\nepisode_kinds = [{ id = "a", description = "  " }]\n', 'empty_description:a'],
  ] as const) {
    const loaded = loadCogmemConfig({ configPath: withConfig(toml), env: { HOME: '/nonexistent' } as never });
    expect({ reason: loaded.taxonomyStatus?.reasons.includes(reason) }).toEqual({ reason: true });
    expect(loaded.taxonomyStatus?.source).toBe('invalid-fell-back');
    // Falling back means the shipped vocabulary is in effect — a broken file cannot half-apply.
    expect(loaded.taxonomyStatus?.taxonomy.episodeKinds.map((kind) => kind.id)).toEqual([...MEMORY_FRAME_EPISODE_KINDS]);
  }
});

test('the fallback never throws, so a typo cannot stop Cogmem from starting', () => {
  expect(resolveTaxonomy({ episode_kinds: 'not an array' }).source).toBe('invalid-fell-back');
  expect(resolveTaxonomy(null).source).toBe('default');
  expect(resolveTaxonomy('nonsense').source).toBe('invalid-fell-back');
});
