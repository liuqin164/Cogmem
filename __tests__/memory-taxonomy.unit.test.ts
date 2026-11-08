import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FacetQueryPlanner } from '../src/atlas/FacetQueryPlanner.js';
import { DEFAULT_TAXONOMY, resolveTaxonomy, validateTaxonomy, type MemoryTaxonomy } from '../src/config/MemoryTaxonomy.js';
import { MEMORY_FRAME_EPISODE_KINDS, normalizeEpisodeKind } from '../src/semantic/MemoryFrameTypes.js';
import { MEMORY_FRAME_JSON_SCHEMA, memoryFrameJsonSchema } from '../src/semantic/MemoryFrameSchema.js';
import { MEMORY_FRAME_SYSTEM_PROMPT, memoryFrameSystemPrompt } from '../src/semantic/SemanticProcessorPrompt.js';
import { validateMemoryFrame } from '../src/semantic/MemoryFrameValidator.js';

/**
 * #132: the vocabulary moved into one place, and the default is what it always was. The first half asserts
 * that item by item; the second half asserts that a different vocabulary actually takes effect, which is the
 * only way to tell "configurable" from "still hard-coded".
 */
function frameWithKind(episodeKind: string) {
  return {
    schemaVersion: 'memory_frame.v1', frameId: 'f1', projectId: 'p', episodeId: 'e1', title: 't', summary: 's',
    episodeKind, nodes: [
      { frameNodeId: 'ep', dimension: 'episode', label: 'episode', confidence: 1, evidenceEventIds: ['evt-1'] },
      { frameNodeId: 'pj', dimension: 'project', label: 'p', confidence: 1, evidenceEventIds: ['evt-1'] },
    ],
    relations: [], temporalReferences: [], stateTransitions: [], confidence: 0.5, evidenceEventIds: ['evt-1'],
    processor: { promptVersion: 'v1', generatedAt: 1 },
  } as never;
}

test('the default vocabulary is the one the code already had, item by item', () => {
  expect(DEFAULT_TAXONOMY.episodeKinds.map((kind) => kind.id)).toEqual([...MEMORY_FRAME_EPISODE_KINDS]);
  // The schema, the validator and the prompt all read that list rather than restating it.
  expect(MEMORY_FRAME_JSON_SCHEMA.properties.episodeKind.enum).toEqual([...MEMORY_FRAME_EPISODE_KINDS]);
  for (const kind of MEMORY_FRAME_EPISODE_KINDS) {
    expect({ kind, valid: validateMemoryFrame(frameWithKind(kind)).valid }).toEqual({ kind, valid: true });
  }
  expect(validateMemoryFrame(frameWithKind('not_a_kind')).errors).toContain('invalid_episode_kind');
  expect(MEMORY_FRAME_SYSTEM_PROMPT).toContain(`episodeKind must be one of ${MEMORY_FRAME_EPISODE_KINDS.join(', ')}.`);
  expect(MEMORY_FRAME_SYSTEM_PROMPT).toContain(`Registered relation names: ${DEFAULT_TAXONOMY.relationNames.join(', ')}.`);
  // The planner's rules come from the same definition.
  const planned = new FacetQueryPlanner().plan('有一个 bug 要修', { projectId: 'p', now: 0 }).facets
    .filter((facet) => facet.type === 'memoryKind').map((facet) => facet.value);
  expect(planned).toEqual(['bug']);
  expect(DEFAULT_TAXONOMY.memoryKindRules.map((rule) => rule.id)).toEqual(['bug', 'decision', 'plan']);
});

const COMPANION: MemoryTaxonomy = {
  ...DEFAULT_TAXONOMY,
  episodeKinds: [
    { id: 'story', description: 'Something the user told me about their day.' },
    { id: 'mood', description: 'How the user sounded.' },
    { id: 'promise', description: 'Something the user asked me to remember to follow up.' },
  ],
};

test('a different vocabulary takes effect in the prompt, the schema and the validator', () => {
  const prompt = memoryFrameSystemPrompt(COMPANION);
  expect(prompt).toContain('episodeKind must be one of story, mood, promise.');
  expect(prompt).not.toContain('episodeKind must be one of discussion');
  // The shipped schema constant is not mutated by asking for another vocabulary.
  expect(memoryFrameJsonSchema({ taxonomy: COMPANION }).properties.episodeKind.enum).toEqual(['story', 'mood', 'promise']);
  expect(MEMORY_FRAME_JSON_SCHEMA.properties.episodeKind.enum).toEqual([...MEMORY_FRAME_EPISODE_KINDS]);
  // The gate follows the vocabulary: a companion kind passes with it and fails without it.
  expect(validateMemoryFrame(frameWithKind('story'), { taxonomy: COMPANION }).valid).toBe(true);
  expect(validateMemoryFrame(frameWithKind('story')).errors).toContain('invalid_episode_kind');
});

