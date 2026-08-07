import { createHash } from 'node:crypto';
import type Database from 'bun:sqlite';
import type { MemoryFrameStore } from '../store/MemoryFrameStore.js';
import type { MemoryAtlasStore } from '../store/MemoryAtlasStore.js';
import type { MemoryFrameNode, MemoryFrameRelation, MemoryFrameV1 } from '../semantic/MemoryFrameTypes.js';
import { normalizeAlias } from '../semantic/CanonicalMemoryResolver.js';
import { decodeAtlasNodeId, encodeAtlasNodeId, toAtlasNodeEndpoint } from './AtlasNodeIdCodec.js';
import { invalidateMemoryEdgeSupportIds, mergeMemoryEdge, reduceMemoryEdges } from '../binding/MemoryEdgeMerge.js';
import { localDateFor } from '../utils/LocalDateContext.js';

export interface MemoryFrameProjectionResult { frames: number; nodes: number; edges: number; needsReview: number; }

export class MemoryFrameProjector {
  private rebuildAliasIndex = new Map<string, string[]>();
  private affectedNodeIds = new Set<string>();

  constructor(private readonly db: Database, private readonly frameStore: MemoryFrameStore, private readonly atlasStore: MemoryAtlasStore, private readonly projectTimeZone?: string) {}

  rebuild(projectId: string, now = Date.now(), options: { canonicalDocumentsRebuilt?: boolean } = {}): MemoryFrameProjectionResult {
    return this.db.transaction(() => this.rebuildUnsafe(projectId, now, options))();
  }

