import type { EventStore } from '../store/EventStore.js';
import { MEMORY_ATLAS_PROJECTION_NAME, type MemoryAtlasStore } from '../store/MemoryAtlasStore.js';
import { eventTextForMemory } from '../episode/CogmemBlockStripper.js';
import { FacetQueryPlanner, type FacetQueryPlan } from './FacetQueryPlanner.js';
import { compileAtlasQuery } from './MemoryAtlasQueryCompiler.js';
import type { MemoryAtlasCard, MemoryAtlasEdge, MemoryAtlasEvidence, MemoryAtlasNode, MemoryAtlasNodeDetail, MemoryAtlasPathResult, MemoryAtlasQueryOptions, MemoryAtlasRelaxationStep, MemoryAtlasSlice, MemoryAtlasTimelineResult } from './MemoryAtlasTypes.js';

export class MemoryAtlasService {
  private readonly facetPlanner = new FacetQueryPlanner();
  constructor(private store: MemoryAtlasStore, private eventStore: EventStore) {}

  resolveQueryAliases(query: string, projectId: string): Array<{ label: string; dimension: string; nodeId: string }> {
    return this.store.resolveQueryAliases(projectId, query);
  }

  overview(options: MemoryAtlasQueryOptions): MemoryAtlasSlice {
    const limit = boundedLimit(options.limit);
    const nodes = this.store.listNodes(requiredProject(options.projectId), limit);
    return slice(options.projectId, nodes, this.edgesFor(nodes, options.projectId));
  }

  search(query: string, options: MemoryAtlasQueryOptions): MemoryAtlasSlice {
    const projectId = requiredProject(options.projectId); const limit = boundedLimit(options.limit);
    const facetResult = this.searchFacetCardsWithRelaxation(query, projectId, limit, options);
    const cards = facetResult.cards;
    let nodes = this.store.search(boundedQuery(query), projectId, limit);
    if (cards.length) {
      const cardNodes = cards.map((card) => this.store.getNode(card.canonicalId, projectId)).filter((node): node is MemoryAtlasNode => Boolean(node));
      nodes = uniqueNodes([...cardNodes, ...nodes]).slice(0, limit);
    }
    const withEvidence = this.attachEvidence(nodes, projectId, options);
    const result = slice(projectId, withEvidence, this.edgesFor(withEvidence, projectId), query);
    result.facets = facetsForPlan(facetResult.plan);
    result.matchedFacets = cards.flatMap((card) => card.matchedFacets);
    if (cards.length) result.cards = this.attachCardEvidence(cards, projectId, options);
    if (facetResult.relaxationTrace.length) result.relaxationTrace = facetResult.relaxationTrace;
    return result;
  }

  explore(query: string, options: MemoryAtlasQueryOptions): MemoryAtlasSlice {
    const projectId = requiredProject(options.projectId); const limit = boundedLimit(options.limit);
    const facetResult = this.searchFacetCardsWithRelaxation(query, projectId, limit, options);
    const cards = facetResult.cards;
    const compiled = compileAtlasQuery(boundedQuery(query), options.now);
    const target = this.store.resolveTargetNodeIds(projectId, compiled.text);
    const seedNodeIds = [...new Set([...(target.nodeIds ?? []), ...(options.seedNodeIds ?? [])])];
    let nodes = this.store.searchFaceted(query, projectId, limit, {
      from: compiled.range?.from, to: compiled.range?.to, memoryKinds: compiled.memoryKinds,
      keywords: seedNodeIds.length ? [] : compiled.tokens,
      targetNodeIds: seedNodeIds.length ? seedNodeIds : undefined,
    });
    if (seedNodeIds.length) {
      const bridgeEdges = this.store.listEdgesForNodes(projectId, seedNodeIds, Math.max(60, limit * 12));
      const bridgeIds = [...new Set(bridgeEdges.flatMap((edge) => [edge.source, edge.target]))]
        .filter((id) => !seedNodeIds.includes(id));
      const bridgeNodes = bridgeIds.map((id) => this.store.getNode(id, projectId)).filter((node): node is MemoryAtlasNode => Boolean(node));
      nodes = uniqueNodes([...nodes, ...bridgeNodes]).slice(0, limit);
    }
    if (cards.length) {
      const cardNodes = cards.map((card) => this.store.getNode(card.canonicalId, projectId)).filter((node): node is MemoryAtlasNode => Boolean(node));
      nodes = uniqueNodes([...cardNodes, ...nodes]).slice(0, limit);
    }
    if (compiled.actionIntent) {
      const actions = this.store.listActions(projectId, { target: compiled.target, targetEntityIds: target.entitySourceIds,
        from: compiled.range?.from, to: compiled.range?.to, limit });
      nodes = uniqueNodes([...actions.map((action) => this.store.getNode(action.id, projectId)).filter((node): node is MemoryAtlasNode => Boolean(node)), ...nodes]).slice(0, limit);
    }
    const nodesWithEvidence = this.attachEvidence(nodes, projectId, options);
    const edgeProjection = this.edgeProjection(nodesWithEvidence, projectId, exactMatchedNodeIds(cards, facetResult.plan));
    const result = slice(projectId, nodesWithEvidence, edgeProjection.edges, query);
    result.facets = {
      ...facetsForPlan(facetResult.plan),
      legacy: { time: compiled.range, target: target.labels.join(', ') || compiled.target, memoryKinds: compiled.memoryKinds, keywords: compiled.keywords },
    };
    result.matchedFacets = cards.flatMap((card) => card.matchedFacets);
    if (cards.length) result.cards = this.attachCardEvidence(cards, projectId, options);
    if (facetResult.relaxationTrace.length) result.relaxationTrace = facetResult.relaxationTrace;
    if (edgeProjection.truncation) {
      result.edgeTruncation = edgeProjection.truncation;
      result.warnings.push(`edges_truncated:${edgeProjection.truncation.omitted}_omitted`);
    }
    const hasFacet = Boolean(compiled.range || compiled.target || compiled.memoryKinds.length || compiled.tokens.length);
    result.coldMemoryResurrected = hasFacet && nodes.some((node) => node.activation <= 0.1);
    return result;
  }

