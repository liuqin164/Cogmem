import type { MemoryAtlasQueryOptions, MemoryAtlasService } from '../atlas/index.js';
import type { MemoryAtlasSlice } from '../atlas/MemoryAtlasTypes.js';
import { DimensionAwareRanker } from './DimensionAwareRanker.js';
import { MultidimensionalQueryPlanner } from './MultidimensionalQueryPlanner.js';

export class AtlasPathRetriever {
  constructor(private readonly atlas: MemoryAtlasService, private readonly planner = new MultidimensionalQueryPlanner(), private readonly ranker = new DimensionAwareRanker()) {}

  retrieve(query: string, options: MemoryAtlasQueryOptions): { queryFrame: ReturnType<MultidimensionalQueryPlanner['plan']>; result: MemoryAtlasSlice } {
    const queryFrame = this.planner.plan(query, options.now);
    const facetKeys: Record<string, 'actors' | 'projects' | 'topics' | 'issues' | 'events' | 'tasks' | 'entities' | 'locations'> = {
      actor: 'actors', project: 'projects', topic: 'topics', issue: 'issues', event: 'events', task: 'tasks', entity: 'entities', location: 'locations',
    };
    for (const alias of this.atlas.resolveQueryAliases(query, options.projectId)) {
      const key = facetKeys[alias.dimension];
      if (!key) continue;
      const facets = (queryFrame[key] ??= []);
      if (!facets.some((facet) => facet.canonicalNodeId === alias.nodeId)) facets.push({ label: alias.label, dimension: alias.dimension as never, canonicalNodeId: alias.nodeId, confidence: 1 });
    }
    const result = this.atlas.explore(query, {
      ...options,
      seedNodeIds: [...new Set(this.atlas.resolveQueryAliases(query, options.projectId).map((alias) => alias.nodeId))],
      limit: Math.min(options.limit ?? 30, 100),
    });
    const requestedTypes = new Set([
      ...(queryFrame.actors ?? []).map(() => 'actor'), ...(queryFrame.projects ?? []).map(() => 'project'),
      ...(queryFrame.topics ?? []).map(() => 'topic'), ...(queryFrame.issues ?? []).map(() => 'issue'),
      ...(queryFrame.events ?? []).map(() => 'event'), ...(queryFrame.tasks ?? []).map(() => 'task'),
      ...(queryFrame.entities ?? []).map(() => 'entity'), ...(queryFrame.locations ?? []).map(() => 'location'),
    ]);
    const byId = new Map(result.nodes.map((node) => [node.id, node]));
    const matches = (node: (typeof result.nodes)[number]) => {
      const requested = !requestedTypes.size || requestedTypes.has(node.nodeType);
      const facets = Object.values(queryFrame).flatMap((value) => Array.isArray(value) ? value : []).filter((item): item is { label?: string; canonicalNodeId?: string } => Boolean(item && typeof item === 'object'));
      const canonicalMatch = facets.some((facet) => facet.canonicalNodeId === node.id);
      const labelMatch = facets.map((facet) => String(facet.label ?? '').toLocaleLowerCase('und')).some((label) => label && node.label.toLocaleLowerCase('und').includes(label));
      const timeMatch = node.occurredAt === undefined || ((queryFrame.time?.from === undefined || node.occurredAt >= queryFrame.time.from) && (queryFrame.time?.to === undefined || node.occurredAt < queryFrame.time.to));
      const stateMatch = !queryFrame.states?.length || node.nodeType !== 'state' || queryFrame.states.some((state) => node.label.toLocaleLowerCase('und').includes(state.replace('_', ' ')));
      return requested && timeMatch && stateMatch && (canonicalMatch || labelMatch || !requestedTypes.size || requestedTypes.has(node.nodeType));
    };
    const seeds = result.nodes.filter(matches);
    const selected = new Set(seeds.map((node) => node.id));
    // QueryFrame chooses seeds; the bounded edge closure preserves the path
    // needed to explain an Actor/Project/Issue intersection.
    for (const edge of result.edges) if (selected.has(edge.source) || selected.has(edge.target)) {
      selected.add(edge.source); selected.add(edge.target);
    }
    result.nodes = this.ranker.rank(result.nodes.filter((node) => selected.has(node.id)), queryFrame).slice(0, Math.min(options.limit ?? 30, 100));
    const visible = new Set(result.nodes.map((node) => node.id));
    result.edges = result.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target));
    if (result.cards) result.cards = result.cards.filter((card) => visible.has(card.canonicalId));
    if (result.matchedFacets) result.matchedFacets = result.matchedFacets.filter((facet) => visible.has(facet.nodeId));
    if (result.cards) {
      result.cards = result.cards.map((card) => ({
        ...card,
        matchedFacets: card.matchedFacets.filter((facet) => visible.has(facet.nodeId)),
        relatedButNotSelected: card.relatedButNotSelected.filter((related) => visible.has(related.canonicalId)),
      }));
    }
    return { queryFrame, result };
  }
}
