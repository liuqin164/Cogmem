import { createHash } from 'node:crypto';
import type { MemoryEvent } from '../types/index.js';
import type { EpisodeStore } from './EpisodeStore.js';
import type { EpisodeEventLink, TurnRelation } from './EpisodeTypes.js';
import { DEFAULT_EPISODE_BOUNDARY_CONFIG } from './EpisodeBoundaryPolicy.js';

export const EPISODE_SPLIT_PLANNER_VERSION = 'episode_split_preview.v1';

export interface EpisodeSplitPlanSegment {
  segmentIndex: number;
  eventIds?: string[];
  eventIdsHash: string;
  eventIdsOmitted: number;
  eventIdsCursor?: string;
  startEventId?: string;
  endEventId?: string;
  eventCount: number;
  reason: string;
  startedAt?: number;
  endedAt?: number;
  userEventCount: number;
  assistantEventCount: number;
  toolEventCount: number;
  systemEventCount: number;
}

export interface EpisodeSplitProposedBoundary {
  boundaryIndex: number;
  beforeEventId?: string;
  afterEventId?: string;
  reason: string;
  relation?: TurnRelation;
}

export interface EpisodeSplitImpactInventory {
  eventCount: number;
  userEventCount: number;
  assistantEventCount: number;
  toolEventCount: number;
  systemEventCount: number;
  hardShiftCount: number;
  trustedLocalDates: string[];
}

export interface EpisodeSplitPlan {
  planId: string;
  plannerVersion: string;
  projectId: string;
  episodeId: string;
  sourceFingerprint: string;
  normalizedPolicy: {
    maxEvents: number;
    maxDurationMs: number;
    maxIdleGapMs: number;
    timezone?: string;
  };
  proposedBoundaries: EpisodeSplitProposedBoundary[];
  impactInventory: EpisodeSplitImpactInventory;
  segments: EpisodeSplitPlanSegment[];
  warnings: string[];
  unresolvedEventCount: number;
  missingRawEventIds: string[];
  evidenceIntegrityStatus: 'ok' | 'missing_raw_events';
  requiresManualReview: boolean;
  applyableInCurrentVersion: false;
  applyCommand: null;
}

export class EpisodeSplitPlanner {
  constructor(
    private readonly store: EpisodeStore,
    private readonly resolveEvent?: (eventId: string) => MemoryEvent | null | undefined,
  ) {}

