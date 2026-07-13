import { createHash } from 'node:crypto';
import { normalizeAlias } from '../semantic/CanonicalMemoryResolver.js';
export class MemoryFrameProjector {
    db;
    frameStore;
    atlasStore;
    constructor(db, frameStore, atlasStore) {
        this.db = db;
        this.frameStore = frameStore;
        this.atlasStore = atlasStore;
    }
    rebuild(projectId, now = Date.now()) {
        const frames = [];
        for (let offset = 0;; offset += 500) {
            const page = this.frameStore.list(projectId, { statuses: ['active'], limit: 500, offset });
            frames.push(...page);
            if (page.length < 500)
                break;
        }
        let nodes = 0;
        let edges = 0;
        let needsReview = 0;
        this.db.prepare(`DELETE FROM memory_edges WHERE project_id=? AND source_authority='memory_frame_projector'`).run(projectId);
        this.db.prepare(`DELETE FROM memory_atlas_fts WHERE project_id=? AND node_id IN (SELECT node_id FROM memory_atlas_documents WHERE project_id=? AND json_extract(metadata_json, '$.projection')='memory_atlas.frame.v2')`).run(projectId, projectId);
        this.db.prepare(`DELETE FROM memory_atlas_documents WHERE project_id=? AND json_extract(metadata_json, '$.projection')='memory_atlas.frame.v2'`).run(projectId);
        this.db.prepare(`UPDATE memory_atlas_supports SET status='invalidated', invalidated_at=? WHERE project_id=? AND source_type IN ('frame','frame_edge') AND status='active'`).run(now, projectId);
        this.db.prepare(`UPDATE memory_atlas_aliases SET status='invalidated', updated_at=? WHERE project_id=? AND source_frame_id IS NOT NULL AND status='active'`).run(now, projectId);
        for (const frame of frames) {
            if (frame.needsReview)
                needsReview += 1;
            const nodeIds = new Map(frame.nodes.map((node) => [node.frameNodeId, this.nodeId(projectId, node, frame)]));
            for (const node of frame.nodes) {
                const id = nodeIds.get(node.frameNodeId);
                const existing = this.atlasStore.getNodeIncludingInactive(id, projectId);
                if (!existing) {
                    this.atlasStore.upsertDocument({
                        id, projectId, nodeType: node.dimension === 'episode' ? 'episode' : node.dimension,
                        sourceId: id.slice(id.indexOf(':') + 1), label: node.label, summary: node.description,
                        confidence: node.confidence, supportCount: 1, status: 'active',
                        evidenceEventIds: node.evidenceEventIds, metadata: { projection: 'memory_atlas.frame.v2', frameId: frame.frameId, frameSchemaVersion: frame.schemaVersion }, updatedAt: now,
                    });
                }
                nodes += 1;
                this.upsertSupport(projectId, id, frame, node.evidenceEventIds, now);
                for (const alias of [node.label, ...(node.aliases ?? [])])
                    this.upsertAlias(projectId, id, node, alias, frame, now);
            }
            for (const relation of frame.relations) {
                const source = nodeIds.get(relation.sourceFrameNodeId);
                const target = nodeIds.get(relation.targetFrameNodeId);
                if (!source || !target)
                    continue;
                this.upsertEdge(projectId, source, target, relation, frame, now);
                edges += 1;
            }
            for (const reference of frame.temporalReferences) {
                const timeId = `time:${createHash('sha256').update(`${projectId}\0${reference.label}\0${reference.occurredAt ?? 'unknown'}\0${reference.evidenceEventIds[0] ?? ''}`).digest('hex').slice(0, 32)}`;
                if (!this.atlasStore.getNodeIncludingInactive(timeId, projectId))
                    this.atlasStore.upsertDocument({ id: timeId, projectId, nodeType: 'time', sourceId: timeId.slice(5), label: reference.label,
                        confidence: reference.confidence, supportCount: 1, status: 'active', occurredAt: reference.occurredAt,
                        evidenceEventIds: reference.evidenceEventIds, metadata: { projection: 'memory_atlas.frame.v2', frameId: frame.frameId }, updatedAt: now });
                this.upsertSupport(projectId, timeId, frame, reference.evidenceEventIds, now);
                const timeSource = reference.evidenceEventIds[0] ? `raw_event:${reference.evidenceEventIds[0]}` : `episode:${frame.episodeId}`;
                this.upsertEdge(projectId, timeSource, timeId, { sourceFrameNodeId: timeSource, relationType: 'OCCURRED_ON', targetFrameNodeId: timeId, confidence: reference.confidence, evidenceEventIds: reference.evidenceEventIds }, frame, now);
                nodes += 1;
            }
            for (const transition of frame.stateTransitions) {
                const subject = nodeIds.get(transition.subjectFrameNodeId);
                if (!subject)
                    continue;
                const stateId = `state:${createHash('sha256').update(`${projectId}\0${transition.to}`).digest('hex').slice(0, 32)}`;
                if (!this.atlasStore.getNodeIncludingInactive(stateId, projectId))
                    this.atlasStore.upsertDocument({ id: stateId, projectId, nodeType: 'state', sourceId: stateId.slice(6), label: transition.to,
                        confidence: transition.confidence, supportCount: 1, status: 'active', evidenceEventIds: transition.evidenceEventIds,
                        metadata: { projection: 'memory_atlas.frame.v2', frameId: frame.frameId }, updatedAt: now });
                this.upsertSupport(projectId, stateId, frame, transition.evidenceEventIds, now);
                this.upsertEdge(projectId, subject, stateId, { sourceFrameNodeId: transition.subjectFrameNodeId, relationType: 'HAS_STATE', targetFrameNodeId: stateId,
                    confidence: transition.confidence, evidenceEventIds: transition.evidenceEventIds }, frame, now);
                if (transition.from) {
                    const fromId = `state:${createHash('sha256').update(`${projectId}\0${transition.from}`).digest('hex').slice(0, 32)}`;
                    if (!this.atlasStore.getNodeIncludingInactive(fromId, projectId))
                        this.atlasStore.upsertDocument({ id: fromId, projectId, nodeType: 'state', sourceId: fromId.slice(6), label: transition.from, confidence: transition.confidence, supportCount: 1, status: 'active', evidenceEventIds: transition.evidenceEventIds, metadata: { projection: 'memory_atlas.frame.v2', frameId: frame.frameId }, updatedAt: now });
                    this.upsertEdge(projectId, subject, fromId, { sourceFrameNodeId: transition.subjectFrameNodeId, relationType: 'CHANGED_FROM', targetFrameNodeId: fromId, confidence: transition.confidence, evidenceEventIds: transition.evidenceEventIds }, frame, now);
                }
                this.upsertEdge(projectId, subject, stateId, { sourceFrameNodeId: transition.subjectFrameNodeId, relationType: 'CHANGED_TO', targetFrameNodeId: stateId, confidence: transition.confidence, evidenceEventIds: transition.evidenceEventIds }, frame, now);
                edges += 1;
            }
        }
        this.db.prepare(`UPDATE memory_atlas_documents SET support_count=(SELECT COUNT(*) FROM memory_atlas_supports s WHERE s.project_id=memory_atlas_documents.project_id AND s.node_id=memory_atlas_documents.node_id AND s.source_type='frame' AND s.status='active') WHERE project_id=? AND EXISTS (SELECT 1 FROM memory_atlas_supports s WHERE s.project_id=memory_atlas_documents.project_id AND s.node_id=memory_atlas_documents.node_id AND s.source_type='frame')`).run(projectId);
        return { frames: frames.length, nodes, edges, needsReview };
    }
    nodeId(projectId, node, frame) {
        if (node.canonicalHint?.nodeId) {
            const candidate = node.canonicalHint.nodeId;
            const existing = this.atlasStore.getNode(candidate, projectId);
            if (existing && existing.projectId === projectId && existing.nodeType === node.dimension)
                return candidate;
        }
        if (node.dimension === 'episode')
            return `episode:${frame.episodeId}`;
        if (node.dimension === 'project')
            return `project:${frame.projectId}`;
        if (node.dimension === 'raw_event') {
            if (node.evidenceEventIds.length !== 1)
                throw new Error(`raw_event_identity_requires_one_evidence:${node.frameNodeId}`);
            return `raw_event:${node.evidenceEventIds[0]}`;
        }
        const key = `${projectId}\0${node.dimension}\0${node.label.normalize('NFKC').toLocaleLowerCase('und').trim()}`;
        return `${node.dimension}:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
    }
    upsertSupport(projectId, nodeId, frame, evidenceEventIds, now) {
        const supportId = createHash('sha256').update(`${nodeId}\0frame\0${frame.frameId}`).digest('hex');
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
        this.db.prepare(`INSERT INTO memory_atlas_aliases(alias_id,project_id,node_id,normalized_alias,alias,dimension,status,confidence,source_frame_id,evidence_event_ids_json,created_at,updated_at) VALUES(?,?,?,?,? ,?,'active',?,?,?, ?,?) ON CONFLICT(project_id,normalized_alias,dimension,node_id) DO UPDATE SET status='active',confidence=excluded.confidence,source_frame_id=excluded.source_frame_id,evidence_event_ids_json=excluded.evidence_event_ids_json,updated_at=excluded.updated_at`).run(aliasId, projectId, nodeId, normalized, alias, node.dimension, node.confidence, frame.frameId, JSON.stringify(node.evidenceEventIds), now, now);
    }
    upsertEdge(projectId, source, target, relation, frame, now) {
        const parsedSource = splitNodeId(source);
        const parsedTarget = splitNodeId(target);
        const edgeId = createHash('sha256').update(`${projectId}\0${source}\0${relation.relationType}\0${target}`).digest('hex');
        this.db.prepare(`
      INSERT INTO memory_edges (edge_id,project_id,source_type,source_id,relation_type,target_type,target_id,confidence,base_weight,stability,activation,evidence_event_ids_json,status,valid_from,valid_to,version,source_authority,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(edge_id) DO UPDATE SET confidence=excluded.confidence,evidence_event_ids_json=excluded.evidence_event_ids_json,status='active',updated_at=excluded.updated_at
    `).run(edgeId, projectId, parsedSource.type, parsedSource.id, relation.relationType, parsedTarget.type, parsedTarget.id, relation.confidence, 1, 0.85, 1, JSON.stringify(relation.evidenceEventIds), 'active', relation.validFrom ?? this.evidenceTime(relation.evidenceEventIds, frame.processor.generatedAt), relation.validTo ?? null, 1, 'memory_frame_projector', now, now);
        const supportId = createHash('sha256').update(`${edgeId}\0frame_edge\0${frame.frameId}`).digest('hex');
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
}
function splitNodeId(value) {
    const index = value.indexOf(':');
    return index < 0 ? { type: 'semantic', id: value } : { type: value.slice(0, index), id: value.slice(index + 1) };
}