  private rebuildUnsafe(projectId: string, now: number, options: { canonicalDocumentsRebuilt?: boolean }): MemoryFrameProjectionResult {
    this.rebuildAliasIndex.clear();
    this.affectedNodeIds.clear();
    const frames: MemoryFrameV1[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = this.frameStore.list(projectId, { statuses: ['active'], limit: 500, offset });
      frames.push(...page);
      if (page.length < 500) break;
    }
    frames.sort((a, b) => this.frameEvidenceTime(b) - this.frameEvidenceTime(a) || b.frameId.localeCompare(a.frameId));
    let nodes = 0; let edges = 0; let needsReview = 0;
    const currentStateSubjects = new Set<string>();
    if (this.tableExists('memory_atlas_supports')) {
      const previous = this.db.prepare(`SELECT DISTINCT node_id FROM memory_atlas_supports WHERE project_id=? AND source_type='frame'`).all(projectId) as Array<{ node_id: string }>;
      for (const row of previous) this.affectedNodeIds.add(row.node_id);
    }
    const staleSupportIds = (this.db.prepare(`SELECT support_id FROM memory_edge_supports WHERE project_id=? AND source_authority='memory_frame_projector' AND support_status='active'`).all(projectId) as Array<{ support_id: string }>).map((row) => row.support_id);
    const staleEdgeIds = invalidateMemoryEdgeSupportIds(this.db, staleSupportIds, now, false);
    this.db.prepare(`DELETE FROM memory_atlas_fts WHERE project_id=? AND node_id IN (SELECT node_id FROM memory_atlas_documents WHERE project_id=? AND json_extract(metadata_json, '$.projection')='memory_atlas.frame.v2')`).run(projectId, projectId);
    this.db.prepare(`DELETE FROM memory_atlas_documents WHERE project_id=? AND json_extract(metadata_json, '$.projection')='memory_atlas.frame.v2'`).run(projectId);
    if (options.canonicalDocumentsRebuilt) this.refreshCanonicalBaselineSupports(projectId, now);
    this.db.prepare(`UPDATE memory_atlas_supports SET status='invalidated', invalidated_at=? WHERE project_id=? AND source_type='frame' AND status='active'`).run(now, projectId);
    if (this.tableExists('memory_atlas_alias_supports')) this.db.prepare(`UPDATE memory_atlas_alias_supports SET status='invalidated', invalidated_at=? WHERE project_id=? AND status='active'`).run(now, projectId);
    // Resolve only governed/legacy aliases from the stable pre-projection
    // state. Newly written Frame aliases must not become their own resolver.
    this.rebuildAliasIndex = this.loadActiveAliasIndex(projectId);
    const blocked = new Set<string>();
    for (const frame of frames) {
        if (frame.needsReview) needsReview += 1;
        const nodeIds = new Map(frame.nodes.map((node) => [node.frameNodeId, this.nodeId(projectId, node, frame, now)]));
        for (const node of frame.nodes) {
          const id = nodeIds.get(node.frameNodeId)!;
          if (!id) continue;
          const existing = this.atlasStore.getNodeIncludingInactive(id, projectId);
          if (existing && !['active', 'weak'].includes(existing.status)) { blocked.add(id); continue; }
          if (!existing) {
            this.atlasStore.upsertDocument({
              id, projectId, nodeType: node.dimension === 'episode' ? 'episode' : node.dimension,
              sourceId: decodeAtlasNodeId(id, projectId)?.id ?? id, label: node.label, summary: node.description,
              confidence: node.confidence, supportCount: 1, status: 'active',
              evidenceEventIds: node.evidenceEventIds, metadata: { projection: 'memory_atlas.frame.v2', frameId: frame.frameId, frameSchemaVersion: frame.schemaVersion }, updatedAt: now,
            });
          }
          nodes += 1;
          this.upsertSupport(projectId, id, frame, node.evidenceEventIds, now, { label: node.label, summary: node.description, confidence: node.confidence, kind: 'node' });
          for (const alias of [node.label, ...(node.aliases ?? []), ...(node.canonicalHint?.canonicalLabel ? [node.canonicalHint.canonicalLabel] : [])]) this.upsertAlias(projectId, id, node, alias, frame, now);
        }
        for (const relation of frame.relations) {
          const source = nodeIds.get(relation.sourceFrameNodeId); const target = nodeIds.get(relation.targetFrameNodeId);
          if (!source || !target || blocked.has(source) || blocked.has(target)) continue;
          this.upsertEdge(projectId, source, target, relation, frame, now);
          edges += 1;
        }
        for (const reference of frame.temporalReferences) {
          const localDate = this.evidenceLocalDate(reference.evidenceEventIds);
          const dayKey = localDate ?? (reference.occurredAt == null ? normalizeAlias(reference.label) : localDateFor(reference.occurredAt, this.projectTimeZone));
          const timeId = encodeAtlasNodeId('time', dayKey, projectId);
          const existingTime = this.atlasStore.getNodeIncludingInactive(timeId, projectId);
          if (existingTime && !['active', 'weak'].includes(existingTime.status)) { blocked.add(timeId); continue; }
          if (!existingTime) this.atlasStore.upsertDocument({ id: timeId, projectId, nodeType: 'time', sourceId: decodeAtlasNodeId(timeId, projectId)?.id ?? timeId, label: reference.label,
            confidence: reference.confidence, supportCount: 1, status: 'active', occurredAt: reference.occurredAt,
            evidenceEventIds: reference.evidenceEventIds, metadata: { projection: 'memory_atlas.frame.v2', frameId: frame.frameId }, updatedAt: now });
          this.upsertSupport(projectId, timeId, frame, reference.evidenceEventIds, now, { label: reference.label, confidence: reference.confidence, occurredAt: reference.occurredAt, kind: 'time' });
          const timeSources = reference.evidenceEventIds.filter((eventId) => this.isActiveEndpoint(projectId, `raw_event:${eventId}`)).map((eventId) => `raw_event:${eventId}`);
          if (!timeSources.length && this.isActiveEndpoint(projectId, `episode:${frame.episodeId}`)) timeSources.push(`episode:${frame.episodeId}`);
          for (const timeSource of timeSources) if (!blocked.has(timeId)) this.upsertEdge(projectId, timeSource, timeId, { sourceFrameNodeId: timeSource, relationType: 'OCCURRED_ON', targetFrameNodeId: timeId, confidence: reference.confidence, evidenceEventIds: reference.evidenceEventIds }, frame, now);
          const dayMatch = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u.exec(dayKey);
          if (dayMatch) {
            const yearId = encodeAtlasNodeId('time', dayMatch[1], projectId);
            const monthId = encodeAtlasNodeId('time', `${dayMatch[1]}-${dayMatch[2]}`, projectId);
            for (const [id, label] of [[yearId, dayMatch[1]], [monthId, `${dayMatch[1]}-${dayMatch[2]}`]] as const) {
              const existingPeriod = this.atlasStore.getNodeIncludingInactive(id, projectId);
              if (!existingPeriod && !blocked.has(id)) this.atlasStore.upsertDocument({ id, projectId, nodeType: 'time', sourceId: decodeAtlasNodeId(id, projectId)?.id ?? id, label, confidence: reference.confidence, supportCount: 1, status: 'active', evidenceEventIds: reference.evidenceEventIds, metadata: { projection: 'memory_atlas.frame.v2', frameId: frame.frameId }, updatedAt: now });
              if (existingPeriod && !['active', 'weak'].includes(existingPeriod.status)) { blocked.add(id); continue; }
              this.upsertSupport(projectId, id, frame, reference.evidenceEventIds, now, { label, confidence: reference.confidence, kind: 'time_period' });
            }
            if (!blocked.has(monthId) && !blocked.has(yearId)) this.upsertEdge(projectId, monthId, yearId, { sourceFrameNodeId: monthId, relationType: 'OCCURRED_IN', targetFrameNodeId: yearId, confidence: reference.confidence, evidenceEventIds: reference.evidenceEventIds }, frame, now);
            if (!blocked.has(timeId) && !blocked.has(monthId)) this.upsertEdge(projectId, timeId, monthId, { sourceFrameNodeId: timeId, relationType: 'OCCURRED_IN', targetFrameNodeId: monthId, confidence: reference.confidence, evidenceEventIds: reference.evidenceEventIds }, frame, now);
          }
          nodes += 1;
        }
        for (const transition of [...frame.stateTransitions].sort((a, b) => this.latestEvidenceTime(b.evidenceEventIds, 0) - this.latestEvidenceTime(a.evidenceEventIds, 0))) {
          const subject = nodeIds.get(transition.subjectFrameNodeId);
          const subjectNode = frame.nodes.find((node) => node.frameNodeId === transition.subjectFrameNodeId);
          if (!subject || !subjectNode || !['task', 'entity', 'event', 'object'].includes(subjectNode.dimension) || blocked.has(subject)) continue;
          const stateId = encodeAtlasNodeId('state', createHash('sha256').update(`${projectId}\0${canonicalStateKey(transition.to)}`).digest('hex').slice(0, 32), projectId);
          const existingState = this.atlasStore.getNodeIncludingInactive(stateId, projectId);
          if (existingState && !['active', 'weak'].includes(existingState.status)) continue;
          const isCurrentState = !currentStateSubjects.has(subject);
          if (isCurrentState) currentStateSubjects.add(subject);
          const parsedSubject = decodeAtlasNodeId(subject, projectId);
          if (!parsedSubject) continue;
          if (isCurrentState) {
            const obsolete = (this.db.prepare(`SELECT support_id FROM memory_edge_supports WHERE project_id=? AND source_type=? AND source_id=? AND relation_type='HAS_STATE' AND target_id<>? AND source_authority='memory_frame_projector' AND support_status='active'`).all(projectId, parsedSubject.type, parsedSubject.id, decodeAtlasNodeId(stateId, projectId)?.id ?? stateId) as Array<{ support_id: string }>).map((row) => row.support_id);
            invalidateMemoryEdgeSupportIds(this.db, obsolete, now);
          }
          if (!existingState) this.atlasStore.upsertDocument({ id: stateId, projectId, nodeType: 'state', sourceId: decodeAtlasNodeId(stateId, projectId)?.id ?? stateId, label: transition.to,
            confidence: transition.confidence, supportCount: 1, status: 'active', evidenceEventIds: transition.evidenceEventIds,
            metadata: { projection: 'memory_atlas.frame.v2', frameId: frame.frameId }, updatedAt: now });
          this.upsertSupport(projectId, stateId, frame, transition.evidenceEventIds, now, { label: transition.to, confidence: transition.confidence, kind: 'state' });
          if (isCurrentState) this.upsertEdge(projectId, subject, stateId, { sourceFrameNodeId: transition.subjectFrameNodeId, relationType: 'HAS_STATE', targetFrameNodeId: stateId,
            confidence: transition.confidence, evidenceEventIds: transition.evidenceEventIds }, frame, now);
          if (transition.from && subjectNode.dimension === 'event') {
            const fromId = encodeAtlasNodeId('state', createHash('sha256').update(`${projectId}\0${canonicalStateKey(transition.from)}`).digest('hex').slice(0, 32), projectId);
            const existingFrom = this.atlasStore.getNodeIncludingInactive(fromId, projectId);
            if (!existingFrom || ['active', 'weak'].includes(existingFrom.status)) {
              if (!existingFrom) this.atlasStore.upsertDocument({ id: fromId, projectId, nodeType: 'state', sourceId: decodeAtlasNodeId(fromId, projectId)?.id ?? fromId, label: transition.from, confidence: transition.confidence, supportCount: 1, status: 'active', evidenceEventIds: transition.evidenceEventIds, metadata: { projection: 'memory_atlas.frame.v2', frameId: frame.frameId }, updatedAt: now });
              this.upsertSupport(projectId, fromId, frame, transition.evidenceEventIds, now, { label: transition.from, confidence: transition.confidence, kind: 'state' });
              this.upsertEdge(projectId, subject, fromId, { sourceFrameNodeId: transition.subjectFrameNodeId, relationType: 'CHANGED_FROM', targetFrameNodeId: fromId, confidence: transition.confidence, evidenceEventIds: transition.evidenceEventIds }, frame, now);
            }
          }
          if (subjectNode.dimension === 'event') this.upsertEdge(projectId, subject, stateId, { sourceFrameNodeId: transition.subjectFrameNodeId, relationType: 'CHANGED_TO', targetFrameNodeId: stateId, confidence: transition.confidence, evidenceEventIds: transition.evidenceEventIds }, frame, now);
          edges += 1;
        }
    }
    this.db.prepare(`UPDATE memory_atlas_aliases SET status='invalidated', updated_at=? WHERE project_id=? AND source_frame_id IS NOT NULL AND status='active' AND NOT EXISTS (SELECT 1 FROM memory_atlas_alias_supports s WHERE s.alias_id=memory_atlas_aliases.alias_id AND s.status='active')`).run(now, projectId);
    // Include legacy canonical documents that received Frame supports, while
    // preserving counts maintained by older Atlas authorities.
    this.reduceAffectedDocuments(projectId, now);
    reduceMemoryEdges(this.db, staleEdgeIds, now);
    this.rebuildAliasIndex.clear();
    return { frames: frames.length, nodes, edges, needsReview };
  }

