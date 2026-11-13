import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_TAXONOMY, resolveTaxonomy } from '../src/config/MemoryTaxonomy.js';
import { DEFAULT_EPISODE_TYPES } from '../src/episode/EpisodeTypes.js';
import { classifyTurnRelationHybridTrace, type TurnRelationAdvisoryReviewer } from '../src/episode/TurnRelationClassifier.js';
import { createMemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

const episodeBin = join(import.meta.dir, '..', 'src', 'bin', 'episode.ts');

const STORY_VOCAB = `[taxonomy]\nepisode_kinds = [\n  { id = "story", description = "What the user told me about their day." },\n  { id = "other", description = "None of the above." },\n]\n`;
const TURN = 'the garden needs work this spring';

/** A workspace with a project config and one seeded episode, the way a user would have one. */
function seedWorkspace(toml: string): { configPath: string; dbPath: string; episodeId: string } {
  const dir = makeTempDir('cogmem-episode-type-');
  const dbPath = join(dir, 'memory.db');
  const configPath = join(dir, 'config.toml');
  writeFileSync(configPath, `[core]\ndb_path = "${dbPath}"\n${toml}`);
  const kernel = createMemoryKernel({ dbPath });
  kernel.appendEpisodeMessage({
    projectId: 'p', sessionId: 's', sourceAgent: 'p', role: 'user', text: TURN, timestamp: Date.UTC(2026, 0, 2),
  });
  const episodeId = kernel.listEpisodes({ projectId: 'p', limit: 1 })[0]!.episodeId;
  kernel.close();
  return { configPath, dbPath, episodeId };
}

function runCli(args: string[]): { status: number | null; output: string } {
  const proc = spawnSync('bun', [episodeBin, ...args], { encoding: 'utf8' });
  return { status: proc.status, output: `${proc.stdout ?? ''}${proc.stderr ?? ''}` };
}

/** A kernel on a temp database, seeded with one episode the way an append would leave it. */
function seededKernel(options: Parameters<typeof createMemoryKernel>[0]): { kernel: ReturnType<typeof createMemoryKernel>; episodeId: string } {
  const kernel = createMemoryKernel(options);
  kernel.appendEpisodeMessage({
    projectId: 'p', sessionId: 's', sourceAgent: 'p', role: 'user', text: TURN, timestamp: Date.UTC(2026, 0, 2),
  });
  const episodeId = kernel.listEpisodes({ projectId: 'p', limit: 1 })[0]!.episodeId;
  return { kernel, episodeId };
}

/**
 * #184: the CLI's `--episode-type` is validated against the project's own `[taxonomy] episode_kinds`, not the
 * shipped closed set. On the box this rejected `story` outright, so a project's own kind could only enter through
 * a real provider — a rule-only install had no way to mark an episode as its own kind.
 */
test('a project vocabulary lets the CLI name its own kind, and still refuses an undeclared one', () => {
  const { configPath, dbPath, episodeId } = seedWorkspace(STORY_VOCAB);

  const ok = runCli(['reclassify', '--project', 'p', '--episode', episodeId, '--episode-type', 'story', '--config', configPath, '--json']);
  expect({ status: ok.status, output: ok.status === 0 ? '' : ok.output }).toEqual({ status: 0, output: '' });
  const kernel = createMemoryKernel({ dbPath });
  expect(kernel.getEpisode(episodeId)?.episodeType).toBe('story');
  kernel.close();

  const bad = runCli(['reclassify', '--project', 'p', '--episode', episodeId, '--episode-type', 'bogus', '--config', configPath, '--json']);
  expect(bad.status).not.toBe(0);
  expect(bad.output).toContain('invalid episode type: expected one of story, other');
});

/**
 * The other half of the decision: with no `[taxonomy]` the episode vocabulary is the shipped nine, unchanged — and
 * it is the *episode* nine, not the frame layer's, which a naive read of `episodeKinds` would have swapped in.
 */
test('the resolved episode vocabulary follows the declared episode_kinds, not the frame default', () => {
  expect(DEFAULT_TAXONOMY.episodeTypes).toEqual([...DEFAULT_EPISODE_TYPES]);
  // A project that declares only `action_kinds` did not touch the episode vocabulary.
  expect(resolveTaxonomy({ action_kinds: [{ kind: 'brewed' }] }).taxonomy.episodeTypes).toEqual([...DEFAULT_EPISODE_TYPES]);
  expect(resolveTaxonomy({ episode_kinds: [{ id: 'story', description: 'x' }] }).taxonomy.episodeTypes).toEqual(['story']);
});

test('the CLI without a taxonomy accepts a shipped type and refuses a frame-only kind', () => {
  const { configPath, episodeId } = seedWorkspace('');
  const ok = runCli(['reclassify', '--project', 'p', '--episode', episodeId, '--episode-type', 'prospective', '--config', configPath]);
  expect({ status: ok.status, output: ok.status === 0 ? '' : ok.output }).toEqual({ status: 0, output: '' });

  const frameKind = runCli(['reclassify', '--project', 'p', '--episode', episodeId, '--episode-type', 'operation', '--config', configPath]);
  expect(frameKind.status).not.toBe(0);
  expect(frameKind.output).toContain('invalid episode type: expected one of discussion, decision');
});

/**
 * A reviewer is a producer of kinds, and it may only name one the resolved vocabulary declares (#184). An
 * undeclared value keeps the deterministic classification instead of being written through.
 */
test('a reviewer may name a declared project kind; an undeclared one falls back to the deterministic type', async () => {
  const story: TurnRelationAdvisoryReviewer = { review: async () => ({ episodeType: 'story' }) };
  const context = { currentUserText: TURN };

  const declared = await classifyTurnRelationHybridTrace(context, story, ['story', 'other']);
  expect(declared.finalDecision.episodeType).toBe('story');
  // Rollback-red: the shipped nine does not know `story`, so the CPU classification stands.
  expect((await classifyTurnRelationHybridTrace(context, story)).finalDecision.episodeType).toBe('discussion');

  // A shipped kind the project did not declare is refused the same way.
  const preference: TurnRelationAdvisoryReviewer = { review: async () => ({ episodeType: 'preference' }) };
  const undeclared = await classifyTurnRelationHybridTrace(context, preference, ['story', 'other']);
  expect(undeclared.finalDecision.episodeType).toBe(undeclared.cpuDecision.episodeType);
  expect((await classifyTurnRelationHybridTrace(context, preference)).finalDecision.episodeType).toBe('preference');
});

/**
 * The wiring, not just the classifier: the kernel's assembler hands the resolved vocabulary down, so an append
 * with a reviewer lands the project's own kind on the episode.
 */
test('the resolved vocabulary reaches the append path through the assembler', async () => {
  const story: TurnRelationAdvisoryReviewer = { review: async () => ({ episodeType: 'story' }) };
  const custom = resolveTaxonomy({ episode_kinds: [
    { id: 'story', description: 'What the user told me about their day.' },
    { id: 'other', description: 'None of the above.' },
  ] });

  const withProject = createMemoryKernel({
    dbPath: join(makeTempDir('cogmem-episode-type-append-'), 'memory.db'), vectorBackend: 'sqlite-vec',
    taxonomy: custom, turnRelationReviewer: story,
  });
  try {
    await withProject.appendEpisodeMessageAsync({ projectId: 'p', sessionId: 's', sourceAgent: 'p', role: 'user', text: TURN, timestamp: Date.UTC(2026, 0, 2) });
    expect(withProject.listEpisodes({ projectId: 'p', limit: 1 })[0]!.episodeType).toBe('story');
  } finally {
    withProject.close();
  }

  // No project vocabulary: `story` is not declared, so the deterministic type is what an append leaves behind.
  const shipped = createMemoryKernel({
    dbPath: join(makeTempDir('cogmem-episode-type-append-'), 'memory.db'), vectorBackend: 'sqlite-vec',
    turnRelationReviewer: story,
  });
  try {
    await shipped.appendEpisodeMessageAsync({ projectId: 'p', sessionId: 's', sourceAgent: 'p', role: 'user', text: TURN, timestamp: Date.UTC(2026, 0, 2) });
    expect(shipped.listEpisodes({ projectId: 'p', limit: 1 })[0]!.episodeType).toBe('discussion');
  } finally {
    shipped.close();
  }
});

/** #184: the episode type is an open `string`; the runtime gate is the resolved vocabulary, not the type. */
test('the episode type is an open string', () => {
  const source = readFileSync(join(import.meta.dir, '..', 'src', 'episode', 'EpisodeTypes.ts'), 'utf8');
  expect(source).toMatch(/export type EpisodeType = string;/);
});

/**
 * #209: the gate is on the kernel, not only the CLI. Any caller reaching `repairEpisode` directly — a future
 * resident agent, a plugin, a script — may name a declared kind and nothing else. Rollback-red: before the
 * check moved into the kernel this wrote `bogus` through and `getEpisode` returned it.
 */
test('the kernel refuses an episode type the project did not declare', () => {
  const custom = resolveTaxonomy({ episode_kinds: [
    { id: 'story', description: 'What the user told me about their day.' },
    { id: 'other', description: 'None of the above.' },
  ] });
  const { kernel, episodeId } = seededKernel({ dbPath: join(makeTempDir('cogmem-episode-type-kernel-'), 'memory.db'), taxonomy: custom });
  try {
    kernel.repairEpisode({ operation: 'reclassify', projectId: 'p', episodeId, episodeType: 'story' });
    expect(kernel.getEpisode(episodeId)?.episodeType).toBe('story');

    expect(() => kernel.repairEpisode({ operation: 'reclassify', projectId: 'p', episodeId, episodeType: 'bogus' }))
      .toThrow('invalid_episode_type');
    // The refusal is not a partial write: the episode still carries the declared kind.
    expect(kernel.getEpisode(episodeId)?.episodeType).toBe('story');
  } finally {
    kernel.close();
  }

  // A shipped kind the project did not declare is refused the same way, and the shipped nine still pass.
  const { kernel: shipped, episodeId: shippedId } = seededKernel({ dbPath: join(makeTempDir('cogmem-episode-type-kernel-'), 'memory.db') });
  try {
    expect(() => shipped.repairEpisode({ operation: 'reclassify', projectId: 'p', episodeId: shippedId, episodeType: 'story' }))
      .toThrow('invalid_episode_type');
    shipped.repairEpisode({ operation: 'reclassify', projectId: 'p', episodeId: shippedId, episodeType: 'prospective' });
    expect(shipped.getEpisode(shippedId)?.episodeType).toBe('prospective');
  } finally {
    shipped.close();
  }
});
