import type { MemoryEvent } from '../types/index.js';
import type { EpisodeBoundaryConfig, EpisodeBoundaryGuardCode, EpisodeBoundaryGuardResult } from './EpisodeBoundaryPolicy.js';
import { EpisodeBoundaryPolicy, resolveTrustedLocalDate } from './EpisodeBoundaryPolicy.js';
import type { EpisodeEventLink, EpisodeStatus, TurnRelation } from './EpisodeTypes.js';

export type EpisodeReplayPair = { link: EpisodeEventLink; event?: MemoryEvent };

export interface EpisodeBoundaryReplayState {
  eventCount: number;
  startedAt?: number;
  lastEventAt?: number;
  lastTrustedUserLocalDate?: string;
  trustedLocalDates: string[];
}

export interface EpisodeBoundaryReplayBoundary {
  boundaryIndex: number;
  beforeEventId?: string;
  afterEventId?: string;
  primaryUserEventId?: string;
  relation?: TurnRelation;
  reason: string;
  guardCodes: EpisodeBoundaryGuardCode[];
  warnings: string[];
  detected: boolean;
  effective: boolean;
  disposition: 'explicit' | 'soft_review' | 'shadow' | 'enforced';
  guardResult?: EpisodeBoundaryGuardResult;
}

export interface EpisodeBoundaryReplayResult {
  logicalTurns: EpisodeReplayPair[][];
  detectedBoundaries: EpisodeBoundaryReplayBoundary[];
  effectiveBoundaries: EpisodeBoundaryReplayBoundary[];
  warnings: string[];
  structuralAnomalies: string[];
  runningState: EpisodeBoundaryReplayState;
  policyDisposition: 'disabled' | 'shadow' | 'enforce';
}