  plan(options: {
    projectId: string;
    episodeId: string;
    maxEvents?: number;
    maxDurationMs?: number;
    maxIdleGapMs?: number;
    timezone?: string;
    includeEventIds?: boolean;
  }): EpisodeSplitPlan {
    const episode = this.store.getEpisode(options.episodeId);
    if (!episode || episode.projectId !== options.projectId) throw new Error(`episode_project_mismatch:${options.episodeId}`);
    const links = this.store.listEventLinks(options.episodeId);
    const pairs = links.map((link) => ({ link, event: this.resolveEvent?.(link.eventId) || undefined }));
    const events = pairs.map((item) => item.event).filter((event): event is MemoryEvent => Boolean(event));
    const missingRawEventIds = pairs.filter((item) => !item.event).map((item) => item.link.eventId);
    const policy = {
      maxEvents: Math.max(1, Math.trunc(options.maxEvents ?? DEFAULT_EPISODE_BOUNDARY_CONFIG.maxEvents)),
      maxDurationMs: Math.max(1, Math.trunc(options.maxDurationMs ?? DEFAULT_EPISODE_BOUNDARY_CONFIG.maxDurationMs)),
      maxIdleGapMs: Math.max(1, Math.trunc(options.maxIdleGapMs ?? DEFAULT_EPISODE_BOUNDARY_CONFIG.maxIdleGapMs)),
      timezone: options.timezone,
    };
    const warnings: string[] = [];
    if (missingRawEventIds.length) warnings.push('unresolved_raw_events');
    if (events[0] && events[0].role !== 'user') warnings.push('leading_non_user_event');
    const userCount = events.filter((event) => event.role === 'user').length;
    if (userCount === 0) warnings.push('no_user_event_episode');
    const groups = logicalTurns(pairs);
    const segments: EpisodeSplitPlanSegment[] = [];
    const proposedBoundaries: EpisodeSplitProposedBoundary[] = [];
    let current: Pair[] = [];
    for (const group of groups) {
      const boundary = current.length ? boundaryReason(current, group, policy) : undefined;
      if (boundary) {
        proposedBoundaries.push({
          boundaryIndex: proposedBoundaries.length,
          beforeEventId: current.at(-1)?.link.eventId,
          afterEventId: group[0]?.link.eventId,
          reason: boundary,
          relation: group[0]?.link.relation,
        });
        segments.push(segment(segments.length, current, boundary, options.includeEventIds === true));
        current = [];
      }
      current.push(...group);
    }
    if (current.length > 0) segments.push(segment(segments.length, current, segments.length ? 'tail' : 'single_segment', options.includeEventIds === true));
    const fingerprint = sourceFingerprint(pairs);
    const canonicalSegments = segments.map((item) => ({
      segmentIndex: item.segmentIndex,
      eventIdsHash: item.eventIdsHash,
      startEventId: item.startEventId,
      endEventId: item.endEventId,
      eventCount: item.eventCount,
      reason: item.reason,
    }));
    const hash = createHash('sha256').update(JSON.stringify([
      options.projectId,
      options.episodeId,
      fingerprint,
      policy,
      canonicalSegments,
      proposedBoundaries,
    ])).digest('hex');
    return {
      planId: `episode-split-plan-${hash.slice(0, 24)}`,
      plannerVersion: EPISODE_SPLIT_PLANNER_VERSION,
      projectId: options.projectId,
      episodeId: options.episodeId,
      sourceFingerprint: fingerprint,
      normalizedPolicy: policy,
      proposedBoundaries,
      impactInventory: impactInventory(pairs),
      segments,
      warnings,
      unresolvedEventCount: missingRawEventIds.length,
      missingRawEventIds: missingRawEventIds.slice(0, 50),
      evidenceIntegrityStatus: missingRawEventIds.length ? 'missing_raw_events' : 'ok',
      requiresManualReview: userCount === 0 || missingRawEventIds.length > 0,
      applyableInCurrentVersion: false,
      applyCommand: null,
    };
  }
}

type Pair = { link: EpisodeEventLink; event?: MemoryEvent };