  private loadActiveAliasIndex(projectId: string): Map<string, string[]> {
    const index = new Map<string, string[]>();
    if (!this.tableExists('memory_atlas_alias_supports')) return index;
    const rows = this.db.prepare(`
      SELECT a.dimension, a.normalized_alias, a.node_id
      FROM memory_atlas_aliases a
      LEFT JOIN memory_atlas_alias_supports s ON s.alias_id=a.alias_id AND s.status='active'
      LEFT JOIN memory_frames f ON f.frame_id=s.source_frame_id AND f.status='active'
      WHERE a.project_id=? AND a.status='active'
        AND (a.source_frame_id IS NULL OR f.frame_id IS NOT NULL)
      GROUP BY a.dimension, a.normalized_alias, a.node_id
      ORDER BY a.node_id
    `).all(projectId) as Array<{ dimension: string; normalized_alias: string; node_id: string }>;
    for (const row of rows) {
      const key = `${row.dimension}\0${normalizeAlias(row.normalized_alias)}`;
      const ids = index.get(key) ?? [];
      if (!ids.includes(row.node_id)) ids.push(row.node_id);
      index.set(key, ids);
    }
    return index;
  }

  private nodeId(projectId: string, node: MemoryFrameNode, frame: MemoryFrameV1, now: number): string | undefined {
    if (node.dimension === 'episode') return encodeAtlasNodeId('episode', frame.episodeId, projectId);
    if (node.dimension === 'project') return encodeAtlasNodeId('project', frame.projectId, projectId);
    if (node.dimension === 'raw_event') {
      if (node.evidenceEventIds.length !== 1) throw new Error(`raw_event_identity_requires_one_evidence:${node.frameNodeId}`);
      return encodeAtlasNodeId('raw_event', node.evidenceEventIds[0]!, projectId);
    }
    // Mutable canonical identities are resolved by the CPU resolver and
    // governance tables. Model-provided node IDs are never trusted here.
    const normalizedLabel = normalizeAlias(node.label);
    const aliasNodes = this.rebuildAliasIndex.get(`${node.dimension}\0${normalizedLabel}`) ?? [];
    if (aliasNodes.length > 1) {
      const normalizedAlias = normalizeAlias(node.label);
      const candidateId = createHash('sha256').update(`${projectId}\0${node.dimension}\0${normalizedAlias}\0${frame.frameId}`).digest('hex');
      if (this.tableExists('memory_atlas_alias_ambiguities')) this.db.prepare(`
        INSERT INTO memory_atlas_alias_ambiguities(candidate_id,project_id,dimension,normalized_alias,node_ids_json,source_frame_id,status,created_at)
        VALUES(?,?,?,?,?,?,'pending',?)
        ON CONFLICT(candidate_id) DO UPDATE SET node_ids_json=excluded.node_ids_json,status=CASE WHEN memory_atlas_alias_ambiguities.status IN ('resolved','rejected') THEN memory_atlas_alias_ambiguities.status ELSE 'pending' END
      `).run(candidateId, projectId, node.dimension, normalizedAlias, JSON.stringify([...aliasNodes].sort()), frame.frameId, now);
      // A disputed alias must not silently bind evidence to an arbitrary
      // canonical node. Keep this frame's evidence visible under a provisional
      // identity until governance resolves the ambiguity.
      return encodeAtlasNodeId(node.dimension, `provisional:${candidateId}`, projectId);
    }
    if (aliasNodes.length === 1) return aliasNodes[0]!;
    const temporalIdentity = node.dimension === 'event' ? this.evidenceLocalDate(node.evidenceEventIds) ?? '' : '';
    const key = `${projectId}\0${node.dimension}\0${normalizeAlias(node.label)}\0${temporalIdentity}`;
    return encodeAtlasNodeId(node.dimension, createHash('sha256').update(key).digest('hex').slice(0, 32), projectId);
  }

