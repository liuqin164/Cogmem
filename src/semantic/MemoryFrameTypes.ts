export type MemoryDimension =
  | 'actor' | 'entity' | 'project' | 'topic' | 'issue' | 'event' | 'raw_event' | 'episode'
  | 'task' | 'object' | 'location' | 'time' | 'state';

export type MemoryRelationType =
  | 'PARTICIPATED_IN' | 'PERFORMED' | 'INVOLVES' | 'PART_OF_PROJECT'
  | 'PART_OF_EVENT' | 'ABOUT_TOPIC' | 'ADDRESSES_ISSUE' | 'ADVANCES_TASK'
  | 'DEPENDS_ON' | 'BLOCKED_BY' | 'OCCURRED_ON' | 'OCCURRED_IN'
  | 'LOCATED_AT' | 'HAS_STATE' | 'CHANGED_FROM' | 'CHANGED_TO'
  | 'BROADER_THAN' | 'NARROWER_THAN' | 'SAME_EVENT' | 'SAME_ISSUE'
  | 'FOLLOWS_UP' | 'RELATED_TO' | 'CORRECTS' | 'CONTRADICTS'
  | 'SUPERSEDES' | 'SUPPORTED_BY' | 'DERIVED_FROM';

export type MemoryFrameStatus = 'staged' | 'active' | 'needs_confirmation' | 'superseded' | 'failed';

export interface MemoryFrameNode {
  frameNodeId: string;
  dimension: MemoryDimension;
  label: string;
  aliases?: string[];
  description?: string;
  confidence: number;
  evidenceEventIds: string[];
  canonicalHint?: { nodeId?: string; canonicalLabel?: string; confidence?: number };
}

export interface MemoryFrameRelation {
  sourceFrameNodeId: string;
  relationType: MemoryRelationType;
  targetFrameNodeId: string;
  confidence: number;
  evidenceEventIds: string[];
  validFrom?: number;
  validTo?: number;
}

export interface TemporalReference {
  label: string;
  occurredAt?: number;
  evidenceEventIds: string[];
  confidence: number;
}

export interface StateTransition {
  subjectFrameNodeId: string;
  from?: string;
  to: string;
  evidenceEventIds: string[];
  confidence: number;
}

export interface MemoryFrameV1 {
  schemaVersion: 'memory_frame.v1';
  frameId: string;
  revisionId?: string;
  revisionNumber?: number;
  supersedesFrameId?: string;
  projectId: string;
  episodeId: string;
  title: string;
  summary: string;
  primaryLanguage?: string;
  episodeKind: 'discussion' | 'operation' | 'decision' | 'correction' | 'diagnostic' | 'planning' | 'status_update' | 'preference' | 'other';
  nodes: MemoryFrameNode[];
  relations: MemoryFrameRelation[];
  temporalReferences: TemporalReference[];
  stateTransitions: StateTransition[];
  confidence: number;
  evidenceEventIds: string[];
  processor: { provider?: string; model?: string; promptVersion: string; generatedAt: number };
  status?: MemoryFrameStatus;
  sourceAuthority?: 'processor' | 'deterministic_fallback';
  semanticCompleteness?: 'full' | 'minimal';
  needsReview?: boolean;
  publishStatus?: 'active' | 'needs_confirmation';
}

export type MemoryQueryIntent = 'exact_lookup' | 'historical_summary' | 'continuity' | 'causal_explanation' | 'status_check' | 'preference_recall' | 'source_drilldown';

export interface MemoryQueryFacet { label: string; dimension?: MemoryDimension; canonicalNodeId?: string; confidence?: number; }

export interface MemoryQueryFrameV1 {
  schemaVersion: 'memory_query_frame.v1';
  actors?: MemoryQueryFacet[];
  projects?: MemoryQueryFacet[];
  topics?: MemoryQueryFacet[];
  issues?: MemoryQueryFacet[];
  events?: MemoryQueryFacet[];
  tasks?: MemoryQueryFacet[];
  entities?: MemoryQueryFacet[];
  locations?: MemoryQueryFacet[];
  time?: { from?: number; to?: number; expressions?: string[] };
  states?: string[];
  intent: MemoryQueryIntent;
  requireRawEvidence: boolean;
}
