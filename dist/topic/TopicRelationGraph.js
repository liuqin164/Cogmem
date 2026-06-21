import { randomUUID } from 'node:crypto';
export class TopicRelationGraph {
    db;
    constructor(db) {
        this.db = db;
    }
    add(input) {
        this.assertTopic(input.sourceTopicId, input.projectId);
        this.assertTopic(input.targetTopicId, input.projectId);
        if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(input.relation))
            throw new Error(`invalid_topic_relation:${input.relation}`);
        const relationId = `topic-relation-${randomUUID()}`;
        const now = input.now ?? Date.now();
        const status = input.createdBy === 'model_candidate' ? 'candidate' : 'active';
        this.db.prepare(`
      INSERT INTO topic_relations (relation_id, project_id, source_topic_id, relation, target_topic_id, status,
        created_by, confidence, evidence_event_ids_json, evidence_episode_ids_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(relationId, input.projectId, input.sourceTopicId, input.relation, input.targetTopicId, status, input.createdBy, Math.max(0, Math.min(1, input.confidence ?? 1)), JSON.stringify(input.evidenceEventIds || []), JSON.stringify(input.evidenceEpisodeIds || []), now, now);
        return this.get(relationId);
    }
    get(relationId) {
        const row = this.db.prepare(`SELECT * FROM topic_relations WHERE relation_id = ?`).get(relationId);
        return row ? mapRelation(row) : undefined;
    }
    archive(relationId, projectId, now = Date.now()) {
        this.db.prepare(`UPDATE topic_relations SET status = 'archived', updated_at = ? WHERE relation_id = ? AND project_id = ?`)
            .run(now, relationId, projectId);
    }
    setStatus(relationId, projectId, status, now = Date.now()) {
        const relation = this.get(relationId);
        if (!relation)
            throw new Error(`topic_relation_not_found:${relationId}`);
        if (relation.projectId !== projectId)
            throw new Error(`topic_relation_project_mismatch:${relationId}`);
        this.db.prepare(`UPDATE topic_relations SET status = ?, updated_at = ? WHERE relation_id = ? AND project_id = ?`)
            .run(status, now, relationId, projectId);
    }
    list(projectId) {
        return this.db.prepare(`SELECT * FROM topic_relations WHERE project_id = ? ORDER BY created_at`).all(projectId).map(mapRelation);
    }
    assertTopic(topicId, projectId) {
        const row = this.db.prepare(`SELECT project_id FROM topic_nodes WHERE topic_id = ?`).get(topicId);
        if (!row)
            throw new Error(`topic_not_found:${topicId}`);
        if (row.project_id !== projectId)
            throw new Error(`topic_project_mismatch:${topicId}`);
    }
}
function mapRelation(row) {
    return { relationId: row.relation_id, projectId: row.project_id, sourceTopicId: row.source_topic_id,
        relation: row.relation, targetTopicId: row.target_topic_id, status: row.status, createdBy: row.created_by,
        confidence: row.confidence, evidenceEventIds: JSON.parse(row.evidence_event_ids_json),
        evidenceEpisodeIds: JSON.parse(row.evidence_episode_ids_json), createdAt: row.created_at, updatedAt: row.updated_at };
}