  private upsertSupport(projectId: string, nodeId: string, frame: MemoryFrameV1, evidenceEventIds: string[], now: number, payload: Record<string, unknown> = {}): void {
    this.affectedNodeIds.add(nodeId);
    this.ensureCanonicalBaselineSupport(projectId, nodeId, now);
    const sourceAuthority = (frame as MemoryFrameV1 & { sourceAuthority?: string }).sourceAuthority === 'deterministic_fallback'
      ? 'deterministic_fallback' : 'validated_processor';
    const supportId = createHash('sha256').update(`${nodeId}\0frame\0${frame.frameId}`).digest('hex');
    if (this.hasColumn('memory_atlas_supports', 'payload_json')) {
      this.db.prepare(`
        INSERT INTO memory_atlas_supports (support_id,project_id,node_id,source_type,source_id,source_episode_id,source_frame_id,evidence_event_ids_json,status,created_at,payload_json,confidence,source_authority)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(node_id,source_type,source_id) DO UPDATE SET evidence_event_ids_json=excluded.evidence_event_ids_json,payload_json=excluded.payload_json,confidence=excluded.confidence,source_authority=excluded.source_authority,status='active',invalidated_at=NULL
      `).run(supportId, projectId, nodeId, 'frame', frame.frameId, frame.episodeId, frame.frameId, JSON.stringify(evidenceEventIds), 'active', now, JSON.stringify(payload), Number(payload.confidence ?? frame.confidence), sourceAuthority);
      return;
    }
    this.db.prepare(`
      INSERT INTO memory_atlas_supports (support_id,project_id,node_id,source_type,source_id,source_episode_id,source_frame_id,evidence_event_ids_json,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(node_id,source_type,source_id) DO UPDATE SET evidence_event_ids_json=excluded.evidence_event_ids_json,status='active',invalidated_at=NULL
    `).run(supportId, projectId, nodeId, 'frame', frame.frameId, frame.episodeId, frame.frameId, JSON.stringify(evidenceEventIds), 'active', now);
  }

