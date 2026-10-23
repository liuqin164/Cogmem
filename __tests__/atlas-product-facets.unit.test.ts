import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';
import { productFacetFor } from '../src/atlas/MemoryAtlasTypes.js';

// Q10: the product speaks six Facets. A schema `entity` match is a person to the
// reader, and an internal entrance must not be dressed up as one of the six.
test('an entity match on a real episode is reported as the person facet', () => {
  const kernel = createMemoryKernel({ dbPath: join(mkdtempSync(join(tmpdir(), 'cogmem-product-facets-')), 'memory.db') });
  try {
    kernel.memoryBindingStore.upsertEntity({ projectId: 'cogmem', canonicalName: 'Hermes', entityType: 'project' });
    const event = kernel.eventStore.append({
      eventId: 'evt-product-facet', streamId: 's1', streamType: 'thread', eventType: 'MESSAGE', rawEventType: 'message',
      projectId: 'cogmem', sessionId: 's1', threadId: 's1', localDate: '2026-06-01', role: 'user',
      occurredAt: Date.UTC(2026, 5, 1, 12), payload: { text: 'Hermes 部署在东京办公室。' },
    });
    kernel.appendRawEventToEpisode(event, { projectId: 'cogmem', sessionId: 's1', sourceAgent: 'openclaw' });
    kernel.rebuildMemoryAtlas({ projectId: 'cogmem' });

    const result = kernel.graphSearch('Hermes', { projectId: 'cogmem' });
    const entityFacets = (result.matchedFacets ?? []).filter((facet) => facet.type === 'entity');
    expect(entityFacets.length).toBeGreaterThan(0);
    for (const facet of entityFacets) expect(facet.productFacet).toBe('person');
    // The schema field is unchanged: consumers keying on `type` keep working.
    expect(entityFacets[0]!.type).toBe('entity');
  } finally {
    kernel.close();
  }
});

test('internal entrances map to nothing, and event is the only memory kind that is a facet', () => {
  expect(productFacetFor('entity', 'facet:hermes')).toBe('person');
  expect(productFacetFor('location', 'tokyo')).toBe('place');
  expect(productFacetFor('state', 'sqlite')).toBe('state');
  expect(productFacetFor('time', '2026-06')).toBe('time');
  expect(productFacetFor('topic', 'PROJECT/x/deploy')).toBe('topic');
  expect(productFacetFor('memoryKind', 'event')).toBe('event');
  expect(productFacetFor('memoryKind', 'decision')).toBeUndefined();
  expect(productFacetFor('session', 's1')).toBeUndefined();
  expect(productFacetFor('thread', 't1')).toBeUndefined();
  expect(productFacetFor('actionKind', 'started')).toBeUndefined();
  expect(productFacetFor('issue', 'atlas-readability')).toBeUndefined();
  expect(productFacetFor('project', 'cogmem')).toBeUndefined();
});
