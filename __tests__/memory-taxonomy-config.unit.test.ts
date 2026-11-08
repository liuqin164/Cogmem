import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FacetQueryPlanner } from '../src/atlas/FacetQueryPlanner.js';
import { loadCogmemConfig } from '../src/config/CogmemConfig.js';
import { resolveTaxonomy } from '../src/config/MemoryTaxonomy.js';
import { createMemoryKernel } from '../src/factory.js';
import { deterministicFrameFallback, StructuredSemanticProcessor } from '../src/semantic/index.js';
import { MEMORY_FRAME_EPISODE_KINDS, normalizeEpisodeKind } from '../src/semantic/MemoryFrameTypes.js';
import { memoryFrameSystemPrompt } from '../src/semantic/SemanticProcessorPrompt.js';
import { frameSourceFingerprint } from '../src/store/MemoryFrameStore.js';
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

/**
 * #170: the action vocabulary is a `[taxonomy]` key, and the planner is one of its consumers.
 *
 * `action_kinds` used to be validated with the wrong field name (so a good entry fell back) and the planner read
 * the shipped registry instead of the project's list, so nothing a project wrote here reached a query. This walks
 * the real path — file, loader, resolved taxonomy, planner — rather than a hand-built object.
 */
test('a project action vocabulary changes what the planner emits', () => {
  const path = withConfig(`[taxonomy]\naction_kinds = [\n  { kind = "brewed", label = "煮", pattern = "煮咖啡|brewed" },\n  { kind = "started" },\n]\n`);
  const loaded = loadCogmemConfig({ configPath: path, env: { HOME: '/nonexistent' } as never });
  expect(loaded.taxonomyStatus?.source).toBe('custom');
  const planner = new FacetQueryPlanner(loaded.options.taxonomy?.taxonomy);
  const kindsOf = (query: string) => planner.plan(query, { projectId: 'p', now: 0 })
    .facets.filter((facet) => facet.type === 'actionKind').map((facet) => facet.value);
  // The project's own kind, through its pattern ...
  expect(kindsOf('今天煮咖啡了吗')).toContain('brewed');
  // ... and the shipped `installed` is absent because this project did not list it.
  expect(kindsOf('安装还是启动')).toEqual(['started']);
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

/**
 * A custom vocabulary has to survive the two validators between the prompt and the database.
 *
 * Measured on the box (#132): with `[taxonomy] episode_kinds = [story, mood]`, a real provider returned an
 * episode kind the shipped vocabulary does not contain and Dream answered
 * `invalid_memory_frame_output:invalid_episode_kind` — the prompt said `story, mood`, but the processor
 * validated against the shipped list because neither it nor the frame store was told the project's taxonomy.
 */
test('a custom episode kind passes the processor and the frame store, not just the prompt', async () => {
  const custom = resolveTaxonomy({ episode_kinds: [
    { id: 'story', description: 'What the user told me about their day.' },
    { id: 'mood', description: 'How the user sounded.' },
  ] });
  const frame = {
    ...deterministicFrameFallback({ projectId: 'p', episodeId: 'ep-story', events: [{ eventId: 'evt-1', occurredAt: 0 } as never], now: 0 }),
    episodeKind: 'story',
  };

  const processor = new StructuredSemanticProcessor(async () => frame, custom.taxonomy);
  const processed = await processor.process({ projectId: 'p', episodeId: 'ep-story', events: [{ eventId: 'evt-1' } as never] });
  expect(processed.episodeKind).toBe('story');

  const dir = makeTempDir('cogmem-taxonomy-frame-');
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec', taxonomy: custom });
  try {
    const saved = kernel.memoryFrameStore.save({ frame, sourceFingerprint: frameSourceFingerprint(['evt-1'], 'ep-story') });
    expect(saved.episodeKind).toBe('story');
    expect(kernel.memoryFrameStore.get(saved.frameId)?.episodeKind).toBe('story');
  } finally {
    kernel.close();
  }
});

/**
 * #175 left one mapping on the shipped list: the deterministic fallback — the only producer on a rule-only install,
 * and what `frame-backfill` uses — named its frame kind through `MEMORY_FRAME_EPISODE_KINDS`, while the store now
 * validates against the project's own list. So a project with a vocabulary of its own got frames the same store
 * rejected (`invalid_episode_kind`, every episode of the batch failing) or, if it happened to keep the shipped
 * kind, a frame mislabelled with it. The honest target is the vocabulary's own `other`, which is what the shipped
 * list has always done for a type the frame layer does not know.
 */
test('the fallback names its frame kind through the project vocabulary, not the shipped one', () => {
  // `story` is a kind only this project declares; the shipped list has no answer for it but `other`.
  const custom = resolveTaxonomy({ episode_kinds: [
    { id: 'story', description: 'What the user told me about their day.' },
    { id: 'other', description: 'None of the above.' },
  ] });
  const declared = custom.taxonomy.episodeKinds.map((kind) => kind.id);
  // Rollback-red on both halves: the shipped list answers `other` for `story`, and `preference` — a kind this
  // project never declared, which the store then rejects — for an episode type outside its list.
  expect(normalizeEpisodeKind('story')).toBe('other');
  expect(normalizeEpisodeKind('story', declared)).toBe('story');
  expect(normalizeEpisodeKind('preference')).toBe('preference');
  expect(normalizeEpisodeKind('preference', declared)).toBe('other');

  const dir = makeTempDir('cogmem-taxonomy-fallback-');
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec', taxonomy: custom });
  try {
    // A declared kind survives the store that validates against the same list.
    const storyFrame = deterministicFrameFallback({
      projectId: 'p', episodeId: 'ep-story', episodeType: 'story',
      episodeKinds: declared, events: [{ eventId: 'evt-story', occurredAt: 0 } as never],
    });
    expect(storyFrame.episodeKind).toBe('story');
    const savedStory = kernel.memoryFrameStore.save({ frame: storyFrame, sourceFingerprint: frameSourceFingerprint(['evt-story'], 'ep-story') });
    expect(savedStory.episodeKind).toBe('story');
    expect(kernel.memoryFrameStore.get(savedStory.frameId)?.episodeKind).toBe('story');

    // One it does not declare falls to the project's own `other` and still saves.
    const otherFrame = deterministicFrameFallback({
      projectId: 'p', episodeId: 'ep-preference', episodeType: 'preference',
      episodeKinds: declared, events: [{ eventId: 'evt-pref', occurredAt: 0 } as never],
    });
    expect(otherFrame.episodeKind).toBe('other');
    const savedOther = kernel.memoryFrameStore.save({ frame: otherFrame, sourceFingerprint: frameSourceFingerprint(['evt-pref'], 'ep-preference') });
    expect(savedOther.episodeKind).toBe('other');
  } finally {
    kernel.close();
  }
});

test('a backfill on a project vocabulary completes, instead of failing every episode', () => {
  const custom = resolveTaxonomy({ episode_kinds: [
    { id: 'discussion', description: 'A conversation.' },
    { id: 'other', description: 'None of the above.' },
  ] });
  const dir = makeTempDir('cogmem-taxonomy-backfill-');
  const dbPath = join(dir, 'memory.db');
  const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec', taxonomy: custom });
  kernel.appendEpisodeMessage({ projectId: 'p', sessionId: 's1', sourceAgent: 'a', role: 'user', text: '归档保留期定成七年。', timestamp: Date.now() - 3_600_000 });
  // A kind the project's list does not declare: the shipped default would emit it and the store would reject it.
  const db = new Database(dbPath);
  db.prepare("UPDATE memory_episodes SET episode_type = 'preference'").run();
  db.close();

  const result = kernel.backfillMemoryFrames({ projectId: 'p', limit: 50 });
  expect(result.failed).toBe(0);
  expect(result.created).toBe(1);
  const episodeId = kernel.listEpisodes({ projectId: 'p', limit: 1 })[0]!.episodeId;
  expect(kernel.getMemoryFrame(episodeId, 'p', { includeStaged: true })?.episodeKind).toBe('other');
  kernel.close();
});