export function replayEpisodeBoundaries(input: {
  episode: { startedAt?: number; status?: EpisodeStatus };
  pairs: EpisodeReplayPair[];
  config: EpisodeBoundaryConfig;
  imported?: boolean;
  live?: boolean;
  initialState?: EpisodeBoundaryReplayState;
}): EpisodeBoundaryReplayResult {
  const policy = new EpisodeBoundaryPolicy(input.config);
  const state: EpisodeBoundaryReplayState = input.initialState ? {
    ...input.initialState,
    trustedLocalDates: [...input.initialState.trustedLocalDates],
  } : {
    eventCount: 0,
    startedAt: input.episode.startedAt,
    trustedLocalDates: [],
  };
  const logicalTurns = logicalTurnsFromPairs(input.pairs);
  const detectedBoundaries: EpisodeBoundaryReplayBoundary[] = [];
  const warnings = new Set<string>();
  const anomalies = new Set<string>();
  let pendingClosureAfter: EpisodeReplayPair[] | undefined;

  const pushBoundary = (boundary: Omit<EpisodeBoundaryReplayBoundary, 'boundaryIndex' | 'detected'>) => {
    const item: EpisodeBoundaryReplayBoundary = { ...boundary, boundaryIndex: detectedBoundaries.length, detected: true };
    detectedBoundaries.push(item);
    for (const warning of item.warnings) warnings.add(warning);
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
      if (turn.some((pair) => !pair.event)) anomalies.add('raw_event_missing');
      acceptTurn(state, turn, input.config.timezone, warnings);
      continue;
    }

    const relation = user.link.relation;
    if (startedAfterClosure) {
      // The closure-after boundary already started this segment.
    } else if (state.eventCount > 0 && isHardSwitch(relation)) {
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
    } else if (state.eventCount > 0 && relation === 'ambiguous_shift') {
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
    } else if (relation !== 'closes_episode') {
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
      for (const warning of result.warnings) warnings.add(warning.code);
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

    if (effectiveBoundaryBeforeTurn) resetSegmentState(state, turn);
    acceptTurn(state, turn, input.config.timezone, warnings);
    if (relation === 'closes_episode') pendingClosureAfter = turn;
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

export function replayPendingTurnBoundary(input: {
  config: EpisodeBoundaryConfig;
  active?: EpisodeBoundaryReplayState;
  pendingPairs: EpisodeReplayPair[];
  primaryEvent: MemoryEvent;
  imported?: boolean;
}): EpisodeBoundaryGuardResult {
  const active = input.active;
  const replay = replayEpisodeBoundaries({
    episode: { startedAt: active?.startedAt },
    pairs: input.pendingPairs,
    config: input.config,
    imported: input.imported,
    initialState: active,
  });
  const guarded = replay.detectedBoundaries.find((boundary) => boundary.guardResult)?.guardResult;
  if (guarded) return guarded;
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

export function logicalTurnsFromPairs(pairs: EpisodeReplayPair[]): EpisodeReplayPair[][] {
  const groups: EpisodeReplayPair[][] = [];
  let current: EpisodeReplayPair[] = [];
  let currentTurnKey: string | undefined;
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
    if (turnKey && !currentTurnKey) currentTurnKey = turnKey;
    if (pair.event?.role === 'user') currentHasUser = true;
  }
  if (current.length) groups.push(current);
  return groups;
}

function acceptTurn(state: EpisodeBoundaryReplayState, turn: EpisodeReplayPair[], timezone: string | undefined, warnings: Set<string>): void {
  for (const pair of turn) {
    const event = pair.event;
    const occurredAt = event?.occurredAt;
    const hasOccurredAt = typeof occurredAt === 'number' && Number.isFinite(occurredAt);
    const outOfOrder = hasOccurredAt && state.lastEventAt !== undefined && occurredAt < state.lastEventAt;
    if (event?.role === 'user') {
      const resolved = resolveTrustedLocalDate(event, timezone);
      if (resolved.date && !outOfOrder) {
        state.lastTrustedUserLocalDate = resolved.date;
        if (!state.trustedLocalDates.includes(resolved.date)) state.trustedLocalDates.push(resolved.date);
      } else if (resolved.warning && resolved.warning.code !== 'trusted_local_date_unavailable') {
        warnings.add(resolved.warning.code);
      }
    }
    if (hasOccurredAt) {
      if (outOfOrder) {
        warnings.add('out_of_order_timestamp');
      } else {
        state.lastEventAt = Math.max(state.lastEventAt ?? occurredAt, occurredAt);
      }
    }
    if (state.startedAt === undefined && hasOccurredAt) state.startedAt = occurredAt;
    state.eventCount += 1;
  }
}

function resetSegmentState(state: EpisodeBoundaryReplayState, turn: EpisodeReplayPair[]): void {
  const firstTimestamp = turn
    .map((pair) => pair.event?.occurredAt)
    .find((value): value is number => typeof value === 'number' && Number.isFinite(value));
  state.eventCount = 0;
  state.startedAt = firstTimestamp;
  state.lastEventAt = undefined;
  state.lastTrustedUserLocalDate = undefined;
  state.trustedLocalDates = [];
}

function primaryUser(turn: EpisodeReplayPair[]): EpisodeReplayPair | undefined {
  return turn.find((pair) => pair.event?.role === 'user');
}

function firstPair(turn: EpisodeReplayPair[]): EpisodeReplayPair | undefined {
  return turn[0];
}

function lastPair(turn: EpisodeReplayPair[]): EpisodeReplayPair | undefined {
  return turn.at(-1);
}

function previousAcceptedEventId(allPairs: EpisodeReplayPair[], turn: EpisodeReplayPair[]): string | undefined {
  const first = firstPair(turn);
  if (!first) return undefined;
  const index = allPairs.indexOf(first);
  return index > 0 ? allPairs[index - 1]?.link.eventId : undefined;
}

function turnKeyFor(event: MemoryEvent): string | undefined {
  if (event.turnId) return `id:${event.turnId}`;
  if (typeof event.turnSeq === 'number') return `seq:${event.turnSeq}`;
  return undefined;
}

function isHardSwitch(relation: TurnRelation): boolean {
  return relation === 'hard_topic_switch' || relation === 'starts_new_topic' || relation === 'switches_topic';
}

function isImportedTurn(turn: EpisodeReplayPair[]): boolean {
  return turn.some((pair) => {
    const payload = pair.event?.payload as { metadata?: Record<string, unknown> } | undefined;
    return payload?.metadata?.imported === true || payload?.metadata?.sourceRef !== undefined;
  });
}

function guardReason(codes: EpisodeBoundaryGuardCode[]): string {
  if (codes.includes('max_events_exceeded')) return 'max_events_boundary';
  if (codes.includes('trusted_local_date_changed')) return 'trusted_local_date_boundary';
  if (codes.includes('max_duration_exceeded')) return 'max_duration_boundary';
  if (codes.includes('max_idle_gap_exceeded')) return 'max_idle_gap_boundary';
  return codes[0] ?? 'policy_boundary';
}
