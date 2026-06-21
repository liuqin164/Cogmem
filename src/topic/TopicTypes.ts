import type { MemoryOntologyClass } from '../ontology/MemoryOntology.js';

export type TopicStatus = 'candidate' | 'active' | 'merged' | 'archived' | 'needs_review';
export type TopicCreatedBy = 'user_explicit' | 'model_candidate' | 'import' | 'repair';
export type TopicOperationType =
  | 'USER_DEFINED_TOPIC_CREATE' | 'USER_DEFINED_TOPIC_RENAME' | 'USER_DEFINED_TOPIC_ALIAS'
  | 'USER_DEFINED_TOPIC_MOVE' | 'USER_DEFINED_TOPIC_MERGE' | 'USER_DEFINED_TOPIC_SPLIT'
  | 'USER_DEFINED_TOPIC_REASSIGN' | 'USER_DEFINED_TOPIC_RELATION_ADD' | 'USER_DEFINED_TOPIC_RELATION_REMOVE'
  | 'MODEL_PROPOSED_TOPIC' | 'MODEL_PROPOSED_TOPIC_ALIAS' | 'MODEL_PROPOSED_TOPIC_RELATION'
  | 'SYSTEM_REPAIR_TOPIC';

export interface TopicNode {
  topicId: string;
  projectId: string;
  topicPath: string;
  canonicalName: string;
  aliases: string[];
  parentTopicId?: string;
  ontologyClass: MemoryOntologyClass;
  status: TopicStatus;
  createdBy: TopicCreatedBy;
  confidence: number;
  evidenceEventIds: string[];
  evidenceEpisodeIds: string[];
  lastUsedAt: number;
  mergeCandidates?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface TopicOperationInput {
  projectId: string;
  operationType: TopicOperationType;
  actor: TopicCreatedBy;
  targetTopicId?: string;
  payload: Record<string, unknown>;
  evidenceEventIds?: string[];
  now?: number;
}

export interface TopicOperationRecord {
  operationId: string;
  projectId: string;
  operationType: TopicOperationType;
  actor: TopicCreatedBy;
  targetTopicId?: string;
  payload: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  status: 'applied' | 'reverted' | 'needs_review' | 'rejected';
  evidenceEventIds: string[];
  createdAt: number;
  revertedAt?: number;
}

export interface TopicAliasRecord {
  aliasId: string;
  projectId: string;
  topicId: string;
  alias: string;
  normalizedAlias: string;
  status: 'candidate' | 'active' | 'needs_review' | 'archived';
  createdBy: TopicCreatedBy;
  confidence: number;
  evidenceEventIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface TopicRelationRecord {
  relationId: string;
  projectId: string;
  sourceTopicId: string;
  relation: string;
  targetTopicId: string;
  status: 'candidate' | 'active' | 'archived' | 'needs_review';
  createdBy: TopicCreatedBy;
  confidence: number;
  evidenceEventIds: string[];
  evidenceEpisodeIds: string[];
  createdAt: number;
  updatedAt: number;
}