  node(nodeId: string, options: MemoryAtlasQueryOptions): MemoryAtlasNodeDetail | null {
    const projectId = requiredProject(options.projectId); const node = this.store.getNode(boundedId(nodeId), projectId);
    if (!node) return null;
    const evidence = this.evidence(node.id, projectId, options.evidenceLimit, options.includeEvidence);
    const neighbors = this.safeEdges(this.store.listEdgesForNodes(projectId, [node.id], 30), projectId);
    const evidenceTotal = this.store.evidenceTotal(node.id, projectId);
    return { ...node, evidenceCount: evidenceTotal, evidenceTotal, evidenceReturned: evidence.length, evidence, neighbors };
  }

  neighbors(nodeId: string, options: MemoryAtlasQueryOptions & { hops?: number }): MemoryAtlasSlice {
    const projectId = requiredProject(options.projectId); const hops = options.hops ?? 1;
    if (!Number.isInteger(hops) || hops < 1 || hops > 2) throw new Error('hops must be between 1 and 2');
    const limit = boundedLimit(options.limit);
    const start = canonicalInputNodeId(this.store, boundedId(nodeId), projectId);
    const seen = new Set([start]); let frontier = [...seen]; const selectedEdges: MemoryAtlasEdge[] = [];
    for (let depth = 0; depth < hops; depth += 1) {
      const next: string[] = [];
      const adjacentEdges = this.store.listEdgesForNodes(projectId, frontier, Math.max(60, limit * 20));
      for (const edge of adjacentEdges) if (frontier.includes(edge.source) || frontier.includes(edge.target)) {
        selectedEdges.push(edge); const other = frontier.includes(edge.source) ? edge.target : edge.source;
        if (!seen.has(other) && seen.size < limit) { seen.add(other); next.push(other); }
      }
      frontier = next;
    }
    const nodes = Array.from(seen).map((id) => this.store.getNode(id, projectId)).filter((node): node is MemoryAtlasNode => Boolean(node)).slice(0, limit);
    return slice(projectId, nodes, this.safeEdges(selectedEdges.filter((edge) => seen.has(edge.source) && seen.has(edge.target)).slice(0, 60), projectId));
  }