function logicalTurns(pairs: Pair[]): Pair[][] {
  const groups: Pair[][] = [];
  let current: Pair[] = [];
  let currentTurnKey: string | undefined;
  let currentHasUser = false;
  for (const pair of pairs) {
    const event = pair.event;
    const turnKey = event ? turnKeyFor(event) : undefined;
    const explicitTurnChange = Boolean(currentTurnKey && turnKey && currentTurnKey !== turnKey);
    const roleBoundary = event?.role === 'user' && currentHasUser && !explicitTurnChange;
    if (current.length > 0 && (explicitTurnChange || roleBoundary)) {
      groups.push(current);
      current = [];
      currentTurnKey = undefined;
      currentHasUser = false;
    }
    current.push(pair);
    if (turnKey && !currentTurnKey) currentTurnKey = turnKey;
    if (event?.role === 'user') currentHasUser = true;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

const MAX_RETURNED_EVENT_IDS = 500;

function segment(index: number, pairs: Pair[], reason: string, includeEventIds: boolean): EpisodeSplitPlanSegment {
  const eventIds = pairs.map((item) => item.link.eventId);
  const returned = includeEventIds && eventIds.length <= MAX_RETURNED_EVENT_IDS ? eventIds : undefined;
  const times = pairs.map((item) => item.event?.occurredAt).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const counts = roleCounts(pairs);
  return {
    segmentIndex: index,
    eventIds: returned,
    eventIdsHash: createHash('sha256').update(JSON.stringify(eventIds)).digest('hex'),
    eventIdsOmitted: returned ? 0 : eventIds.length,
    eventIdsCursor: returned ? undefined : `segment:${index}:eventIds`,
    startEventId: eventIds[0],
    endEventId: eventIds.at(-1),
    eventCount: eventIds.length,
    reason,
    startedAt: times.length ? Math.min(...times) : undefined,
    endedAt: times.length ? Math.max(...times) : undefined,
    ...counts,
  };
}

function sourceFingerprint(pairs: Pair[]): string {
  const hash = createHash('sha256');
  for (const { link, event } of pairs) {
    hash.update(JSON.stringify([
      link.eventId,
      link.position,
      link.relation,
      event?.role,
      event?.turnId,
      event?.turnSeq,
      event?.eventOrdinal,
      event?.occurredAt,
      event?.localDate,
      event?.contentHash,
    ]));
  }
  return hash.digest('hex');
}

function boundaryReason(
  current: Pair[],
  next: Pair[],
  policy: { maxEvents: number; maxDurationMs: number; maxIdleGapMs: number; timezone?: string },
): string | undefined {
  const nextRelation = next[0]?.link.relation;
  if (nextRelation === 'hard_topic_switch' || nextRelation === 'starts_new_topic' || nextRelation === 'switches_topic') return 'hard_topic_switch_boundary';
  const currentLastDate = lastTrustedDate(current, policy.timezone);
  const nextFirstDate = firstTrustedDate(next, policy.timezone);
  if (currentLastDate && nextFirstDate && currentLastDate !== nextFirstDate) return 'trusted_local_date_boundary';
  const currentStart = firstTime(current);
  const nextEnd = lastTime(next);
  if (currentStart !== undefined && nextEnd !== undefined && nextEnd - currentStart > policy.maxDurationMs) return 'max_duration_boundary';
  const currentLast = lastTime(current);
  const nextFirst = firstTime(next);
  if (currentLast !== undefined && nextFirst !== undefined && nextFirst - currentLast > policy.maxIdleGapMs) return 'max_idle_gap_boundary';
  if (current.length + next.length > policy.maxEvents) return 'max_events_boundary';
  return undefined;
}

function firstTime(pairs: Pair[]): number | undefined {
  return pairs.find((item) => typeof item.event?.occurredAt === 'number')?.event?.occurredAt;
}

function lastTime(pairs: Pair[]): number | undefined {
  return [...pairs].reverse().find((item) => typeof item.event?.occurredAt === 'number')?.event?.occurredAt;
}

function firstTrustedDate(pairs: Pair[], timezone?: string): string | undefined {
  for (const pair of pairs) {
    const date = trustedLocalDate(pair.event, timezone);
    if (date) return date;
  }
  return undefined;
}

function lastTrustedDate(pairs: Pair[], timezone?: string): string | undefined {
  for (const pair of [...pairs].reverse()) {
    const date = trustedLocalDate(pair.event, timezone);
    if (date) return date;
  }
  return undefined;
}

function trustedLocalDate(event: MemoryEvent | undefined, timezone?: string): string | undefined {
  if (!event) return undefined;
  if (event.localDate && /^\d{4}-\d{2}-\d{2}$/.test(event.localDate)) return event.localDate;
  if (!timezone || !event.occurredAt) return undefined;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(event.occurredAt);
}

function turnKeyFor(event: MemoryEvent): string | undefined {
  if (event.turnId) return `id:${event.turnId}`;
  if (typeof event.turnSeq === 'number') return `seq:${event.turnSeq}`;
  return undefined;
}

function roleCounts(pairs: Pair[]) {
  return {
    userEventCount: pairs.filter((item) => item.event?.role === 'user').length,
    assistantEventCount: pairs.filter((item) => item.event?.role === 'assistant' || item.event?.role === 'agent').length,
    toolEventCount: pairs.filter((item) => item.event?.role === 'tool').length,
    systemEventCount: pairs.filter((item) => item.event?.role === 'system').length,
  };
}

function impactInventory(pairs: Pair[]): EpisodeSplitImpactInventory {
  const counts = roleCounts(pairs);
  const dates = pairs.map((item) => trustedLocalDate(item.event)).filter((value): value is string => Boolean(value));
  return {
    eventCount: pairs.length,
    ...counts,
    hardShiftCount: pairs.filter((item) => ['hard_topic_switch', 'starts_new_topic', 'switches_topic'].includes(item.link.relation)).length,
    trustedLocalDates: [...new Set(dates)],
  };
}
