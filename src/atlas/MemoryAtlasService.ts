import type { EventStore } from '../store/EventStore.js';
import type { MemoryAtlasStore } from '../store/MemoryAtlasStore.js';
import { eventTextForMemory } from '../episode/CogmemBlockStripper.js';
import { compileAtlasQuery } from './MemoryAtlasQueryCompiler.js';
import type { MemoryAtlasEdge, MemoryAtlasEvidence, MemoryAtlasNode, MemoryAtlasNodeDetail, MemoryAtlasPathResult, MemoryAtlasQueryOptions, MemoryAtlasSlice, MemoryAtlasTimelineResult } from './MemoryAtlasTypes.js';

export class MemoryAtlasService {
  constructor(private store: MemoryAtlasStore, private eventStore: EventStore) {}

  overview(options: MemoryAtlasQueryOptions): MemoryAtlasSlice {
    const limit = boundedLimit(options.limit);
    const nodes = this.store.listNodes(requiredProject(options.projectId), limit);
    this.store.recordAccess(options.projectId, nodes.map((node) => node.id), 'overview');
    return slice(options.projectId, nodes, this.edgesFor(nodes, options.projectId));
  }

  search(query: string, options: MemoryAtlasQueryOptions): MemoryAtlasSlice {
    const projectId = requiredProject(options.projectId); const nodes = this.store.search(boundedQuery(query), projectId, boundedLimit(options.limit));
    this.store.recordAccess(projectId, nodes.map((node) => node.id), 'search', query);
    return slice(projectId, nodes, this.edgesFor(nodes, projectId), query);
  }

  explore(query: string, options: MemoryAtlasQueryOptions): MemoryAtlasSlice {
    const projectId = requiredProject(options.projectId); const limit = boundedLimit(options.limit);
    const compiled = compileAtlasQuery(boundedQuery(query), options.now);
    let nodes = this.store.searchFaceted(query, projectId, limit, {
      from: compiled.range?.from, to: compiled.range?.to, memoryKinds: compiled.memoryKinds,
    });
    if (compiled.actionIntent) {
      const actions = this.store.listActions(projectId, { target: compiled.target, from: compiled.range?.from, to: compiled.range?.to, limit });
      nodes = uniqueNodes([...actions.map((action) => this.store.getNode(action.id, projectId)).filter((node): node is MemoryAtlasNode => Boolean(node)), ...nodes]).slice(0, limit);
    }
    const edges = this.edgesFor(nodes, projectId);
    this.store.recordAccess(projectId, nodes.map((node) => node.id), 'explore', query);
    const result = slice(projectId, nodes, edges, query);
    result.facets = { time: compiled.range, target: compiled.target, memoryKinds: compiled.memoryKinds, keywords: compiled.tokens };
    const hasFacet = Boolean(compiled.range || compiled.target || compiled.memoryKinds.length || compiled.tokens.length);
    result.coldMemoryResurrected = hasFacet && nodes.some((node) => node.activation <= 0.1);
    return result;
  }

  node(nodeId: string, options: MemoryAtlasQueryOptions): MemoryAtlasNodeDetail | null {
    const projectId = requiredProject(options.projectId); const node = this.store.getNode(boundedId(nodeId), projectId);
    if (!node) return null;
    const evidence = this.evidence(node.id, projectId, options.evidenceLimit, options.includeEvidence);
    const neighbors = this.safeEdges(this.store.listEdgesForNodes(projectId, [node.id], 30), projectId);
    this.store.recordAccess(projectId, [node.id], 'node');
    return { ...node, evidenceCount: evidence.length, evidence, neighbors };
  }

  neighbors(nodeId: string, options: MemoryAtlasQueryOptions & { hops?: number }): MemoryAtlasSlice {
    const projectId = requiredProject(options.projectId); const hops = options.hops ?? 1;
    if (!Number.isInteger(hops) || hops < 1 || hops > 2) throw new Error('hops must be between 1 and 2');
    const limit = boundedLimit(options.limit);
    const seen = new Set([boundedId(nodeId)]); let frontier = [...seen]; const selectedEdges: MemoryAtlasEdge[] = [];
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
    this.store.recordAccess(projectId, nodes.map((node) => node.id), 'neighbors');
    return slice(projectId, nodes, this.safeEdges(selectedEdges.filter((edge) => seen.has(edge.source) && seen.has(edge.target)).slice(0, 60), projectId));
  }

