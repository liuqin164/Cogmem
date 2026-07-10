import { EpisodeBoundaryPolicy, resolveTrustedLocalDate } from './EpisodeBoundaryPolicy.js';
export function replayEpisodeBoundaries(input) {
    const policy = new EpisodeBoundaryPolicy(input.config);
    const state = input.initialState ? {
        ...input.initialState,
        trustedLocalDates: [...input.initialState.trustedLocalDates],
    } : {
        eventCount: 0,
        startedAt: input.episode.startedAt,
        trustedLocalDates: [],
    };
    const logicalTurns = logicalTurnsFromPairs(input.pairs);
    const detectedBoundaries = [];
    const warnings = new Set();
    const anomalies = new Set();
    let pendingClosureAfter;
    const pushBoundary = (boundary) => {
        const item = { ...boundary, boundaryIndex: detectedBoundaries.length, detected: true };
        detectedBoundaries.push(item);
        for (const warning of item.warnings)
            warnings.add(warning);
    };
    for (const turn of logicalTurns) {
        const user = primaryUser(turn);
        const imported = input.imported ?? isImportedTurn(turn);
        let startedAfterClosure = false;
        let effectiveBoundaryBeforeTurn = false;
        if (pendingClosureAfter) {
            pushBoundary({
                beforeEventId: lastPair(pendingClosureAfter)?.link.eventId,
                afterEventId: firstPair(turn)?.link.eventId,
                primaryUserEventId: user?.event?.eventId,
                relation: user?.link.relation,
                reason: 'explicit_closure_boundary',
                guardCodes: [],
                warnings: [],
                effective: true,
                disposition: 'explicit',
            });
            pendingClosureAfter = undefined;
            startedAfterClosure = true;
            effectiveBoundaryBeforeTurn = true;
        }
        if (!user?.event) {
            if (turn.some((pair) => !pair.event))
                anomalies.add('raw_event_missing');
            acceptTurn(state, turn, input.config.timezone, warnings);
            continue;
        }
        const relation = user.link.relation;
        if (startedAfterClosure) {
            // The closure-after boundary already started this segment.
        }
        else if (state.eventCount > 0 && isHardSwitch(relation)) {
            pushBoundary({
                beforeEventId: previousAcceptedEventId(input.pairs, turn),
                afterEventId: firstPair(turn)?.link.eventId,
                primaryUserEventId: user.event.eventId,
                relation,
                reason: 'hard_topic_switch_boundary',
                guardCodes: [],
                warnings: [],
                effective: true,
                disposition: 'explicit',
            });
            effectiveBoundaryBeforeTurn = true;
        }
        else if (state.eventCount > 0 && relation === 'ambiguous_shift') {
            pushBoundary({
                beforeEventId: previousAcceptedEventId(input.pairs, turn),
                afterEventId: firstPair(turn)?.link.eventId,
                primaryUserEventId: user.event.eventId,
                relation,
                reason: 'ambiguous_shift_boundary',
                guardCodes: [],
                warnings: [],
                effective: true,
                disposition: 'soft_review',
            });
            effectiveBoundaryBeforeTurn = true;
        }
        else if (relation !== 'closes_episode') {
            const result = policy.evaluate({
                active: {
                    eventCount: state.eventCount,
                    startedAt: state.startedAt,
                    updatedAt: state.lastEventAt,
                    localDates: state.trustedLocalDates,
                    lastTrustedLocalDate: state.lastTrustedUserLocalDate,
                },
                primaryEvent: user.event,
                imported,
            });
            for (const warning of result.warnings)
                warnings.add(warning.code);
            if (result.guardCodes.length) {
                const effective = result.guardAction === 'enforce_new_episode';
                pushBoundary({
                    beforeEventId: previousAcceptedEventId(input.pairs, turn),
                    afterEventId: firstPair(turn)?.link.eventId,
                    primaryUserEventId: user.event.eventId,
                    relation,
                    reason: guardReason(result.guardCodes),
                    guardCodes: result.guardCodes,
                    warnings: result.warnings.map((warning) => warning.code),
                    effective,
                    disposition: effective ? 'enforced' : 'shadow',
                    guardResult: result,
                });
                effectiveBoundaryBeforeTurn = effective;
            }
        }
        if (effectiveBoundaryBeforeTurn)
            resetSegmentState(state, turn);
        acceptTurn(state, turn, input.config.timezone, warnings);
        if (relation === 'closes_episode')
            pendingClosureAfter = turn;
    }
    return {
        logicalTurns,
        detectedBoundaries,
        effectiveBoundaries: detectedBoundaries.filter((boundary) => boundary.effective),
        warnings: [...warnings].sort(),
        structuralAnomalies: [...anomalies].sort(),
        runningState: state,
        policyDisposition: !input.config.enabled || input.config.mode === 'off' ? 'disabled' : input.config.mode,
    };
}
/** Reduces accepted evidence without evaluating a new boundary. */
export function replayEpisodeBoundaryState(input) {
    const state = {
        eventCount: 0,
        startedAt: input.episode.startedAt,
        trustedLocalDates: [],
    };
    const warnings = new Set();
    for (const turn of logicalTurnsFromPairs(input.pairs))
        acceptTurn(state, turn, input.timezone, warnings);
    return state;
}
export function replayPendingTurnBoundary(input) {
    const active = input.active;
    const replay = replayEpisodeBoundaries({
        episode: { startedAt: active?.startedAt },
        pairs: input.pendingPairs,
        config: input.config,
        imported: input.imported,
        initialState: active,
    });
    const guarded = replay.detectedBoundaries.find((boundary) => boundary.guardResult)?.guardResult;
    if (guarded)
        return guarded;
    return new EpisodeBoundaryPolicy(input.config).evaluate({
        active: active ? {
            eventCount: active.eventCount,
            startedAt: active.startedAt,
            updatedAt: active.lastEventAt,
            localDates: active.trustedLocalDates,
            lastTrustedLocalDate: active.lastTrustedUserLocalDate,
        } : undefined,
        primaryEvent: input.primaryEvent,
        imported: input.imported,
    });
}
export function logicalTurnsFromPairs(pairs) {
    const groups = [];
    let current = [];
    let currentTurnKey;
    let currentHasUser = false;
    for (const pair of pairs) {
        const turnKey = pair.event ? turnKeyFor(pair.event) : undefined;
        const explicitTurnChange = Boolean(currentTurnKey && turnKey && currentTurnKey !== turnKey);
        const roleBoundary = pair.event?.role === 'user' && currentHasUser && !explicitTurnChange;
        if (current.length && (explicitTurnChange || roleBoundary)) {
            groups.push(current);
            current = [];
            currentTurnKey = undefined;
            currentHasUser = false;
        }
        current.push(pair);
        if (turnKey && !currentTurnKey)
            currentTurnKey = turnKey;
        if (pair.event?.role === 'user')
            currentHasUser = true;
    }
    if (current.length)
        groups.push(current);
    return groups;
}
function acceptTurn(state, turn, timezone, warnings) {
    for (const pair of turn) {
        const event = pair.event;
        const occurredAt = event?.occurredAt;
        const hasOccurredAt = typeof occurredAt === 'number' && Number.isFinite(occurredAt);
        const outOfOrder = hasOccurredAt && state.lastEventAt !== undefined && occurredAt < state.lastEventAt;
        if (event?.role === 'user') {
            const resolved = resolveTrustedLocalDate(event, timezone);
            if (resolved.date && !outOfOrder) {
                state.lastTrustedUserLocalDate = resolved.date;
                if (!state.trustedLocalDates.includes(resolved.date))
                    state.trustedLocalDates.push(resolved.date);
            }
            else if (resolved.warning && resolved.warning.code !== 'trusted_local_date_unavailable') {
                warnings.add(resolved.warning.code);
            }
        }
        if (hasOccurredAt) {
            if (outOfOrder) {
                warnings.add('out_of_order_timestamp');
            }
            else {
                state.lastEventAt = Math.max(state.lastEventAt ?? occurredAt, occurredAt);
            }
        }
        if (state.startedAt === undefined && hasOccurredAt)
            state.startedAt = occurredAt;
        state.eventCount += 1;
    }
}
function resetSegmentState(state, turn) {
    const firstTimestamp = turn
        .map((pair) => pair.event?.occurredAt)
        .find((value) => typeof value === 'number' && Number.isFinite(value));
    state.eventCount = 0;
    state.startedAt = firstTimestamp;
    state.lastEventAt = undefined;
    state.lastTrustedUserLocalDate = undefined;
    state.trustedLocalDates = [];
}
function primaryUser(turn) {
    return turn.find((pair) => pair.event?.role === 'user');
}
function firstPair(turn) {
    return turn[0];
}
function lastPair(turn) {
    return turn.at(-1);
}
function previousAcceptedEventId(allPairs, turn) {
    const first = firstPair(turn);
    if (!first)
        return undefined;
    const index = allPairs.indexOf(first);
    return index > 0 ? allPairs[index - 1]?.link.eventId : undefined;
}
function turnKeyFor(event) {
    if (event.turnId)
        return `id:${event.turnId}`;
    if (typeof event.turnSeq === 'number')
        return `seq:${event.turnSeq}`;
    return undefined;
}
function isHardSwitch(relation) {
    return relation === 'hard_topic_switch' || relation === 'starts_new_topic' || relation === 'switches_topic';
}
function isImportedTurn(turn) {
    return turn.some((pair) => {
        const payload = pair.event?.payload;
        return payload?.metadata?.imported === true || payload?.metadata?.sourceRef !== undefined;
    });
}
function guardReason(codes) {
    if (codes.includes('max_events_exceeded'))
        return 'max_events_boundary';
    if (codes.includes('trusted_local_date_changed'))
        return 'trusted_local_date_boundary';
    if (codes.includes('max_duration_exceeded'))
        return 'max_duration_boundary';
    if (codes.includes('max_idle_gap_exceeded'))
        return 'max_idle_gap_boundary';
    return codes[0] ?? 'policy_boundary';
}
