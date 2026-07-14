import type { MemoryAtlasQueryOptions, MemoryAtlasService } from '../atlas/index.js';
import type { MemoryAtlasSlice } from '../atlas/MemoryAtlasTypes.js';
import { DimensionAwareRanker } from './DimensionAwareRanker.js';
import { MultidimensionalQueryPlanner } from './MultidimensionalQueryPlanner.js';

export class AtlasPathRetriever {
  constructor(private readonly atlas: MemoryAtlasService, private readonly planner = new MultidimensionalQueryPlanner(), private readonly ranker = new DimensionAwareRanker()) {}

  retrieve(query: string, options: MemoryAtlasQueryOptions): { queryFrame: ReturnType<MultidimensionalQueryPlanner['plan']>; result: MemoryAtlasSlice } {
    const queryFrame = this.planner.plan(query, options.now);
    const facetKeys: Record<string, 'actors' | 'projects' | 'topics' | 'issues' | 'events' | 'tasks' | 'entities' | 'objects' | 'locations'> = {
      actor: 'actors', project: 'projects', topic: 'topics', issue: 'issues', event: 'events', task: 'tasks', entity: 'entities', object: 'objects', location: 'locations',
    };
    for (const alias of this.atlas.resolveQueryAliases(query, options.projectId)) {
      const key = facetKeys[alias.dimension];
      if (alias.dimension === 'state') {
        queryFrame.states = [...new Set([...(queryFrame.states ?? []), alias.label])];
        continue;
      }
      if (!key) continue;
      const facets = (queryFrame[key] ??= []);
      if (!facets.some((facet) => facet.canonicalNodeId === alias.nodeId)) facets.push({ label: alias.label, dimension: alias.dimension as never, canonicalNodeId: alias.nodeId, confidence: 1 });
    }
    const result = this.atlas.explore(query, {
      ...options,
      seedNodeIds: [...new Set(this.atlas.resolveQueryAliases(query, options.projectId).map((alias) => alias.nodeId))],
      includeEvidence: Boolean(queryFrame.time),
      limit: Math.min(options.limit ?? 30, 100),
    });
    const seedIds = [...new Set(this.atlas.resolveQueryAliases(query, options.projectId).map((alias) => alias.nodeId))];
    const intersection = seedIds.length > 1 ? nodesReachableFromAll(seedIds, result.edges, 3) : undefined;
    const requestedTypes = new Set([
      ...(queryFrame.actors ?? []).map(() => 'actor'), ...(queryFrame.projects ?? []).map(() => 'project'),
      ...(queryFrame.topics ?? []).map(() => 'topic'), ...(queryFrame.issues ?? []).map(() => 'issue'),
      ...(queryFrame.events ?? []).map(() => 'event'), ...(queryFrame.tasks ?? []).map(() => 'task'),
      ...(queryFrame.entities ?? []).map(() => 'entity'), ...(queryFrame.objects ?? []).map(() => 'object'), ...(queryFrame.locations ?? []).map(() => 'location'),
    ]);
    const byId = new Map(result.nodes.map((node) => [node.id, node]));
    const matches = (node: (typeof result.nodes)[number]) => {
      const requested = !requestedTypes.size || requestedTypes.has(node.nodeType);
      const facets = Object.values(queryFrame).flatMap((value) => Array.isArray(value) ? value : []).filter((item): item is { label?: string; canonicalNodeId?: string } => Boolean(item && typeof item === 'object'));
      const canonicalMatch = facets.some((facet) => facet.canonicalNodeId === node.id);
      const labelMatch = facets.map((facet) => String(facet.label ?? '').toLocaleLowerCase('und')).some((label) => label && node.label.toLocaleLowerCase('und').includes(label));
      const timeMatch = !queryFrame.time || nodeTimeMatches(node, queryFrame.time, canonicalMatch);
      const stateMatch = !queryFrame.states?.length || node.nodeType !== 'state' || queryFrame.states.some((state) => node.label.toLocaleLowerCase('und').includes(state.replace('_', ' ')));
      const intersectionMatch = !intersection || intersection.has(node.id) || canonicalMatch;
      return requested && timeMatch && stateMatch && intersectionMatch && (canonicalMatch || labelMatch || !requestedTypes.size || requestedTypes.has(node.nodeType));
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
    if (result.matchedFacets) result.matchedFacets = result.matchedFacets.filter((facet) => visible.has(facet.nodeId) || isLegacyFacet(facet.type));
    if (result.cards) {
      result.cards = result.cards.map((card) => ({
        ...card,
        matchedFacets: card.matchedFacets.filter((facet) => visible.has(facet.nodeId) || isLegacyFacet(facet.type)),
        relatedButNotSelected: card.relatedButNotSelected.filter((related) => visible.has(related.canonicalId)),
      }));
    }
    return { queryFrame, result };
  }
}

function isLegacyFacet(type: string): boolean {
  return ['time', 'topic', 'issue', 'entity', 'session', 'thread', 'memoryKind', 'actionKind'].includes(type);
}

function nodesReachableFromAll(seedIds: string[], edges: Array<{ source: string; target: string }>, maxHops: number): Set<string> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    (adjacency.get(edge.source) ?? adjacency.set(edge.source, new Set()).get(edge.source)!).add(edge.target);
    (adjacency.get(edge.target) ?? adjacency.set(edge.target, new Set()).get(edge.target)!).add(edge.source);
  }
  let common: Set<string> | undefined;
  for (const seed of seedIds) {
    const seen = new Set([seed]);
    let frontier = new Set([seed]);
    for (let hop = 0; hop < maxHops && frontier.size; hop += 1) {
      const next = new Set<string>();
      for (const node of frontier) for (const neighbor of adjacency.get(node) ?? []) if (!seen.has(neighbor)) { seen.add(neighbor); next.add(neighbor); }
      frontier = next;
    }
    common = common ? new Set([...common].filter((id) => seen.has(id))) : seen;
  }
  return common ?? new Set();
}

function nodeTimeMatches(node: { occurredAt?: number; evidence?: Array<{ sourceLocator?: { localDate?: string } }> }, range: { from?: number; to?: number }, keepCanonical: boolean): boolean {
  if (node.occurredAt !== undefined) return (range.from === undefined || node.occurredAt >= range.from) && (range.to === undefined || node.occurredAt < range.to);
  const evidenceDates = (node.evidence ?? []).map((evidence) => evidence.sourceLocator?.localDate).filter((value): value is string => Boolean(value));
  if (!evidenceDates.length) return keepCanonical;
  return evidenceDates.some((date) => {
    const timestamp = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(timestamp) && (range.from === undefined || timestamp >= range.from) && (range.to === undefined || timestamp < range.to);
  });
}
