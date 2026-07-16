import { createHash } from 'node:crypto';
import { normalizeAlias } from '../semantic/CanonicalMemoryResolver.js';
import { decodeAtlasNodeId, encodeAtlasNodeId, toAtlasNodeEndpoint } from './AtlasNodeIdCodec.js';
export class MemoryFrameProjector {
    db;
    frameStore;
    atlasStore;
    rebuildAliasIndex = new Map();
    constructor(db, frameStore, atlasStore) {
        this.db = db;
        this.frameStore = frameStore;
        this.atlasStore = atlasStore;
    }
    rebuild(projectId, now = Date.now()) {
        return this.db.transaction(() => this.rebuildUnsafe(projectId, now))();
    }
    rebuildUnsafe(projectId, now) {
        this.rebuildAliasIndex = this.loadActiveAliasIndex(projectId);
        const frames = [];
        for (let offset = 0;; offset += 500) {
            const page = this.frameStore.list(projectId, { statuses: ['active'], limit: 500, offset });
            frames.push(...page);
            if (page.length < 500)
                break;
        }
        frames.sort((a, b) => this.frameEvidenceTime(b) - this.frameEvidenceTime(a) || b.frameId.localeCompare(a.frameId));
        let nodes = 0;
        let edges = 0;
        let needsReview = 0;
        const currentStateSubjects = new Set();
        this.db.prepare(`DELETE FROM memory_edges WHERE project_id=? AND source_authority='memory_frame_projector'`).run(projectId);
        this.db.prepare(`DELETE FROM memory_atlas_fts WHERE project_id=? AND node_id IN (SELECT node_id FROM memory_atlas_documents WHERE project_id=? AND json_extract(metadata_json, '$.projection')='memory_atlas.frame.v2')`).run(projectId, projectId);
        this.db.prepare(`DELETE FROM memory_atlas_documents WHERE project_id=? AND json_extract(metadata_json, '$.projection')='memory_atlas.frame.v2'`).run(projectId);
        this.db.prepare(`UPDATE memory_atlas_supports SET status='invalidated', invalidated_at=? WHERE project_id=? AND source_type IN ('frame','frame_edge') AND status='active'`).run(now, projectId);
        if (this.tableExists('memory_atlas_alias_supports'))
            this.db.prepare(`UPDATE memory_atlas_alias_supports SET status='invalidated', invalidated_at=? WHERE project_id=? AND status='active'`).run(now, projectId);
        const blocked = new Set();
        for (const frame of frames) {
            if (frame.needsReview)
                needsReview += 1;
            const nodeIds = new Map(frame.nodes.map((node) => [node.frameNodeId, this.nodeId(projectId, node, frame)]));
            for (const node of frame.nodes) {
                const id = nodeIds.get(node.frameNodeId);
                if (!id)
                    continue;
                const existing = this.atlasStore.getNodeIncludingInactive(id, projectId);
                if (existing && !['active', 'weak'].includes(existing.status)) {
                    blocked.add(id);
                    continue;
                }
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
                for (const alias of [node.label, ...(node.aliases ?? []), ...(node.canonicalHint?.canonicalLabel ? [node.canonicalHint.canonicalLabel] : [])])
                    this.upsertAlias(projectId, id, node, alias, frame, now);
            }
            for (const relation of frame.relations) {
                const source = nodeIds.get(relation.sourceFrameNodeId);
                const target = nodeIds.get(relation.targetFrameNodeId);
                if (!source || !target || blocked.has(source) || blocked.has(target))
                    continue;
                this.upsertEdge(projectId, source, target, relation, frame, now);
                edges += 1;
            }
            for (const reference of frame.temporalReferences) {
                const localDate = this.evidenceLocalDate(reference.evidenceEventIds);
                const dayKey = localDate ?? (reference.occurredAt == null ? normalizeAlias(reference.label) : new Date(reference.occurredAt).toISOString().slice(0, 10));
                const timeId = encodeAtlasNodeId('time', dayKey, projectId);
                const existingTime = this.atlasStore.getNodeIncludingInactive(timeId, projectId);
                if (existingTime && !['active', 'weak'].includes(existingTime.status)) {
                    blocked.add(timeId);
                    continue;
                }
                if (!existingTime)
                    this.atlasStore.upsertDocument({ id: timeId, projectId, nodeType: 'time', sourceId: decodeAtlasNodeId(timeId, projectId)?.id ?? timeId, label: reference.label,
                        confidence: reference.confidence, supportCount: 1, status: 'active', occurredAt: reference.occurredAt,
                        evidenceEventIds: reference.evidenceEventIds, metadata: { projection: 'memory_atlas.frame.v2', frameId: frame.frameId }, updatedAt: now });
                this.upsertSupport(projectId, timeId, frame, reference.evidenceEventIds, now, { label: reference.label, confidence: reference.confidence, occurredAt: reference.occurredAt, kind: 'time' });
                const timeSources = reference.evidenceEventIds.filter((eventId) => this.atlasStore.getNodeIncludingInactive(`raw_event:${eventId}`, projectId)).map((eventId) => `raw_event:${eventId}`);
                if (!timeSources.length)
                    timeSources.push(`episode:${frame.episodeId}`);
                for (const timeSource of timeSources)
                    if (!blocked.has(timeId))
                        this.upsertEdge(projectId, timeSource, timeId, { sourceFrameNodeId: timeSource, relationType: 'OCCURRED_ON', targetFrameNodeId: timeId, confidence: reference.confidence, evidenceEventIds: reference.evidenceEventIds }, frame, now);
                const dayMatch = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u.exec(dayKey);
                if (dayMatch) {
                    const yearId = encodeAtlasNodeId('time', dayMatch[1], projectId);
                    const monthId = encodeAtlasNodeId('time', `${dayMatch[1]}-${dayMatch[2]}`, projectId);
                    for (const [id, label] of [[yearId, dayMatch[1]], [monthId, `${dayMatch[1]}-${dayMatch[2]}`]]) {
                        const existingPeriod = this.atlasStore.getNodeIncludingInactive(id, projectId);
                        if (!existingPeriod && !blocked.has(id))
                            this.atlasStore.upsertDocument({ id, projectId, nodeType: 'time', sourceId: decodeAtlasNodeId(id, projectId)?.id ?? id, label, confidence: reference.confidence, supportCount: 1, status: 'active', evidenceEventIds: reference.evidenceEventIds, metadata: { projection: 'memory_atlas.frame.v2', frameId: frame.frameId }, updatedAt: now });
                        if (existingPeriod && !['active', 'weak'].includes(existingPeriod.status)) {
                            blocked.add(id);
                            continue;
                        }
                        this.upsertSupport(projectId, id, frame, reference.evidenceEventIds, now, { label, confidence: reference.confidence, kind: 'time_period' });
                    }
                    if (!blocked.has(monthId) && !blocked.has(yearId))
                        this.upsertEdge(projectId, monthId, yearId, { sourceFrameNodeId: monthId, relationType: 'OCCURRED_IN', targetFrameNodeId: yearId, confidence: reference.confidence, evidenceEventIds: reference.evidenceEventIds }, frame, now);
                    if (!blocked.has(timeId) && !blocked.has(monthId))
                        this.upsertEdge(projectId, timeId, monthId, { sourceFrameNodeId: timeId, relationType: 'OCCURRED_IN', targetFrameNodeId: monthId, confidence: reference.confidence, evidenceEventIds: reference.evidenceEventIds }, frame, now);
                }
                nodes += 1;
            }
            for (const transition of [...frame.stateTransitions].sort((a, b) => this.latestEvidenceTime(b.evidenceEventIds, 0) - this.latestEvidenceTime(a.evidenceEventIds, 0))) {
                const subject = nodeIds.get(transition.subjectFrameNodeId);
                const subjectNode = frame.nodes.find((node) => node.frameNodeId === transition.subjectFrameNodeId);
                if (!subject || !subjectNode || !['task', 'entity', 'event', 'object'].includes(subjectNode.dimension) || blocked.has(subject))
                    continue;
                const stateId = encodeAtlasNodeId('state', createHash('sha256').update(`${projectId}\0${canonicalStateKey(transition.to)}`).digest('hex').slice(0, 32), projectId);
                const existingState = this.atlasStore.getNodeIncludingInactive(stateId, projectId);
                if (existingState && !['active', 'weak'].includes(existingState.status))
                    continue;
                const isCurrentState = !currentStateSubjects.has(subject);
                if (isCurrentState)
                    currentStateSubjects.add(subject);
                const parsedSubject = decodeAtlasNodeId(subject, projectId);
                if (!parsedSubject)
                    continue;
                if (isCurrentState) {
                    this.db.prepare(`UPDATE memory_edges SET status='archived', updated_at=? WHERE project_id=? AND source_type=? AND source_id=? AND relation_type='HAS_STATE' AND target_id<>? AND source_authority='memory_frame_projector' AND status IN ('active','weak')`).run(now, projectId, parsedSubject.type, parsedSubject.id, decodeAtlasNodeId(stateId, projectId)?.id ?? stateId);
                }
                if (!existingState)
                    this.atlasStore.upsertDocument({ id: stateId, projectId, nodeType: 'state', sourceId: decodeAtlasNodeId(stateId, projectId)?.id ?? stateId, label: transition.to,
                        confidence: transition.confidence, supportCount: 1, status: 'active', evidenceEventIds: transition.evidenceEventIds,
                        metadata: { projection: 'memory_atlas.frame.v2', frameId: frame.frameId }, updatedAt: now });
                this.upsertSupport(projectId, stateId, frame, transition.evidenceEventIds, now, { label: transition.to, confidence: transition.confidence, kind: 'state' });
                if (isCurrentState)
                    this.upsertEdge(projectId, subject, stateId, { sourceFrameNodeId: transition.subjectFrameNodeId, relationType: 'HAS_STATE', targetFrameNodeId: stateId,
                        confidence: transition.confidence, evidenceEventIds: transition.evidenceEventIds }, frame, now);
                if (transition.from && subjectNode.dimension === 'event') {
                    const fromId = encodeAtlasNodeId('state', createHash('sha256').update(`${projectId}\0${canonicalStateKey(transition.from)}`).digest('hex').slice(0, 32), projectId);
                    const existingFrom = this.atlasStore.getNodeIncludingInactive(fromId, projectId);
                    if (!existingFrom || ['active', 'weak'].includes(existingFrom.status)) {
                        if (!existingFrom)
                            this.atlasStore.upsertDocument({ id: fromId, projectId, nodeType: 'state', sourceId: decodeAtlasNodeId(fromId, projectId)?.id ?? fromId, label: transition.from, confidence: transition.confidence, supportCount: 1, status: 'active', evidenceEventIds: transition.evidenceEventIds, metadata: { projection: 'memory_atlas.frame.v2', frameId: frame.frameId }, updatedAt: now });
                        this.upsertSupport(projectId, fromId, frame, transition.evidenceEventIds, now, { label: transition.from, confidence: transition.confidence, kind: 'state' });
                        this.upsertEdge(projectId, subject, fromId, { sourceFrameNodeId: transition.subjectFrameNodeId, relationType: 'CHANGED_FROM', targetFrameNodeId: fromId, confidence: transition.confidence, evidenceEventIds: transition.evidenceEventIds }, frame, now);
                    }
                }
                if (subjectNode.dimension === 'event')
                    this.upsertEdge(projectId, subject, stateId, { sourceFrameNodeId: transition.subjectFrameNodeId, relationType: 'CHANGED_TO', targetFrameNodeId: stateId, confidence: transition.confidence, evidenceEventIds: transition.evidenceEventIds }, frame, now);
                edges += 1;
            }
        }
        this.db.prepare(`UPDATE memory_atlas_aliases SET status='invalidated', updated_at=? WHERE project_id=? AND source_frame_id IS NOT NULL AND status='active' AND NOT EXISTS (SELECT 1 FROM memory_atlas_alias_supports s WHERE s.alias_id=memory_atlas_aliases.alias_id AND s.status='active')`).run(now, projectId);
        // Include legacy canonical documents that received Frame supports, while
        // preserving counts maintained by older Atlas authorities.
        this.db.prepare(`UPDATE memory_atlas_documents
      SET support_count=MAX(COALESCE(support_count,0), (
        SELECT COUNT(*) FROM memory_atlas_supports s
        WHERE s.project_id=memory_atlas_documents.project_id
          AND s.node_id=memory_atlas_documents.node_id
          AND s.status='active'
      ))
      WHERE project_id=? AND EXISTS (
        SELECT 1 FROM memory_atlas_supports s
        WHERE s.project_id=memory_atlas_documents.project_id
          AND s.node_id=memory_atlas_documents.node_id
          AND s.status='active'
      )`).run(projectId);
        this.rebuildAliasIndex.clear();
        return { frames: frames.length, nodes, edges, needsReview };
    }
    loadActiveAliasIndex(projectId) {
        const index = new Map();
        if (!this.tableExists('memory_atlas_alias_supports'))
            return index;
        const rows = this.db.prepare(`
      SELECT a.dimension, a.normalized_alias, a.node_id
      FROM memory_atlas_aliases a
      JOIN memory_atlas_alias_supports s ON s.alias_id=a.alias_id AND s.status='active'
      JOIN memory_frames f ON f.frame_id=s.source_frame_id AND f.status='active'
      WHERE a.project_id=? AND a.status='active'
      GROUP BY a.dimension, a.normalized_alias, a.node_id
      ORDER BY a.node_id
    `).all(projectId);
        for (const row of rows) {
            const key = `${row.dimension}\0${normalizeAlias(row.normalized_alias)}`;
            const ids = index.get(key) ?? [];
            if (!ids.includes(row.node_id))
                ids.push(row.node_id);
            index.set(key, ids);
        }
        return index;
    }
    nodeId(projectId, node, frame) {
        if (node.dimension === 'episode')
            return encodeAtlasNodeId('episode', frame.episodeId, projectId);
        if (node.dimension === 'project')
            return encodeAtlasNodeId('project', frame.projectId, projectId);
        if (node.dimension === 'raw_event') {
            if (node.evidenceEventIds.length !== 1)
                throw new Error(`raw_event_identity_requires_one_evidence:${node.frameNodeId}`);
            return encodeAtlasNodeId('raw_event', node.evidenceEventIds[0], projectId);
        }
        if (node.canonicalHint?.nodeId) {
            const candidate = node.canonicalHint.nodeId;
            const existing = this.atlasStore.getNodeIncludingInactive(candidate, projectId);
            if (existing && existing.projectId === projectId && existing.nodeType === node.dimension)
                return candidate;
        }
        const normalizedLabel = normalizeAlias(node.label);
        const aliasNodes = this.rebuildAliasIndex.get(`${node.dimension}\0${normalizedLabel}`)
            ?? this.atlasStore.findAliasNodes(projectId, node.dimension, normalizedLabel);
        if (aliasNodes.length > 1) {
            const normalizedAlias = normalizeAlias(node.label);
            const candidateId = createHash('sha256').update(`${projectId}\0${node.dimension}\0${normalizedAlias}\0${frame.frameId}`).digest('hex');
            if (this.tableExists('memory_atlas_alias_ambiguities'))
                this.db.prepare(`
        INSERT INTO memory_atlas_alias_ambiguities(candidate_id,project_id,dimension,normalized_alias,node_ids_json,source_frame_id,status,created_at)
        VALUES(?,?,?,?,?,?,'pending',?)
        ON CONFLICT(candidate_id) DO UPDATE SET node_ids_json=excluded.node_ids_json,status=CASE WHEN memory_atlas_alias_ambiguities.status IN ('resolved','rejected') THEN memory_atlas_alias_ambiguities.status ELSE 'pending' END
      `).run(candidateId, projectId, node.dimension, normalizedAlias, JSON.stringify([...aliasNodes].sort()), frame.frameId, Date.now());
            // A disputed alias must not silently bind evidence to an arbitrary
            // canonical node. Keep this frame's evidence visible under a provisional
            // identity until governance resolves the ambiguity.
            return encodeAtlasNodeId(node.dimension, `provisional:${candidateId}`, projectId);
        }
        if (aliasNodes.length === 1)
            return aliasNodes[0];
        const temporalIdentity = node.dimension === 'event' ? this.evidenceLocalDate(node.evidenceEventIds) ?? '' : '';
        const key = `${projectId}\0${node.dimension}\0${normalizeAlias(node.label)}\0${temporalIdentity}`;
        return encodeAtlasNodeId(node.dimension, createHash('sha256').update(key).digest('hex').slice(0, 32), projectId);
    }
    upsertSupport(projectId, nodeId, frame, evidenceEventIds, now, payload = {}) {
        const supportId = createHash('sha256').update(`${nodeId}\0frame\0${frame.frameId}`).digest('hex');
        if (this.hasColumn('memory_atlas_supports', 'payload_json')) {
            this.db.prepare(`
        INSERT INTO memory_atlas_supports (support_id,project_id,node_id,source_type,source_id,source_episode_id,source_frame_id,evidence_event_ids_json,status,created_at,payload_json,confidence,source_authority)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(node_id,source_type,source_id) DO UPDATE SET evidence_event_ids_json=excluded.evidence_event_ids_json,payload_json=excluded.payload_json,confidence=excluded.confidence,source_authority=excluded.source_authority,status='active',invalidated_at=NULL
      `).run(supportId, projectId, nodeId, 'frame', frame.frameId, frame.episodeId, frame.frameId, JSON.stringify(evidenceEventIds), 'active', now, JSON.stringify(payload), Number(payload.confidence ?? frame.confidence), 'memory_frame_projector');
            return;
        }
        this.db.prepare(`
      INSERT INTO memory_atlas_supports (support_id,project_id,node_id,source_type,source_id,source_episode_id,source_frame_id,evidence_event_ids_json,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(node_id,source_type,source_id) DO UPDATE SET evidence_event_ids_json=excluded.evidence_event_ids_json,status='active',invalidated_at=NULL
    `).run(supportId, projectId, nodeId, 'frame', frame.frameId, frame.episodeId, frame.frameId, JSON.stringify(evidenceEventIds), 'active', now);
    }
    upsertAlias(projectId, nodeId, node, alias, frame, now) {
        const normalized = normalizeAlias(alias);
        if (!normalized)
            return;
        const aliasId = createHash('sha256').update(`${projectId}\0${nodeId}\0${normalized}`).digest('hex');
        this.db.prepare(`INSERT INTO memory_atlas_aliases(alias_id,project_id,node_id,normalized_alias,alias,dimension,status,confidence,source_frame_id,evidence_event_ids_json,created_at,updated_at) VALUES(?,?,?,?,? ,?,'active',?,?,?, ?,?) ON CONFLICT(project_id,normalized_alias,dimension,node_id) DO UPDATE SET status='active',confidence=MAX(memory_atlas_aliases.confidence,excluded.confidence),updated_at=excluded.updated_at`).run(aliasId, projectId, nodeId, normalized, alias, node.dimension, node.confidence, frame.frameId, JSON.stringify(node.evidenceEventIds), now, now);
        if (this.tableExists('memory_atlas_alias_supports')) {
            const supportId = createHash('sha256').update(`${aliasId}\0${frame.frameId}`).digest('hex');
            if (this.hasColumn('memory_atlas_alias_supports', 'payload_json')) {
                this.db.prepare(`INSERT INTO memory_atlas_alias_supports(support_id,alias_id,project_id,node_id,source_frame_id,source_episode_id,evidence_event_ids_json,status,created_at,payload_json,confidence,source_authority) VALUES(?,?,?,?,?,?,?,'active',?,?,?,?) ON CONFLICT(alias_id,source_frame_id) DO UPDATE SET status='active',invalidated_at=NULL,evidence_event_ids_json=excluded.evidence_event_ids_json,payload_json=excluded.payload_json,confidence=excluded.confidence,source_authority=excluded.source_authority`).run(supportId, aliasId, projectId, nodeId, frame.frameId, frame.episodeId, JSON.stringify(node.evidenceEventIds), now, JSON.stringify({ alias, normalized, dimension: node.dimension }), node.confidence, 'memory_frame_projector');
            }
            else {
                this.db.prepare(`INSERT INTO memory_atlas_alias_supports(support_id,alias_id,project_id,node_id,source_frame_id,source_episode_id,evidence_event_ids_json,status,created_at) VALUES(?,?,?,?,?,?,?,'active',?) ON CONFLICT(alias_id,source_frame_id) DO UPDATE SET status='active',invalidated_at=NULL,evidence_event_ids_json=excluded.evidence_event_ids_json`).run(supportId, aliasId, projectId, nodeId, frame.frameId, frame.episodeId, JSON.stringify(node.evidenceEventIds), now);
            }
        }
    }
    tableExists(name) { return Boolean(this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name)); }
    hasColumn(table, name) { return Boolean(this.db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name=?`).get(table, name)); }
    upsertEdge(projectId, source, target, relation, frame, now) {
        const parsedSource = toAtlasNodeEndpoint(source, projectId);
        const parsedTarget = toAtlasNodeEndpoint(target, projectId);
        if (!parsedSource || !parsedTarget)
            throw new Error(`invalid_atlas_edge_endpoint:${source}:${target}`);
        const edgeId = createHash('sha256').update(`${projectId}\0${source}\0${relation.relationType}\0${target}`).digest('hex');
        const existing = this.db.prepare(`SELECT source_authority,valid_from FROM memory_edges WHERE edge_id=?`).get(edgeId);
        const validFrom = relation.validFrom ?? this.evidenceTime(relation.evidenceEventIds, frame.processor.generatedAt);
        const shouldUpdate = !existing || (existing.source_authority === 'memory_frame_projector' && Number(existing.valid_from ?? Number.NEGATIVE_INFINITY) < validFrom);
        if (shouldUpdate)
            this.db.prepare(`
      INSERT INTO memory_edges (edge_id,project_id,source_type,source_id,relation_type,target_type,target_id,confidence,base_weight,stability,activation,evidence_event_ids_json,status,valid_from,valid_to,version,source_authority,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(edge_id) DO UPDATE SET confidence=excluded.confidence,evidence_event_ids_json=excluded.evidence_event_ids_json,status='active',valid_from=excluded.valid_from,valid_to=excluded.valid_to,updated_at=excluded.updated_at
    `).run(edgeId, projectId, parsedSource.type, parsedSource.id, relation.relationType, parsedTarget.type, parsedTarget.id, relation.confidence, 1, 0.85, 1, JSON.stringify(relation.evidenceEventIds), 'active', validFrom, relation.validTo ?? null, 1, 'memory_frame_projector', now, now);
        const supportId = createHash('sha256').update(`${edgeId}\0frame_edge\0${frame.frameId}`).digest('hex');
        if (this.hasColumn('memory_atlas_supports', 'payload_json')) {
            this.db.prepare(`
        INSERT INTO memory_atlas_supports (support_id,project_id,node_id,source_type,source_id,source_episode_id,source_frame_id,evidence_event_ids_json,status,created_at,payload_json,confidence,valid_from,valid_to,source_authority)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(node_id,source_type,source_id) DO UPDATE SET status='active', invalidated_at=NULL,evidence_event_ids_json=excluded.evidence_event_ids_json,payload_json=excluded.payload_json,confidence=excluded.confidence,valid_from=excluded.valid_from,valid_to=excluded.valid_to,source_authority=excluded.source_authority
      `).run(supportId, projectId, edgeId, 'frame_edge', frame.frameId, frame.episodeId, frame.frameId, JSON.stringify(relation.evidenceEventIds), 'active', now, JSON.stringify({ relationType: relation.relationType, confidence: relation.confidence, validFrom, validTo: relation.validTo ?? null, kind: 'edge' }), relation.confidence, validFrom, relation.validTo ?? null, 'memory_frame_projector');
            return;
        }
        this.db.prepare(`
      INSERT INTO memory_atlas_supports (support_id,project_id,node_id,source_type,source_id,source_episode_id,source_frame_id,evidence_event_ids_json,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(node_id,source_type,source_id) DO UPDATE SET status='active', invalidated_at=NULL, evidence_event_ids_json=excluded.evidence_event_ids_json
    `).run(supportId, projectId, edgeId, 'frame_edge', frame.frameId, frame.episodeId, frame.frameId, JSON.stringify(relation.evidenceEventIds), 'active', now);
    }
    evidenceTime(eventIds, fallback) {
        if (!eventIds.length)
            return fallback;
        const row = this.db.prepare(`SELECT MIN(occurred_at) AS occurred_at FROM memory_events WHERE event_id IN (${eventIds.map(() => '?').join(',')})`).get(...eventIds);
        return row?.occurred_at == null ? fallback : Number(row.occurred_at);
    }
    latestEvidenceTime(eventIds, fallback) {
        if (!eventIds.length)
            return fallback;
        const row = this.db.prepare(`SELECT MAX(occurred_at) AS occurred_at FROM memory_events WHERE event_id IN (${eventIds.map(() => '?').join(',')})`).get(...eventIds);
        return row?.occurred_at == null ? fallback : Number(row.occurred_at);
    }
    evidenceLocalDate(eventIds) {
        if (!eventIds.length)
            return undefined;
        const row = this.db.prepare(`SELECT local_date FROM memory_events WHERE event_id IN (${eventIds.map(() => '?').join(',')}) AND local_date IS NOT NULL ORDER BY occurred_at LIMIT 1`).get(...eventIds);
        return row?.local_date || undefined;
    }
    frameEvidenceTime(frame) {
        if (!frame.evidenceEventIds.length)
            return frame.processor.generatedAt;
        const placeholders = frame.evidenceEventIds.map(() => '?').join(',');
        const row = this.db.prepare(`SELECT MAX(COALESCE(occurred_at, 0)) AS occurred_at FROM memory_events WHERE event_id IN (${placeholders})`).get(...frame.evidenceEventIds);
        return row?.occurred_at == null ? frame.processor.generatedAt : Number(row.occurred_at);
    }
}
function canonicalStateKey(value) {
    const normalized = value.normalize('NFKC').toLocaleLowerCase('und').trim().replace(/[\s-]+/gu, '_');
    if (/^(completed?|done|resolved|完了|已完成|完成)$/u.test(normalized))
        return 'task.completed';
    if (/^(in_progress|progress|working|进行中|处理中|進行中)$/u.test(normalized))
        return 'task.in_progress';
    if (/^(blocked|stuck|阻塞|卡住|ブロック)$/u.test(normalized))
        return 'task.blocked';
    if (/^(planned|planning|计划|规划|計画)$/u.test(normalized))
        return 'task.planned';
    return `state.${normalized}`;
}
