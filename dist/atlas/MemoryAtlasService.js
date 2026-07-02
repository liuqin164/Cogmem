import { eventTextForMemory } from '../episode/CogmemBlockStripper.js';
import { compileAtlasQuery } from './MemoryAtlasQueryCompiler.js';
export class MemoryAtlasService {
    store;
    eventStore;
    constructor(store, eventStore) {
        this.store = store;
        this.eventStore = eventStore;
    }
    overview(options) {
        const limit = boundedLimit(options.limit);
        const nodes = this.store.listNodes(requiredProject(options.projectId), limit);
        return slice(options.projectId, nodes, this.edgesFor(nodes, options.projectId));
    }
    search(query, options) {
        const projectId = requiredProject(options.projectId);
        const nodes = this.store.search(boundedQuery(query), projectId, boundedLimit(options.limit));
        const withEvidence = this.attachEvidence(nodes, projectId, options);
        return slice(projectId, withEvidence, this.edgesFor(withEvidence, projectId), query);
    }
    explore(query, options) {
        const projectId = requiredProject(options.projectId);
        const limit = boundedLimit(options.limit);
        const compiled = compileAtlasQuery(boundedQuery(query), options.now);
        const target = this.store.resolveTargetNodeIds(projectId, compiled.text);
        let nodes = this.store.searchFaceted(query, projectId, limit, {
            from: compiled.range?.from, to: compiled.range?.to, memoryKinds: compiled.memoryKinds,
            keywords: target.nodeIds.length ? compiled.keywords : compiled.tokens,
            targetNodeIds: target.nodeIds.length ? target.nodeIds : undefined,
        });
        if (compiled.actionIntent) {
            const actions = this.store.listActions(projectId, { target: compiled.target, targetEntityIds: target.entitySourceIds,
                from: compiled.range?.from, to: compiled.range?.to, limit });
            nodes = uniqueNodes([...actions.map((action) => this.store.getNode(action.id, projectId)).filter((node) => Boolean(node)), ...nodes]).slice(0, limit);
        }
        const nodesWithEvidence = this.attachEvidence(nodes, projectId, options);
        const edges = this.edgesFor(nodesWithEvidence, projectId);
        const result = slice(projectId, nodesWithEvidence, edges, query);
        result.facets = { time: compiled.range, target: target.labels.join(', ') || compiled.target, memoryKinds: compiled.memoryKinds, keywords: compiled.keywords };
        const hasFacet = Boolean(compiled.range || compiled.target || compiled.memoryKinds.length || compiled.tokens.length);
        result.coldMemoryResurrected = hasFacet && nodes.some((node) => node.activation <= 0.1);
        return result;
    }
    node(nodeId, options) {
        const projectId = requiredProject(options.projectId);
        const node = this.store.getNode(boundedId(nodeId), projectId);
        if (!node)
            return null;
        const evidence = this.evidence(node.id, projectId, options.evidenceLimit, options.includeEvidence);
        const neighbors = this.safeEdges(this.store.listEdgesForNodes(projectId, [node.id], 30), projectId);
        const evidenceTotal = this.store.evidenceTotal(node.id, projectId);
        return { ...node, evidenceCount: evidenceTotal, evidenceTotal, evidenceReturned: evidence.length, evidence, neighbors };
    }
    neighbors(nodeId, options) {
        const projectId = requiredProject(options.projectId);
        const hops = options.hops ?? 1;
        if (!Number.isInteger(hops) || hops < 1 || hops > 2)
            throw new Error('hops must be between 1 and 2');
        const limit = boundedLimit(options.limit);
        const seen = new Set([boundedId(nodeId)]);
        let frontier = [...seen];
        const selectedEdges = [];
        for (let depth = 0; depth < hops; depth += 1) {
            const next = [];
            const adjacentEdges = this.store.listEdgesForNodes(projectId, frontier, Math.max(60, limit * 20));
            for (const edge of adjacentEdges)
                if (frontier.includes(edge.source) || frontier.includes(edge.target)) {
                    selectedEdges.push(edge);
                    const other = frontier.includes(edge.source) ? edge.target : edge.source;
                    if (!seen.has(other) && seen.size < limit) {
                        seen.add(other);
                        next.push(other);
                    }
                }
            frontier = next;
        }
        const nodes = Array.from(seen).map((id) => this.store.getNode(id, projectId)).filter((node) => Boolean(node)).slice(0, limit);
        return slice(projectId, nodes, this.safeEdges(selectedEdges.filter((edge) => seen.has(edge.source) && seen.has(edge.target)).slice(0, 60), projectId));
    }
    path(from, to, options) {
        const projectId = requiredProject(options.projectId);
        const maxHops = Math.max(1, Math.min(options.maxHops ?? 6, 6));
        const start = boundedId(from);
        const target = boundedId(to);
        const parents = new Map();
        const best = new Map([[start, 0]]);
        const queue = [{ id: start, cost: 0, hops: 0 }];
        const expanded = new Set();
        let found = start === target;
        while (queue.length && expanded.size < 2000) {
            queue.sort((left, right) => left.cost - right.cost || left.hops - right.hops);
            const current = queue.shift();
            if (current.cost !== best.get(current.id))
                continue;
            if (current.id === target) {
                found = true;
                break;
            }
            if (current.hops >= maxHops)
                continue;
            expanded.add(current.id);
            const adjacent = uniqueEdges([
                ...this.adjacentEdges(projectId, [current.id], 4000),
                ...this.directEdgesToTarget(projectId, [current.id], target),
            ]);
            for (const edge of adjacent) {
                const next = edge.source === current.id ? edge.target : edge.target === current.id ? edge.source : undefined;
                if (!next)
                    continue;
                if (next !== target && !this.store.getNode(next, projectId))
                    continue;
                const nextCost = current.cost + edgeTraversalCost(edge);
                if (nextCost >= (best.get(next) ?? Number.POSITIVE_INFINITY))
                    continue;
                best.set(next, nextCost);
                parents.set(next, { previous: current.id, edge });
                queue.push({ id: next, cost: nextCost, hops: current.hops + 1 });
            }
        }
        const pathIds = [];
        const pathEdges = [];
        if (found) {
            let current = target;
            pathIds.push(current);
            while (current !== start) {
                const parent = parents.get(current);
                if (!parent)
                    break;
                pathEdges.push(parent.edge);
                current = parent.previous;
                pathIds.push(current);
            }
            pathIds.reverse();
            pathEdges.reverse();
        }
        const path = found ? pathIds.map((id) => this.store.getNode(id, projectId)).filter((node) => Boolean(node)) : [];
        return { version: 'memory_atlas.v1', projectId, from: start, to: target, path,
            edges: found ? this.safeEdges(pathEdges, projectId) : [], truncated: expanded.size >= 2000 };
    }
    timeline(query, options) {
        const projectId = requiredProject(options.projectId);
        const compiled = compileAtlasQuery(boundedQuery(query), options.now);
        const limit = boundedLimit(options.limit);
        const target = this.store.resolveTargetNodeIds(projectId, compiled.text);
        const nodes = this.store.searchFaceted(query, projectId, limit, {
            from: compiled.range?.from, to: compiled.range?.to, memoryKinds: compiled.memoryKinds,
            keywords: target.nodeIds.length ? compiled.keywords : compiled.tokens,
            targetNodeIds: target.nodeIds.length ? target.nodeIds : undefined,
        }).sort((left, right) => Number(right.occurredAt || 0) - Number(left.occurredAt || 0)).map((node) => {
            const evidence = this.evidence(node.id, projectId, options.evidenceLimit, options.includeEvidence);
            const evidenceTotal = this.store.evidenceTotal(node.id, projectId);
            return { ...node, evidenceCount: evidenceTotal, evidenceTotal, evidenceReturned: evidence.length, evidence, neighbors: [] };
        });
        const actions = this.store.listActions(projectId, { target: compiled.target, targetEntityIds: target.entitySourceIds,
            from: compiled.range?.from, to: compiled.range?.to, limit: boundedLimit(options.limit) })
            .map((action) => ({ ...action, evidence: this.evidence(action.id, projectId, options.evidenceLimit, options.includeEvidence) }));
        return { version: 'memory_atlas.v1', projectId, query, range: compiled.range,
            temporalResurrection: Boolean(compiled.range && [...nodes, ...actions].length), nodes, actions, warnings: [] };
    }
    attachEvidence(nodes, projectId, options) {
        return nodes.map((node) => {
            const evidence = this.evidence(node.id, projectId, options.evidenceLimit, options.includeEvidence);
            const evidenceTotal = this.store.evidenceTotal(node.id, projectId);
            return { ...node, evidenceCount: evidenceTotal, evidenceTotal, evidenceReturned: evidence.length, evidence };
        });
    }
    evidence(nodeId, projectId, requested, includeExcerpt) {
        const limit = Math.max(1, Math.min(requested ?? 2, 10));
        return this.store.evidenceIds(nodeId, projectId, limit).flatMap((eventId) => {
            const event = this.eventStore.getEvent(eventId);
            if (!event || event.projectId !== projectId)
                return [];
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
    edgesFor(nodes, projectId) {
        const ids = new Set(nodes.map((node) => node.id));
        return this.safeEdges(this.store.listEdgesForNodes(projectId, [...ids], 60)
            .filter((edge) => ids.has(edge.source) && ids.has(edge.target)).slice(0, 60), projectId);
    }
    safeEdges(edges, projectId) {
        return edges.map((edge) => ({ ...edge, evidenceEventIds: edge.evidenceEventIds.filter((eventId) => {
                const event = this.eventStore.getEvent(eventId);
                return Boolean(event && event.projectId === projectId);
            }) }));
    }
    adjacentEdges(projectId, nodeIds, limit) {
        const chunks = chunked(nodeIds, 30);
        const perChunk = Math.max(60, Math.ceil(limit / Math.max(1, chunks.length)));
        const edges = chunks.flatMap((chunk) => this.store.listEdgesForNodes(projectId, chunk, perChunk));
        return uniqueEdges(edges).slice(0, limit);
    }
    directEdgesToTarget(projectId, nodeIds, target) {
        return uniqueEdges(chunked(nodeIds, 30)
            .flatMap((chunk) => this.store.findEdgesFromNodesToTarget(projectId, chunk, target)));
    }
}
function requiredProject(value) { if (!value?.trim())
    throw new Error('projectId is required for Memory Atlas queries'); return value.trim(); }
function boundedLimit(value) { if (value !== undefined && (!Number.isFinite(value) || value < 1))
    throw new Error('limit must be a positive number'); return Math.min(Math.floor(value ?? 8), 30); }
function boundedQuery(value) { const query = String(value || '').trim(); if (!query)
    throw new Error('query is required'); if (query.length > 1000)
    throw new Error('query exceeds 1000 characters'); return query; }
function boundedId(value) { const id = String(value || '').trim(); if (!id || id.length > 500)
    throw new Error('invalid node id'); return id; }
function uniqueNodes(nodes) { return Array.from(new Map(nodes.map((node) => [node.id, node])).values()); }
function uniqueIds(ids) { return Array.from(new Set(ids)); }
function uniqueEdges(edges) {
    return Array.from(new Map(edges.map((edge) => [`${edge.source}\0${edge.relation}\0${edge.target}`, edge])).values());
}
function edgeTraversalCost(edge) {
    const confidence = Math.max(0.01, Math.min(1, edge.confidence));
    const relationPenalty = /^(EVIDENCED_BY|DERIVED_FROM|TARGETS|OCCURRED_IN|SUPPORTS|ABOUT|MENTIONS)$/u.test(edge.relation)
        ? 0 : /^(CONTRADICTS|CORRECTS)$/u.test(edge.relation) ? 0.2 : 0.1;
    return -Math.log(confidence) + 0.12 + relationPenalty;
}
function chunked(values, size) {
    const chunks = [];
    for (let index = 0; index < values.length; index += size)
        chunks.push(values.slice(index, index + size));
    return chunks;
}
function slice(projectId, nodes, edges, query) { return { version: 'memory_atlas.v1', projectId, query, nodes, edges, nextActions: nodes.slice(0, 5).map((node) => ({ label: `Inspect ${node.label}`, tool: 'cogmem_graph_node', args: { id: node.id, projectId } })), warnings: [] }; }
function atlasSourceLocator(event, projectId) {
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
function cliArg(value) {
    return /^[A-Za-z0-9._:/=@+-]+$/u.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
