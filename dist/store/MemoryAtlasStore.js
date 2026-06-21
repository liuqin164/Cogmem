import { createHash, randomUUID } from 'node:crypto';
export class MemoryAtlasStore {
    db;
    constructor(db) {
        this.db = db;
    }
    upsertDocument(input) {
        this.db.prepare(`
      INSERT INTO memory_atlas_documents (
        node_id, project_id, node_type, source_id, label, summary, topic_path, confidence,
        support_count, status, occurred_at, evidence_event_ids_json, metadata_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET project_id=excluded.project_id, node_type=excluded.node_type,
        source_id=excluded.source_id, label=excluded.label, summary=excluded.summary,
        topic_path=excluded.topic_path, confidence=excluded.confidence, support_count=excluded.support_count,
        status=excluded.status, occurred_at=excluded.occurred_at,
        evidence_event_ids_json=excluded.evidence_event_ids_json, metadata_json=excluded.metadata_json,
        updated_at=excluded.updated_at
    `).run(input.id, input.projectId, input.nodeType, input.sourceId, input.label, input.summary || null, input.topicPath || null, input.confidence, input.supportCount, input.status, input.occurredAt ?? null, JSON.stringify(input.evidenceEventIds || []), JSON.stringify(input.metadata || {}), input.updatedAt ?? Date.now());
        this.refreshFtsNode(input.id);
    }
    getNode(nodeId, projectId) {
        const row = this.db.prepare(`
      SELECT d.*, COALESCE(a.activation, 0) AS activation
      FROM memory_atlas_documents d LEFT JOIN memory_atlas_activation a
        ON a.project_id=d.project_id AND a.node_id=d.node_id
      WHERE d.node_id=? AND d.project_id=?
    `).get(nodeId, projectId);
        return row ? mapNode(row, 0) : null;
    }
    listNodes(projectId, limit) {
        const rows = this.db.prepare(`
      SELECT d.*, COALESCE(a.activation, 0) AS activation
      FROM memory_atlas_documents d LEFT JOIN memory_atlas_activation a
        ON a.project_id=d.project_id AND a.node_id=d.node_id
      WHERE d.project_id=? AND d.status NOT IN ('rejected','archived')
      ORDER BY COALESCE(a.activation,0) DESC, d.support_count DESC, d.updated_at DESC LIMIT ?
    `).all(projectId, limit);
        return rows.map((row) => mapNode(row, Number(row.activation || 0)));
    }
    search(query, projectId, limit) {
        return this.searchFaceted(query, projectId, limit, {});
    }
    searchFaceted(query, projectId, limit, facets) {
        const tokens = (query.match(/[\p{L}\p{N}_-]+/gu) || []).filter((item) => item.length > 1).slice(0, 12);
        if (!tokens.length)
            return this.listNodes(projectId, limit);
        const clauses = tokens.map(() => `(d.label LIKE ? ESCAPE '\\' OR COALESCE(d.summary,'') LIKE ? ESCAPE '\\' OR COALESCE(d.topic_path,'') LIKE ? ESCAPE '\\')`);
        const likeParams = tokens.flatMap((token) => [`%${escapeLike(token)}%`, `%${escapeLike(token)}%`, `%${escapeLike(token)}%`]);
        const filters = [];
        const facetParams = [];
        if (facets.from !== undefined) {
            filters.push('d.occurred_at>=?');
            facetParams.push(facets.from);
        }
        if (facets.to !== undefined) {
            filters.push('d.occurred_at<?');
            facetParams.push(facets.to);
        }
        if (facets.memoryKinds?.length) {
            filters.push(`(${facets.memoryKinds.map(() => `(d.node_type=? OR d.metadata_json LIKE ? OR d.label LIKE ? OR COALESCE(d.summary,'') LIKE ?)`).join(' OR ')})`);
            for (const kind of facets.memoryKinds)
                facetParams.push(kind, `%${escapeLike(kind)}%`, `%${escapeLike(kind)}%`, `%${escapeLike(kind)}%`);
        }
        const filterSql = filters.length ? `AND ${filters.join(' AND ')}` : '';
        const ftsQuery = tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' OR ');
        let rows = this.db.prepare(`
      SELECT d.*, COALESCE(a.activation, 0) AS activation
      FROM memory_atlas_fts f
      JOIN memory_atlas_documents d ON d.node_id=f.node_id
      LEFT JOIN memory_atlas_activation a ON a.project_id=d.project_id AND a.node_id=d.node_id
      WHERE memory_atlas_fts MATCH ? AND d.project_id=? ${filterSql} AND d.status NOT IN ('rejected','archived')
      ORDER BY COALESCE(a.activation,0) DESC, d.support_count DESC, d.updated_at DESC LIMIT ?
    `).all(ftsQuery, projectId, ...facetParams, limit);
        if (!rows.length)
            rows = this.db.prepare(`
      SELECT d.*, COALESCE(a.activation, 0) AS activation
      FROM memory_atlas_documents d LEFT JOIN memory_atlas_activation a
        ON a.project_id=d.project_id AND a.node_id=d.node_id
      WHERE d.project_id=? AND (${clauses.join(' OR ')}) ${filterSql} AND d.status NOT IN ('rejected','archived')
      ORDER BY COALESCE(a.activation,0) DESC, d.support_count DESC, d.updated_at DESC LIMIT ?
    `).all(projectId, ...likeParams, ...facetParams, limit);
        return rows.map((row) => {
            const haystack = `${row.label} ${row.summary || ''} ${row.topic_path || ''}`.toLowerCase();
            const matches = tokens.filter((token) => haystack.includes(token.toLowerCase())).length;
            return mapNode(row, matches + Number(row.activation || 0));
        }).sort((a, b) => b.score - a.score);
    }
    evidenceIds(nodeId, projectId, limit) {
        const node = this.db.prepare(`SELECT node_type, source_id, topic_path, evidence_event_ids_json FROM memory_atlas_documents WHERE node_id=? AND project_id=?`).get(nodeId, projectId);
        if (!node)
            return [];
        const ids = parseStringArray(node.evidence_event_ids_json);
        if (node.node_type === 'entity') {
            const rows = this.db.prepare(`SELECT event_id FROM memory_bindings WHERE project_id=? AND entity_id=? ORDER BY created_at DESC LIMIT ?`).all(projectId, node.source_id, limit);
            ids.push(...rows.map((row) => row.event_id));
        }
        else if (node.node_type === 'topic') {
            const rows = this.db.prepare(`SELECT event_id FROM memory_bindings WHERE project_id=? AND topic_path=? ORDER BY created_at DESC LIMIT ?`).all(projectId, node.topic_path || node.source_id, limit);
            ids.push(...rows.map((row) => row.event_id));
        }
        else if (node.node_type === 'action') {
            const rows = this.db.prepare(`SELECT event_id FROM memory_action_frame_evidence WHERE project_id=? AND action_id=? ORDER BY created_at DESC LIMIT ?`).all(projectId, node.source_id, limit);
            ids.push(...rows.map((row) => row.event_id));
        }
        else if (node.node_type === 'episode') {
            const rows = this.db.prepare(`SELECT event_id FROM memory_episode_events WHERE episode_id=? ORDER BY position LIMIT ?`).all(node.source_id, limit);
            ids.push(...rows.map((row) => row.event_id));
        }
        return Array.from(new Set(ids.filter(Boolean))).slice(0, limit);
    }
    listEdges(projectId) {
        const edges = [];
        const rows = this.db.prepare(`SELECT * FROM memory_edges WHERE project_id=? AND status IN ('active','weak') ORDER BY confidence DESC LIMIT 2000`).all(projectId);
        for (const row of rows)
            edges.push({
                source: nodeId(String(row.source_type), String(row.source_id), projectId), relation: String(row.relation_type),
                target: nodeId(String(row.target_type), String(row.target_id), projectId), confidence: Number(row.confidence),
                evidenceEventIds: parseStringArray(String(row.evidence_event_ids_json || '[]')),
            });
        const actions = this.db.prepare(`SELECT action_id,target_entity_id,occurred_at,confidence FROM memory_action_frames WHERE project_id=?`).all(projectId);
        for (const action of actions) {
            if (action.target_entity_id)
                edges.push({ source: `action:${action.action_id}`, relation: 'TARGETS', target: `entity:${action.target_entity_id}`, confidence: action.confidence, evidenceEventIds: this.actionEvidenceIds(action.action_id, projectId) });
            edges.push({ source: `action:${action.action_id}`, relation: 'OCCURRED_IN', target: timeNodeId(projectId, action.occurred_at), confidence: 1, evidenceEventIds: this.actionEvidenceIds(action.action_id, projectId) });
        }
        edges.push(...this.topicRelationEdges(projectId));
        return edges;
    }
    listEdgesForNodes(projectId, nodeIds, limit = 2000) {
        const boundedIds = Array.from(new Set(nodeIds)).slice(0, 30);
        if (!boundedIds.length)
            return [];
        const parsed = boundedIds.map((id) => parseNodeId(id, projectId)).filter((item) => Boolean(item));
        const edges = [];
        if (parsed.length) {
            const clauses = parsed.map(() => `((source_type=? AND source_id=?) OR (target_type=? AND target_id=?))`);
            const params = parsed.flatMap((item) => [item.type, item.id, item.type, item.id]);
            const rows = this.db.prepare(`
        SELECT * FROM memory_edges
        WHERE project_id=? AND status IN ('active','weak') AND (${clauses.join(' OR ')})
        ORDER BY confidence DESC LIMIT ?
      `).all(projectId, ...params, Math.max(1, Math.min(limit, 4000)));
            for (const row of rows)
                edges.push({
                    source: nodeId(String(row.source_type), String(row.source_id), projectId), relation: String(row.relation_type),
                    target: nodeId(String(row.target_type), String(row.target_id), projectId), confidence: Number(row.confidence),
                    evidenceEventIds: parseStringArray(String(row.evidence_event_ids_json || '[]')),
                });
        }
        const actionIds = parsed.filter((item) => item.type === 'action').map((item) => item.id);
        const entityIds = parsed.filter((item) => item.type === 'entity').map((item) => item.id);
        const years = parsed.filter((item) => item.type === 'time' && /^\d{4}$/u.test(item.id)).map((item) => Number(item.id));
        const actionClauses = [];
        const actionParams = [projectId];
        if (actionIds.length) {
            actionClauses.push(`action_id IN (${actionIds.map(() => '?').join(',')})`);
            actionParams.push(...actionIds);
        }
        if (entityIds.length) {
            actionClauses.push(`target_entity_id IN (${entityIds.map(() => '?').join(',')})`);
            actionParams.push(...entityIds);
        }
        for (const year of years) {
            actionClauses.push('(occurred_at>=? AND occurred_at<?)');
            actionParams.push(Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1));
        }
        if (actionClauses.length) {
            const actions = this.db.prepare(`SELECT action_id,target_entity_id,occurred_at,confidence FROM memory_action_frames WHERE project_id=? AND (${actionClauses.join(' OR ')}) ORDER BY occurred_at DESC LIMIT ?`).all(...actionParams, Math.max(1, Math.min(limit, 2000)));
            for (const action of actions) {
                const evidenceEventIds = this.actionEvidenceIds(action.action_id, projectId);
                if (action.target_entity_id)
                    edges.push({ source: `action:${action.action_id}`, relation: 'TARGETS', target: `entity:${action.target_entity_id}`, confidence: action.confidence, evidenceEventIds });
                edges.push({ source: `action:${action.action_id}`, relation: 'OCCURRED_IN', target: timeNodeId(projectId, action.occurred_at), confidence: 1, evidenceEventIds });
            }
        }
        const topicPaths = parsed.filter((item) => item.type === 'topic').map((item) => item.id);
        if (topicPaths.length)
            edges.push(...this.topicRelationEdges(projectId, topicPaths, Math.max(1, Math.min(limit, 2000))));
        return Array.from(new Map(edges.map((edge) => [`${edge.source}\0${edge.relation}\0${edge.target}`, edge])).values()).slice(0, Math.max(1, Math.min(limit, 4000)));
    }
    findEdgesBetween(projectId, leftNodeId, rightNodeId) {
        const left = parseNodeId(leftNodeId, projectId);
        const right = parseNodeId(rightNodeId, projectId);
        if (!left || !right)
            return [];
        const rows = this.db.prepare(`
      SELECT * FROM memory_edges WHERE project_id=? AND status IN ('active','weak') AND (
        (source_type=? AND source_id=? AND target_type=? AND target_id=?) OR
        (source_type=? AND source_id=? AND target_type=? AND target_id=?)
      ) ORDER BY confidence DESC LIMIT 20
    `).all(projectId, left.type, left.id, right.type, right.id, right.type, right.id, left.type, left.id);
        const edges = rows.map((row) => ({
            source: nodeId(String(row.source_type), String(row.source_id), projectId), relation: String(row.relation_type),
            target: nodeId(String(row.target_type), String(row.target_id), projectId), confidence: Number(row.confidence),
            evidenceEventIds: parseStringArray(String(row.evidence_event_ids_json || '[]')),
        }));
        const action = left.type === 'action' ? left : right.type === 'action' ? right : undefined;
        if (action) {
            const row = this.db.prepare(`SELECT action_id,target_entity_id,occurred_at,confidence FROM memory_action_frames WHERE project_id=? AND action_id=?`).get(projectId, action.id);
            if (row) {
                const evidenceEventIds = this.actionEvidenceIds(row.action_id, projectId);
                const candidates = [];
                if (row.target_entity_id)
                    candidates.push({ source: `action:${row.action_id}`, relation: 'TARGETS', target: `entity:${row.target_entity_id}`, confidence: row.confidence, evidenceEventIds });
                candidates.push({ source: `action:${row.action_id}`, relation: 'OCCURRED_IN', target: timeNodeId(projectId, row.occurred_at), confidence: 1, evidenceEventIds });
                edges.push(...candidates.filter((edge) => (edge.source === leftNodeId && edge.target === rightNodeId) || (edge.source === rightNodeId && edge.target === leftNodeId)));
            }
        }
        if (left.type === 'topic' && right.type === 'topic') {
            edges.push(...this.topicRelationEdges(projectId, [left.id, right.id], 20).filter((edge) => (edge.source === leftNodeId && edge.target === rightNodeId) || (edge.source === rightNodeId && edge.target === leftNodeId)));
        }
        return edges;
    }
    findEdgesFromNodesToTarget(projectId, leftNodeIds, rightNodeId) {
        const right = parseNodeId(rightNodeId, projectId);
        const left = Array.from(new Set(leftNodeIds)).slice(0, 30)
            .map((id) => parseNodeId(id, projectId)).filter((item) => Boolean(item));
        if (!right || !left.length)
            return [];
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
    `).all(projectId, ...params);
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
        WHERE project_id=? AND action_id IN (${actionIds.map(() => '?').join(',')})`).all(projectId, ...actionIds);
            const endpointPairs = new Set(leftNodeIds.flatMap((id) => [`${id}\0${rightNodeId}`, `${rightNodeId}\0${id}`]));
            for (const action of actions) {
                const evidenceEventIds = this.actionEvidenceIds(action.action_id, projectId);
                const candidates = [];
                if (action.target_entity_id)
                    candidates.push({ source: `action:${action.action_id}`, relation: 'TARGETS', target: `entity:${action.target_entity_id}`, confidence: action.confidence, evidenceEventIds });
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
    listActions(projectId, options) {
        const clauses = ['project_id=?'];
        const params = [projectId];
        if (options.target) {
            clauses.push(`target_label LIKE ? ESCAPE '\\'`);
            params.push(`%${escapeLike(options.target)}%`);
        }
        if (options.from !== undefined) {
            clauses.push('occurred_at>=?');
            params.push(options.from);
        }
        if (options.to !== undefined) {
            clauses.push('occurred_at<?');
            params.push(options.to);
        }
        const rows = this.db.prepare(`SELECT * FROM memory_action_frames WHERE ${clauses.join(' AND ')} ORDER BY occurred_at DESC LIMIT ?`).all(...params, options.limit);
        return rows.map((row) => ({
            id: `action:${row.action_id}`, frameType: String(row.frame_type), action: String(row.action),
            targetLabel: row.target_label ? String(row.target_label) : undefined, topicPath: row.topic_path ? String(row.topic_path) : undefined,
            episodeId: row.episode_id ? String(row.episode_id) : undefined, occurredAt: Number(row.occurred_at), confidence: Number(row.confidence), evidence: [],
        }));
    }
    actionEvidenceIds(actionId, projectId) {
        return this.db.prepare(`SELECT event_id FROM memory_action_frame_evidence WHERE action_id=? AND project_id=? ORDER BY created_at`).all(actionId, projectId).map((row) => row.event_id);
    }
    recordAccess(projectId, nodeIds, kind, query) {
        const now = Date.now();
        const hash = query ? createHash('sha256').update(query).digest('hex') : null;
        const access = this.db.prepare(`INSERT INTO memory_atlas_access(access_id,project_id,node_id,access_kind,query_hash,accessed_at) VALUES(?,?,?,?,?,?)`);
        const activate = this.db.prepare(`INSERT INTO memory_atlas_activation(project_id,node_id,activation,usage_count,last_accessed_at,updated_at) VALUES(?,?,1,1,?,?) ON CONFLICT(project_id,node_id) DO UPDATE SET activation=MIN(10,memory_atlas_activation.activation+1), usage_count=memory_atlas_activation.usage_count+1,last_accessed_at=excluded.last_accessed_at,updated_at=excluded.updated_at`);
        for (const id of nodeIds.slice(0, 30)) {
            access.run(randomUUID(), projectId, id, kind, hash, now);
            activate.run(projectId, id, now, now);
        }
    }
    decay(projectId, factor = 0.85, now = Date.now()) {
        const result = projectId
            ? this.db.prepare(`UPDATE memory_atlas_activation SET activation=MAX(0,activation*?),updated_at=? WHERE project_id=?`).run(factor, now, projectId)
            : this.db.prepare(`UPDATE memory_atlas_activation SET activation=MAX(0,activation*?),updated_at=?`).run(factor, now);
        return Number(result.changes || 0);
    }
    projectionNeedsRefresh(projectId) {
        const row = this.db.prepare(`
      SELECT status FROM memory_atlas_projection_state
      WHERE project_id=? AND projection_name='memory_atlas.v1'
    `).get(projectId);
        return !row || row.status !== 'clean';
    }
    markProjectionClean(projectId, metadata = {}, now = Date.now()) {
        this.db.prepare(`
      INSERT INTO memory_atlas_projection_state(
        project_id, projection_name, cursor_value, status, last_rebuild_at, last_error, metadata_json
      ) VALUES(?, 'memory_atlas.v1', ?, 'clean', ?, NULL, ?)
      ON CONFLICT(project_id, projection_name) DO UPDATE SET
        cursor_value=excluded.cursor_value, status='clean', last_rebuild_at=excluded.last_rebuild_at,
        last_error=NULL, metadata_json=excluded.metadata_json
    `).run(projectId, String(now), now, JSON.stringify(metadata));
    }
    countDocuments(projectId) {
        const row = projectId
            ? this.db.prepare(`SELECT COUNT(*) AS count FROM memory_atlas_documents WHERE project_id=?`).get(projectId)
            : this.db.prepare(`SELECT COUNT(*) AS count FROM memory_atlas_documents`).get();
        return Number(row?.count || 0);
    }
    refreshFtsNode(nodeIdValue) {
        this.db.prepare(`DELETE FROM memory_atlas_fts WHERE node_id=?`).run(nodeIdValue);
        this.db.prepare(`INSERT INTO memory_atlas_fts(node_id,project_id,node_type,label,summary,topic_path) SELECT node_id,project_id,node_type,label,COALESCE(summary,''),COALESCE(topic_path,'') FROM memory_atlas_documents WHERE node_id=?`).run(nodeIdValue);
    }
    topicRelationEdges(projectId, topicPaths = [], limit = 2000) {
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
    `).all(projectId, ...paths, ...paths, Math.max(1, Math.min(limit, 2000)));
        return rows.map((row) => ({ source: nodeId('topic', row.source_path, projectId), relation: row.relation,
            target: nodeId('topic', row.target_path, projectId), confidence: Number(row.confidence),
            evidenceEventIds: parseStringArray(row.evidence_event_ids_json) }));
    }
}
function mapNode(row, score) {
    return { id: row.node_id, projectId: row.project_id, nodeType: row.node_type, sourceId: row.source_id,
        label: row.label, summary: row.summary || undefined, topicPath: row.topic_path || undefined,
        confidence: Number(row.confidence), supportCount: Number(row.support_count), status: row.status,
        occurredAt: row.occurred_at ?? undefined, activation: Number(row.activation || 0), score,
        evidenceCount: parseStringArray(row.evidence_event_ids_json).length };
}
function parseStringArray(value) { try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
}
catch {
    return [];
} }
function escapeLike(value) { return value.replace(/[\\%_]/g, '\\$&'); }
function nodeId(type, id, projectId) {
    if (type === 'topic' || type === 'time')
        return `${type}:${projectId}:${id}`;
    return `${type}:${id}`;
}
function timeNodeId(projectId, occurredAt) {
    return `time:${projectId}:${new Date(occurredAt).getUTCFullYear()}`;
}
function parseNodeId(value, projectId) {
    const topicPrefix = `topic:${projectId}:`;
    if (value.startsWith(topicPrefix))
        return { type: 'topic', id: value.slice(topicPrefix.length) };
    const timePrefix = `time:${projectId}:`;
    if (value.startsWith(timePrefix))
        return { type: 'time', id: value.slice(timePrefix.length) };
    const separator = value.indexOf(':');
    if (separator <= 0 || separator === value.length - 1)
        return null;
    return { type: value.slice(0, separator), id: value.slice(separator + 1) };
}
