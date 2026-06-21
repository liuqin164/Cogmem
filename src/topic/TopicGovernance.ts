import { randomUUID } from 'node:crypto';
import type Database from 'bun:sqlite';
import { isMemoryOntologyClass } from '../ontology/MemoryOntology.js';
import type { TopicAliasRegistry } from './TopicAliasRegistry.js';
import type { TopicPathRegistry } from './TopicPathRegistry.js';
import type { TopicRelationGraph } from './TopicRelationGraph.js';
import type { TopicOperationInput, TopicOperationRecord, TopicOperationType } from './TopicTypes.js';

const OPERATIONS = new Set<TopicOperationType>([
  'USER_DEFINED_TOPIC_CREATE', 'USER_DEFINED_TOPIC_RENAME', 'USER_DEFINED_TOPIC_ALIAS', 'USER_DEFINED_TOPIC_MOVE',
  'USER_DEFINED_TOPIC_MERGE', 'USER_DEFINED_TOPIC_SPLIT', 'USER_DEFINED_TOPIC_REASSIGN',
  'USER_DEFINED_TOPIC_RELATION_ADD', 'USER_DEFINED_TOPIC_RELATION_REMOVE', 'MODEL_PROPOSED_TOPIC',
  'MODEL_PROPOSED_TOPIC_ALIAS', 'MODEL_PROPOSED_TOPIC_RELATION', 'SYSTEM_REPAIR_TOPIC',
]);

export class TopicGovernance {
  constructor(
    private readonly db: Database,
    private readonly paths: TopicPathRegistry,
    private readonly aliases: TopicAliasRegistry,
    private readonly relations: TopicRelationGraph,
  ) {}

