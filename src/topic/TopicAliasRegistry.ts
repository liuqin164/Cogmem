import { randomUUID } from 'node:crypto';
import type Database from 'bun:sqlite';
import type { TopicAliasRecord, TopicCreatedBy } from './TopicTypes.js';

export class TopicAliasRegistry {
  constructor(private readonly db: Database) {}

  add(input: {
    projectId: string; topicId: string; alias: string; createdBy: TopicCreatedBy;
    confidence: number; evidenceEventIds?: string[]; now?: number;
  }): TopicAliasRecord {
    const topic = this.db.prepare(`SELECT project_id FROM topic_nodes WHERE topic_id = ?`).get(input.topicId) as { project_id: string } | null;
    if (!topic) throw new Error(`topic_not_found:${input.topicId}`);
    if (topic.project_id !== input.projectId) throw new Error(`topic_project_mismatch:${input.topicId}`);
    const alias = input.alias.normalize('NFKC').trim();
    const normalizedAlias = normalizeTopicAlias(alias);
    if (!normalizedAlias) throw new Error('topic_alias_required');
    const collisions = this.db.prepare(`
      SELECT DISTINCT topic_id FROM topic_aliases
      WHERE project_id = ? AND normalized_alias = ? AND status IN ('active', 'needs_review') AND topic_id != ?
    `).all(input.projectId, normalizedAlias, input.topicId) as Array<{ topic_id: string }>;
    const status = collisions.length
      ? 'needs_review' as const
      : input.createdBy === 'model_candidate' ? 'candidate' as const : 'active' as const;
    const aliasId = `topic-alias-${randomUUID()}`;
    const now = input.now ?? Date.now();
    this.db.prepare(`
      INSERT INTO topic_aliases (alias_id, project_id, normalized_alias, alias, topic_id, status,
        created_by, confidence, evidence_event_ids_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(aliasId, input.projectId, normalizedAlias, alias, input.topicId, status, input.createdBy,
      Math.max(0, Math.min(1, input.confidence)), JSON.stringify(input.evidenceEventIds || []), now, now);
    return this.get(aliasId)!;
  }

  resolve(projectId: string, alias: string): TopicAliasRecord | undefined {
    const rows = this.db.prepare(`
      SELECT * FROM topic_aliases WHERE project_id = ? AND normalized_alias = ? AND status IN ('active', 'needs_review')
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, confidence DESC
    `).all(projectId, normalizeTopicAlias(alias)) as AliasRow[];
    if (new Set(rows.map((row) => row.topic_id)).size !== 1 || rows.some((row) => row.status === 'needs_review')) return undefined;
    return rows[0] ? mapAlias(rows[0]) : undefined;
  }

  matchText(projectId: string, text: string, limit = 10): TopicAliasRecord[] {
    const normalized = normalizeTopicAlias(text);
    if (!normalized) return [];
    const rows = this.db.prepare(`
      SELECT * FROM topic_aliases WHERE project_id = ? AND status = 'active' ORDER BY LENGTH(normalized_alias) DESC
    `).all(projectId) as AliasRow[];
    return rows.filter((row) => row.normalized_alias.length >= 2 && normalized.includes(row.normalized_alias)).slice(0, limit).map(mapAlias);
  }

  archive(aliasId: string, projectId: string, now = Date.now()): void {
    this.db.prepare(`UPDATE topic_aliases SET status = 'archived', updated_at = ? WHERE alias_id = ? AND project_id = ?`)
      .run(now, aliasId, projectId);
  }

  get(aliasId: string): TopicAliasRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM topic_aliases WHERE alias_id = ?`).get(aliasId) as AliasRow | null;
    return row ? mapAlias(row) : undefined;
  }
}

export function normalizeTopicAlias(value: string): string {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

interface AliasRow {
  alias_id: string; project_id: string; topic_id: string; alias: string; normalized_alias: string;
  status: TopicAliasRecord['status']; created_by: TopicCreatedBy; confidence: number;
  evidence_event_ids_json: string; created_at: number; updated_at: number;
}
function mapAlias(row: AliasRow): TopicAliasRecord {
  return { aliasId: row.alias_id, projectId: row.project_id, topicId: row.topic_id, alias: row.alias,
    normalizedAlias: row.normalized_alias, status: row.status, createdBy: row.created_by, confidence: row.confidence,
    evidenceEventIds: JSON.parse(row.evidence_event_ids_json) as string[], createdAt: row.created_at, updatedAt: row.updated_at };
}
