import { expect, test } from 'bun:test';
import { FacetQueryPlanner } from '../src/atlas/FacetQueryPlanner.js';

const OPTIONS = { projectId: 'project-a', now: Date.UTC(2026, 0, 15), localDateNow: '2026-01-15', timeZone: 'UTC' };

function facetsFor(query: string) {
  return new FacetQueryPlanner().plan(query, OPTIONS).facets.map((facet) => ({ type: facet.type, value: facet.value, relation: facet.relation }));
}

/**
 * #28: where and in what state are things a person says out loud. The planner emits the cue text and
 * the store resolves it through the alias index, because a place is keyed by its normalized name and a
 * state's id is a hash — equality against a cue could never work for either.
 */
test('the two questions produce a state facet and a place facet', () => {
  expect(facetsFor('What did we decide while still on SQLite?')).toContainEqual(
    { type: 'state', value: 'SQLite', relation: 'HAS_STATE' },
  );
  expect(facetsFor('What happened at the Tokyo office?')).toContainEqual(
    { type: 'place', value: 'Tokyo office', relation: 'LOCATED_AT' },
  );
});

test('time cues are not mistaken for places', () => {
  for (const query of ['What happened in July?', 'What happened at 2:00?', 'What changed in 2026?']) {
    expect({ query, places: facetsFor(query).filter((facet) => facet.type === 'place') }).toEqual({ query, places: [] });
  }
  // A Chinese locative still produces a place.
  expect(facetsFor('在东京办公室发生了什么？').some((facet) => facet.type === 'place')).toBe(true);
});
