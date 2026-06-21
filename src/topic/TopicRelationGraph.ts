import { randomUUID } from 'node:crypto';
import type Database from 'bun:sqlite';
import type { TopicCreatedBy, TopicRelationRecord } from './TopicTypes.js';

export class TopicRelationGraph {
  constructor(private readonly db: Database) {}

  add(input: {
    projectId: string; sourceTopicId: string; relation: string; targetTopicId: string;
    createdBy: TopicCreatedBy; confidence?: number; evidenceEventIds?: string[]; evidenceEpisodeIds?: string[]; now?: number;
  }): TopicRelationRecord {
    this.assertTopic(input.sourceTopicId, input.projectId);
    this.assertTopic(input.targetTopicId, input.projectId);
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(input.relation)) throw new Error(`invalid_topic_relation:${input.relation}`);
    const relationId = `topic-relation-${randomUUID()}`;
    const now = input.now ?? Date.now();
    const status = input.createdBy === 'model_candidate' ? 'candidate' : 'active';
    this.db.prepare(`
      INSERT INTO topic_relations (relation_id, project_id, source_topic_id, relation, target_topic_id, status,
        created_by, confidence, evidence_event_ids_json, evidence_episode_ids_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(relationId, input.projectId, input.sourceTopicId, input.relation, input.targetTopicId, status,
      input.createdBy, Math.max(0, Math.min(1, input.confidence ?? 1)), JSON.stringify(input.evidenceEventIds || []),
      JSON.stringify(input.evidenceEpisodeIds || []), now, now);
    return this.get(relationId)!;
  }

  get(relationId: string): TopicRelationRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM topic_relations WHERE relation_id = ?`).get(relationId) as RelationRow | null;
    return row ? mapRelation(row) : undefined;
  }

  archive(relationId: string, projectId: string, now = Date.now()): void {
    this.db.prepare(`UPDATE topic_relations SET status = 'archived', updated_at = ? WHERE relation_id = ? AND project_id = ?`)
      .run(now, relationId, projectId);
  }

  setStatus(relationId: string, projectId: string, status: TopicRelationRecord['status'], now = Date.now()): void {
    const relation = this.get(relationId);
    if (!relation) throw new Error(`topic_relation_not_found:${relationId}`);
    if (relation.projectId !== projectId) throw new Error(`topic_relation_project_mismatch:${relationId}`);
    this.db.prepare(`UPDATE topic_relations SET status = ?, updated_at = ? WHERE relation_id = ? AND project_id = ?`)
      .run(status, now, relationId, projectId);
  }

  list(projectId: string): TopicRelationRecord[] {
    return (this.db.prepare(`SELECT * FROM topic_relations WHERE project_id = ? ORDER BY created_at`).all(projectId) as RelationRow[]).map(mapRelation);
  }

  private assertTopic(topicId: string, projectId: string): void {
    const row = this.db.prepare(`SELECT project_id FROM topic_nodes WHERE topic_id = ?`).get(topicId) as { project_id: string } | null;
    if (!row) throw new Error(`topic_not_found:${topicId}`);
    if (row.project_id !== projectId) throw new Error(`topic_project_mismatch:${topicId}`);
  }
}

interface RelationRow {
  relation_id: string; project_id: string; source_topic_id: string; relation: string; target_topic_id: string;
  status: TopicRelationRecord['status']; created_by: TopicCreatedBy; confidence: number;
  evidence_event_ids_json: string; evidence_episode_ids_json: string; created_at: number; updated_at: number;
}
function mapRelation(row: RelationRow): TopicRelationRecord {
  return { relationId: row.relation_id, projectId: row.project_id, sourceTopicId: row.source_topic_id,
    relation: row.relation, targetTopicId: row.target_topic_id, status: row.status, createdBy: row.created_by,
    confidence: row.confidence, evidenceEventIds: JSON.parse(row.evidence_event_ids_json) as string[],
    evidenceEpisodeIds: JSON.parse(row.evidence_episode_ids_json) as string[], createdAt: row.created_at, updatedAt: row.updated_at };
}
