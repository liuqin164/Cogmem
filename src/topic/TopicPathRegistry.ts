import { randomUUID } from 'node:crypto';
import type Database from 'bun:sqlite';
import { isMemoryOntologyClass, type MemoryOntologyClass } from '../ontology/MemoryOntology.js';
import type { TopicCreatedBy, TopicNode, TopicStatus } from './TopicTypes.js';

export class TopicPathRegistry {
  constructor(private readonly db: Database) {}

  create(input: {
    projectId: string; topicPath: string; canonicalName: string; parentTopicId?: string;
    ontologyClass?: MemoryOntologyClass; status?: TopicStatus; createdBy: TopicCreatedBy;
    confidence?: number; evidenceEventIds?: string[]; evidenceEpisodeIds?: string[]; now?: number;
  }): TopicNode {
    const now = input.now ?? Date.now();
    const topicPath = normalizeTopicPath(input.topicPath);
    const ontologyClass = input.ontologyClass ?? 'Topic';
    if (!input.projectId.trim()) throw new Error('topic_project_required');
    if (!input.canonicalName.trim()) throw new Error('topic_name_required');
    if (!isMemoryOntologyClass(ontologyClass)) throw new Error(`invalid_ontology_class:${ontologyClass}`);
    if (input.parentTopicId) this.assertProject(input.parentTopicId, input.projectId);
    const topicId = `topic-${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO topic_nodes (
        topic_id, project_id, topic_path, canonical_name, parent_topic_id, ontology_class, status,
        created_by, confidence, evidence_event_ids_json, evidence_episode_ids_json, last_used_at,
        merge_candidates_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
    `).run(
      topicId, input.projectId, topicPath, input.canonicalName.trim(), input.parentTopicId || null,
      ontologyClass, input.status ?? (input.createdBy === 'model_candidate' ? 'candidate' : 'active'),
      input.createdBy, clamp(input.confidence ?? (input.createdBy === 'user_explicit' ? 1 : 0.6)),
      JSON.stringify(input.evidenceEventIds || []), JSON.stringify(input.evidenceEpisodeIds || []), now, now, now,
    );
    return this.get(topicId)!;
  }

  get(topicId: string): TopicNode | undefined {
    const row = this.db.prepare(`SELECT * FROM topic_nodes WHERE topic_id = ?`).get(topicId) as TopicRow | null;
    return row ? mapTopic(row, this.listAliases(row.project_id, row.topic_id)) : undefined;
  }

  getByPath(projectId: string, topicPath: string): TopicNode | undefined {
    const row = this.db.prepare(`SELECT * FROM topic_nodes WHERE project_id = ? AND topic_path = ?`)
      .get(projectId, normalizeTopicPath(topicPath)) as TopicRow | null;
    return row ? mapTopic(row, this.listAliases(row.project_id, row.topic_id)) : undefined;
  }

  list(projectId: string, statuses?: TopicStatus[]): TopicNode[] {
    const rows = statuses?.length
      ? this.db.prepare(`SELECT * FROM topic_nodes WHERE project_id = ? AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY topic_path`)
        .all(projectId, ...statuses) as TopicRow[]
      : this.db.prepare(`SELECT * FROM topic_nodes WHERE project_id = ? ORDER BY topic_path`).all(projectId) as TopicRow[];
    return rows.map((row) => mapTopic(row, this.listAliases(projectId, row.topic_id)));
  }

  update(topicId: string, projectId: string, patch: {
    canonicalName?: string; topicPath?: string; parentTopicId?: string | null; status?: TopicStatus;
    mergeCandidates?: string[]; now?: number;
  }): TopicNode {
    const current = this.assertProject(topicId, projectId);
    if (patch.parentTopicId) this.assertProject(patch.parentTopicId, projectId);
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
    `).run(next.canonicalName, next.topicPath, next.parentTopicId || null, next.status,
      JSON.stringify(next.mergeCandidates), patch.now ?? Date.now(), topicId, projectId);
    return this.get(topicId)!;
  }

  delete(topicId: string, projectId: string): void {
    this.assertProject(topicId, projectId);
    this.db.prepare(`DELETE FROM topic_nodes WHERE topic_id = ? AND project_id = ?`).run(topicId, projectId);
  }

  assertProject(topicId: string, projectId: string): TopicNode {
    const topic = this.get(topicId);
    if (!topic) throw new Error(`topic_not_found:${topicId}`);
    if (topic.projectId !== projectId) throw new Error(`topic_project_mismatch:${topicId}`);
    return topic;
  }

  private listAliases(projectId: string, topicId: string): string[] {
    return (this.db.prepare(`SELECT alias FROM topic_aliases WHERE project_id = ? AND topic_id = ? AND status = 'active' ORDER BY created_at`)
      .all(projectId, topicId) as Array<{ alias: string }>).map((row) => row.alias);
  }
}

export function normalizeTopicPath(value: string): string {
  const path = String(value || '').normalize('NFKC').trim().toLowerCase()
    .replace(/[^\p{L}\p{N}/_-]+/gu, '-').replace(/_+/g, '-').replace(/\/{2,}/g, '/')
    .replace(/^[/\-]+|[/\-]+$/g, '');
  if (!path) throw new Error('topic_path_required');
  if (path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) throw new Error('invalid_topic_path');
  return path;
}

interface TopicRow {
  topic_id: string; project_id: string; topic_path: string; canonical_name: string; parent_topic_id?: string | null;
  ontology_class: MemoryOntologyClass; status: TopicStatus; created_by: TopicCreatedBy; confidence: number;
  evidence_event_ids_json: string; evidence_episode_ids_json: string; last_used_at: number;
  merge_candidates_json?: string | null; created_at: number; updated_at: number;
}

function mapTopic(row: TopicRow, aliases: string[]): TopicNode {
  return {
    topicId: row.topic_id, projectId: row.project_id, topicPath: row.topic_path, canonicalName: row.canonical_name,
    aliases, parentTopicId: row.parent_topic_id || undefined, ontologyClass: row.ontology_class, status: row.status,
    createdBy: row.created_by, confidence: row.confidence, evidenceEventIds: parse(row.evidence_event_ids_json, []),
    evidenceEpisodeIds: parse(row.evidence_episode_ids_json, []), lastUsedAt: row.last_used_at,
    mergeCandidates: parse(row.merge_candidates_json, []), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function parse<T>(value: string | null | undefined, fallback: T): T { try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
function clamp(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