  path(from: string, to: string, options: MemoryAtlasQueryOptions & { maxHops?: number }): MemoryAtlasPathResult {
    const projectId = requiredProject(options.projectId); const maxHops = Math.max(1, Math.min(options.maxHops ?? 6, 6));
    const start = boundedId(from); const target = boundedId(to);
    const visited = new Set([start]); const parents = new Map<string, { previous: string; edge: MemoryAtlasEdge }>();
    let frontier = [start]; let found = start === target; let depth = 0;
    while (frontier.length && !found && depth < maxHops && visited.size < 2000) {
      const direct = this.directEdgesToTarget(projectId, frontier, target)[0];
      if (direct && !visited.has(target)) {
        const previous = direct.source === target ? direct.target : direct.source;
        visited.add(target); parents.set(target, { previous, edge: direct }); found = true;
      }
      if (found) break;
      const adjacentEdges = this.adjacentEdges(projectId, frontier, 4000);
      const nextFrontier: string[] = [];
      for (const current of frontier) {
        for (const edge of adjacentEdges) {
          const next = edge.source === current ? edge.target : edge.target === current ? edge.source : undefined;
          if (!next || visited.has(next)) continue;
          visited.add(next); parents.set(next, { previous: current, edge }); nextFrontier.push(next);
          if (next === target) { found = true; break; }
          if (visited.size >= 2000) break;
        }
        if (found || visited.size >= 2000) break;
      }
      frontier = nextFrontier; depth += 1;
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
    this.store.recordAccess(projectId, path.map((node) => node.id), 'path');
    return { version: 'memory_atlas.v1', projectId, from: start, to: target, path,
      edges: found ? this.safeEdges(pathEdges, projectId) : [], truncated: visited.size >= 2000 };
  }

  timeline(query: string, options: MemoryAtlasQueryOptions): MemoryAtlasTimelineResult {
    const projectId = requiredProject(options.projectId); const compiled = compileAtlasQuery(boundedQuery(query), options.now);
    const limit = boundedLimit(options.limit);
    const nodes = this.store.searchFaceted(query, projectId, limit, {
      from: compiled.range?.from, to: compiled.range?.to, memoryKinds: compiled.memoryKinds,
    }).sort((left, right) => Number(right.occurredAt || 0) - Number(left.occurredAt || 0)).map((node) => {
      const evidence = this.evidence(node.id, projectId, options.evidenceLimit, options.includeEvidence);
      return { ...node, evidenceCount: evidence.length, evidence, neighbors: [] };
    });
    const actions = this.store.listActions(projectId, { target: compiled.target, from: compiled.range?.from, to: compiled.range?.to, limit: boundedLimit(options.limit) })
      .map((action) => ({ ...action, evidence: this.evidence(action.id, projectId, options.evidenceLimit, options.includeEvidence) }));
    this.store.recordAccess(projectId, uniqueIds([...nodes.map((node) => node.id), ...actions.map((action) => action.id)]), 'timeline', query);
    return { version: 'memory_atlas.v1', projectId, query, range: compiled.range,
      temporalResurrection: Boolean(compiled.range && [...nodes, ...actions].length), nodes, actions, warnings: [] };
  }

  private evidence(nodeId: string, projectId: string, requested?: number, includeExcerpt?: boolean): MemoryAtlasEvidence[] {
    const limit = Math.max(1, Math.min(requested ?? 2, 10));
    return this.store.evidenceIds(nodeId, projectId, limit).flatMap((eventId) => {
      const event = this.eventStore.getEvent(eventId);
      if (!event || event.projectId !== projectId) return [];
      return [{ eventId, drilldown: `cogmem memory show --event ${eventId} --project ${projectId} --json`,
        excerpt: includeExcerpt ? eventTextForMemory(event).slice(0, 500) : undefined }];
    });
  }
  private edgesFor(nodes: MemoryAtlasNode[], projectId: string): MemoryAtlasEdge[] {
    const ids = new Set(nodes.map((node) => node.id));
    return this.safeEdges(this.store.listEdgesForNodes(projectId, [...ids], 60)
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target)).slice(0, 60), projectId);
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

function requiredProject(value: string): string { if (!value?.trim()) throw new Error('projectId is required for Memory Atlas queries'); return value.trim(); }
function boundedLimit(value?: number): number { if (value !== undefined && (!Number.isFinite(value) || value < 1)) throw new Error('limit must be a positive number'); return Math.min(Math.floor(value ?? 8), 30); }
function boundedQuery(value: string): string { const query = String(value || '').trim(); if (!query) throw new Error('query is required'); if (query.length > 1000) throw new Error('query exceeds 1000 characters'); return query; }
function boundedId(value: string): string { const id = String(value || '').trim(); if (!id || id.length > 500) throw new Error('invalid node id'); return id; }
function uniqueNodes(nodes: MemoryAtlasNode[]): MemoryAtlasNode[] { return Array.from(new Map(nodes.map((node) => [node.id, node])).values()); }
function uniqueIds(ids: string[]): string[] { return Array.from(new Set(ids)); }
function uniqueEdges(edges: MemoryAtlasEdge[]): MemoryAtlasEdge[] {
  return Array.from(new Map(edges.map((edge) => [`${edge.source}\0${edge.relation}\0${edge.target}`, edge])).values());
}
function chunked<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}
function slice(projectId: string, nodes: MemoryAtlasNode[], edges: MemoryAtlasEdge[], query?: string): MemoryAtlasSlice { return { version: 'memory_atlas.v1', projectId, query, nodes, edges, nextActions: nodes.slice(0, 5).map((node) => ({ label: `Inspect ${node.label}`, tool: 'cogmem_graph_node', args: { id: node.id, projectId } })), warnings: [] }; }
