import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');
const rootDocs = readdirSync(root).filter((file) => file.endsWith('.md'));

/** Phrases the vocabulary change retired. A new document may not reintroduce them. */
const RETIRED_PHRASES = ['structure-first pulse navigation', 'pulse activation', 'pulse-activated'];
const SIX_FACETS = 'time, person, place, event, topic, state';

describe('domain vocabulary in the main documents', () => {
  test('MEMORY_MODEL names the six facets and the thirteen dimensions', () => {
    const model = read('MEMORY_MODEL.md');
    expect(model, 'MEMORY_MODEL must list the six facets in order').toContain(SIX_FACETS);
    expect(model, 'MEMORY_MODEL must keep the dimension count').toContain('thirteen **Dimensions**');
    expect(model, 'MEMORY_MODEL must point at the glossary').toContain('GLOSSARY.md');
  });

  test('MEMORY_MODEL describes recall as one Pulse of two waves', () => {
    const model = read('MEMORY_MODEL.md');
    expect(model, 'the Pulse must be the whole two-wave event').toMatch(/one \*\*Pulse\*\*/);
    expect(model, 'Pulse 1 must be named').toMatch(/\*\*Pulse 1\*\*/);
    expect(model, 'Pulse 2 must be named').toMatch(/\*\*Pulse 2\*\*/);
  });

  test('no root document reintroduces a retired phrase', () => {
    for (const file of rootDocs) {
      for (const phrase of RETIRED_PHRASES) {
        expect(read(file), `${file} must not say "${phrase}"`).not.toContain(phrase);
      }
    }
  });

  test('MEMORY_ATLAS reserves Facet for the six and marks place/state as unprojected', () => {
    const atlas = read('MEMORY_ATLAS.md');
    expect(atlas, 'the stored entrance list must not be called facets').not.toMatch(/Facet nodes: `time`/);
    expect(atlas, 'the six facets must be named').toContain('person, place, event, topic, state');
    expect(atlas, 'the gap must stay visible').toContain('not projected yet');
    expect(atlas, 'the API field keeps its name').toContain('matchedFacets');
    expect(atlas, 'the product facet field must be documented').toContain('productFacet');
  });

  test('README names both waves', () => {
    const readme = read('README.md');
    expect(readme, 'README must name Pulse 1').toContain('Pulse 1');
    expect(readme, 'README must name Pulse 2').toContain('Pulse 2');
  });
});