  /** Preserve legacy/governed document fields as an authority support before
   * Frame reduction can touch a shared canonical node. */
  private ensureCanonicalBaselineSupport(projectId: string, nodeId: string, now: number, refresh = false): void {
    if (!this.hasColumn('memory_atlas_supports', 'payload_json')) return;
    const existing = this.db.prepare(`SELECT 1 FROM memory_atlas_supports WHERE project_id=? AND node_id=? AND source_type='canonical_baseline' LIMIT 1`).get(projectId, nodeId);
    if (existing && !refresh) return;
    const document = this.db.prepare(`SELECT label,summary,confidence,support_count,occurred_at,evidence_event_ids_json,metadata_json FROM memory_atlas_documents WHERE project_id=? AND node_id=?`).get(projectId, nodeId) as {
      label: string; summary?: string | null; confidence?: number; support_count?: number; occurred_at?: number | null; evidence_event_ids_json?: string; metadata_json?: string;
    } | null;
    if (!document) return;
    let metadata: Record<string, unknown> = {};
    try { const value = JSON.parse(document.metadata_json ?? '{}'); if (value && typeof value === 'object') metadata = value as Record<string, unknown>; } catch { /* corrupt legacy metadata has no baseline authority */ }
    if (metadata.projection === 'memory_atlas.frame.v2') return;
    const sourceId = `baseline:${nodeId}`;
    const supportId = createHash('sha256').update(`${nodeId}\0canonical\0${sourceId}`).digest('hex');
    const representedSupports = this.db.prepare(`SELECT payload_json FROM memory_atlas_supports WHERE project_id=? AND node_id=? AND status='active' AND source_type NOT IN ('frame','frame_edge','canonical_baseline')`).all(projectId, nodeId) as Array<{ payload_json?: string }>;
    const representedCount = representedSupports.reduce((total, support) => {
      try {
        const payload = JSON.parse(String(support.payload_json ?? '{}')) as { supportCount?: unknown };
        return total + Math.max(0, Number(payload.supportCount ?? 1));
      } catch {
        return total + 1;
      }
    }, 0);
    const supportCount = Math.max(0, Number(document.support_count ?? 0) - representedCount);
    this.db.prepare(`
      INSERT INTO memory_atlas_supports
        (support_id,project_id,node_id,source_type,source_id,evidence_event_ids_json,status,created_at,payload_json,confidence,source_authority)
      VALUES (?,?,?,?,?,?, 'active', ?,?,?, 'canonical')
      ON CONFLICT(node_id,source_type,source_id) DO UPDATE SET
        evidence_event_ids_json=excluded.evidence_event_ids_json,
        status='active', invalidated_at=NULL, created_at=excluded.created_at,
        payload_json=excluded.payload_json, confidence=excluded.confidence,
        source_authority='canonical'
    `).run(
      supportId, projectId, nodeId, 'canonical_baseline', sourceId,
      document.evidence_event_ids_json ?? '[]', now,
      JSON.stringify({ label: document.label, summary: document.summary, confidence: Number(document.confidence ?? 0), occurredAt: document.occurred_at, supportCount }),
      Number(document.confidence ?? 0),
    );
  }