  apply(input: TopicOperationInput): TopicOperationRecord {
    if (!OPERATIONS.has(input.operationType)) throw new Error(`invalid_topic_operation:${input.operationType}`);
    const now = input.now ?? Date.now();
    const operationId = `topic-operation-${randomUUID()}`;
    let targetTopicId = input.targetTopicId;
    let before: unknown;
    let after: unknown;
    let status: TopicOperationRecord['status'] = 'applied';
    this.db.transaction(() => {
      if (input.operationType === 'USER_DEFINED_TOPIC_CREATE' || input.operationType === 'MODEL_PROPOSED_TOPIC') {
        const ontologyClass = input.payload.ontologyClass ?? 'Topic';
        if (!isMemoryOntologyClass(ontologyClass)) throw new Error(`invalid_ontology_class:${String(ontologyClass)}`);
        const created = this.paths.create({
          projectId: input.projectId, topicPath: required(input.payload.topicPath, 'topicPath'),
          canonicalName: required(input.payload.canonicalName, 'canonicalName'), ontologyClass,
          parentTopicId: optional(input.payload.parentTopicId), createdBy: input.actor,
          evidenceEventIds: input.evidenceEventIds, now,
        });
        targetTopicId = created.topicId;
        this.aliases.add({
          projectId: input.projectId, topicId: created.topicId, alias: created.canonicalName,
          createdBy: input.actor, confidence: input.actor === 'user_explicit' ? 1 : 0.6,
          evidenceEventIds: input.evidenceEventIds, now,
        });
        after = created;
      } else {
        if (!targetTopicId) throw new Error('target_topic_required');
        before = this.paths.assertProject(targetTopicId, input.projectId);
        if (input.operationType === 'USER_DEFINED_TOPIC_RENAME') {
          after = this.paths.update(targetTopicId, input.projectId, { canonicalName: required(input.payload.canonicalName, 'canonicalName'), now });
        } else if (input.operationType === 'USER_DEFINED_TOPIC_MOVE' || input.operationType === 'USER_DEFINED_TOPIC_REASSIGN') {
          after = this.paths.update(targetTopicId, input.projectId, {
            topicPath: optional(input.payload.topicPath), parentTopicId: optional(input.payload.parentTopicId) ?? null, now,
          });
        } else if (input.operationType === 'USER_DEFINED_TOPIC_ALIAS' || input.operationType === 'MODEL_PROPOSED_TOPIC_ALIAS') {
          after = this.aliases.add({ projectId: input.projectId, topicId: targetTopicId,
            alias: required(input.payload.alias, 'alias'), createdBy: input.actor,
            confidence: input.actor === 'user_explicit' ? 1 : 0.6, evidenceEventIds: input.evidenceEventIds, now });
          status = (after as { status?: string }).status === 'needs_review' ? 'needs_review' : 'applied';
        } else if (input.operationType === 'USER_DEFINED_TOPIC_MERGE') {
          const destinationId = required(input.payload.destinationTopicId, 'destinationTopicId');
          this.paths.assertProject(destinationId, input.projectId);
          after = this.paths.update(targetTopicId, input.projectId, { status: 'merged', mergeCandidates: [destinationId], now });
        } else if (input.operationType === 'USER_DEFINED_TOPIC_SPLIT') {
          const created = this.paths.create({ projectId: input.projectId,
            topicPath: required(input.payload.topicPath, 'topicPath'), canonicalName: required(input.payload.canonicalName, 'canonicalName'),
            ontologyClass: 'Topic', parentTopicId: before ? (before as { parentTopicId?: string }).parentTopicId : undefined,
            createdBy: input.actor, evidenceEventIds: input.evidenceEventIds, now });
          after = { source: before, splitTopic: created };
        } else if (input.operationType === 'USER_DEFINED_TOPIC_RELATION_ADD' || input.operationType === 'MODEL_PROPOSED_TOPIC_RELATION') {
          after = this.relations.add({ projectId: input.projectId, sourceTopicId: targetTopicId,
            relation: required(input.payload.relation, 'relation'), targetTopicId: required(input.payload.targetTopicId, 'targetTopicId'),
            createdBy: input.actor, evidenceEventIds: input.evidenceEventIds, now });
        } else if (input.operationType === 'USER_DEFINED_TOPIC_RELATION_REMOVE') {
          const relationId = required(input.payload.relationId, 'relationId');
          const relation = this.relations.get(relationId);
          if (!relation || relation.projectId !== input.projectId) throw new Error(`topic_relation_project_mismatch:${relationId}`);
          before = relation;
          this.relations.archive(relationId, input.projectId, now);
          after = { relationId: input.payload.relationId, status: 'archived' };
        } else {
          after = this.paths.update(targetTopicId, input.projectId, { status: 'needs_review', now });
          status = 'needs_review';
        }
      }
      this.db.prepare(`
        INSERT INTO topic_operations (operation_id, project_id, operation_type, actor, target_topic_id, payload_json,
          before_json, after_json, inverse_operation_json, status, evidence_event_ids_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(operationId, input.projectId, input.operationType, input.actor, targetTopicId || null,
        JSON.stringify(input.payload), before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after),
        before === undefined ? null : JSON.stringify({ restoreTopic: before }), status, JSON.stringify(input.evidenceEventIds || []), now);
    })();
    return this.getOperation(operationId)!;
  }

  rollback(operationId: string, projectId: string, now = Date.now()): TopicOperationRecord {
    const operation = this.getOperation(operationId);
    if (!operation) throw new Error(`topic_operation_not_found:${operationId}`);
    if (operation.projectId !== projectId) throw new Error(`topic_operation_project_mismatch:${operationId}`);
    if (operation.status === 'reverted') return operation;
    this.db.transaction(() => {
      if (operation.operationType === 'USER_DEFINED_TOPIC_ALIAS' || operation.operationType === 'MODEL_PROPOSED_TOPIC_ALIAS') {
        const aliasId = (operation.after as { aliasId?: string } | undefined)?.aliasId;
        if (aliasId) this.aliases.archive(aliasId, projectId, now);
      } else if (operation.operationType === 'USER_DEFINED_TOPIC_RELATION_ADD' || operation.operationType === 'MODEL_PROPOSED_TOPIC_RELATION') {
        const relationId = (operation.after as { relationId?: string } | undefined)?.relationId;
        if (relationId) this.relations.archive(relationId, projectId, now);
      } else if (operation.operationType === 'USER_DEFINED_TOPIC_RELATION_REMOVE') {
        const relation = operation.before as { relationId?: string; status?: 'candidate' | 'active' | 'archived' | 'needs_review' } | undefined;
        if (relation?.relationId && relation.status) this.relations.setStatus(relation.relationId, projectId, relation.status, now);
      } else if (operation.operationType === 'USER_DEFINED_TOPIC_SPLIT') {
        const splitTopicId = (operation.after as { splitTopic?: { topicId?: string } } | undefined)?.splitTopic?.topicId;
        if (splitTopicId) this.deleteTopicGraph(splitTopicId, projectId);
      } else if (operation.before && operation.targetTopicId) {
        const before = operation.before as { canonicalName?: string; topicPath?: string; parentTopicId?: string; status?: never; mergeCandidates?: string[] };
        this.paths.update(operation.targetTopicId!, projectId, {
          canonicalName: before.canonicalName, topicPath: before.topicPath, parentTopicId: before.parentTopicId ?? null,
          status: before.status, mergeCandidates: before.mergeCandidates, now,
        });
      } else if (operation.targetTopicId && (operation.operationType === 'USER_DEFINED_TOPIC_CREATE' || operation.operationType === 'MODEL_PROPOSED_TOPIC')) {
        this.deleteTopicGraph(operation.targetTopicId, projectId);
      }
      this.db.prepare(`UPDATE topic_operations SET status = 'reverted', reverted_at = ? WHERE operation_id = ?`).run(now, operationId);
    })();
    return this.getOperation(operationId)!;
  }

  listOperations(input: { projectId: string; limit?: number }): TopicOperationRecord[] {
    return (this.db.prepare(`SELECT * FROM topic_operations WHERE project_id = ? ORDER BY created_at LIMIT ?`)
      .all(input.projectId, Math.max(1, Math.min(input.limit ?? 100, 1000))) as OperationRow[]).map(mapOperation);
  }

  getOperation(operationId: string): TopicOperationRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM topic_operations WHERE operation_id = ?`).get(operationId) as OperationRow | null;
    return row ? mapOperation(row) : undefined;
  }

  private deleteTopicGraph(topicId: string, projectId: string): void {
    this.paths.assertProject(topicId, projectId);
    this.db.prepare(`DELETE FROM topic_relations WHERE project_id = ? AND (source_topic_id = ? OR target_topic_id = ?)`)
      .run(projectId, topicId, topicId);
    this.db.prepare(`DELETE FROM topic_aliases WHERE project_id = ? AND topic_id = ?`).run(projectId, topicId);
    this.paths.delete(topicId, projectId);
  }
}

interface OperationRow {
  operation_id: string; project_id: string; operation_type: TopicOperationType; actor: TopicOperationRecord['actor'];
  target_topic_id?: string | null; payload_json: string; before_json?: string | null; after_json?: string | null;
  status: TopicOperationRecord['status']; evidence_event_ids_json: string; created_at: number; reverted_at?: number | null;
}
function mapOperation(row: OperationRow): TopicOperationRecord {
  return { operationId: row.operation_id, projectId: row.project_id, operationType: row.operation_type, actor: row.actor,
    targetTopicId: row.target_topic_id || undefined, payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    before: row.before_json ? JSON.parse(row.before_json) : undefined, after: row.after_json ? JSON.parse(row.after_json) : undefined,
    status: row.status, evidenceEventIds: JSON.parse(row.evidence_event_ids_json) as string[], createdAt: row.created_at,
    revertedAt: row.reverted_at ?? undefined };
}
function required(value: unknown, name: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name}_required`); return value.trim(); }
function optional(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
