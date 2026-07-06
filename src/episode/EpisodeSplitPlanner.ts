import { createHash } from 'node:crypto';
import type { MemoryEvent } from '../types/index.js';
import type { EpisodeStore } from './EpisodeStore.js';
import type { EpisodeEventLink, TurnRelation } from './EpisodeTypes.js';
import type { EpisodeBoundaryConfig } from './EpisodeBoundaryPolicy.js';
import { normalizeEpisodeBoundaryConfig, resolveTrustedLocalDate } from './EpisodeBoundaryPolicy.js';

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
    enabled: boolean;
    maxEvents: number;
    maxDurationMs: number;
    maxIdleGapMs: number;
    splitOnTrustedLocalDateChange: boolean;
    applyToImports: boolean;
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
    private readonly liveBoundaryConfig: Partial<EpisodeBoundaryConfig> = {},
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
    const normalized = normalizeEpisodeBoundaryConfig(configWithDefinedOverrides(this.liveBoundaryConfig, options));
    const policy = {
      enabled: normalized.config.enabled,
      maxEvents: normalized.config.maxEvents,
      maxDurationMs: normalized.config.maxDurationMs,
      maxIdleGapMs: normalized.config.maxIdleGapMs,
      splitOnTrustedLocalDateChange: normalized.config.splitOnTrustedLocalDateChange,
      applyToImports: normalized.config.applyToImports,
      timezone: normalized.config.timezone,
    };
    const warnings: string[] = normalized.diagnostics.map((item) => item.code);
    warnings.push(...dateWarningCodes(pairs, policy.timezone));
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
        const boundaryPair = userPair(group) || group[0];
        proposedBoundaries.push({
          boundaryIndex: proposedBoundaries.length,
          beforeEventId: current.at(-1)?.link.eventId,
          afterEventId: boundaryPair?.link.eventId,
          reason: boundary,
          relation: boundaryPair?.link.relation,
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
      impactInventory: impactInventory(pairs, policy.timezone),
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
  policy: { enabled: boolean; maxEvents: number; maxDurationMs: number; maxIdleGapMs: number; splitOnTrustedLocalDateChange: boolean; applyToImports: boolean; timezone?: string },
): string | undefined {
  const nextUserPair = userPair(next);
  const nextRelation = nextUserPair?.link.relation;
  if (nextRelation === 'closes_episode') return undefined;
  if (nextRelation === 'hard_topic_switch' || nextRelation === 'starts_new_topic' || nextRelation === 'switches_topic') return 'hard_topic_switch_boundary';
  if (!policy.enabled || (!policy.applyToImports && isImportedTurn(next))) return undefined;
  const currentLastDate = lastTrustedUserDate(current, policy.timezone);
  const nextFirstDate = firstTrustedUserDate(next, policy.timezone);
  if (policy.splitOnTrustedLocalDateChange && currentLastDate && nextFirstDate && currentLastDate !== nextFirstDate) return 'trusted_local_date_boundary';
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

function firstTrustedUserDate(pairs: Pair[], timezone?: string): string | undefined {
  for (const pair of pairs) {
    if (pair.event?.role !== 'user') continue;
    const date = trustedLocalDate(pair.event, timezone);
    if (date) return date;
  }
  return undefined;
}

function lastTrustedUserDate(pairs: Pair[], timezone?: string): string | undefined {
  for (const pair of [...pairs].reverse()) {
    if (pair.event?.role !== 'user') continue;
    const date = trustedLocalDate(pair.event, timezone);
    if (date) return date;
  }
  return undefined;
}

function trustedLocalDate(event: MemoryEvent | undefined, timezone?: string): string | undefined {
  return resolveTrustedLocalDate(event, timezone).date;
}

function userPair(pairs: Pair[]): Pair | undefined {
  return pairs.find((item) => item.event?.role === 'user');
}

function isImportedTurn(pairs: Pair[]): boolean {
  return pairs.some((item) => {
    const payload = item.event?.payload as { metadata?: Record<string, unknown> } | undefined;
    return payload?.metadata?.imported === true || payload?.metadata?.sourceRef !== undefined;
  });
}

function dateWarningCodes(pairs: Pair[], timezone?: string): string[] {
  return [...new Set(pairs
    .map((item) => resolveTrustedLocalDate(item.event, timezone).warning?.code)
    .filter((code): code is string => code === 'invalid_trusted_local_date'))];
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

function impactInventory(pairs: Pair[], timezone?: string): EpisodeSplitImpactInventory {
  const counts = roleCounts(pairs);
  const dates = pairs
    .filter((item) => item.event?.role === 'user')
    .map((item) => trustedLocalDate(item.event, timezone))
    .filter((value): value is string => Boolean(value));
  return {
    eventCount: pairs.length,
    ...counts,
    hardShiftCount: pairs.filter((item) => ['hard_topic_switch', 'starts_new_topic', 'switches_topic'].includes(item.link.relation)).length,
    trustedLocalDates: [...new Set(dates)],
  };
}

function configWithDefinedOverrides(
  base: Partial<EpisodeBoundaryConfig>,
  overrides: { maxEvents?: number; maxDurationMs?: number; maxIdleGapMs?: number; timezone?: string },
): Partial<EpisodeBoundaryConfig> {
  const config: Partial<EpisodeBoundaryConfig> = { ...base };
  if (overrides.maxEvents !== undefined) config.maxEvents = overrides.maxEvents;
  if (overrides.maxDurationMs !== undefined) config.maxDurationMs = overrides.maxDurationMs;
  if (overrides.maxIdleGapMs !== undefined) config.maxIdleGapMs = overrides.maxIdleGapMs;
  if (overrides.timezone !== undefined) config.timezone = overrides.timezone;
  return config;
}