  private refreshCanonicalBaselineSupports(projectId: string, now: number): void {
    if (!this.hasColumn('memory_atlas_supports', 'payload_json')) return;
    const rows = this.db.prepare(`SELECT DISTINCT node_id FROM memory_atlas_supports WHERE project_id=? AND source_type='canonical_baseline'`).all(projectId) as Array<{ node_id: string }>;
    for (const row of rows) {
      this.affectedNodeIds.add(row.node_id);
      const document = this.db.prepare(`SELECT metadata_json FROM memory_atlas_documents WHERE project_id=? AND node_id=?`).get(projectId, row.node_id) as { metadata_json?: string } | null;
      if (!document) {
        this.db.prepare(`UPDATE memory_atlas_supports SET status='invalidated',invalidated_at=? WHERE project_id=? AND node_id=? AND source_type='canonical_baseline' AND status='active'`).run(now, projectId, row.node_id);
        continue;
      }
      let frameProjection = false;
      try { frameProjection = JSON.parse(document.metadata_json ?? '{}')?.projection === 'memory_atlas.frame.v2'; } catch { frameProjection = true; }
      if (frameProjection) {
        this.db.prepare(`UPDATE memory_atlas_supports SET status='invalidated',invalidated_at=? WHERE project_id=? AND node_id=? AND source_type='canonical_baseline' AND status='active'`).run(now, projectId, row.node_id);
        continue;
      }
      this.ensureCanonicalBaselineSupport(projectId, row.node_id, now, true);
    }
  }