test('a broken vocabulary is refused loudly enough for the caller to fall back', () => {
  expect(validateTaxonomy({ episode_kinds: [{ id: 'a', description: 'x' }], nonsense: 1 }).reasons).toContain('unknown_field:nonsense');
  expect(validateTaxonomy({ episode_kinds: [{ id: 'a', description: 'x' }, { id: 'a', description: 'y' }] }).reasons).toContain('duplicate_id:a');
  expect(validateTaxonomy({ episode_kinds: [{ id: 'a', description: '   ' }] }).reasons).toContain('empty_description:a');
  expect(validateTaxonomy({ episode_kinds: [{ id: 'a' }] }).reasons).toContain('missing_description:a');
  expect(validateTaxonomy({ episode_kinds: [{ id: 'a', description: 'x' }] })).toEqual({ ok: true, reasons: [] });
});

/**
 * #182: an empty list is a broken file, not a way to declare "none".
 *
 * `episode_kinds = []` passed the shape check and validated no entry, so `resolveTaxonomy` answered
 * `source: custom` with an empty kind list — every frame was then `invalid_episode_kind` and the prompt read
 * `episodeKind must be one of .`. The three lists now fall back to the shipped vocabulary together and say why.
 */
test('an empty vocabulary list falls back to the default instead of accepting nothing', () => {
  for (const [field, section] of [
    ['episode_kinds', { episode_kinds: [] }],
    ['action_kinds', { action_kinds: [] }],
    ['relation_names', { relation_names: [] }],
  ] as const) {
    expect(validateTaxonomy(section).reasons).toContain(`${field}_must_not_be_empty`);
    const resolved = resolveTaxonomy(section);
    expect({ field, source: resolved.source }).toEqual({ field, source: 'invalid-fell-back' });
    expect(resolved.taxonomy.episodeKinds.map((kind) => kind.id)).toEqual([...MEMORY_FRAME_EPISODE_KINDS]);
    expect(resolved.taxonomy.actionKinds).toEqual(DEFAULT_TAXONOMY.actionKinds);
    expect(resolved.taxonomy.relationNames).toEqual(DEFAULT_TAXONOMY.relationNames);
  }
  // A non-empty list is still `custom`: the check did not turn the surface off.
  expect(resolveTaxonomy({ episode_kinds: [{ id: 'story', description: 'x' }] })).toMatchObject({ source: 'custom' });
  // The same shape check now covers a non-array `relation_names`, which used to resolve `custom` while quietly
  // keeping the default names — the same "validated but ineffective" one shape over.
  expect(validateTaxonomy({ relation_names: 'PARTICIPATED_IN' }).reasons).toContain('relation_names_must_be_an_array');
  expect(resolveTaxonomy({ relation_names: 'PARTICIPATED_IN' }).source).toBe('invalid-fell-back');
});

/** #132: a user learns the vocabulary from the host's own skill, and all three must say the same thing. */
test('every shipped host skill states the default vocabulary from the one source', () => {
  const sentence = `Cogmem classifies each turn as one of these episode kinds: ${DEFAULT_TAXONOMY.episodeKinds.map((kind) => kind.id).join(', ')}.`;
  for (const file of ['examples/openclaw-backend/SKILL.md', 'examples/hermes-backend/SKILL.md', 'examples/pi-backend/SKILL.md']) {
    const text = readFileSync(join(import.meta.dir, '..', file), 'utf8');
    expect({ file, teaches: text.includes(sentence) }).toEqual({ file, teaches: true });
  }
});

/**
 * #170: the two mis-wired fields and the two dead ones.
 *
 * The planner's rules and its action vocabulary both come from the project's `[taxonomy]` now; the config key that
 * was accepted and then dropped (`memory_kind_rules`) is an unknown field, and the consumer-less marker field is
 * gone from the type.
 */
