import { expect, test } from 'bun:test';
import { FacetQueryPlanner } from '../src/atlas/FacetQueryPlanner.js';
import { DEFAULT_TAXONOMY, validateTaxonomy, type MemoryTaxonomy } from '../src/config/MemoryTaxonomy.js';
import { MEMORY_FRAME_EPISODE_KINDS } from '../src/semantic/MemoryFrameTypes.js';
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