  private upsertAlias(projectId: string, nodeId: string, node: MemoryFrameNode, alias: string, frame: MemoryFrameV1, now: number): void {
    const normalized = normalizeAlias(alias);
    if (!normalized) return;
    const aliasId = createHash('sha256').update(`${projectId}\0${nodeId}\0${normalized}`).digest('hex');
    this.db.prepare(`INSERT INTO memory_atlas_aliases(alias_id,project_id,node_id,normalized_alias,alias,dimension,status,confidence,source_frame_id,evidence_event_ids_json,created_at,updated_at) VALUES(?,?,?,?,? ,?,'active',?,?,?, ?,?) ON CONFLICT(project_id,normalized_alias,dimension,node_id) DO UPDATE SET status='active',confidence=MAX(memory_atlas_aliases.confidence,excluded.confidence),updated_at=excluded.updated_at`).run(aliasId, projectId, nodeId, normalized, alias, node.dimension, node.confidence, frame.frameId, JSON.stringify(node.evidenceEventIds), now, now);
    if (this.tableExists('memory_atlas_alias_supports')) {
      const supportId = createHash('sha256').update(`${aliasId}\0${frame.frameId}`).digest('hex');
      if (this.hasColumn('memory_atlas_alias_supports', 'payload_json')) {
        this.db.prepare(`INSERT INTO memory_atlas_alias_supports(support_id,alias_id,project_id,node_id,source_frame_id,source_episode_id,evidence_event_ids_json,status,created_at,payload_json,confidence,source_authority) VALUES(?,?,?,?,?,?,?,'active',?,?,?,?) ON CONFLICT(alias_id,source_frame_id) DO UPDATE SET status='active',invalidated_at=NULL,evidence_event_ids_json=excluded.evidence_event_ids_json,payload_json=excluded.payload_json,confidence=excluded.confidence,source_authority=excluded.source_authority`).run(supportId, aliasId, projectId, nodeId, frame.frameId, frame.episodeId, JSON.stringify(node.evidenceEventIds), now, JSON.stringify({ alias, normalized, dimension: node.dimension }), node.confidence, 'memory_frame_projector');
      } else {
        this.db.prepare(`INSERT INTO memory_atlas_alias_supports(support_id,alias_id,project_id,node_id,source_frame_id,source_episode_id,evidence_event_ids_json,status,created_at) VALUES(?,?,?,?,?,?,?,'active',?) ON CONFLICT(alias_id,source_frame_id) DO UPDATE SET status='active',invalidated_at=NULL,evidence_event_ids_json=excluded.evidence_event_ids_json`).run(supportId, aliasId, projectId, nodeId, frame.frameId, frame.episodeId, JSON.stringify(node.evidenceEventIds), now);
      }
    }
  }