  path(from: string, to: string, options: MemoryAtlasQueryOptions & { maxHops?: number }): MemoryAtlasPathResult {
    const projectId = requiredProject(options.projectId); const maxHops = Math.max(1, Math.min(options.maxHops ?? 6, 6));
    const start = canonicalInputNodeId(this.store, boundedId(from), projectId);
    const target = canonicalInputNodeId(this.store, boundedId(to), projectId);
    const parents = new Map<string, { previous: string; edge: MemoryAtlasEdge }>();
    const best = new Map<string, number>([[start, 0]]);
    const queue: Array<{ id: string; cost: number; hops: number }> = [{ id: start, cost: 0, hops: 0 }];
    const expanded = new Set<string>();
    let found = start === target;
    while (queue.length && expanded.size < 2000) {
      queue.sort((left, right) => left.cost - right.cost || left.hops - right.hops);
      const current = queue.shift()!;
      if (current.cost !== best.get(current.id)) continue;
      if (current.id === target) { found = true; break; }
      if (current.hops >= maxHops) continue;
      expanded.add(current.id);
      const adjacent = uniqueEdges([
        ...this.adjacentEdges(projectId, [current.id], 4000),
        ...this.directEdgesToTarget(projectId, [current.id], target),
      ]);
      for (const edge of adjacent) {
        const next = edge.source === current.id ? edge.target : edge.target === current.id ? edge.source : undefined;
        if (!next) continue;
        if (next !== target && !this.store.getNode(next, projectId)) continue;
        const nextCost = current.cost + edgeTraversalCost(edge);
        if (nextCost >= (best.get(next) ?? Number.POSITIVE_INFINITY)) continue;
        best.set(next, nextCost); parents.set(next, { previous: current.id, edge });
        queue.push({ id: next, cost: nextCost, hops: current.hops + 1 });
      }
    }
    const pathIds: string[] = []; const pathEdges: MemoryAtlasEdge[] = [];
    if (found) {
      let current = target; pathIds.push(current);
      while (current !== start) {
        const parent = parents.get(current); if (!parent) break;
        pathEdges.push(parent.edge); current = parent.previous; pathIds.push(current);
      }
      pathIds.reverse(); pathEdges.reverse();
    }
    const path = found ? pathIds.map((id) => this.store.getNode(id, projectId)).filter((node): node is MemoryAtlasNode => Boolean(node)) : [];
    return { version: MEMORY_ATLAS_PROJECTION_NAME, projectId, from: start, to: target, path,
      edges: found ? this.safeEdges(pathEdges, projectId) : [], truncated: expanded.size >= 2000 };
  }

  timeline(query: string, options: MemoryAtlasQueryOptions): MemoryAtlasTimelineResult {
    const projectId = requiredProject(options.projectId); const compiled = compileAtlasQuery(boundedQuery(query), options.now);
    const limit = boundedLimit(options.limit);
    const facetResult = this.searchFacetCardsWithRelaxation(query, projectId, limit, options);
    const cards = this.attachCardEvidence(facetResult.cards, projectId, options)
      .sort((left, right) => dateKey(left) - dateKey(right) || left.displayTitle.localeCompare(right.displayTitle));
    const target = this.store.resolveTargetNodeIds(projectId, compiled.text);
    const nodes = this.store.searchFaceted(query, projectId, limit, {
      from: compiled.range?.from, to: compiled.range?.to, memoryKinds: compiled.memoryKinds,
      keywords: target.nodeIds.length ? compiled.keywords : compiled.tokens,
      targetNodeIds: target.nodeIds.length ? target.nodeIds : undefined,
    }).sort((left, right) => Number(left.occurredAt || 0) - Number(right.occurredAt || 0)).map((node) => {
      const evidence = this.evidence(node.id, projectId, options.evidenceLimit, options.includeEvidence);
      const evidenceTotal = this.store.evidenceTotal(node.id, projectId);
      return { ...node, evidenceCount: evidenceTotal, evidenceTotal, evidenceReturned: evidence.length, evidence, neighbors: [] };
    });
    const actions = this.store.listActions(projectId, { target: compiled.target, targetEntityIds: target.entitySourceIds,
      from: compiled.range?.from, to: compiled.range?.to, limit: boundedLimit(options.limit) })
      .map((action) => ({ ...action, evidence: this.evidence(action.id, projectId, options.evidenceLimit, options.includeEvidence) }));
    return { version: MEMORY_ATLAS_PROJECTION_NAME, projectId, query, range: compiled.range,
      temporalResurrection: Boolean((compiled.range || facetResult.plan.temporalIntent) && [...nodes, ...actions, ...cards].length),
      nodes, actions, cards,
      groupedByIssue: groupCardsByIssue(cards),
      relaxationTrace: facetResult.relaxationTrace.length ? facetResult.relaxationTrace : undefined,
      facets: facetsForPlan(facetResult.plan),
      matchedFacets: cards.flatMap((card) => card.matchedFacets),
      warnings: [] };
  }

