import type { MemoryDimension, MemoryRelationType } from './MemoryFrameTypes.js';

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
  ['actor', 'LIKES', 'entity'], ['actor', 'LIKES', 'object'], ['actor', 'LIKES', 'topic'], ['actor', 'LIKES', 'event'],
  ['actor', 'FRIEND_OF', 'actor'], ['actor', 'FRIEND_OF', 'entity'],
  ['actor', 'FAMILY_OF', 'actor'], ['actor', 'FAMILY_OF', 'entity'],
];

/** Whether a relation name is part of the vocabulary at all. */
export function isKnownRelationType(relation: string): boolean {
  return CONSTRAINTS.some(([, known]) => known === relation);
}

/**
 * Map a relation the reading model invented onto the vocabulary's catch-all.
 *
 * The vocabulary is curated because recall ranks by relation name: an
 * unregistered name is unqueryable. Coercing keeps the claim instead of
 * discarding the whole frame.
 */
export function normalizeRelationType(relation: string): string {
  return isKnownRelationType(relation) ? relation : 'RELATED_TO';
}

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