  private tableExists(name: string): boolean { return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name)); }
  private hasColumn(table: string, name: string): boolean { return Boolean(this.db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name=?`).get(table, name)); }

  private upsertEdge(projectId: string, source: string, target: string, relation: MemoryFrameRelation, frame: MemoryFrameV1, now: number): void {
    const parsedSource = toAtlasNodeEndpoint(source, projectId); const parsedTarget = toAtlasNodeEndpoint(target, projectId);
    if (!parsedSource || !parsedTarget) throw new Error(`invalid_atlas_edge_endpoint:${source}:${target}`);
    if (!this.isActiveEndpoint(projectId, source) || !this.isActiveEndpoint(projectId, target)) return;
    const validFrom = relation.validFrom ?? this.evidenceTime(relation.evidenceEventIds, frame.processor.generatedAt);
    mergeMemoryEdge(this.db, {
      projectId,
      sourceType: parsedSource.type,
      sourceId: parsedSource.id,
      relationType: relation.relationType,
      targetType: parsedTarget.type,
      targetId: parsedTarget.id,
      confidence: relation.confidence,
      stability: 0.85,
      evidenceEventIds: relation.evidenceEventIds,
      status: 'active',
      validFrom,
      validTo: relation.validTo,
      sourceAuthority: 'memory_frame_projector',
      supportSourceType: 'frame',
      supportSourceId: frame.frameId,
      operation: 'replace',
      createdAt: now,
      updatedAt: now,
    });
  }

  private isActiveEndpoint(projectId: string, nodeId: string): boolean {
    const node = this.atlasStore.getNodeIncludingInactive(nodeId, projectId);
    return Boolean(node && node.projectId === projectId && ['active', 'weak'].includes(node.status));
  }

  private reduceAffectedDocuments(projectId: string, now: number): void {
    const authorityRank: Record<string, number> = { operator: 5, governed: 5, canonical: 4, validated_processor: 3, memory_frame_projector: 2, deterministic_fallback: 1 };
    for (const nodeId of this.affectedNodeIds) {
      if (nodeId === `project:${projectId}`) continue;
      const supports = this.db.prepare(`SELECT payload_json,confidence,evidence_event_ids_json,source_authority,created_at FROM memory_atlas_supports WHERE project_id=? AND node_id=? AND status='active'`).all(projectId, nodeId) as Array<{ payload_json?: string; confidence?: number; evidence_event_ids_json?: string; source_authority?: string; created_at: number }>;
      if (!supports.length) {
        this.db.prepare(`UPDATE memory_atlas_documents SET support_count=0,status=CASE WHEN json_extract(metadata_json,'$.projection')='memory_atlas.frame.v2' THEN 'archived' ELSE status END,updated_at=? WHERE project_id=? AND node_id=?`).run(now, projectId, nodeId);
        continue;
      }
      const parsed = supports.map((support) => {
        let payload: Record<string, unknown> = {};
        try { const value = JSON.parse(String(support.payload_json ?? '{}')); if (value && typeof value === 'object') payload = value as Record<string, unknown>; } catch { /* legacy support */ }
        return { support, payload };
      }).sort((a, b) => (authorityRank[String(b.support.source_authority ?? '')] ?? 0) - (authorityRank[String(a.support.source_authority ?? '')] ?? 0)
        || Number(b.support.confidence ?? 0) - Number(a.support.confidence ?? 0) || b.support.created_at - a.support.created_at);
      const winner = parsed[0]!;
      const label = typeof winner.payload.label === 'string' ? winner.payload.label : undefined;
      const summary = typeof winner.payload.summary === 'string' ? winner.payload.summary : undefined;
      const confidence = Number(winner.support.confidence ?? winner.payload.confidence ?? 0);
      const evidence = [...new Set(parsed.flatMap(({ support }) => {
        try { const value = JSON.parse(String(support.evidence_event_ids_json ?? '[]')); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []; } catch { return []; }
      }))].sort();
      const occurredAt = parsed.map(({ payload }) => payload.occurredAt).find((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const supportCount = parsed.reduce((total, { payload }) => total + Math.max(0, Number(payload.supportCount ?? 1)), 0);
      this.db.prepare(`UPDATE memory_atlas_documents SET support_count=?, confidence=?, label=COALESCE(?,label), summary=COALESCE(?,summary), occurred_at=COALESCE(?,occurred_at), evidence_event_ids_json=?, updated_at=? WHERE project_id=? AND node_id=?`).run(supportCount, confidence, label ?? null, summary ?? null, occurredAt ?? null, JSON.stringify(evidence), now, projectId, nodeId);
    }
  }

  private evidenceTime(eventIds: string[], fallback: number): number {
    if (!eventIds.length) return fallback;
    const row = this.db.prepare(`SELECT MIN(occurred_at) AS occurred_at FROM memory_events WHERE event_id IN (${eventIds.map(() => '?').join(',')})`).get(...eventIds) as { occurred_at?: number } | null;
    return row?.occurred_at == null ? fallback : Number(row.occurred_at);
  }

  private latestEvidenceTime(eventIds: string[], fallback: number): number {
    if (!eventIds.length) return fallback;
    const row = this.db.prepare(`SELECT MAX(occurred_at) AS occurred_at FROM memory_events WHERE event_id IN (${eventIds.map(() => '?').join(',')})`).get(...eventIds) as { occurred_at?: number } | null;
    return row?.occurred_at == null ? fallback : Number(row.occurred_at);
  }

  private evidenceLocalDate(eventIds: string[]): string | undefined {
    if (!eventIds.length) return undefined;
    const row = this.db.prepare(`SELECT local_date FROM memory_events WHERE event_id IN (${eventIds.map(() => '?').join(',')}) AND local_date IS NOT NULL ORDER BY occurred_at LIMIT 1`).get(...eventIds) as { local_date?: string } | null;
    return row?.local_date || undefined;
  }

  private frameEvidenceTime(frame: MemoryFrameV1): number {
    if (!frame.evidenceEventIds.length) return frame.processor.generatedAt;
    const placeholders = frame.evidenceEventIds.map(() => '?').join(',');
    const row = this.db.prepare(`SELECT MAX(COALESCE(occurred_at, 0)) AS occurred_at FROM memory_events WHERE event_id IN (${placeholders})`).get(...frame.evidenceEventIds) as { occurred_at?: number } | null;
    return row?.occurred_at == null ? frame.processor.generatedAt : Number(row.occurred_at);
  }
}

function canonicalStateKey(value: string): string {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('und').trim().replace(/[\s-]+/gu, '_');
  if (/^(completed?|done|resolved|完了|已完成|完成)$/u.test(normalized)) return 'task.completed';
  if (/^(in_progress|progress|working|进行中|处理中|進行中)$/u.test(normalized)) return 'task.in_progress';
  if (/^(blocked|stuck|阻塞|卡住|ブロック)$/u.test(normalized)) return 'task.blocked';
  if (/^(planned|planning|计划|规划|計画)$/u.test(normalized)) return 'task.planned';
  return `state.${normalized}`;
}
