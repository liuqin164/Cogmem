import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The `person` facet reaches `PersonDirectory` (#214): a query that names a person is resolved by
 * the person layer first, so a nickname of an identity merged away still becomes an entrance to the
 * memory indexed under the survivor's name. The Atlas machinery itself is covered elsewhere; this
 * file holds the wiring discriminator.
 */
const scratch = makeTempDir('cogmem-person-facet-');
let kernel: MemoryKernel;

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath: join(scratch, 'memory.db'), projectTimeZone: 'UTC' });
});

afterAll(() => {
  kernel.close();
});

describe('the person facet resolves through the person directory', () => {
  test('合并后用小名查询图谱，仍能找到挂在被并侧名下的记忆', () => {
    const projectId = 'person-facet';
    const survivor = kernel.persons.ensurePerson({ projectId, name: 'Alice' });
    const source = kernel.persons.ensurePerson({ projectId, name: 'Allison', aliases: ['Ally'] });
    const event = kernel.eventStore.append({
      eventId: 'evt-person-facet', streamId: 's1', streamType: 'thread', eventType: 'MESSAGE', rawEventType: 'message',
      projectId, sessionId: 's1', threadId: 's1', localDate: '2026-06-01', role: 'user',
      occurredAt: Date.UTC(2026, 5, 1, 12), payload: { text: 'Allison is learning to bake.' },
    });
    kernel.appendRawEventToEpisode(event, { projectId, sessionId: 's1', sourceAgent: 'openclaw' });
    kernel.rebuildMemoryAtlas({ projectId });
    const evidence = kernel.recordRawEvent({ threadId: 't-facet', projectId, role: 'user', content: 'Allison 和 Alice 是同一个人。' });
    kernel.persons.mergePersons({
      projectId, sourcePersonId: source.personId, targetPersonId: survivor.personId,
      alias: 'Allison', confidence: 0.99, evidenceEventIds: [evidence.eventId],
    });

    // "Ally" is the merged-away source's nickname: the person facet must reach Alice's atlas
    // entrance through the directory, not look for a literal "Ally" node.
    const result = kernel.graphSearch('Ally', { projectId });
    const personFacets = (result.matchedFacets ?? []).filter((facet) => facet.type === 'entity');
    expect(personFacets.length).toBeGreaterThan(0);
    for (const facet of personFacets) expect(facet.productFacet).toBe('person');
    expect((result as unknown as { cards?: unknown[] }).cards?.length ?? 0).toBeGreaterThan(0);

    // A reference the directory does not know is not dressed up as a person.
    const undeclared = kernel.graphSearch('Nobody', { projectId });
    expect((undeclared.matchedFacets ?? []).some((facet) => facet.type === 'entity' && facet.productFacet === 'person')).toBe(false);
  });
});
