import type { MemoryAtlasQueryOptions, MemoryAtlasService } from '../atlas/index.js';
import type { MemoryAtlasSlice } from '../atlas/MemoryAtlasTypes.js';
import { DimensionAwareRanker } from './DimensionAwareRanker.js';
import { MultidimensionalQueryPlanner } from './MultidimensionalQueryPlanner.js';

export class AtlasPathRetriever {
  constructor(private readonly atlas: MemoryAtlasService, private readonly planner = new MultidimensionalQueryPlanner(), private readonly ranker = new DimensionAwareRanker()) {}

  retrieve(query: string, options: MemoryAtlasQueryOptions): { queryFrame: ReturnType<MultidimensionalQueryPlanner['plan']>; result: MemoryAtlasSlice } {
    const queryFrame = this.planner.plan(query, { now: options.now, localDateNow: options.localDateNow, timeZone: options.timeZone });
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
      evidenceLimit: queryFrame.time ? Math.max(options.evidenceLimit ?? 0, 1000) : options.evidenceLimit,
      limit: Math.min(options.limit ?? 30, 100),
    });
    const seedIds = [...new Set(this.atlas.resolveQueryAliases(query, options.projectId).map((alias) => alias.nodeId))];
    const groups = new Map<string, string[]>();
    for (const key of Object.keys(facetKeys)) {
      const facets = queryFrame[facetKeys[key] as keyof typeof queryFrame];
      if (!Array.isArray(facets)) continue;
      const ids = facets.map((facet) => facet && typeof facet === 'object' ? facet.canonicalNodeId : undefined).filter((id): id is string => Boolean(id));
      if (ids.length) groups.set(key, [...new Set(ids)]);
    }
    const reachableSets = [...groups.values()].map((ids) => nodesReachableFromAny(ids, result.edges, 3));
    const intersection = reachableSets.reduce<Set<string> | undefined>((common, current) => common ? new Set([...common].filter((id) => current.has(id))) : current, undefined);
    const reachable = reachableSets.length === 1 ? reachableSets[0] : undefined;
    const byId = new Map(result.nodes.map((node) => [node.id, node]));
    const matches = (node: (typeof result.nodes)[number]) => {
      const facets = Object.values(queryFrame).flatMap((value) => Array.isArray(value) ? value : []).filter((item): item is { label?: string; canonicalNodeId?: string } => Boolean(item && typeof item === 'object'));
      const canonicalMatch = facets.some((facet) => facet.canonicalNodeId === node.id);
      const labelMatch = facets.map((facet) => String(facet.label ?? '').toLocaleLowerCase('und')).some((label) => label && node.label.toLocaleLowerCase('und').includes(label));
      const timeMatch = !queryFrame.time || this.atlas.nodeHasEvidenceInRange(node.id, options.projectId, queryFrame.time) || nodeTimeMatches(node, queryFrame.time, canonicalMatch);
      const stateMatch = !queryFrame.states?.length
        || (node.nodeType === 'state'
          ? queryFrame.states.some((state) => node.label.toLocaleLowerCase('und').includes(state.replaceAll('_', ' ')))
          : this.atlas.nodeHasActiveState(node.id, options.projectId, queryFrame.states));
      const pathMatch = !seedIds.length || Boolean(intersection?.has(node.id) || reachable?.has(node.id) || canonicalMatch);
      const constrainedTarget = new Set(['episode', 'event', 'raw_event', 'task']);
      const strictIntersection = groups.size > 1
        ? Boolean(intersection?.has(node.id) && constrainedTarget.has(node.nodeType))
        : false;
      const semanticMatch = !facets.length || canonicalMatch || labelMatch || strictIntersection || (groups.size <= 1 && Boolean(intersection?.has(node.id)));
      return timeMatch && stateMatch && pathMatch && semanticMatch;
    };
    const seeds = result.nodes.filter(matches);
    const selected = new Set(seeds.map((node) => node.id));
    // QueryFrame chooses seeds; the bounded edge closure preserves the path
    // needed to explain an Actor/Project/Issue intersection.
    for (const edge of result.edges) if (selected.has(edge.source) || selected.has(edge.target)) {
      selected.add(edge.source); selected.add(edge.target);
    }
    if (queryFrame.time) {
      for (const id of [...selected]) {
        const node = byId.get(id);
        if (node && !seedIds.includes(id) && !this.atlas.nodeHasEvidenceInRange(node.id, options.projectId, queryFrame.time) && !nodeTimeMatches(node, queryFrame.time, false)) selected.delete(id);
      }
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

function nodesReachableFromAny(seedIds: string[], edges: Array<{ source: string; target: string }>, maxHops: number): Set<string> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    (adjacency.get(edge.source) ?? adjacency.set(edge.source, new Set()).get(edge.source)!).add(edge.target);
    (adjacency.get(edge.target) ?? adjacency.set(edge.target, new Set()).get(edge.target)!).add(edge.source);
  }
  const reachable = new Set<string>();
  for (const seed of seedIds) {
    const seen = new Set([seed]);
    let frontier = new Set([seed]);
    for (let hop = 0; hop < maxHops && frontier.size; hop += 1) {
      const next = new Set<string>();
      for (const node of frontier) for (const neighbor of adjacency.get(node) ?? []) if (!seen.has(neighbor)) { seen.add(neighbor); next.add(neighbor); }
      frontier = next;
    }
    for (const id of seen) reachable.add(id);
  }
  return reachable;
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
