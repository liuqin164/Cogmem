import { createHash, randomUUID } from 'node:crypto';
import type Database from 'bun:sqlite';
import type { PlannedFacet, FacetQueryPlan } from '../atlas/FacetQueryPlanner.js';
import type {
  MemoryAtlasAction,
  MemoryAtlasCard,
  MemoryAtlasEdge,
  MemoryAtlasMatchedFacet,
  MemoryAtlasMatchedPath,
  MemoryAtlasNode,
  MemoryAtlasNodeType,
  MemoryAtlasRelatedCard,
} from '../atlas/MemoryAtlasTypes.js';
import { decodeAtlasNodeId, encodeAtlasNodeId, fromAtlasEdgeEndpoint } from '../atlas/AtlasNodeIdCodec.js';
import { normalizeAlias } from '../semantic/CanonicalMemoryResolver.js';

export const MEMORY_ATLAS_PROJECTION_NAME = 'memory_atlas.v2';
export const MEMORY_ATLAS_PROJECTION_SCHEMA_VERSION = '3.7.4';

interface AtlasDocumentRow {
  node_id: string; project_id: string; node_type: string; memory_kind: string | null; source_id: string; label: string;
  summary: string | null; topic_path: string | null; confidence: number; support_count: number;
  status: string; occurred_at: number | null; evidence_event_ids_json: string; updated_at: number;
  metadata_json?: string | null;
  activation?: number | null;
}

interface FacetEdgeRow {
  source_id: string;
  relation_type: string;
  target_type: string;
  target_id: string;
  confidence: number;
  evidence_event_ids_json: string;
}

export class MemoryAtlasStore {
  constructor(readonly db: Database) {}

  upsertDocument(input: Omit<MemoryAtlasNode, 'activation' | 'score' | 'evidenceCount' | 'evidenceTotal' | 'evidenceReturned'> & { evidenceEventIds?: string[]; metadata?: Record<string, unknown>; updatedAt?: number }): void {
    this.db.prepare(`
      INSERT INTO memory_atlas_documents (
        node_id, project_id, node_type, memory_kind, source_id, label, summary, topic_path, confidence,
        support_count, status, occurred_at, evidence_event_ids_json, metadata_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET project_id=excluded.project_id, node_type=excluded.node_type,
        memory_kind=excluded.memory_kind,
        source_id=excluded.source_id, label=excluded.label, summary=excluded.summary,
        topic_path=excluded.topic_path, confidence=excluded.confidence, support_count=excluded.support_count,
        status=excluded.status, occurred_at=excluded.occurred_at,
        evidence_event_ids_json=excluded.evidence_event_ids_json, metadata_json=excluded.metadata_json,
        updated_at=excluded.updated_at
    `).run(input.id, input.projectId, input.nodeType, input.memoryKind || deriveMemoryKind(input.nodeType, input.metadata) || null, input.sourceId, input.label, input.summary || null,
      input.topicPath || null, input.confidence, input.supportCount, input.status, input.occurredAt ?? null,
      JSON.stringify(input.evidenceEventIds || []), JSON.stringify(input.metadata || {}), input.updatedAt ?? Date.now());
    this.refreshFtsNode(input.id);
  }

  getNode(nodeId: string, projectId: string): MemoryAtlasNode | null {
    const scopedNodeId = scopedEntityNodeId(this.db, nodeId, projectId);
    const row = this.db.prepare(`
      SELECT d.*, COALESCE(a.activation, 0) AS activation
      FROM memory_atlas_documents d LEFT JOIN memory_atlas_activation a
        ON a.project_id=d.project_id AND a.node_id=d.node_id
      WHERE d.node_id=? AND d.project_id=? AND d.status NOT IN ('rejected','archived','needs_confirmation')
    `).get(scopedNodeId, projectId) as AtlasDocumentRow | null;
    return row ? mapNode(row, 0) : null;
  }

  /** Internal projector/governance read; ordinary recall must use getNode(). */
  getNodeIncludingInactive(nodeId: string, projectId: string): MemoryAtlasNode | null {
    const scopedNodeId = scopedEntityNodeId(this.db, nodeId, projectId);
    const row = this.db.prepare(`SELECT d.*, COALESCE(a.activation, 0) AS activation FROM memory_atlas_documents d LEFT JOIN memory_atlas_activation a ON a.project_id=d.project_id AND a.node_id=d.node_id WHERE d.node_id=? AND d.project_id=?`).get(scopedNodeId, projectId) as AtlasDocumentRow | null;
    return row ? mapNode(row, Number(row.activation || 0)) : null;
  }

  listNodes(projectId: string, limit: number): MemoryAtlasNode[] {
    const rows = this.db.prepare(`
      SELECT d.*, COALESCE(a.activation, 0) AS activation
      FROM memory_atlas_documents d LEFT JOIN memory_atlas_activation a
        ON a.project_id=d.project_id AND a.node_id=d.node_id
      WHERE d.project_id=? AND d.status NOT IN ('rejected','archived','needs_confirmation')
      ORDER BY COALESCE(a.activation,0) DESC, d.support_count DESC, d.updated_at DESC LIMIT ?
    `).all(projectId, limit) as AtlasDocumentRow[];
    return rows.map((row) => mapNode(row, Number(row.activation || 0)));
  }

  search(query: string, projectId: string, limit: number): MemoryAtlasNode[] {
    return this.searchFaceted(query, projectId, limit, {});
  }