test('action_kinds judges existence by `kind`, the field the entries actually carry', () => {
  // The old check read `id`, so this well-formed entry was judged `action_kinds_entry_without_id` and the whole
  // section fell back with a reason naming the wrong fault.
  expect(validateTaxonomy({ action_kinds: [{ kind: 'brewed', label: '煮', pattern: 'brewed' }] })).toEqual({ ok: true, reasons: [] });
  expect(validateTaxonomy({ action_kinds: [{ id: 'brewed' }] }).reasons).toContain('action_kinds_entry_without_kind');
  expect(validateTaxonomy({ action_kinds: [{ kind: 'brewed' }, { kind: 'brewed' }] }).reasons).toContain('duplicate_kind:brewed');
  // A pattern that cannot compile is caught at validation, not thrown out of `resolveTaxonomy`.
  expect(validateTaxonomy({ action_kinds: [{ kind: 'brewed', pattern: '(' }] }).reasons).toContain('invalid_pattern:brewed');
});

test('the planner follows the project action vocabulary, not the shipped one', () => {
  const kindsOf = (planner: FacetQueryPlanner, query: string) => planner.plan(query, { projectId: 'p', now: 0 })
    .facets.filter((facet) => facet.type === 'actionKind').map((facet) => facet.value);

  // A project-invented kind is findable through its own pattern ...
  const project = resolveTaxonomy({ action_kinds: [{ kind: 'brewed', label: '煮', pattern: '煮咖啡|brewed' }] });
  expect(kindsOf(new FacetQueryPlanner(project.taxonomy), '今天煮咖啡了吗')).toContain('brewed');
  expect(kindsOf(new FacetQueryPlanner(), '今天煮咖啡了吗')).not.toContain('brewed');

  // ... and narrowing the vocabulary narrows the planner: `installed` is not in this project's list.
  const narrowed = resolveTaxonomy({ action_kinds: [{ kind: 'started' }] });
  expect(kindsOf(new FacetQueryPlanner(narrowed.taxonomy), '安装还是启动')).toEqual(['started']);
  expect(kindsOf(new FacetQueryPlanner(), '安装还是启动').sort()).toEqual(['installed', 'started']);

  // The generic "what did I have you do" expansion asks about the project's kinds too.
  const generic = new FacetQueryPlanner(narrowed.taxonomy)
    .plan('查查还记不记得我之前让你对 Hermes 做过什么', { projectId: 'p', now: 0 })
    .facets.filter((facet) => facet.type === 'actionKind').map((facet) => facet.value);
  expect(generic).toEqual(['started']);
});

test('memory_kind_rules is an unknown field, and the marker field is gone', () => {
  expect(validateTaxonomy({ memory_kind_rules: [{ id: 'bug', pattern: 'bug' }] }).reasons).toContain('unknown_field:memory_kind_rules');
  expect(resolveTaxonomy({ memory_kind_rules: [{ id: 'bug', pattern: 'bug' }] }).source).toBe('invalid-fell-back');
  expect(Object.keys(DEFAULT_TAXONOMY)).not.toContain('memoryKindMarkers');
});

/**
 * #182: the frame kind is an open `string`, not a closed union.
 *
 * The valid set is the project's `[taxonomy] episode_kinds` and is only known at runtime, so the type cannot be
 * the shipped nine; `#175`/`#179` let a custom kind through `normalizeEpisodeKind` with an `as` cast at the
 * boundary. `bun run typecheck` is the real gate — removing the cast while the union is still there stops
 * compiling — but it reads `src/` only, so these two shape assertions are the tripwire the suite itself runs.
 * Runtime validation is unchanged: a kind the resolved vocabulary does not declare is still rejected.
 */
test('the frame kind is an open string, with no cast left at the boundary', () => {
  const source = readFileSync(join(import.meta.dir, '..', 'src/semantic/MemoryFrameTypes.ts'), 'utf8');
  expect(source).toMatch(/episodeKind:\s*string;/);
  expect(source).not.toMatch(/as MemoryFrameV1\['episodeKind'\]/);
  // The value crosses as-is; the gate is the resolved vocabulary, not the type.
  const kind = normalizeEpisodeKind('story', ['story', 'mood', 'other']);
  expect(kind).toBe('story');
  expect(validateMemoryFrame(frameWithKind('story')).errors).toContain('invalid_episode_kind');
  expect(validateMemoryFrame(frameWithKind('story'), { taxonomy: COMPANION }).valid).toBe(true);
});
