import type { MemoryEvent } from '../types/index.js';
import { resolveTrustedLocalDate } from './EpisodeBoundaryPolicy.js';
import { logicalTurnsFromPairs, type EpisodeReplayPair } from './EpisodeBoundaryReplayEngine.js';
import type { MemoryEpisode } from './EpisodeTypes.js';

export interface EpisodeInvariantViolation {
  reason: string;
  severity: 'info' | 'warning' | 'critical';
  recommendedAction: 'none' | 'inspect' | 'split-plan';
  requiresManualReview: boolean;
}

export function validateEpisodeInvariants(input: {
  episode: MemoryEpisode;
  pairs: EpisodeReplayPair[];
  timezone?: string;
}): EpisodeInvariantViolation[] {
  const violations: EpisodeInvariantViolation[] = [];
  const add = (reason: string, severity: EpisodeInvariantViolation['severity'] = 'warning') => {
    violations.push({
      reason,
      severity,
      recommendedAction: severity === 'critical' ? 'split-plan' : 'inspect',
      requiresManualReview: severity !== 'info',
    });
  };
  const { episode, pairs } = input;
  if (episode.eventCount !== pairs.length) add('stored_actual_event_count_mismatch', 'critical');
  if (!positionsAreContiguous(pairs)) add('duplicate_or_gapped_positions', 'critical');
  if (pairs.length) {
    if (episode.startEventId !== pairs[0].link.eventId || episode.endEventId !== pairs.at(-1)?.link.eventId) {
      add('start_end_pointer_mismatch', 'critical');
    }
  }
  if (pairs.some((pair) => !pair.event)) add('raw_event_missing', 'critical');
  if (pairs.some((pair) => scopeMismatch(episode, pair.event))) add('event_scope_mismatch', 'critical');
  for (const pair of pairs) {
    if (pair.event?.role === 'user') {
      const resolved = resolveTrustedLocalDate(pair.event, input.timezone);
      if (resolved.warning?.code === 'invalid_trusted_local_date') add('invalid_local_date', 'warning');
      if (resolved.warning?.code === 'legacy_unknown_local_date_source') add('legacy_unknown_local_date_source', 'warning');
    }
  }
  const turns = logicalTurnsFromPairs(pairs);
  const userTurns = turns.filter((turn) => turn.some((pair) => pair.event?.role === 'user'));
  userTurns.forEach((turn, index) => {
    const user = turn.find((pair) => pair.event?.role === 'user');
    if (!user) return;
    const relation = user.link.relation;
    if (['hard_topic_switch', 'starts_new_topic', 'switches_topic'].includes(relation) && index !== 0) add('invalid_hard_shift_position', 'critical');
    if (relation === 'ambiguous_shift' && index !== 0) add('invalid_ambiguous_shift_position', 'critical');
    if (relation === 'closes_episode' && index !== userTurns.length - 1) add('continuation_after_closure', 'critical');
  });
  if (episode.status === 'sealed' && pairs.length === 0) add('closure_receipt_status_mismatch', 'critical');
  return stableViolations(violations);
}

function positionsAreContiguous(pairs: EpisodeReplayPair[]): boolean {
  const seen = new Set<number>();
  for (let index = 0; index < pairs.length; index += 1) {
    const position = pairs[index].link.position;
    if (seen.has(position) || position !== index + 1) return false;
    seen.add(position);
  }
  return true;
}

function scopeMismatch(episode: MemoryEpisode, event: MemoryEvent | undefined): boolean {
  if (!event) return false;
  if (event.projectId && event.projectId !== episode.projectId) return true;
  if (event.sessionId && event.sessionId !== episode.sessionId) return true;
  if (episode.conversationThreadId && event.threadId && event.threadId !== episode.conversationThreadId) return true;
  return false;
}

function stableViolations(violations: EpisodeInvariantViolation[]): EpisodeInvariantViolation[] {
  const byReason = new Map<string, EpisodeInvariantViolation>();
  for (const violation of violations) byReason.set(violation.reason, violation);
  return [...byReason.values()].sort((left, right) => left.reason.localeCompare(right.reason));
}
