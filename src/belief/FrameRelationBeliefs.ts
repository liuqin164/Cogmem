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

/**
 * The belief-layer name for a frame relation.
 *
 * `LIKES` becomes `preference.LIKES`: the belief engine keys its preference handling on
 * the `preference.` prefix — decay, the preference-intent boost, and the "a newer
 * revision wins" rule — and a bare `LIKES` would be scored as a fact with a 30-day
 * half-life. The relation name survives inside the prefix.
 */
function beliefPredicate(relation: string): string {
  return relation === 'LIKES' ? 'preference.LIKES' : relation;
}

/**
 * What one pass wrote, and what it left alone.
 *
 * The caller may ignore it; it exists so a pass that wrote nothing is explainable
 * rather than merely quiet. (Not named "projection": GLOSSARY reserves that word for the
 * Memory Atlas, which is a different derived layer.)
 */
export interface FrameRelationWriteResult {
  written: number;
  /** Relations this pass left alone, with the reason, so a silent no-op is visible. */
  skipped: Array<{ relation: string; reason: 'not_projected' | 'unresolved_node' | 'empty_label' | 'already_recorded' }>;
  /** Relations the belief layer refused, with the store's own message. */
  failed: Array<{ relation: string; error: string }>;
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
): FrameRelationWriteResult {
  const nodes = new Map(frame.nodes.map((node) => [node.frameNodeId, node]));
  const projection: FrameRelationWriteResult = { written: 0, skipped: [], failed: [] };

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

    // Only an event the store can actually attach: naming one outside the project makes
    // `attachEvidence` throw and takes the belief with it. The claim is still worth
    // recording without its provenance line — the frame id in the metadata still points
    // at where it came from.
    const evidenceId = relation.evidenceEventIds[0] ?? frame.evidenceEventIds[0];
    const candidate: BeliefCandidate = {
      projectId: frame.projectId,
      scope: 'project',
      subject,
      predicate: beliefPredicate(relation.relationType),
      objectValue: { raw: objectValue, type: 'string' },
      confidence: relation.confidence,
      // A frame is the reading model's account of an episode, not a verified fact, and
      // the trust it carries should say so.
      sourceType: 'llm_inference',
      // The episode's own time, not the publication's: a replay of an older frame must
      // not look newer than the preference it would then supersede.
      validFrom: relation.validFrom ?? beliefStore.eventOccurredAt(evidenceId) ?? now,
      ...(beliefStore.eventInProject(evidenceId, frame.projectId) ? { sourceEventId: evidenceId } : {}),
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

    // One relation that cannot be written must not discard the others: the projection
    // runs after the frame is already published, so a throw here would report a failed
    // publication that in fact succeeded.
    try {
      const { belief }: { belief: BeliefRecord | null } = beliefStore.upsert(candidate, now);
      if (belief) projection.written += 1;
    } catch (error) {
      projection.failed.push({ relation: relation.relationType, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return projection;
}
