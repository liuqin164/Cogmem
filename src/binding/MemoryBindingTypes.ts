export type MemoryEntityType =
  | 'person'
  | 'project'
  | 'object'
  | 'event'
  | 'time'
  | 'place'
  | 'concept';

export type MemoryBindingType =
  | 'about'
  | 'mentions'
  | 'decision'
  | 'correction'
  | 'preference'
  | 'boundary'
  | 'diagnostic'
  | 'goal';

export type MemoryBindingSource = 'deterministic';

export type MemoryBindingAction =
  | 'create_new_cluster'
  | 'attach_to_existing'
  | 'strengthen_existing'
  | 'possible_conflict'
  | 'corrects_prior_memory'
  | 'refines_prior_memory'
  | 'needs_review';

export type MemoryClusterStatus = 'active' | 'possible_conflict' | 'superseded';

export type MemoryEdgeRelation =
  | 'ABOUT'
  | 'MENTIONS'
  | 'SUPPORTS'
  | 'BELONGS_TO'
  | 'SAME_TOPIC_AS'
  | 'CORRECTS'
  | 'CONTRADICTS'
  | 'REFINES'
  | 'SUPERSEDES';

export type MemoryGraphEndpointType = MemoryAtlasNodeType;

export type MemoryGraphRelation =
  | MemoryEdgeRelation
  | MemoryRelationType
  | 'PART_OF_ISSUE'
  | 'INVOLVES_ENTITY'
  | 'IN_SESSION'
  | 'IN_THREAD'
  | 'HAS_EVIDENCE'
  | 'HAS_MEMORY_KIND'
  | 'HAS_ACTION_KIND'
  | 'SAME_ISSUE'
  | 'TARGETS'
  | 'belongs_to';

export type MemoryGraphEdgeStatus = 'active' | 'weak' | 'needs_confirmation' | 'rejected' | 'superseded' | 'archived';

export interface MemoryEntityRecord {
  entityId: string;
  projectId?: string;
  canonicalName: string;
  entityType: MemoryEntityType;
  aliases: string[];
  stablePath?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryTopicRecord {
  topicPath: string;
  projectId?: string;
  parentPath?: string;
  topicType: 'project' | 'person' | 'object' | 'event' | 'place' | 'time' | 'concept';
  summary?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryBindingRecord {
  bindingId: string;
  eventId: string;
  projectId?: string;
  role?: string;
  rawEventType?: string;
  entityId?: string;
  entityName?: string;
  entityType?: MemoryEntityType;
  topicPath: string;
  bindingType: MemoryBindingType;
  confidence: number;
  source: MemoryBindingSource;
  signal: string;
  claimKey: string;
  bindingAction: MemoryBindingAction;
  clusterId?: string;
  relatedEventIds: string[];
  createdAt: number;
}

export interface MemoryBindingInput {
  eventId: string;
  projectId?: string;
  role?: string;
  rawEventType?: string;
  entityId?: string;
  entityName?: string;
  entityType?: MemoryEntityType;
  topicPath: string;
  bindingType: MemoryBindingType;
  confidence: number;
  source: MemoryBindingSource;
  signal: string;
  claimKey: string;
  bindingAction?: MemoryBindingAction;
  clusterId?: string;
  relatedEventIds?: string[];
  createdAt?: number;
}

export interface MemoryBindingListOptions {
  projectId?: string;
  eventId?: string;
  topicPath?: string;
  entityName?: string;
  bindingType?: MemoryBindingType;
  role?: string;
  limit?: number;
}

export interface MemoryClusterRecord {
  clusterId: string;
  projectId?: string;
  topicPath: string;
  clusterType: MemoryBindingType | 'topic';
  title: string;
  summary: string;
  claimKey: string;
  status: MemoryClusterStatus;
  reviewFlags: string[];
  confidence: number;
  supportCount: number;
  evidenceEventIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface MemoryClusterListOptions {
  projectId?: string;
  topicPath?: string;
  clusterType?: MemoryClusterRecord['clusterType'];
  status?: MemoryClusterStatus;
  limit?: number;
}

export interface MemoryEdgeRecord {
  edgeId: string;
  projectId?: string;
  sourceType: MemoryGraphEndpointType;
  sourceId: string;
  relationType: MemoryGraphRelation;
  targetType: MemoryGraphEndpointType;
  targetId: string;
  confidence: number;
  baseWeight: number;
  stability: number;
  activation: number;
  evidenceEventIds: string[];
  status: MemoryGraphEdgeStatus;
  createdAt: number;
  updatedAt: number;
  validFrom: number;
  validTo?: number;
  version: number;
  sourceAuthority: 'raw_evidence' | 'governed_projection' | 'memory_frame_projector' | 'atlas_curator' | 'model_candidate';
}

export interface MemoryEdgeListOptions {
  projectId?: string;
  sourceId?: string;
  targetId?: string;
  relationType?: MemoryGraphRelation;
  limit?: number;
}

export interface MemoryGraphRecallAnchor {
  eventId: string;
  projectId?: string;
  topicPath: string;
  clusterId?: string;
  confidence: number;
  whyMatched: 'memory_binding_graph';
}

export interface MemoryBindingStats {
  bindings: number;
  topics: number;
  entities: number;
  clusters: number;
  edges: number;
}
import type { MemoryAtlasNodeType } from '../atlas/MemoryAtlasTypes.js';
import type { MemoryRelationType } from '../semantic/MemoryFrameTypes.js';
