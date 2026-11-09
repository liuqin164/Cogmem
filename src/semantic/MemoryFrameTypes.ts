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
  | 'SUPERSEDES' | 'SUPPORTED_BY' | 'DERIVED_FROM'
  | 'LIKES' | 'FRIEND_OF' | 'FAMILY_OF';

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
  /**
   * The project's classification for this episode. A `string`, not a closed union (#182): the project's
   * `[taxonomy] episode_kinds` decides what is valid, and that list is only known at runtime — a union of the
   * shipped nine made every value outside it a type error at the boundary and forced a cast to let it through.
   * `validateMemoryFrame` still rejects a kind the resolved vocabulary does not declare.
   */
  episodeKind: string;
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

/**
 * The episode kinds a frame may carry. An episode type the frame layer does not know —
 * `prospective` was the first one in practice — is `other`, which the enum already keeps
 * for exactly this. Passing it through unmapped made the frame invalid, and one invalid
 * frame aborted a whole backfill batch.
 */
export const MEMORY_FRAME_EPISODE_KINDS = ['discussion', 'operation', 'decision', 'correction', 'diagnostic', 'planning', 'status_update', 'preference', 'other'] as const;

/**
 * A frame kind the vocabulary knows, else the vocabulary's own `other` (#175).
 *
 * `episodeKinds` is the project's `[taxonomy] episode_kinds` when it declared one. It has to be honoured here, and
 * not only by the validator: this mapping is what the deterministic fallback uses to name a frame built without a
 * model, so reading the shipped list while the store validates against the project's list made every backfilled
 * frame of a project with its own vocabulary either a mislabelled `other` or an `invalid_episode_kind` failure.
 * The sentinel stays `other`, so a vocabulary that does not declare it has no valid fallback kind — that is a loud
 * per-episode failure rather than a frame the project's own list rejects.
 */
export function normalizeEpisodeKind(value: unknown, episodeKinds: readonly string[] = MEMORY_FRAME_EPISODE_KINDS): string {
  return typeof value === 'string' && episodeKinds.includes(value)
    ? value
    : 'other';
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
  objects?: MemoryQueryFacet[];
  locations?: MemoryQueryFacet[];
  time?: { from?: number; to?: number; expressions?: string[] };
  states?: string[];
  intent: MemoryQueryIntent;
  requireRawEvidence: boolean;
}
