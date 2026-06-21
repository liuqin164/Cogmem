import { randomUUID } from 'node:crypto';
export class TopicAliasRegistry {
    db;
    constructor(db) {
        this.db = db;
    }
    add(input) {
        const topic = this.db.prepare(`SELECT project_id FROM topic_nodes WHERE topic_id = ?`).get(input.topicId);
        if (!topic)
            throw new Error(`topic_not_found:${input.topicId}`);
        if (topic.project_id !== input.projectId)
            throw new Error(`topic_project_mismatch:${input.topicId}`);
        const alias = input.alias.normalize('NFKC').trim();
        const normalizedAlias = normalizeTopicAlias(alias);
        if (!normalizedAlias)
            throw new Error('topic_alias_required');
        const collisions = this.db.prepare(`
      SELECT DISTINCT topic_id FROM topic_aliases
      WHERE project_id = ? AND normalized_alias = ? AND status IN ('active', 'needs_review') AND topic_id != ?
    `).all(input.projectId, normalizedAlias, input.topicId);
        const status = collisions.length
            ? 'needs_review'
            : input.createdBy === 'model_candidate' ? 'candidate' : 'active';
        const aliasId = `topic-alias-${randomUUID()}`;
        const now = input.now ?? Date.now();
        this.db.prepare(`
      INSERT INTO topic_aliases (alias_id, project_id, normalized_alias, alias, topic_id, status,
        created_by, confidence, evidence_event_ids_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(aliasId, input.projectId, normalizedAlias, alias, input.topicId, status, input.createdBy, Math.max(0, Math.min(1, input.confidence)), JSON.stringify(input.evidenceEventIds || []), now, now);
        return this.get(aliasId);
    }
    resolve(projectId, alias) {
        const rows = this.db.prepare(`
      SELECT * FROM topic_aliases WHERE project_id = ? AND normalized_alias = ? AND status IN ('active', 'needs_review')
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, confidence DESC
    `).all(projectId, normalizeTopicAlias(alias));
        if (new Set(rows.map((row) => row.topic_id)).size !== 1 || rows.some((row) => row.status === 'needs_review'))
            return undefined;
        return rows[0] ? mapAlias(rows[0]) : undefined;
    }
    matchText(projectId, text, limit = 10) {
        const normalized = normalizeTopicAlias(text);
        if (!normalized)
            return [];
        const rows = this.db.prepare(`
      SELECT * FROM topic_aliases WHERE project_id = ? AND status = 'active' ORDER BY LENGTH(normalized_alias) DESC
    `).all(projectId);
        return rows.filter((row) => row.normalized_alias.length >= 2 && normalized.includes(row.normalized_alias)).slice(0, limit).map(mapAlias);
    }
    archive(aliasId, projectId, now = Date.now()) {
        this.db.prepare(`UPDATE topic_aliases SET status = 'archived', updated_at = ? WHERE alias_id = ? AND project_id = ?`)
            .run(now, aliasId, projectId);
    }
    get(aliasId) {
        const row = this.db.prepare(`SELECT * FROM topic_aliases WHERE alias_id = ?`).get(aliasId);
        return row ? mapAlias(row) : undefined;
    }
}
export function normalizeTopicAlias(value) {
    return String(value || '').normalize('NFKC').trim().toLocaleLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}
function mapAlias(row) {
    return { aliasId: row.alias_id, projectId: row.project_id, topicId: row.topic_id, alias: row.alias,
        normalizedAlias: row.normalized_alias, status: row.status, createdBy: row.created_by, confidence: row.confidence,
        evidenceEventIds: JSON.parse(row.evidence_event_ids_json), createdAt: row.created_at, updatedAt: row.updated_at };
}
