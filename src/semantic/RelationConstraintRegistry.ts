import type { MemoryDimension, MemoryFrameV1, MemoryRelationType } from './MemoryFrameTypes.js';

type Endpoint = readonly [MemoryDimension, MemoryRelationType, MemoryDimension];

const CONSTRAINTS: Endpoint[] = [
  ['actor', 'PARTICIPATED_IN', 'event'], ['actor', 'PARTICIPATED_IN', 'raw_event'], ['actor', 'PERFORMED', 'task'], ['event', 'PART_OF_PROJECT', 'project'],
  ['event', 'PART_OF_EVENT', 'event'], ['event', 'ADDRESSES_ISSUE', 'issue'], ['event', 'OCCURRED_ON', 'time'], ['raw_event', 'OCCURRED_ON', 'time'], ['episode', 'OCCURRED_ON', 'time'],
  ['event', 'OCCURRED_IN', 'location'], ['task', 'ADVANCES_TASK', 'event'], ['event', 'ADVANCES_TASK', 'task'], ['task', 'HAS_STATE', 'state'],
  ['issue', 'ABOUT_TOPIC', 'topic'], ['topic', 'NARROWER_THAN', 'topic'], ['topic', 'BROADER_THAN', 'topic'], ['episode', 'SUPPORTED_BY', 'event'], ['episode', 'SUPPORTED_BY', 'raw_event'],
  ['event', 'INVOLVES', 'entity'], ['event', 'INVOLVES', 'object'], ['task', 'INVOLVES', 'object'], ['object', 'LOCATED_AT', 'location'], ['object', 'HAS_STATE', 'state'], ['task', 'DEPENDS_ON', 'task'], ['task', 'BLOCKED_BY', 'issue'],
  ['entity', 'HAS_STATE', 'state'], ['event', 'HAS_STATE', 'state'], ['event', 'DERIVED_FROM', 'event'], ['event', 'SAME_EVENT', 'event'], ['issue', 'SAME_ISSUE', 'issue'],
  ['episode', 'FOLLOWS_UP', 'episode'], ['episode', 'RELATED_TO', 'episode'], ['episode', 'CORRECTS', 'episode'], ['episode', 'CONTRADICTS', 'episode'], ['episode', 'SUPERSEDES', 'episode'],
  ['event', 'LOCATED_AT', 'location'], ['event', 'CHANGED_FROM', 'state'], ['event', 'CHANGED_TO', 'state'], ['event', 'ABOUT_TOPIC', 'topic'], ['event', 'ADDRESSES_ISSUE', 'issue'],
  ['episode', 'PART_OF_PROJECT', 'project'], ['episode', 'PART_OF_EVENT', 'event'], ['episode', 'SUPPORTED_BY', 'event'],
  // What a person asks about most: what they like, and who they know. A
  // preference or a relationship is a claim about the world, so it is recorded
  // as a relation on the actor, not as a new dimension.
  ['actor', 'LIKES', 'entity'], ['actor', 'LIKES', 'object'], ['actor', 'LIKES', 'topic'], ['actor', 'LIKES', 'event'], ['actor', 'LIKES', 'actor'],
  ['actor', 'FRIEND_OF', 'actor'], ['actor', 'FRIEND_OF', 'entity'],
  ['actor', 'FAMILY_OF', 'actor'], ['actor', 'FAMILY_OF', 'entity'],
];

/** Whether a relation name is part of the vocabulary at all. */
/** A type predicate: membership is exactly what the callers then rely on. */
export function isKnownRelationType(relation: string): relation is MemoryRelationType {
  return CONSTRAINTS.some(([, known]) => known === relation);
}

/**
 * Map a relation the reading model invented onto the vocabulary's catch-all.
 *
 * The vocabulary is curated because recall ranks by relation name: an
 * unregistered name is unqueryable. Coercing keeps the claim instead of
 * discarding the whole frame.
 */
export function normalizeRelationType(relation: string): MemoryRelationType {
  return isKnownRelationType(relation) ? relation : 'RELATED_TO';
}

/**
 * Rewrite a reading model's relation names onto the vocabulary.
 *
 * Applied where the model's output is parsed, before it is validated: the
 * validator rejects an unknown name, and rejecting it there would drop the whole
 * reading over one word. Only model-authored frames are rewritten — a
 * deterministic frame that invents a relation is a defect, not a paraphrase.
 */
export function normalizeFrameRelations<T>(frame: T): T {
  const candidate = frame as { sourceAuthority?: string; nodes?: unknown; relations?: unknown } | null;
  if (!candidate || typeof candidate !== 'object' || candidate.sourceAuthority !== 'processor' || !Array.isArray(candidate.relations)) return frame;
  const dimensions = new Map<string, string>();
  if (Array.isArray(candidate.nodes)) {
    for (const node of candidate.nodes as Array<{ frameNodeId?: unknown; dimension?: unknown }>) {
      if (node && typeof node.frameNodeId === 'string' && typeof node.dimension === 'string') dimensions.set(node.frameNodeId, node.dimension);
    }
  }
  return {
    ...candidate,
    relations: candidate.relations.map((relation: { relationType?: unknown; sourceFrameNodeId?: unknown; targetFrameNodeId?: unknown }) => {
      if (!relation || typeof relation !== 'object' || typeof relation.relationType !== 'string') return relation;
      const relationType = normalizeRelationType(relation.relationType);
      const source = typeof relation.sourceFrameNodeId === 'string' ? dimensions.get(relation.sourceFrameNodeId) : undefined;
      const target = typeof relation.targetFrameNodeId === 'string' ? dimensions.get(relation.targetFrameNodeId) : undefined;
      // A known relation between dimensions it does not hold for is the same
      // situation as a relation the vocabulary never knew: the frame is worth
      // keeping and the claim is worth keeping as a generic one. Measured on
      // the box: `event -[INVOLVES]-> topic` cost the whole frame.
      if (source && target && !relationConstraintRegistry.isAllowed(source as MemoryDimension, relationType, target as MemoryDimension)) {
        return { ...relation, relationType: 'RELATED_TO' };
      }
      return { ...relation, relationType };
    }),
  } as T;
}

/**
 * The constraint table as prompt text.
 *
 * The reading model is told the relation *names*; without their endpoints it
 * invents pairs (measured: `actor -[PART_OF_PROJECT]-> project`,
 * `actor -[ADVANCES_TASK]-> task`), and the frame is rejected after the fact.
 * Generated from the table itself so the two cannot drift.
 */
export const RELATION_ENDPOINTS_TEXT = CONSTRAINTS.map(([source, relation, target]) => `${source} -[${relation}]-> ${target}`).join('; ');

export class RelationConstraintRegistry {
  isAllowed(source: MemoryDimension, relation: MemoryRelationType, target: MemoryDimension): boolean {
    // The catch-all is allowed between any two nodes: it is what a claim the
    // vocabulary has no name for is recorded as, and refusing it would drop the
    // claim along with the name.
    if (relation === 'RELATED_TO') return true;
    return CONSTRAINTS.some(([s, r, t]) => s === source && r === relation && t === target);
  }

  validate(source: MemoryDimension, relation: MemoryRelationType, target: MemoryDimension): void {
    if (!this.isAllowed(source, relation, target)) throw new Error(`invalid_memory_frame_relation:${source}:${relation}:${target}`);
  }
}

export const relationConstraintRegistry = new RelationConstraintRegistry();
