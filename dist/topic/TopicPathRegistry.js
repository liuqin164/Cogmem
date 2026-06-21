import { randomUUID } from 'node:crypto';
import { isMemoryOntologyClass } from '../ontology/MemoryOntology.js';
export class TopicPathRegistry {
    db;
    constructor(db) {
        this.db = db;
    }
    create(input) {
        const now = input.now ?? Date.now();
        const topicPath = normalizeTopicPath(input.topicPath);
        const ontologyClass = input.ontologyClass ?? 'Topic';
        if (!input.projectId.trim())
            throw new Error('topic_project_required');
        if (!input.canonicalName.trim())
            throw new Error('topic_name_required');
        if (!isMemoryOntologyClass(ontologyClass))
            throw new Error(`invalid_ontology_class:${ontologyClass}`);
        if (input.parentTopicId)
            this.assertProject(input.parentTopicId, input.projectId);
        const topicId = `topic-${randomUUID()}`;
        this.db.prepare(`
      INSERT INTO topic_nodes (
        topic_id, project_id, topic_path, canonical_name, parent_topic_id, ontology_class, status,
        created_by, confidence, evidence_event_ids_json, evidence_episode_ids_json, last_used_at,
        merge_candidates_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
    `).run(topicId, input.projectId, topicPath, input.canonicalName.trim(), input.parentTopicId || null, ontologyClass, input.status ?? (input.createdBy === 'model_candidate' ? 'candidate' : 'active'), input.createdBy, clamp(input.confidence ?? (input.createdBy === 'user_explicit' ? 1 : 0.6)), JSON.stringify(input.evidenceEventIds || []), JSON.stringify(input.evidenceEpisodeIds || []), now, now, now);
        return this.get(topicId);
    }
    get(topicId) {
        const row = this.db.prepare(`SELECT * FROM topic_nodes WHERE topic_id = ?`).get(topicId);
        return row ? mapTopic(row, this.listAliases(row.project_id, row.topic_id)) : undefined;
    }
    getByPath(projectId, topicPath) {
        const row = this.db.prepare(`SELECT * FROM topic_nodes WHERE project_id = ? AND topic_path = ?`)
            .get(projectId, normalizeTopicPath(topicPath));
        return row ? mapTopic(row, this.listAliases(row.project_id, row.topic_id)) : undefined;
    }
    list(projectId, statuses) {
        const rows = statuses?.length
            ? this.db.prepare(`SELECT * FROM topic_nodes WHERE project_id = ? AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY topic_path`)
                .all(projectId, ...statuses)
            : this.db.prepare(`SELECT * FROM topic_nodes WHERE project_id = ? ORDER BY topic_path`).all(projectId);
        return rows.map((row) => mapTopic(row, this.listAliases(projectId, row.topic_id)));
    }
    update(topicId, projectId, patch) {
        const current = this.assertProject(topicId, projectId);
        if (patch.parentTopicId)
            this.assertProject(patch.parentTopicId, projectId);
        const next = {
            canonicalName: patch.canonicalName?.trim() || current.canonicalName,
            topicPath: patch.topicPath ? normalizeTopicPath(patch.topicPath) : current.topicPath,
            parentTopicId: patch.parentTopicId === undefined ? current.parentTopicId : patch.parentTopicId || undefined,
            status: patch.status || current.status,
            mergeCandidates: patch.mergeCandidates ?? current.mergeCandidates ?? [],
        };
        this.db.prepare(`
      UPDATE topic_nodes SET canonical_name = ?, topic_path = ?, parent_topic_id = ?, status = ?,
        merge_candidates_json = ?, updated_at = ? WHERE topic_id = ? AND project_id = ?
    `).run(next.canonicalName, next.topicPath, next.parentTopicId || null, next.status, JSON.stringify(next.mergeCandidates), patch.now ?? Date.now(), topicId, projectId);
        return this.get(topicId);
    }
    delete(topicId, projectId) {
        this.assertProject(topicId, projectId);
        this.db.prepare(`DELETE FROM topic_nodes WHERE topic_id = ? AND project_id = ?`).run(topicId, projectId);
    }
    assertProject(topicId, projectId) {
        const topic = this.get(topicId);
        if (!topic)
            throw new Error(`topic_not_found:${topicId}`);
        if (topic.projectId !== projectId)
            throw new Error(`topic_project_mismatch:${topicId}`);
        return topic;
    }
    listAliases(projectId, topicId) {
        return this.db.prepare(`SELECT alias FROM topic_aliases WHERE project_id = ? AND topic_id = ? AND status = 'active' ORDER BY created_at`)
            .all(projectId, topicId).map((row) => row.alias);
    }
}
export function normalizeTopicPath(value) {
    const path = String(value || '').normalize('NFKC').trim().toLowerCase()
        .replace(/[^\p{L}\p{N}/_-]+/gu, '-').replace(/_+/g, '-').replace(/\/{2,}/g, '/')
        .replace(/^[/\-]+|[/\-]+$/g, '');
    if (!path)
        throw new Error('topic_path_required');
    if (path.split('/').some((segment) => !segment || segment === '.' || segment === '..'))
        throw new Error('invalid_topic_path');
    return path;
}
function mapTopic(row, aliases) {
    return {
        topicId: row.topic_id, projectId: row.project_id, topicPath: row.topic_path, canonicalName: row.canonical_name,
        aliases, parentTopicId: row.parent_topic_id || undefined, ontologyClass: row.ontology_class, status: row.status,
        createdBy: row.created_by, confidence: row.confidence, evidenceEventIds: parse(row.evidence_event_ids_json, []),
        evidenceEpisodeIds: parse(row.evidence_episode_ids_json, []), lastUsedAt: row.last_used_at,
        mergeCandidates: parse(row.merge_candidates_json, []), createdAt: row.created_at, updatedAt: row.updated_at,
    };
}
function parse(value, fallback) { try {
    return value ? JSON.parse(value) : fallback;
}
catch {
    return fallback;
} }
function clamp(value) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
