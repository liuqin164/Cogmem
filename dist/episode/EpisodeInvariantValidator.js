import { resolveTrustedLocalDate } from './EpisodeBoundaryPolicy.js';
import { logicalTurnsFromPairs } from './EpisodeBoundaryReplayEngine.js';
export function validateEpisodeInvariants(input) {
    const violations = [];
    const add = (reason, severity = 'warning') => {
        violations.push({
            reason,
            severity,
            recommendedAction: ['closure_receipt_status_mismatch', 'dream_job_status_mismatch'].includes(reason) ? 'inspect' : severity === 'critical' ? 'split-plan' : 'inspect',
            requiresManualReview: severity !== 'info',
        });
    };
    const { episode, pairs } = input;
    if (episode.eventCount !== pairs.length)
        add('stored_actual_event_count_mismatch', 'critical');
    if (!positionsAreContiguous(pairs))
        add('duplicate_or_gapped_positions', 'critical');
    if (pairs.length) {
        if (episode.startEventId !== pairs[0].link.eventId || episode.endEventId !== pairs.at(-1)?.link.eventId) {
            add('start_end_pointer_mismatch', 'critical');
        }
        const firstEvent = pairs[0].event;
        const lastEvent = pairs.at(-1)?.event;
        if (firstEvent?.globalSeq !== undefined && episode.startSeq !== undefined && firstEvent.globalSeq !== episode.startSeq)
            add('start_end_seq_mismatch', 'critical');
        if (lastEvent?.globalSeq !== undefined && episode.endSeq !== undefined && lastEvent.globalSeq !== episode.endSeq)
            add('start_end_seq_mismatch', 'critical');
    }
    else if (episode.startEventId || episode.endEventId) {
        add('empty_episode_pointer_mismatch', 'critical');
    }
    if (pairs.some((pair) => !pair.event))
        add('raw_event_missing', 'critical');
    if (pairs.some((pair) => scopeMismatch(episode, pair.event)))
        add('event_scope_mismatch', 'critical');
    for (const pair of pairs) {
        if (pair.event?.role === 'user') {
            const resolved = resolveTrustedLocalDate(pair.event, input.timezone);
            if (resolved.warning?.code === 'invalid_trusted_local_date')
                add('invalid_local_date', 'warning');
            if (resolved.warning?.code === 'legacy_unknown_local_date_source')
                add('legacy_unknown_local_date_source', 'warning');
        }
    }
    const turns = logicalTurnsFromPairs(pairs);
    const userTurns = turns.filter((turn) => turn.some((pair) => pair.event?.role === 'user'));
    userTurns.forEach((turn, index) => {
        const user = turn.find((pair) => pair.event?.role === 'user');
        if (!user)
            return;
        const relation = user.link.relation;
        if (['hard_topic_switch', 'starts_new_topic', 'switches_topic'].includes(relation) && index !== 0)
            add('invalid_hard_shift_position', 'critical');
        if (relation === 'ambiguous_shift' && index !== 0)
            add('invalid_ambiguous_shift_position', 'critical');
        if (relation === 'closes_episode' && index !== userTurns.length - 1)
            add('continuation_after_closure', 'critical');
    });
    const receipts = input.closureReceipts || [];
    if ((episode.status === 'sealed' || episode.status === 'soft_sealed') && receipts.length === 0)
        add('closure_receipt_status_mismatch', 'critical');
    if (episode.status === 'open' && receipts.length > 0 && userTurns.some((turn) => turn.some((pair) => pair.link.relation === 'closes_episode')))
        add('closure_receipt_status_mismatch', 'critical');
    if (input.dreamJobState && episode.status !== 'sealed' && ['pending', 'processing', 'retry_scheduled', 'failed_retryable'].includes(input.dreamJobState))
        add('dream_job_status_mismatch', 'critical');
    if (input.dreamJobState === 'processed' && episode.dreamStatus !== 'processed')
        add('dream_job_status_mismatch', 'critical');
    return stableViolations(violations);
}
function positionsAreContiguous(pairs) {
    const seen = new Set();
    for (let index = 0; index < pairs.length; index += 1) {
        const position = pairs[index].link.position;
        if (seen.has(position) || position !== index + 1)
            return false;
        seen.add(position);
    }
    return true;
}
function scopeMismatch(episode, event) {
    if (!event)
        return false;
    if (event.projectId !== episode.projectId)
        return true;
    if (event.sessionId !== episode.sessionId)
        return true;
    if ((episode.conversationThreadId || '') !== (event.threadId || ''))
        return true;
    const metadata = event.payload?.metadata;
    if (episode.sourceAgent && metadata?.sourceAgent !== undefined && metadata.sourceAgent !== episode.sourceAgent)
        return true;
    return false;
}
function stableViolations(violations) {
    const byReason = new Map();
    for (const violation of violations)
        byReason.set(violation.reason, violation);
    return [...byReason.values()].sort((left, right) => left.reason.localeCompare(right.reason));
}