  private searchFacetCardsWithRelaxation(query: string, projectId: string, limit: number, options: MemoryAtlasQueryOptions): {
    plan: FacetQueryPlan;
    cards: MemoryAtlasCard[];
    relaxationTrace: MemoryAtlasRelaxationStep[];
  } {
    let plan = this.facetPlanner.plan(boundedQuery(query), { projectId, now: options.now });
    const relaxationTrace: MemoryAtlasRelaxationStep[] = [];
    let cards = plan.facets.length ? this.store.searchCanonicalEpisodeCards(projectId, plan, limit) : [];
    for (let attempt = 0; !cards.length && plan.facets.length && attempt < 3; attempt += 1) {
      const relaxed = relaxFacetPlan(plan);
      if (!relaxed) break;
      plan = relaxed.plan;
      cards = this.store.searchCanonicalEpisodeCards(projectId, plan, limit);
      relaxationTrace.push(...relaxed.trace);
    }
    return { plan, cards, relaxationTrace };
  }

  private attachEvidence(nodes: MemoryAtlasNode[], projectId: string, options: MemoryAtlasQueryOptions): MemoryAtlasNode[] {
    return nodes.map((node) => {
      const evidence = this.evidence(node.id, projectId, options.evidenceLimit, options.includeEvidence);
      const evidenceTotal = this.store.evidenceTotal(node.id, projectId);
      return { ...node, evidenceCount: evidenceTotal, evidenceTotal, evidenceReturned: evidence.length, evidence };
    });
  }

  private attachCardEvidence(cards: MemoryAtlasCard[], projectId: string, options: MemoryAtlasQueryOptions): MemoryAtlasCard[] {
    return cards.map((card) => {
      const evidence = this.evidence(card.canonicalId, projectId, options.evidenceLimit, options.includeEvidence);
      return {
        ...card,
        sourceLocator: evidence[0]?.sourceLocator ?? card.sourceLocator,
        evidenceTotal: Math.max(card.evidenceTotal, this.store.evidenceTotal(card.canonicalId, projectId)),
        evidenceReturned: evidence.length,
      };
    });
  }

  private evidence(nodeId: string, projectId: string, requested?: number, includeExcerpt?: boolean): MemoryAtlasEvidence[] {
    const limit = Math.max(1, Math.min(requested ?? 2, 10));
    return this.store.evidenceIds(nodeId, projectId, limit).flatMap((eventId) => {
      const event = this.eventStore.getEvent(eventId);
      if (!event || event.projectId !== projectId) return [];
      const sourceLocator = atlasSourceLocator(event, projectId);
      return [{
        eventId,
        globalSeq: event.globalSeq,
        projectId,
        drilldown: sourceLocator.command,
        sourceLocator,
        excerpt: includeExcerpt ? eventTextForMemory(event).slice(0, 500) : undefined,
      }];
    });
  }
  private edgesFor(nodes: MemoryAtlasNode[], projectId: string): MemoryAtlasEdge[] {
    return this.edgeProjection(nodes, projectId).edges;
  }
  private edgeProjection(nodes: MemoryAtlasNode[], projectId: string, priorityIds = new Set<string>()): {
    edges: MemoryAtlasEdge[];
    truncation?: NonNullable<MemoryAtlasSlice['edgeTruncation']>;
  } {
    const ids = new Set(nodes.map((node) => node.id));
    const limit = 60;
    const candidates = this.safeEdges(this.store.listEdgesWithinNodes(projectId, [...ids], 4000)
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target)), projectId);
    const sorted = uniqueEdges(candidates).sort((left, right) =>
      edgePriority(right, priorityIds) - edgePriority(left, priorityIds)
      || right.confidence - left.confidence
      || edgeKey(left).localeCompare(edgeKey(right)));
    const edges = sorted.slice(0, limit);
    return {
      edges,
      truncation: sorted.length > edges.length
        ? { limit, returned: edges.length, omitted: sorted.length - edges.length, candidateCount: sorted.length, prioritized: priorityIds.size > 0 }
        : undefined,
    };
  }
  private safeEdges(edges: MemoryAtlasEdge[], projectId: string): MemoryAtlasEdge[] {
    return edges.map((edge) => ({ ...edge, evidenceEventIds: edge.evidenceEventIds.filter((eventId) => {
      const event = this.eventStore.getEvent(eventId);
      return Boolean(event && event.projectId === projectId);
    }) }));
  }
  private adjacentEdges(projectId: string, nodeIds: string[], limit: number): MemoryAtlasEdge[] {
    const chunks = chunked(nodeIds, 30);
    const perChunk = Math.max(60, Math.ceil(limit / Math.max(1, chunks.length)));
    const edges = chunks.flatMap((chunk) => this.store.listEdgesForNodes(projectId, chunk, perChunk));
    return uniqueEdges(edges).slice(0, limit);
  }
  private directEdgesToTarget(projectId: string, nodeIds: string[], target: string): MemoryAtlasEdge[] {
    return uniqueEdges(chunked(nodeIds, 30)
      .flatMap((chunk) => this.store.findEdgesFromNodesToTarget(projectId, chunk, target)));
  }
}