  searchFaceted(query: string, projectId: string, limit: number, facets: {
    from?: number; to?: number; memoryKinds?: string[]; keywords?: string[]; targetNodeIds?: string[];
  }): MemoryAtlasNode[] {
    const tokens = (facets.keywords ?? (query.match(/[\p{L}\p{N}_-]+/gu) || []))
      .filter((item) => item.length > 1).slice(0, 12);
    const filters: string[] = [];
    const facetParams: Array<string | number> = [];
    // Seed identities are scope anchors, not temporal facts. Temporal
    // filtering is applied after bounded evidence-backed traversal.
    if (!facets.targetNodeIds && facets.from !== undefined) { filters.push('d.occurred_at>=?'); facetParams.push(facets.from); }
    if (!facets.targetNodeIds && facets.to !== undefined) { filters.push('d.occurred_at<?'); facetParams.push(facets.to); }
    if (facets.memoryKinds?.length) {
      filters.push(`d.memory_kind IN (${facets.memoryKinds.map(() => '?').join(',')})`);
      facetParams.push(...facets.memoryKinds);
    }
    if (facets.targetNodeIds) {
      if (!facets.targetNodeIds.length) return [];
      filters.push(`d.node_id IN (${facets.targetNodeIds.map(() => '?').join(',')})`);
      facetParams.push(...facets.targetNodeIds);
    }
    const keywordClauses = tokens.map(() => `(d.label LIKE ? ESCAPE '\\' OR COALESCE(d.summary,'') LIKE ? ESCAPE '\\' OR COALESCE(d.topic_path,'') LIKE ? ESCAPE '\\')`);
    const keywordParams = tokens.flatMap((token) => [`%${escapeLike(token)}%`, `%${escapeLike(token)}%`, `%${escapeLike(token)}%`]);
    const allFilters = [...filters, ...keywordClauses];
    const filterSql = allFilters.length ? `AND ${allFilters.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT d.*, COALESCE(a.activation, 0) AS activation
      FROM memory_atlas_documents d LEFT JOIN memory_atlas_activation a
        ON a.project_id=d.project_id AND a.node_id=d.node_id
      WHERE d.project_id=? ${filterSql} AND d.status NOT IN ('rejected','archived','needs_confirmation')
      ORDER BY COALESCE(a.activation,0) DESC, d.support_count DESC, d.updated_at DESC LIMIT ?
    `).all(projectId, ...facetParams, ...keywordParams, limit) as AtlasDocumentRow[];
    return rows.map((row) => {
      const haystack = `${row.label} ${row.summary || ''} ${row.topic_path || ''}`.toLowerCase();
      const matches = tokens.filter((token) => haystack.includes(token.toLowerCase())).length;
      return mapNode(row, matches + Number(row.activation || 0));
    }).sort((a, b) => b.score - a.score);
  }

  searchCanonicalEpisodeCards(projectId: string, plan: FacetQueryPlan, limit: number): MemoryAtlasCard[] {
    const plannedFacets = plan.facets;
    if (!plannedFacets.length) return [];
    const facetMatches = plannedFacets.map((facet) => ({ facet, rows: this.episodeEdgesForFacet(projectId, facet) }));
    const facetGroups = groupFacetMatches(facetMatches);
    if (plan.operator === 'intersection' && facetGroups.some((group) => group.every((match) => match.rows.length === 0))) return [];

    const candidateIds = plan.operator === 'intersection'
      ? intersectSets(facetGroups.map((group) => new Set(group.flatMap((match) => match.rows.map((row) => row.source_id)))))
      : new Set(facetMatches.flatMap((match) => match.rows.map((row) => row.source_id)));
    if (!candidateIds.size) return [];

    const rows = this.episodeRows(projectId, Array.from(candidateIds));
    const rankedCards = rows.map((row) => {
      const candidateEdges = facetMatches.flatMap((match) => match.rows.filter((edge) => edge.source_id === row.source_id));
      return this.cardFromEpisodeRow(row, candidateEdges, projectId);
    }).sort((left, right) => cardRank(right) - cardRank(left) || left.canonicalId.localeCompare(right.canonicalId));
    const cards = dedupeCardsByEvidence(rankedCards).slice(0, Math.max(1, Math.min(limit, 100)));
    const selectedIds = new Set(cards.map((card) => card.canonicalId));
    for (const card of cards) {
      card.relatedButNotSelected = mergeRelatedCards(
        card.relatedButNotSelected ?? [],
        this.relatedEpisodeCards(projectId, card.canonicalId, selectedIds, 4),
        this.topicRelatedCardsForPlan(projectId, plan, selectedIds, 4),
      ).slice(0, 4);
    }
    return cards;
  }

  findActiveAliasNode(projectId: string, dimension: string, normalizedAlias: string): string | undefined {
    const rows = this.db.prepare(`
      SELECT DISTINCT node_id FROM memory_atlas_aliases
      WHERE project_id=? AND dimension=? AND normalized_alias=? AND status='active'
        AND (source_frame_id IS NULL OR EXISTS (SELECT 1 FROM memory_atlas_alias_supports s JOIN memory_frames f ON f.frame_id=s.source_frame_id WHERE s.alias_id=memory_atlas_aliases.alias_id AND s.status='active' AND f.status='active'))
      ORDER BY node_id
    `).all(projectId, dimension, normalizedAlias) as Array<{ node_id: string }>;
    return rows.length === 1 ? rows[0]!.node_id : undefined;
  }

  findAliasNodes(projectId: string, dimension: string, normalizedAlias: string): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT a.node_id
      FROM memory_atlas_aliases a
      JOIN memory_atlas_documents d ON d.project_id=a.project_id AND d.node_id=a.node_id
      WHERE a.project_id=? AND a.dimension=? AND a.normalized_alias=?
        AND a.status='active' AND d.status NOT IN ('rejected','archived','needs_confirmation')
        AND (a.source_frame_id IS NULL OR EXISTS (SELECT 1 FROM memory_atlas_alias_supports s JOIN memory_frames f ON f.frame_id=s.source_frame_id WHERE s.alias_id=a.alias_id AND s.status='active' AND f.status='active'))
      ORDER BY a.node_id
    `).all(projectId, dimension, normalizedAlias) as Array<{ node_id: string }>;
    return rows.map((row) => row.node_id);
  }

  resolveQueryAliases(projectId: string, query: string): Array<{ label: string; dimension: string; nodeId: string }> {
    const normalizedQuery = normalizeAlias(query);
    if (!normalizedQuery) return [];
    const rows = this.db.prepare(`
      SELECT a.normalized_alias AS label, a.dimension, a.node_id
      FROM memory_atlas_aliases a
      JOIN memory_atlas_documents d ON d.project_id=a.project_id AND d.node_id=a.node_id
      WHERE a.project_id=? AND a.status='active'
        AND d.status NOT IN ('rejected','archived','needs_confirmation')
        AND (a.source_frame_id IS NULL OR EXISTS (SELECT 1 FROM memory_atlas_alias_supports s JOIN memory_frames f ON f.frame_id=s.source_frame_id WHERE s.alias_id=a.alias_id AND s.status='active' AND f.status='active'))
        AND length(a.normalized_alias) >= 2
        AND instr(?, a.normalized_alias)>0
      ORDER BY length(a.normalized_alias) DESC, a.node_id ASC
      LIMIT 128
    `).all(projectId, normalizedQuery) as Array<{ label: string; dimension: string; node_id: string }>;
    const grouped = new Map<string, Array<{ label: string; dimension: string; nodeId: string }>>();
    for (const row of rows) {
      const item = { label: row.label, dimension: row.dimension, nodeId: row.node_id };
      if (!containsAlias(normalizedQuery, row.label)) continue;
      const key = `${row.dimension}\0${row.label}`;
      const group = grouped.get(key) ?? [];
      if (!group.some((candidate) => candidate.nodeId === item.nodeId)) group.push(item);
      grouped.set(key, group);
    }
    return [...grouped.values()].filter((group) => group.length === 1).map((group) => group[0]!);
  }

  relatedEpisodeCards(projectId: string, canonicalId: string, selectedIds: Set<string>, limit: number): MemoryAtlasRelatedCard[] {
    const parsed = parseNodeId(canonicalId, projectId);
    if (!parsed || parsed.type !== 'episode') return [];
    const rows = this.db.prepare(`
      SELECT e.relation_type, e.confidence, d.node_id, d.label, d.metadata_json
      FROM memory_edges e
      JOIN memory_atlas_documents d ON d.project_id=e.project_id AND d.node_id=CASE
        WHEN e.source_type='episode' AND e.source_id=? THEN 'episode:' || e.target_id
        ELSE 'episode:' || e.source_id
      END
      WHERE e.project_id=? AND e.status IN ('active','weak') AND e.relation_type IN ('SAME_ISSUE','FOLLOWS_UP','REFINES','CORRECTS','CONTRADICTS','SUPERSEDES','RELATED_TO')
        AND ((e.source_type='episode' AND e.source_id=?) OR (e.target_type='episode' AND e.target_id=?))
      ORDER BY CASE e.relation_type WHEN 'SAME_ISSUE' THEN 1 WHEN 'FOLLOWS_UP' THEN 2 WHEN 'REFINES' THEN 3 ELSE 4 END, e.confidence DESC
      LIMIT ?
    `).all(parsed.id, projectId, parsed.id, parsed.id, Math.max(1, Math.min(limit * 3, 30))) as Array<{ relation_type: string; confidence: number; node_id: string; label: string; metadata_json?: string | null }>;
    const result: MemoryAtlasRelatedCard[] = [];
    for (const row of rows) {
      if (selectedIds.has(row.node_id)) continue;
      result.push({
        canonicalId: row.node_id,
        displayTitle: row.label,
        reason: row.relation_type === 'RELATED_TO' ? 'related topic but different issue/date' : row.relation_type.toLowerCase(),
      });
      if (result.length >= limit) break;
    }
    return result;
  }

  private topicRelatedCardsForPlan(projectId: string, plan: FacetQueryPlan, selectedIds: Set<string>, limit: number): MemoryAtlasRelatedCard[] {
    const topicFacets = plan.facets.filter((facet) => facet.type === 'topic');
    if (!topicFacets.length) return [];
    const rows = topicFacets.flatMap((facet) => this.episodeEdgesForFacet(projectId, facet));
    const candidateIds = Array.from(new Set(rows.map((row) => row.source_id))).filter((id) => !selectedIds.has(`episode:${id}`));
    if (!candidateIds.length) return [];
    return this.episodeRows(projectId, candidateIds)
      .map((row) => ({
        canonicalId: row.node_id,
        displayTitle: row.label,
        reason: 'related topic but different issue/date',
      }))
      .slice(0, Math.max(1, Math.min(limit, 20)));
  }

  resolveTargetNodeIds(projectId: string, query: string): { nodeIds: string[]; entitySourceIds: string[]; labels: string[] } {
    const normalizedQuery = normalizeLookup(query);
    const candidates = this.db.prepare(`
      SELECT node_id,node_type,source_id,label,topic_path,metadata_json,evidence_event_ids_json
      FROM memory_atlas_documents
      WHERE project_id=? AND node_type IN ('entity','topic','issue','project','actor','event','task','object','location','state','time','episode') AND status NOT IN ('rejected','archived','needs_confirmation')
    `).all(projectId) as Array<Record<string, unknown>>;
    const seeds: Array<Record<string, unknown>> = [];
    const labels: string[] = [];
    for (const row of candidates) {
      const aliases = lookupAliases(row);
      const matched = aliases.find((alias) => alias.length > 1 && normalizedQuery.includes(normalizeLookup(alias)));
      if (!matched) continue;
      seeds.push(row); labels.push(String(row.label));
    }
    try {
      const aliasRows = this.db.prepare(`
        SELECT d.node_id,d.node_type,d.source_id,d.label,d.topic_path,d.metadata_json,d.evidence_event_ids_json,a.normalized_alias
        FROM memory_atlas_aliases a
        JOIN memory_atlas_documents d ON d.project_id=a.project_id AND d.node_id=a.node_id
        WHERE a.project_id=? AND a.status='active'
          AND (a.source_frame_id IS NULL OR EXISTS (SELECT 1 FROM memory_atlas_alias_supports s JOIN memory_frames f ON f.frame_id=s.source_frame_id WHERE s.alias_id=a.alias_id AND s.status='active' AND f.status='active'))
          AND d.status NOT IN ('rejected','archived','needs_confirmation')
      `).all(projectId) as Array<Record<string, unknown>>;
      for (const row of aliasRows) {
        const alias = normalizeLookup(String(row.normalized_alias ?? ''));
        if (alias.length <= 1 || !normalizedQuery.includes(alias)) continue;
        if (!seeds.some((seed) => seed.node_id === row.node_id)) { seeds.push(row); labels.push(String(row.label)); }
      }
    } catch { /* pre-0033 databases use document aliases only */ }
    if (!seeds.length) return { nodeIds: [], entitySourceIds: [], labels: [] };
    const ids = new Set(seeds.map((row) => String(row.node_id)));
    const entitySourceIds = seeds.filter((row) => row.node_type === 'entity').map((row) => String(row.source_id));
    const topicPaths = new Set(seeds.map((row) => optionalText(row.topic_path)).filter(Boolean) as string[]);
    const eventIds = new Set<string>();
    if (entitySourceIds.length) {
      const bindings = this.db.prepare(`SELECT event_id,topic_path FROM memory_bindings WHERE project_id=? AND entity_id IN (${entitySourceIds.map(() => '?').join(',')})`).all(projectId, ...entitySourceIds) as Array<{ event_id: string; topic_path?: string }>;
      for (const binding of bindings) { eventIds.add(binding.event_id); if (binding.topic_path) topicPaths.add(binding.topic_path); }
    }
    const edges = this.listEdgesForNodes(projectId, [...ids], 2000);
    for (const edge of edges) { ids.add(edge.source); ids.add(edge.target); }
    if (topicPaths.size) {
      const rows = this.db.prepare(`SELECT node_id FROM memory_atlas_documents WHERE project_id=? AND topic_path IN (${[...topicPaths].map(() => '?').join(',')})`).all(projectId, ...topicPaths) as Array<{ node_id: string }>;
      for (const row of rows) ids.add(row.node_id);
    }
    if (eventIds.size) {
      const rows = this.db.prepare(`SELECT node_id,evidence_event_ids_json FROM memory_atlas_documents WHERE project_id=?`).all(projectId) as Array<{ node_id: string; evidence_event_ids_json: string }>;
      for (const row of rows) if (parseStringArray(row.evidence_event_ids_json).some((id) => eventIds.has(id))) ids.add(row.node_id);
    }
    return { nodeIds: [...ids], entitySourceIds, labels: Array.from(new Set(labels)) };
  }

  evidenceIds(nodeId: string, projectId: string, limit: number): string[] {
    const node = this.db.prepare(`SELECT node_type, source_id, topic_path, evidence_event_ids_json FROM memory_atlas_documents WHERE node_id=? AND project_id=?`).get(nodeId, projectId) as { node_type: string; source_id: string; topic_path?: string; evidence_event_ids_json: string } | null;
    if (!node) return [];
    const ids = parseStringArray(node.evidence_event_ids_json);
    const supportRows = this.db.prepare(`SELECT evidence_event_ids_json FROM memory_atlas_supports WHERE project_id=? AND node_id=? AND status='active' ORDER BY created_at DESC LIMIT ?`).all(projectId, nodeId, limit) as Array<{ evidence_event_ids_json: string }>;
    for (const row of supportRows) ids.push(...parseStringArray(row.evidence_event_ids_json));
    if (node.node_type === 'entity') {
      const rows = this.db.prepare(`SELECT event_id FROM memory_bindings WHERE project_id=? AND entity_id=? ORDER BY created_at DESC LIMIT ?`).all(projectId, node.source_id, limit) as Array<{ event_id: string }>;
      ids.push(...rows.map((row) => row.event_id));
    } else if (node.node_type === 'topic') {
      const rows = this.db.prepare(`SELECT event_id FROM memory_bindings WHERE project_id=? AND topic_path=? ORDER BY created_at DESC LIMIT ?`).all(projectId, node.topic_path || node.source_id, limit) as Array<{ event_id: string }>;
      ids.push(...rows.map((row) => row.event_id));
    } else if (node.node_type === 'action') {
      const rows = this.db.prepare(`SELECT event_id FROM memory_action_frame_evidence WHERE project_id=? AND action_id=? ORDER BY created_at DESC LIMIT ?`).all(projectId, node.source_id, limit) as Array<{ event_id: string }>;
      ids.push(...rows.map((row) => row.event_id));
    } else if (node.node_type === 'episode') {
      const rows = this.db.prepare(`SELECT event_id FROM memory_episode_events WHERE episode_id=? ORDER BY position LIMIT ?`).all(node.source_id, limit) as Array<{ event_id: string }>;
      ids.push(...rows.map((row) => row.event_id));
    }
    return Array.from(new Set(ids.filter(Boolean))).slice(0, limit);
  }

  evidenceTotal(nodeId: string, projectId: string): number {
    return this.evidenceIds(nodeId, projectId, 100_000).length;
  }

  hasEvidenceInRange(nodeId: string, projectId: string, from?: number, to?: number): boolean {
    const fromDate = from === undefined ? undefined : new Date(from).toISOString().slice(0, 10);
    const toDate = to === undefined ? undefined : new Date(to).toISOString().slice(0, 10);
    const clauses = ['s.project_id=?', 's.node_id=?', "s.status='active'", 'e.event_id=json_each.value'];
    const params: Array<string | number> = [projectId, nodeId];
    if (from !== undefined) { clauses.push('(e.occurred_at>=? OR e.local_date>=?)'); params.push(from, fromDate!); }
    if (to !== undefined) { clauses.push('(e.occurred_at<? OR e.local_date<?)'); params.push(to, toDate!); }
    const row = this.db.prepare(`SELECT 1 FROM memory_atlas_supports s JOIN json_each(s.evidence_event_ids_json) ON true JOIN memory_events e ON ${clauses.slice(3).join(' AND ')} WHERE ${clauses.slice(0, 3).join(' AND ')} LIMIT 1`).get(...params);
    return Boolean(row);
  }

  hasActiveState(nodeId: string, projectId: string, states: string[]): boolean {
    const wanted = states.map((state) => normalizeAlias(state.replaceAll('_', ' '))).filter(Boolean);
    if (!wanted.length) return true;
    const parsed = parseNodeId(nodeId, projectId);
    if (!parsed) return false;
    const rows = this.db.prepare(`
      SELECT d.label
      FROM memory_edges e
      JOIN memory_atlas_documents d
        ON d.project_id=e.project_id AND d.node_type='state'
       AND d.status NOT IN ('archived','rejected','needs_confirmation')
       AND d.source_id=e.target_id
      WHERE e.project_id=? AND e.source_type=? AND e.source_id=?
        AND e.relation_type='HAS_STATE' AND e.status IN ('active','weak')
    `).all(projectId, parsed.type, parsed.id) as Array<{ label?: string }>;
    return rows.some((row) => wanted.includes(normalizeAlias(String(row.label ?? ''))));
  }

  listEdges(projectId: string): MemoryAtlasEdge[] {
    const edges: MemoryAtlasEdge[] = [];
    const rows = this.db.prepare(`SELECT * FROM memory_edges WHERE project_id=? AND status IN ('active','weak') ORDER BY confidence DESC LIMIT 2000`).all(projectId) as Array<Record<string, unknown>>;
    for (const row of rows) edges.push({
      source: fromAtlasEdgeEndpoint(String(row.source_type), String(row.source_id), projectId), relation: String(row.relation_type),
      target: fromAtlasEdgeEndpoint(String(row.target_type), String(row.target_id), projectId), confidence: Number(row.confidence),
      evidenceEventIds: parseStringArray(String(row.evidence_event_ids_json || '[]')),
    });
    const actions = this.db.prepare(`SELECT action_id,target_entity_id,occurred_at,confidence FROM memory_action_frames WHERE project_id=?`).all(projectId) as Array<{ action_id: string; target_entity_id?: string; occurred_at: number; confidence: number }>;
    for (const action of actions) {
      if (action.target_entity_id) edges.push({ source: `action:${action.action_id}`, relation: 'TARGETS', target: `entity:${action.target_entity_id}`, confidence: action.confidence, evidenceEventIds: this.actionEvidenceIds(action.action_id, projectId) });
      edges.push({ source: `action:${action.action_id}`, relation: 'OCCURRED_IN', target: timeNodeId(projectId, action.occurred_at), confidence: 1, evidenceEventIds: this.actionEvidenceIds(action.action_id, projectId) });
    }
    edges.push(...this.topicRelationEdges(projectId));
    return edges;
  }

  listEdgesForNodes(projectId: string, nodeIds: string[], limit = 2000): MemoryAtlasEdge[] {
    const boundedIds = Array.from(new Set(nodeIds)).slice(0, 200);
    if (!boundedIds.length) return [];
    const parsed = boundedIds.map((id) => parseNodeId(id, projectId)).filter((item): item is { type: string; id: string } => Boolean(item));
    const edges: MemoryAtlasEdge[] = [];
    if (parsed.length) {
      const clauses = parsed.map(() => `((source_type=? AND source_id=?) OR (target_type=? AND target_id=?))`);
      const params = parsed.flatMap((item) => [item.type, item.id, item.type, item.id]);
      const rows = this.db.prepare(`
        SELECT * FROM memory_edges
        WHERE project_id=? AND status IN ('active','weak') AND (${clauses.join(' OR ')})
        ORDER BY confidence DESC LIMIT ?
      `).all(projectId, ...params, Math.max(1, Math.min(limit, 4000))) as Array<Record<string, unknown>>;
      for (const row of rows) edges.push({
        source: fromAtlasEdgeEndpoint(String(row.source_type), String(row.source_id), projectId), relation: String(row.relation_type),
        target: fromAtlasEdgeEndpoint(String(row.target_type), String(row.target_id), projectId), confidence: Number(row.confidence),
        evidenceEventIds: parseStringArray(String(row.evidence_event_ids_json || '[]')),
      });
    }
    const actionIds = parsed.filter((item) => item.type === 'action').map((item) => item.id);
    const entityIds = parsed.filter((item) => item.type === 'entity').map((item) => item.id);
    const years = parsed.filter((item) => item.type === 'time' && /^\d{4}$/u.test(item.id)).map((item) => Number(item.id));
    const actionClauses: string[] = []; const actionParams: Array<string | number> = [projectId];
    if (actionIds.length) { actionClauses.push(`action_id IN (${actionIds.map(() => '?').join(',')})`); actionParams.push(...actionIds); }
    if (entityIds.length) { actionClauses.push(`target_entity_id IN (${entityIds.map(() => '?').join(',')})`); actionParams.push(...entityIds); }
    for (const year of years) {
      actionClauses.push('(occurred_at>=? AND occurred_at<?)');
      actionParams.push(Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1));
    }
    if (actionClauses.length) {
      const actions = this.db.prepare(`SELECT action_id,target_entity_id,occurred_at,confidence FROM memory_action_frames WHERE project_id=? AND (${actionClauses.join(' OR ')}) ORDER BY occurred_at DESC LIMIT ?`).all(...actionParams, Math.max(1, Math.min(limit, 2000))) as Array<{ action_id: string; target_entity_id?: string; occurred_at: number; confidence: number }>;
      for (const action of actions) {
        const evidenceEventIds = this.actionEvidenceIds(action.action_id, projectId);
        if (action.target_entity_id) edges.push({ source: `action:${action.action_id}`, relation: 'TARGETS', target: `entity:${action.target_entity_id}`, confidence: action.confidence, evidenceEventIds });
        edges.push({ source: `action:${action.action_id}`, relation: 'OCCURRED_IN', target: timeNodeId(projectId, action.occurred_at), confidence: 1, evidenceEventIds });
      }
    }
    const topicPaths = parsed.filter((item) => item.type === 'topic').map((item) => item.id);
    if (topicPaths.length) edges.push(...this.topicRelationEdges(projectId, topicPaths, Math.max(1, Math.min(limit, 2000))));
    return Array.from(new Map(edges.map((edge) => [`${edge.source}\0${edge.relation}\0${edge.target}`, edge])).values()).slice(0, Math.max(1, Math.min(limit, 4000)));
  }

  listEdgesWithinNodes(projectId: string, nodeIds: string[], limit = 4000): MemoryAtlasEdge[] {
    const selectedIds = new Set(Array.from(new Set(nodeIds)));
    const parsed = Array.from(selectedIds).map((id) => parseNodeId(id, projectId)).filter((item): item is { type: string; id: string } => Boolean(item));
    if (!parsed.length) return [];
    const edges: MemoryAtlasEdge[] = [];
    const cap = Math.max(1, Math.min(limit, 4000));
    for (const sourceChunk of chunked(parsed, 120)) {
      for (const targetChunk of chunked(parsed, 120)) {
        const sourceClause = sourceChunk.map(() => '(source_type=? AND source_id=?)').join(' OR ');
        const targetClause = targetChunk.map(() => '(target_type=? AND target_id=?)').join(' OR ');
        const rows = this.db.prepare(`
          SELECT * FROM memory_edges
          WHERE project_id=? AND status IN ('active','weak')
            AND (${sourceClause}) AND (${targetClause})
          ORDER BY confidence DESC LIMIT ?
        `).all(
          projectId,
          ...sourceChunk.flatMap((item) => [item.type, item.id]),
          ...targetChunk.flatMap((item) => [item.type, item.id]),
          cap,
        ) as Array<Record<string, unknown>>;
        for (const row of rows) edges.push({
          source: nodeId(String(row.source_type), String(row.source_id), projectId), relation: String(row.relation_type),
          target: nodeId(String(row.target_type), String(row.target_id), projectId), confidence: Number(row.confidence),
          evidenceEventIds: parseStringArray(String(row.evidence_event_ids_json || '[]')),
        });
      }
    }
    const actionIds = parsed.filter((item) => item.type === 'action').map((item) => item.id);
    if (actionIds.length) {
      for (const chunk of chunked(actionIds, 400)) {
        const actions = this.db.prepare(`SELECT action_id,target_entity_id,occurred_at,confidence FROM memory_action_frames
          WHERE project_id=? AND action_id IN (${chunk.map(() => '?').join(',')})`).all(projectId, ...chunk) as Array<{ action_id: string; target_entity_id?: string; occurred_at: number; confidence: number }>;
        for (const action of actions) {
          const evidenceEventIds = this.actionEvidenceIds(action.action_id, projectId);
          if (action.target_entity_id && selectedIds.has(`entity:${action.target_entity_id}`)) {
            edges.push({ source: `action:${action.action_id}`, relation: 'TARGETS', target: `entity:${action.target_entity_id}`, confidence: action.confidence, evidenceEventIds });
          }
          const timeId = timeNodeId(projectId, action.occurred_at);
          if (selectedIds.has(timeId)) edges.push({ source: `action:${action.action_id}`, relation: 'OCCURRED_IN', target: timeId, confidence: 1, evidenceEventIds });
        }
      }
    }
    const topicPaths = parsed.filter((item) => item.type === 'topic').map((item) => item.id);
    if (topicPaths.length) {
      edges.push(...this.topicRelationEdges(projectId, topicPaths, cap)
        .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)));
    }
    return Array.from(new Map(edges.map((edge) => [`${edge.source}\0${edge.relation}\0${edge.target}`, edge])).values());
  }

  findEdgesBetween(projectId: string, leftNodeId: string, rightNodeId: string): MemoryAtlasEdge[] {
    const left = parseNodeId(leftNodeId, projectId); const right = parseNodeId(rightNodeId, projectId);
    if (!left || !right) return [];
    const rows = this.db.prepare(`
      SELECT * FROM memory_edges WHERE project_id=? AND status IN ('active','weak') AND (
        (source_type=? AND source_id=? AND target_type=? AND target_id=?) OR
        (source_type=? AND source_id=? AND target_type=? AND target_id=?)
      ) ORDER BY confidence DESC LIMIT 20
    `).all(projectId, left.type, left.id, right.type, right.id, right.type, right.id, left.type, left.id) as Array<Record<string, unknown>>;
    const edges = rows.map((row) => ({
      source: nodeId(String(row.source_type), String(row.source_id), projectId), relation: String(row.relation_type),
      target: nodeId(String(row.target_type), String(row.target_id), projectId), confidence: Number(row.confidence),
      evidenceEventIds: parseStringArray(String(row.evidence_event_ids_json || '[]')),
    }));
    const action = left.type === 'action' ? left : right.type === 'action' ? right : undefined;
    if (action) {
      const row = this.db.prepare(`SELECT action_id,target_entity_id,occurred_at,confidence FROM memory_action_frames WHERE project_id=? AND action_id=?`).get(projectId, action.id) as { action_id: string; target_entity_id?: string; occurred_at: number; confidence: number } | null;
      if (row) {
        const evidenceEventIds = this.actionEvidenceIds(row.action_id, projectId);
        const candidates: MemoryAtlasEdge[] = [];
        if (row.target_entity_id) candidates.push({ source: `action:${row.action_id}`, relation: 'TARGETS', target: `entity:${row.target_entity_id}`, confidence: row.confidence, evidenceEventIds });
        candidates.push({ source: `action:${row.action_id}`, relation: 'OCCURRED_IN', target: timeNodeId(projectId, row.occurred_at), confidence: 1, evidenceEventIds });
        edges.push(...candidates.filter((edge) => (edge.source === leftNodeId && edge.target === rightNodeId) || (edge.source === rightNodeId && edge.target === leftNodeId)));
      }
    }
    if (left.type === 'topic' && right.type === 'topic') {
      edges.push(...this.topicRelationEdges(projectId, [left.id, right.id], 20).filter((edge) =>
        (edge.source === leftNodeId && edge.target === rightNodeId) || (edge.source === rightNodeId && edge.target === leftNodeId)));
    }
    return edges;
  }

  findEdgesFromNodesToTarget(projectId: string, leftNodeIds: string[], rightNodeId: string): MemoryAtlasEdge[] {
    const right = parseNodeId(rightNodeId, projectId);
    const left = Array.from(new Set(leftNodeIds)).slice(0, 30)
      .map((id) => parseNodeId(id, projectId)).filter((item): item is { type: string; id: string } => Boolean(item));
    if (!right || !left.length) return [];
    const clauses = left.map(() => `(
      (source_type=? AND source_id=? AND target_type=? AND target_id=?) OR
      (source_type=? AND source_id=? AND target_type=? AND target_id=?)
    )`);
    const params = left.flatMap((item) => [
      item.type, item.id, right.type, right.id,
      right.type, right.id, item.type, item.id,
    ]);
    const rows = this.db.prepare(`
      SELECT * FROM memory_edges WHERE project_id=? AND status IN ('active','weak')
        AND (${clauses.join(' OR ')}) ORDER BY confidence DESC LIMIT 30
    `).all(projectId, ...params) as Array<Record<string, unknown>>;
    const edges = rows.map((row) => ({
      source: nodeId(String(row.source_type), String(row.source_id), projectId), relation: String(row.relation_type),
      target: nodeId(String(row.target_type), String(row.target_id), projectId), confidence: Number(row.confidence),
      evidenceEventIds: parseStringArray(String(row.evidence_event_ids_json || '[]')),
    }));
    const actionIds = Array.from(new Set([
      ...left.filter((item) => item.type === 'action').map((item) => item.id),
      ...(right.type === 'action' ? [right.id] : []),
    ]));
    if (actionIds.length) {
      const actions = this.db.prepare(`SELECT action_id,target_entity_id,occurred_at,confidence FROM memory_action_frames
        WHERE project_id=? AND action_id IN (${actionIds.map(() => '?').join(',')})`).all(projectId, ...actionIds) as Array<{ action_id: string; target_entity_id?: string; occurred_at: number; confidence: number }>;
      const endpointPairs = new Set(leftNodeIds.flatMap((id) => [`${id}\0${rightNodeId}`, `${rightNodeId}\0${id}`]));
      for (const action of actions) {
        const evidenceEventIds = this.actionEvidenceIds(action.action_id, projectId);
        const candidates: MemoryAtlasEdge[] = [];
        if (action.target_entity_id) candidates.push({ source: `action:${action.action_id}`, relation: 'TARGETS', target: `entity:${action.target_entity_id}`, confidence: action.confidence, evidenceEventIds });
        candidates.push({ source: `action:${action.action_id}`, relation: 'OCCURRED_IN', target: timeNodeId(projectId, action.occurred_at), confidence: 1, evidenceEventIds });
        edges.push(...candidates.filter((edge) => endpointPairs.has(`${edge.source}\0${edge.target}`)));
      }
    }
    if (right.type === 'topic') {
      const leftTopicPaths = left.filter((item) => item.type === 'topic').map((item) => item.id);
      if (leftTopicPaths.length) {
        const endpointPairs = new Set(leftNodeIds.flatMap((id) => [`${id}\0${rightNodeId}`, `${rightNodeId}\0${id}`]));
        edges.push(...this.topicRelationEdges(projectId, [...leftTopicPaths, right.id], 30)
          .filter((edge) => endpointPairs.has(`${edge.source}\0${edge.target}`)));
      }
    }
    return edges;
  }

  listActions(projectId: string, options: { target?: string; targetEntityIds?: string[]; from?: number; to?: number; limit: number }): MemoryAtlasAction[] {
    const clauses = ['project_id=?']; const params: Array<string | number> = [projectId];
    if (options.targetEntityIds?.length) {
      clauses.push(`target_entity_id IN (${options.targetEntityIds.map(() => '?').join(',')})`);
      params.push(...options.targetEntityIds);
    } else if (options.target) { clauses.push(`target_label LIKE ? ESCAPE '\\'`); params.push(`%${escapeLike(options.target)}%`); }
    if (options.from !== undefined) { clauses.push('occurred_at>=?'); params.push(options.from); }
    if (options.to !== undefined) { clauses.push('occurred_at<?'); params.push(options.to); }
    const rows = this.db.prepare(`SELECT * FROM memory_action_frames WHERE ${clauses.join(' AND ')} ORDER BY occurred_at DESC LIMIT ?`).all(...params, options.limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: `action:${row.action_id}`, frameType: String(row.frame_type), action: String(row.action),
      targetLabel: row.target_label ? String(row.target_label) : undefined, topicPath: row.topic_path ? String(row.topic_path) : undefined,
      episodeId: row.episode_id ? String(row.episode_id) : undefined, occurredAt: Number(row.occurred_at), confidence: Number(row.confidence), evidence: [],
    }));
  }

  actionEvidenceIds(actionId: string, projectId: string): string[] {
    return (this.db.prepare(`SELECT event_id FROM memory_action_frame_evidence WHERE action_id=? AND project_id=? ORDER BY created_at`).all(actionId, projectId) as Array<{ event_id: string }>).map((row) => row.event_id);
  }

  recordAccess(projectId: string, nodeIds: string[], kind: string, query?: string, now = Date.now()): number {
    const hash = query ? createHash('sha256').update(query).digest('hex') : null;
    const access = this.db.prepare(`INSERT INTO memory_atlas_access(access_id,project_id,node_id,access_kind,query_hash,accessed_at) VALUES(?,?,?,?,?,?)`);
    const activate = this.db.prepare(`INSERT INTO memory_atlas_activation(project_id,node_id,activation,usage_count,last_accessed_at,updated_at) VALUES(?,?,1,1,?,?) ON CONFLICT(project_id,node_id) DO UPDATE SET activation=MIN(10,memory_atlas_activation.activation+1), usage_count=memory_atlas_activation.usage_count+1,last_accessed_at=excluded.last_accessed_at,updated_at=excluded.updated_at`);
    for (const id of nodeIds.slice(0, 30)) { access.run(randomUUID(), projectId, id, kind, hash, now); activate.run(projectId, id, now, now); }
    return Math.min(nodeIds.length, 30);
  }

  cleanupAccess(options: { projectId?: string; before: number; retainLatest?: number }): number {
    let changes = 0;
    const expired = options.projectId !== undefined
      ? this.db.prepare(`DELETE FROM memory_atlas_access WHERE project_id=? AND accessed_at<?`).run(options.projectId, options.before)
      : this.db.prepare(`DELETE FROM memory_atlas_access WHERE accessed_at<?`).run(options.before);
    changes += Number(expired.changes || 0);
    const retain = Math.max(100, Math.min(options.retainLatest ?? 100_000, 1_000_000));
    const projects = options.projectId !== undefined ? [options.projectId] : this.listKnownProjectIds();
    for (const projectId of projects) {
      const capped = this.db.prepare(`
        DELETE FROM memory_atlas_access WHERE project_id=? AND access_id NOT IN (
          SELECT access_id FROM memory_atlas_access WHERE project_id=? ORDER BY accessed_at DESC LIMIT ?
        )
      `).run(projectId, projectId, retain);
      changes += Number(capped.changes || 0);
    }
    return changes;
  }

  decay(projectId?: string, factor = 0.85, now = Date.now()): number {
    const result = projectId !== undefined
      ? this.db.prepare(`UPDATE memory_atlas_activation SET activation=MAX(0,activation*?),updated_at=? WHERE project_id=?`).run(factor, now, projectId)
      : this.db.prepare(`UPDATE memory_atlas_activation SET activation=MAX(0,activation*?),updated_at=?`).run(factor, now);
    return Number(result.changes || 0);
  }

  projectionNeedsRefresh(projectId: string): boolean {
    const row = this.db.prepare(`
      SELECT status, metadata_json FROM memory_atlas_projection_state
      WHERE project_id=? AND projection_name=?
    `).get(projectId, MEMORY_ATLAS_PROJECTION_NAME) as { status: string; metadata_json?: string | null } | null;
    if (!row || row.status !== 'clean') return true;
    const metadata = parseMetadata(row.metadata_json);
    if (metadata.projectionSchemaVersion !== MEMORY_ATLAS_PROJECTION_SCHEMA_VERSION) return true;
    const legacyDirty = this.db.prepare(`
      SELECT status FROM memory_atlas_projection_state
      WHERE project_id=? AND projection_name='memory_atlas.v1' AND status<>'clean'
    `).get(projectId) as { status: string } | null;
    return Boolean(legacyDirty);
  }

  markProjectionClean(projectId: string, metadata: Record<string, unknown> = {}, now = Date.now()): void {
    const enrichedMetadata = {
      ...metadata,
      projectionName: MEMORY_ATLAS_PROJECTION_NAME,
      projectionSchemaVersion: MEMORY_ATLAS_PROJECTION_SCHEMA_VERSION,
    };
    this.db.prepare(`
      INSERT INTO memory_atlas_projection_state(
        project_id, projection_name, cursor_value, status, last_rebuild_at, last_error, metadata_json
      ) VALUES(?, ?, ?, 'clean', ?, NULL, ?)
      ON CONFLICT(project_id, projection_name) DO UPDATE SET
        cursor_value=excluded.cursor_value, status='clean', last_rebuild_at=excluded.last_rebuild_at,
        last_error=NULL, metadata_json=excluded.metadata_json
    `).run(projectId, MEMORY_ATLAS_PROJECTION_NAME, String(now), now, JSON.stringify(enrichedMetadata));
    this.db.prepare(`UPDATE memory_atlas_projection_state SET projection_version=?, frame_schema_version=?, source_fingerprint=?, last_backfill_cursor=? WHERE project_id=? AND projection_name=?`)
      .run('v2', 'memory_frame.v1', typeof metadata.sourceFingerprint === 'string' ? metadata.sourceFingerprint : null, typeof metadata.lastBackfillCursor === 'string' ? metadata.lastBackfillCursor : null, projectId, MEMORY_ATLAS_PROJECTION_NAME);
    this.db.prepare(`
      INSERT INTO memory_atlas_projection_state(
        project_id, projection_name, cursor_value, status, last_rebuild_at, last_error, metadata_json
      ) VALUES(?, 'memory_atlas.v1', ?, 'clean', ?, NULL, ?)
      ON CONFLICT(project_id, projection_name) DO UPDATE SET
        cursor_value=excluded.cursor_value, status='clean', last_rebuild_at=excluded.last_rebuild_at,
        last_error=NULL, metadata_json=excluded.metadata_json
    `).run(projectId, String(now), now, JSON.stringify({ compatibilityAliasFor: MEMORY_ATLAS_PROJECTION_NAME }));
  }

  markProjectionDirty(projectId: string, metadata: Record<string, unknown> = {}, now = Date.now()): void {
    this.db.prepare(`
      INSERT INTO memory_atlas_projection_state(project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json)
      VALUES(?, ?, NULL, 'dirty', ?, NULL, ?)
      ON CONFLICT(project_id,projection_name) DO UPDATE SET
        status='dirty', cursor_value=NULL, last_error=NULL, metadata_json=excluded.metadata_json
    `).run(projectId, MEMORY_ATLAS_PROJECTION_NAME, now, JSON.stringify({
      ...metadata,
      projectionName: MEMORY_ATLAS_PROJECTION_NAME,
      projectionSchemaVersion: MEMORY_ATLAS_PROJECTION_SCHEMA_VERSION,
    }));
    this.db.prepare(`
      INSERT INTO memory_atlas_projection_state(project_id,projection_name,cursor_value,status,last_rebuild_at,last_error,metadata_json)
      VALUES(?, 'memory_atlas.v1', NULL, 'dirty', ?, NULL, ?)
      ON CONFLICT(project_id,projection_name) DO UPDATE SET status='dirty', cursor_value=NULL, last_error=NULL, metadata_json=excluded.metadata_json
    `).run(projectId, now, JSON.stringify({ compatibilityAliasFor: MEMORY_ATLAS_PROJECTION_NAME, dirtyBecause: 'atlas_v2_targeted_reindex' }));
  }

  aggregateFacetNodeSupport(projectId: string, now = Date.now()): void {
    const rows = this.db.prepare(`
      SELECT target_type,target_id,evidence_event_ids_json
      FROM memory_edges
      WHERE project_id=? AND source_type='episode'
        AND target_type IN ('topic','time','issue','entity','session','thread','memoryKind','actionKind')
        AND status IN ('active','weak')
      ORDER BY target_type,target_id
    `).all(projectId) as Array<{ target_type: string; target_id: string; evidence_event_ids_json: string }>;
    const buckets = new Map<string, { count: number; evidence: Set<string> }>();
    for (const row of rows) {
      const id = nodeId(row.target_type, row.target_id, projectId);
      const bucket = buckets.get(id) ?? { count: 0, evidence: new Set<string>() };
      bucket.count += 1;
      for (const eventId of parseStringArray(row.evidence_event_ids_json).slice(0, 5)) bucket.evidence.add(eventId);
      buckets.set(id, bucket);
    }
    const update = this.db.prepare(`UPDATE memory_atlas_documents SET support_count=?, evidence_event_ids_json=?, updated_at=? WHERE project_id=? AND node_id=?`);
    for (const [nodeIdValue, bucket] of buckets) {
      update.run(bucket.count, JSON.stringify(Array.from(bucket.evidence).slice(0, 100)), now, projectId, nodeIdValue);
      this.refreshFtsNode(nodeIdValue);
    }
  }

  markProjectionFailed(projectId: string, error: string, now = Date.now()): void {
    this.db.prepare(`
      INSERT INTO memory_atlas_projection_state(project_id,projection_name,status,last_rebuild_at,last_error,metadata_json)
      VALUES(?,?,'error',?,?,?)
      ON CONFLICT(project_id,projection_name) DO UPDATE SET status='error',last_rebuild_at=excluded.last_rebuild_at,last_error=excluded.last_error
    `).run(projectId, MEMORY_ATLAS_PROJECTION_NAME, now, error.slice(0, 2000), JSON.stringify({
      projectionName: MEMORY_ATLAS_PROJECTION_NAME,
      projectionSchemaVersion: MEMORY_ATLAS_PROJECTION_SCHEMA_VERSION,
    }));
  }

  getProjectionState(projectId: string): { status: string; lastRebuildAt?: number; lastError?: string } | null {
    const row = this.db.prepare(`SELECT status,last_rebuild_at,last_error FROM memory_atlas_projection_state WHERE project_id=? AND projection_name=?`).get(projectId, MEMORY_ATLAS_PROJECTION_NAME) as { status: string; last_rebuild_at?: number | null; last_error?: string | null } | null;
    return row ? { status: row.status, lastRebuildAt: row.last_rebuild_at ?? undefined, lastError: row.last_error || undefined } : null;
  }

  listKnownProjectIds(): string[] {
    const rows = this.db.prepare(`
      SELECT project_id FROM memory_atlas_projection_state WHERE project_id<>''
      UNION SELECT project_id FROM memory_atlas_documents WHERE project_id<>''
    `).all() as Array<{ project_id: string }>;
    return Array.from(new Set(rows.map((row) => row.project_id).filter(Boolean)));
  }

  countDocuments(projectId?: string): number {
    const row = projectId !== undefined
      ? this.db.prepare(`SELECT COUNT(*) AS count FROM memory_atlas_documents WHERE project_id=?`).get(projectId)
      : this.db.prepare(`SELECT COUNT(*) AS count FROM memory_atlas_documents`).get();
    return Number((row as { count?: number } | null)?.count || 0);
  }

  private refreshFtsNode(nodeIdValue: string): void {
    this.db.prepare(`DELETE FROM memory_atlas_fts WHERE node_id=?`).run(nodeIdValue);
    this.db.prepare(`INSERT INTO memory_atlas_fts(node_id,project_id,node_type,label,summary,topic_path) SELECT node_id,project_id,node_type,label,COALESCE(summary,''),COALESCE(topic_path,'') FROM memory_atlas_documents WHERE node_id=?`).run(nodeIdValue);
  }

  private topicRelationEdges(projectId: string, topicPaths: string[] = [], limit = 2000): MemoryAtlasEdge[] {
    const paths = Array.from(new Set(topicPaths)).slice(0, 30);
    const filter = paths.length
      ? `AND (source.topic_path IN (${paths.map(() => '?').join(',')}) OR target.topic_path IN (${paths.map(() => '?').join(',')}))`
      : '';
    const rows = this.db.prepare(`
      SELECT relation.relation, relation.confidence, relation.evidence_event_ids_json,
        source.topic_path AS source_path, target.topic_path AS target_path
      FROM topic_relations relation
      JOIN topic_nodes source ON source.topic_id=relation.source_topic_id AND source.project_id=relation.project_id
      JOIN topic_nodes target ON target.topic_id=relation.target_topic_id AND target.project_id=relation.project_id
      WHERE relation.project_id=? AND relation.status='active' ${filter}
      ORDER BY relation.confidence DESC LIMIT ?
    `).all(projectId, ...paths, ...paths, Math.max(1, Math.min(limit, 2000))) as Array<{
      relation: string; confidence: number; evidence_event_ids_json: string; source_path: string; target_path: string;
    }>;
    return rows.map((row) => ({ source: nodeId('topic', row.source_path, projectId), relation: row.relation,
      target: nodeId('topic', row.target_path, projectId), confidence: Number(row.confidence),
      evidenceEventIds: parseStringArray(row.evidence_event_ids_json) }));
  }

  private episodeEdgesForFacet(projectId: string, facet: PlannedFacet): FacetEdgeRow[] {
    const relationFilter = facet.relation ? 'AND relation_type=?' : '';
    const params: Array<string | number> = facet.relation
      ? [projectId, facet.type, facet.value, facet.relation]
      : [projectId, facet.type, facet.value];
    return this.db.prepare(`
      SELECT source_id, relation_type, target_type, target_id, confidence, evidence_event_ids_json
      FROM memory_edges
      WHERE project_id=? AND source_type='episode' AND target_type=? AND target_id=? ${relationFilter}
        AND status IN ('active','weak')
      ORDER BY confidence DESC
      LIMIT 5000
    `).all(...params) as FacetEdgeRow[];
  }

  private episodeRows(projectId: string, episodeIds: string[]): AtlasDocumentRow[] {
    const ids = Array.from(new Set(episodeIds));
    const rows: AtlasDocumentRow[] = [];
    for (let index = 0; index < ids.length; index += 400) {
      const chunk = ids.slice(index, index + 400);
      if (!chunk.length) continue;
      rows.push(...this.db.prepare(`
        SELECT d.*, COALESCE(a.activation, 0) AS activation
        FROM memory_atlas_documents d LEFT JOIN memory_atlas_activation a
          ON a.project_id=d.project_id AND a.node_id=d.node_id
        WHERE d.project_id=? AND d.node_id IN (${chunk.map(() => '?').join(',')})
          AND d.node_type='episode' AND d.status NOT IN ('rejected','archived','needs_confirmation')
        ORDER BY d.occurred_at DESC, d.support_count DESC, d.node_id ASC
      `).all(projectId, ...chunk.map((id) => `episode:${id}`)) as AtlasDocumentRow[]);
    }
    return rows;
  }

  private cardFromEpisodeRow(row: AtlasDocumentRow, edges: FacetEdgeRow[], projectId: string): MemoryAtlasCard {
    const metadata = parseMetadata(row.metadata_json);
    const evidenceEventIds = parseStringArray(row.evidence_event_ids_json);
    const matchedFacets = edges.map((edge) => facetFromEdge(edge, projectId));
    const matchedPaths: MemoryAtlasMatchedPath[] = edges.map((edge) => {
      const facet = facetFromEdge(edge, projectId);
      return { facet, via: [facet.nodeId, row.node_id], relation: edge.relation_type, confidence: Number(edge.confidence || 0) };
    });
    const issueHints = stringArray(metadata.issueHints);
    const topicHints = stringArray(metadata.topicHints);
    const matchedTopicPaths = matchedFacets.filter((facet) => facet.type === 'topic').map((facet) => facet.value);
    return {
      origin: 'legacy_facet',
      canonicalId: row.node_id,
      nodeType: 'episode',
      displayTitle: row.label,
      oneLineSummary: row.summary || undefined,
      matchedFacets,
      matchedPaths,
      parentTopics: matchedTopicPaths.length ? matchedTopicPaths : topicHints.length ? topicHints : row.topic_path ? [row.topic_path] : [],
      issueType: issueHints[0],
      eventKind: optionalMetadataString(metadata.eventKind),
      localDate: optionalMetadataString(metadata.localDate) ?? (row.occurred_at ? new Date(row.occurred_at).toISOString().slice(0, 10) : undefined),
      whyMatched: matchedFacets.length ? `matched ${matchedFacets.map((facet) => `${facet.type}:${facet.value}`).join(', ')}` : 'matched canonical episode',
      relatedButNotSelected: [],
      evidenceEventIds,
      evidenceTotal: evidenceEventIds.length,
      evidenceReturned: 0,
    };
  }
}

function containsAlias(query: string, alias: string): boolean {
  if (alias.length < 2) return false;
  if (query.includes(alias)) {
    // CJK phrases do not have whitespace word boundaries; contiguous matching
    // is intentional there. Latin and numeric aliases require token edges.
    const cjk = /[\u3400-\u9fff\u3040-\u30ff]/u.test(alias);
    if (cjk) return query.includes(alias);
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'u').test(query);
  }
  return false;
}

function mapNode(row: AtlasDocumentRow, score: number): MemoryAtlasNode {
  return { id: row.node_id, projectId: row.project_id, nodeType: row.node_type as MemoryAtlasNodeType, sourceId: row.source_id,
    memoryKind: row.memory_kind || undefined,
    label: row.label, summary: row.summary || undefined, topicPath: row.topic_path || undefined,
    confidence: Number(row.confidence), supportCount: Number(row.support_count), status: row.status,
    occurredAt: row.occurred_at ?? undefined, activation: Number(row.activation || 0), score,
    evidenceCount: parseStringArray(row.evidence_event_ids_json).length,
    evidenceTotal: parseStringArray(row.evidence_event_ids_json).length };
}
function deriveMemoryKind(nodeType: string, metadata?: Record<string, unknown>): string | undefined {
  if (['action', 'project', 'event', 'time'].includes(nodeType)) return nodeType;
  for (const key of ['clusterType', 'episodeType', 'ontologyClass', 'entityType']) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
  }
  return undefined;
}
function normalizeLookup(value: string): string { return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ''); }
function optionalText(value: unknown): string | undefined { return typeof value === 'string' && value ? value : undefined; }
function lookupAliases(row: Record<string, unknown>): string[] {
  const aliases = [String(row.label || ''), String(row.topic_path || '')];
  try {
    const metadata = JSON.parse(String(row.metadata_json || '{}')) as Record<string, unknown>;
    const value = metadata.aliases;
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (Array.isArray(parsed)) aliases.push(...parsed.filter((item): item is string => typeof item === 'string'));
  } catch { /* malformed legacy metadata is ignored */ }
  return Array.from(new Set(aliases.filter(Boolean)));
}
function parseStringArray(value: string): string[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }
function escapeLike(value: string): string { return value.replace(/[\\%_]/g, '\\$&'); }
function nodeId(type: string, id: string, projectId: string): string { return encodeAtlasNodeId(type, id, projectId); }
function timeNodeId(projectId: string, occurredAt: number): string {
  return `time:${projectId}:${new Date(occurredAt).getUTCFullYear()}`;
}
function scopedEntityNodeId(db: Database, value: string, projectId: string): string {
  if (!value.startsWith('entity:') || value.startsWith(`entity:${projectId}:`)) return value;
  const id = value.slice('entity:'.length);
  if (!id.startsWith('facet:')) return value;
  const scoped = `entity:${projectId}:${id}`;
  const row = db.prepare(`SELECT 1 FROM memory_atlas_documents WHERE project_id=? AND node_id=?`).get(projectId, scoped);
  return row ? scoped : value;
}
function parseNodeId(value: string, projectId: string): { type: string; id: string } | null {
  return decodeAtlasNodeId(value, projectId);
}

function parseMetadata(value?: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function optionalMetadataString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function chunked<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function facetFromEdge(edge: FacetEdgeRow, projectId: string): MemoryAtlasMatchedFacet {
  return {
    type: edge.target_type as MemoryAtlasMatchedFacet['type'],
    value: edge.target_id,
    label: facetLabel(edge.target_type, edge.target_id),
    nodeId: nodeId(edge.target_type, edge.target_id, projectId),
    relation: edge.relation_type,
  };
}

function facetLabel(type: string, value: string): string {
  if (type === 'topic') return value.split('/').pop() || value;
  if (type === 'issue') {
    if (value === 'memory-context-blackbox') return 'Memory Context 黑盒';
    if (value === 'graph-runtime-blackbox') return 'Graph Runtime 黑盒';
    if (value === 'atlas-readability') return 'Atlas 可读性黑盒';
    if (value === 'auto-injection-mismatch') return '自动注入不一致';
  }
  return value;
}

function groupFacetMatches<T extends { facet: PlannedFacet; rows: FacetEdgeRow[] }>(matches: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const match of matches) {
    const targetSlug = equivalentTargetSlug(match.facet);
    const key = targetSlug
      ? `target:${targetSlug}`
      : match.facet.type === 'actionKind' || match.facet.type === 'memoryKind'
      ? `${match.facet.type}:${match.facet.relation || ''}`
      : `${match.facet.type}:${match.facet.value}:${match.facet.relation || ''}`;
    const group = groups.get(key) ?? [];
    group.push(match);
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

function equivalentTargetSlug(facet: PlannedFacet): string | undefined {
  if (facet.type === 'entity' && facet.value.startsWith('facet:')) return facet.value.slice('facet:'.length);
  if (facet.type !== 'topic') return undefined;
  const match = facet.value.match(/^PROJECT\/[^/]+\/([^/]+)$/u);
  return match?.[1];
}

function intersectSets(sets: Array<Set<string>>): Set<string> {
  if (!sets.length) return new Set();
  const [first, ...rest] = sets;
  const result = new Set<string>();
  for (const value of first ?? []) {
    if (rest.every((set) => set.has(value))) result.add(value);
  }
  return result;
}

function cardRank(card: MemoryAtlasCard): number {
  return scoreCard(card) + Math.min(card.evidenceTotal || 0, 10) * 0.01;
}

function scoreCard(card: MemoryAtlasCard): number {
  return card.matchedFacets.length * 10 + card.matchedPaths.reduce((sum, path) => sum + path.confidence, 0) + (card.localDate ? 0.1 : 0);
}

function dedupeCardsByEvidence(cards: MemoryAtlasCard[]): MemoryAtlasCard[] {
  const bySignature = new Map<string, MemoryAtlasCard>();
  const out: MemoryAtlasCard[] = [];
  for (const card of cards) {
    const signature = evidenceSignature(card);
    if (!signature) {
      out.push(card);
      continue;
    }
    const kept = bySignature.get(signature);
    if (!kept) {
      bySignature.set(signature, card);
      out.push(card);
      continue;
    }
    kept.relatedButNotSelected = mergeRelatedCards(kept.relatedButNotSelected ?? [], [{
      canonicalId: card.canonicalId,
      displayTitle: card.displayTitle,
      reason: 'same primary raw evidence',
    }]);
  }
  return out;
}

function evidenceSignature(card: MemoryAtlasCard): string | undefined {
  const primary = card.sourceLocator?.eventId || card.evidenceEventIds[0];
  if (!primary) return undefined;
  const facets = (type: string) => card.matchedFacets
    .filter((facet) => facet.type === type)
    .map((facet) => facet.value)
    .sort()
    .join(',');
  return [
    primary,
    card.localDate || '',
    facets('entity'),
    facets('actionKind'),
  ].join('|');
}

function mergeRelatedCards(...groups: MemoryAtlasRelatedCard[][]): MemoryAtlasRelatedCard[] {
  const merged = new Map<string, MemoryAtlasRelatedCard>();
  for (const group of groups) for (const card of group) if (!merged.has(card.canonicalId)) merged.set(card.canonicalId, card);
  return Array.from(merged.values());
}
