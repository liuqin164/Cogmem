import type { BeliefCandidate, BeliefRecord } from '../types/index.js';
import type { MemoryFrameV1 } from '../semantic/MemoryFrameTypes.js';
import type { BeliefStore } from './BeliefStore.js';

/**
 * The frame relations that are also claims about the world, and therefore belong in the
 * belief layer as well as the frame layer (#102).
 *
 * The frame layer answers "what did this episode say". The belief layer answers "what is
 * true now, and what did it replace" — that is the one a host's recall reads, so a
 * preference that only ever lived in a frame was a preference nothing could query.
 */
const PROJECTED_RELATIONS = new Set(['LIKES', 'FRIEND_OF', 'FAMILY_OF', 'RELATED_TO']);

/**
 * The predicates that hold one value per subject.
 *
 * A preference is the case the ticket names: "used to like fishing" must leave the old
 * row behind with `superseded_by_belief_id` and let recall return the current one. A
 * relationship is not that shape — a person has many friends — so `FRIEND_OF` and
 * `FAMILY_OF` are keyed by their object and never supersede each other. `RELATED_TO` is
 * the catch-all for a claim the vocabulary has no name for, so it is treated the same
 * way: recording it must not silently delete the previous catch-all.
 */
const SINGLE_VALUED_RELATIONS = new Set(['LIKES']);

export interface FrameRelationProjection {
  written: number;
  /** Relations this pass left alone, with the reason, so a silent no-op is visible. */
  skipped: Array<{ relation: string; reason: 'not_projected' | 'unresolved_node' | 'empty_label' | 'already_recorded' }>;
}

/**
 * Record a frame's preference and relationship relations as beliefs.
 *
 * Runs when a frame becomes active, is idempotent, and never invents a node: a relation
 * whose endpoints the frame does not carry is skipped rather than guessed, because a
 * belief is what recall will read back to the user.
 */
export function projectFrameRelationsToBeliefs(
  beliefStore: BeliefStore,
  frame: MemoryFrameV1,
  now: number = Date.now(),
): FrameRelationProjection {
  const nodes = new Map(frame.nodes.map((node) => [node.frameNodeId, node]));
  const projection: FrameRelationProjection = { written: 0, skipped: [] };

  for (const relation of frame.relations) {
    if (!PROJECTED_RELATIONS.has(relation.relationType)) {
      projection.skipped.push({ relation: relation.relationType, reason: 'not_projected' });
      continue;
    }
    const source = nodes.get(relation.sourceFrameNodeId);
    const target = nodes.get(relation.targetFrameNodeId);
    if (!source || !target) {
      projection.skipped.push({ relation: relation.relationType, reason: 'unresolved_node' });
      continue;
    }
    const subject = source.label.trim();
    const objectValue = target.label.trim();
    if (!subject || !objectValue) {
      projection.skipped.push({ relation: relation.relationType, reason: 'empty_label' });
      continue;
    }

    const candidate: BeliefCandidate = {
      projectId: frame.projectId,
      scope: 'project',
      subject,
      predicate: relation.relationType,
      objectValue: { raw: objectValue, type: 'string' },
      confidence: relation.confidence,
      // A frame is the reading model's account of an episode, not a verified fact, and
      // the trust it carries should say so.
      sourceType: 'llm_inference',
      validFrom: now,
      sourceEventId: relation.evidenceEventIds[0] ?? frame.evidenceEventIds[0],
      extractionReason: relation.relationType === 'LIKES' ? 'preference_signal' : 'explicit_user_statement',
      explanation: `frame relation in ${frame.episodeId}`,
      metadata: { frameId: frame.frameId, episodeId: frame.episodeId },
      ...(SINGLE_VALUED_RELATIONS.has(relation.relationType) ? {} : { canonicalKeyDiscriminator: objectValue }),
    };

    // Idempotent: republishing a frame, or a second episode repeating the same claim,
    // must not add a row per occurrence. `upsert` treats a same-value restatement as a
    // coexistence and would insert one.
    if (beliefStore.findActiveEquivalent(candidate).length > 0) {
      projection.skipped.push({ relation: relation.relationType, reason: 'already_recorded' });
      continue;
    }

    const { belief }: { belief: BeliefRecord | null } = beliefStore.upsert(candidate, now);
    if (belief) projection.written += 1;
  }

  return projection;
}