function canonicalInputNodeId(store: MemoryAtlasStore, id: string, projectId: string): string {
  if (id.startsWith(`entity:${projectId}:`)) return id;
  if (!id.startsWith('entity:')) return id;
  const entityId = id.slice('entity:'.length);
  if (!entityId.startsWith('facet:')) return id;
  const scoped = `entity:${projectId}:${entityId}`;
  return store.getNode(scoped, projectId) ? scoped : id;
}

function requiredProject(value: string): string { if (!value?.trim()) throw new Error('projectId is required for Memory Atlas queries'); return value.trim(); }
function boundedLimit(value?: number): number { if (value !== undefined && (!Number.isFinite(value) || value < 1)) throw new Error('limit must be a positive number'); return Math.min(Math.floor(value ?? 8), 30); }
function boundedQuery(value: string): string { const query = String(value || '').trim(); if (!query) throw new Error('query is required'); if (query.length > 1000) throw new Error('query exceeds 1000 characters'); return query; }
function boundedId(value: string): string { const id = String(value || '').trim(); if (!id || id.length > 500) throw new Error('invalid node id'); return id; }
function uniqueNodes(nodes: MemoryAtlasNode[]): MemoryAtlasNode[] { return Array.from(new Map(nodes.map((node) => [node.id, node])).values()); }
function uniqueIds(ids: string[]): string[] { return Array.from(new Set(ids)); }
function uniqueEdges(edges: MemoryAtlasEdge[]): MemoryAtlasEdge[] {
  return Array.from(new Map(edges.map((edge) => [`${edge.source}\0${edge.relation}\0${edge.target}`, edge])).values());
}
function edgeKey(edge: MemoryAtlasEdge): string { return `${edge.source}\0${edge.relation}\0${edge.target}`; }
function edgePriority(edge: MemoryAtlasEdge, priorityIds: Set<string>): number {
  return (priorityIds.has(edge.source) ? 1 : 0) + (priorityIds.has(edge.target) ? 1 : 0);
}
function exactMatchedNodeIds(cards: MemoryAtlasCard[], plan: FacetQueryPlan): Set<string> {
  return new Set([
    ...cards.flatMap((card) => [
      card.canonicalId,
      ...card.matchedFacets.map((facet) => facet.nodeId),
      ...card.matchedPaths.flatMap((path) => path.via),
    ]),
    ...plan.facets.map((facet) => facet.nodeId).filter((id): id is string => Boolean(id)),
  ]);
}
function edgeTraversalCost(edge: MemoryAtlasEdge): number {
  const confidence = Math.max(0.01, Math.min(1, edge.confidence));
  const relationPenalty = /^(EVIDENCED_BY|DERIVED_FROM|TARGETS|OCCURRED_IN|SUPPORTS|ABOUT|MENTIONS)$/u.test(edge.relation)
    ? 0 : /^(CONTRADICTS|CORRECTS)$/u.test(edge.relation) ? 0.2 : 0.1;
  return -Math.log(confidence) + 0.12 + relationPenalty;
}
function chunked<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}
function slice(projectId: string, nodes: MemoryAtlasNode[], edges: MemoryAtlasEdge[], query?: string): MemoryAtlasSlice { return { version: MEMORY_ATLAS_PROJECTION_NAME, projectId, query, nodes, edges, nextActions: nodes.slice(0, 5).map((node) => ({ label: `Inspect ${node.label}`, tool: 'cogmem_graph_node', args: { id: node.id, projectId } })), warnings: [] }; }
function facetsForPlan(plan: FacetQueryPlan): NonNullable<MemoryAtlasSlice['facets']> {
  return {
    planner: {
      intent: plan.intent,
      operator: plan.operator,
      temporalIntent: plan.temporalIntent,
      groupBy: plan.groupBy,
      exactness: plan.exactness,
      keywords: plan.keywords,
      facets: plan.facets.map((facet) => ({
        type: facet.type,
        value: facet.value,
        label: facet.label,
        nodeId: facet.nodeId || `${facet.type}:${facet.value}`,
        relation: facet.relation || 'MATCHES',
      })),
    },
  };
}
function dateKey(card: MemoryAtlasCard): number {
  if (card.localDate && /^\d{4}-\d{2}-\d{2}$/u.test(card.localDate)) {
    return Date.parse(`${card.localDate}T00:00:00.000Z`);
  }
  return Number.POSITIVE_INFINITY;
}
function groupCardsByIssue(cards: MemoryAtlasCard[]): Array<{ issueType: string; cards: MemoryAtlasCard[] }> {
  const groups = new Map<string, MemoryAtlasCard[]>();
  for (const card of cards) {
    const key = card.issueType || 'unclassified';
    groups.set(key, [...(groups.get(key) || []), card]);
  }
  return Array.from(groups.entries()).map(([issueType, group]) => ({ issueType, cards: group }));
}
function relaxFacetPlan(plan: FacetQueryPlan): { plan: FacetQueryPlan; trace: MemoryAtlasRelaxationStep[] } | null {
  const dayFacet = plan.facets.find((facet) => facet.type === 'time' && facet.granularity === 'day');
  if (dayFacet) {
    const monthValue = dayFacet.value.slice(0, 7);
    return {
      plan: replaceFacet(plan, dayFacet, {
        ...dayFacet,
        value: monthValue,
        label: monthValue,
        nodeId: dayFacet.nodeId?.replace(dayFacet.value, monthValue),
        relation: 'OCCURRED_IN',
        granularity: 'month',
      }),
      trace: [{ from: dayFacet.value, to: monthValue, reason: 'exact day facet had no canonical episode match; relaxed to parent month' }],
    };
  }
  const monthFacet = plan.facets.find((facet) => facet.type === 'time' && facet.granularity === 'month');
  if (monthFacet) {
    const yearValue = monthFacet.value.slice(0, 4);
    return {
      plan: replaceFacet(plan, monthFacet, {
        ...monthFacet,
        value: yearValue,
        label: yearValue,
        nodeId: monthFacet.nodeId?.replace(monthFacet.value, yearValue),
        relation: 'OCCURRED_IN',
        granularity: 'year',
      }),
      trace: [{ from: monthFacet.value, to: yearValue, reason: 'exact month facet had no canonical episode match; relaxed to parent year' }],
    };
  }
  const issueFacet = plan.facets.find((facet) => facet.type === 'issue');
  const topicFacet = plan.facets.find((facet) => facet.type === 'topic');
  if (issueFacet && topicFacet) {
    return {
      plan: {
        ...plan,
        exactness: 'relaxed',
        requiresIntersection: plan.facets.length - 1 > 1,
        facets: plan.facets.filter((facet) => facet !== issueFacet),
      },
      trace: [{ from: issueFacet.value, to: topicFacet.value, reason: 'issue facet had no canonical episode match; relaxed to parent topic' }],
    };
  }
  return null;
}

function replaceFacet(plan: FacetQueryPlan, from: FacetQueryPlan['facets'][number], to: FacetQueryPlan['facets'][number]): FacetQueryPlan {
  return {
    ...plan,
    exactness: 'relaxed',
    facets: plan.facets.map((facet) => facet === from ? to : facet),
  };
}
function atlasSourceLocator(event: { eventId: string; globalSeq?: number; projectId?: string; threadId?: string; sessionId?: string; localDate?: string }, projectId: string): NonNullable<MemoryAtlasEvidence['sourceLocator']> {
  const project = projectId || event.projectId;
  const projectArg = project ? ` --project ${cliArg(project)}` : '';
  const base = `cogmem memory show --event ${cliArg(event.eventId)}${projectArg}`;
  return {
    eventId: event.eventId,
    globalSeq: event.globalSeq,
    projectId: project,
    threadId: event.threadId,
    sessionId: event.sessionId,
    localDate: event.localDate,
    command: `${base} --before 2 --after 2 --json`,
    contextCommand: `${base} --before 3 --after 3 --json`,
  };
}
function cliArg(value: string): string {
  return /^[A-Za-z0-9._:/=@+-]+$/u.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
