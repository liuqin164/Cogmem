import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { FacetQueryPlanner } from '../src/atlas/FacetQueryPlanner.js';
import { createMemoryKernel } from '../src/factory.js';
import { deterministicFrameFallback } from '../src/semantic/index.js';
import { makeTempDir } from './helpers/tmp.js';

const PLANNER_OPTIONS = { projectId: 'project-a', now: Date.UTC(2026, 0, 15), localDateNow: '2026-01-15', timeZone: 'UTC' };

/**
 * #28's acceptance, end to end and with no model in the loop: a frame that carries a place and a state
 * transition has to be reachable by asking *where* and *in what state*.
 *
 * The frame is hand-written rather than extracted, because the deterministic fallback does not emit a
 * location node or a state transition yet — that is a separate piece of work, named on the ticket.
 */
function seeded() {
  const dir = makeTempDir('cogmem-facet-state-place-');
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const TWO_YEARS_AGO = Date.UTC(2024, 0, 10);
  const event = kernel.eventStore.append({
    eventId: 'pre-migration-decision', streamId: 's1', streamType: 'thread', eventType: 'MESSAGE',
    rawEventType: 'message', projectId: 'project-a', sessionId: 's1', threadId: 's1',
    localDate: '2024-01-10', role: 'user', occurredAt: TWO_YEARS_AGO,
    payload: { text: 'We decided to finish the migration while still on SQLite, at the Tokyo office.' },
  });
  const episode = kernel.episodeStore.createEpisode({
    projectId: 'project-a', sessionId: 's1', conversationThreadId: 's1', episodeType: 'discussion',
    importance: 0.5, eventId: event.eventId, globalSeq: event.globalSeq, occurredAt: TWO_YEARS_AGO,
  });
  kernel.episodeStore.appendEvent({ episodeId: episode.episodeId, eventId: event.eventId, relation: 'primary', confidence: 1, globalSeq: event.globalSeq, occurredAt: TWO_YEARS_AGO });

  const frame = deterministicFrameFallback({ projectId: 'project-a', episodeId: episode.episodeId, events: [event] });
  // The deterministic fallback marks a frame for review, and a frame awaiting review is not projected
  // (its status stays `staged`). A processor frame is trusted, which is the case this test is about.
  frame.needsReview = false;
  (frame as unknown as { sourceAuthority: string }).sourceAuthority = 'processor';
  const subject = frame.nodes.find((node) => node.dimension === 'event')!.frameNodeId;
  frame.nodes.push({ frameNodeId: 'place-tokyo', dimension: 'location', label: 'Tokyo office', description: 'We finished the migration planning here.', aliases: ['the Tokyo office'], confidence: 0.9, evidenceEventIds: [event.eventId] });
  // The questions also name a proper noun, which the entity cue extractor turns into an entity facet.
  // A real frame carries those nodes; the plan intersects facet groups, so without them an empty entity
  // group would veto a query whose place facet did match.
  for (const [frameNodeId, label] of [['entity-tokyo', 'Tokyo'], ['entity-sqlite', 'SQLite']] as const) {
    frame.nodes.push({ frameNodeId, dimension: 'entity', label, confidence: 0.9, evidenceEventIds: [event.eventId] });
  }
  frame.relations.push({ sourceFrameNodeId: subject, relationType: 'LOCATED_AT', targetFrameNodeId: 'place-tokyo', confidence: 0.9, evidenceEventIds: [event.eventId] });
  frame.stateTransitions.push({ subjectFrameNodeId: subject, to: 'SQLite', confidence: 0.9, evidenceEventIds: [event.eventId] });
  const saved = kernel.memoryFrameStore.save({ frame, sourceFingerprint: 'facet-state-place', status: 'active', now: 0 });
  kernel.memoryFrameStore.publish(saved.frameId, 'staged', 'active', 1);
  kernel.rebuildMemoryAtlas({ projectId: 'project-a' });
  return { kernel, episodeId: episode.episodeId };
}

function matchedFacets(kernel: ReturnType<typeof createMemoryKernel>, question: string) {
  const plan = new FacetQueryPlanner().plan(question, PLANNER_OPTIONS);
  const cards = kernel.memoryAtlasStore.searchCanonicalEpisodeCards('project-a', plan, 5);
  return { cards, facets: cards.flatMap((card) => card.matchedFacets ?? []).map((facet) => facet.type) };
}

test('a frame-derived document says in its own text that a consolidation produced it (#129)', () => {
  const { kernel } = seeded();
  try {
    const rows = kernel.factStore.getDatabase().prepare(
      "SELECT summary FROM memory_atlas_documents WHERE project_id='project-a' AND metadata_json LIKE '%frame.v2%' AND summary IS NOT NULL",
    ).all() as Array<{ summary: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.summary).toContain('[consolidated');
  } finally {
    kernel.close();
  }
});

test('a place is projected under its name, not under a hash', () => {
  const { kernel } = seeded();
  try {
    const node = kernel.memoryAtlasStore.getNode('place:tokyo office', 'project-a');
    // The id is the place key; the stored node keeps the dimension it came from.
    expect(node?.nodeType).toBe('location');
    expect(node?.label).toBe('Tokyo office');
  } finally {
    kernel.close();
  }
});

test('"What happened at the Tokyo office?" returns that episode with place in matchedFacets', () => {
  const { kernel } = seeded();
  try {
    const { cards, facets } = matchedFacets(kernel, 'What happened at the Tokyo office?');
    expect(cards.length).toBeGreaterThan(0);
    expect(facets).toContain('place');
  } finally {
    kernel.close();
  }
});

test('"What did we decide while still on SQLite?" returns it with state in matchedFacets', () => {
  const { kernel } = seeded();
  try {
    const { facets } = matchedFacets(kernel, 'What did we decide while still on SQLite?');
    expect(facets).toContain('state');
  } finally {
    kernel.close();
  }
});

test('the episode is two years old and still reachable through both facets (ADR-0001)', () => {
  const { kernel } = seeded();
  try {
    for (const question of ['What happened at the Tokyo office?', 'What did we decide while still on SQLite?']) {
      const { cards } = matchedFacets(kernel, question);
      expect({ question, reached: cards.length > 0 }).toEqual({ question, reached: true });
    }
  } finally {
    kernel.close();
  }
});
