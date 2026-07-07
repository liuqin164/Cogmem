import { createHash } from 'node:crypto';
import type { MemoryEvent } from '../types/index.js';
import type { EpisodeStore } from './EpisodeStore.js';
import type { EpisodeEventLink, TurnRelation } from './EpisodeTypes.js';
import type { EpisodeBoundaryConfig } from './EpisodeBoundaryPolicy.js';
import { normalizeEpisodeBoundaryConfig, resolveTrustedLocalDate } from './EpisodeBoundaryPolicy.js';
import { replayEpisodeBoundaries, type EpisodeReplayPair } from './EpisodeBoundaryReplayEngine.js';

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
  primaryUserEventId?: string;
  reason: string;
  relation?: TurnRelation;
  effective?: boolean;
  disposition?: 'explicit' | 'soft_review' | 'shadow' | 'enforced';
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
    mode: string;
    applyToLive: boolean;
    applyToImports: boolean;
    policyVersion: string;
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
      mode: normalized.config.mode,
      applyToLive: normalized.config.applyToLive,
      applyToImports: normalized.config.applyToImports,
      policyVersion: normalized.config.policyVersion,
      timezone: normalized.config.timezone,
    };
    const warnings: string[] = normalized.diagnostics.map((item) => item.code);
    if (missingRawEventIds.length) warnings.push('unresolved_raw_events');
    if (events[0] && events[0].role !== 'user') warnings.push('leading_non_user_event');
    const userCount = events.filter((event) => event.role === 'user').length;
    if (userCount === 0) warnings.push('no_user_event_episode');
    const replay = replayEpisodeBoundaries({ episode, pairs, config: normalized.config });
    warnings.push(...replay.warnings, ...replay.structuralAnomalies);
    const proposedBoundaries: EpisodeSplitProposedBoundary[] = replay.detectedBoundaries.map((boundary) => ({
      boundaryIndex: boundary.boundaryIndex,
      beforeEventId: boundary.beforeEventId,
      afterEventId: boundary.afterEventId,
      primaryUserEventId: boundary.primaryUserEventId,
      reason: boundary.reason,
      relation: boundary.relation,
      effective: boundary.effective,
      disposition: boundary.disposition,
    }));
    const segments = segmentsFromBoundaries(pairs, replay.effectiveBoundaries, options.includeEventIds === true);
    const fingerprint = sourceFingerprint(pairs, episode.startedAt, episode.status, policy);
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
      warnings: [...new Set(warnings)].sort(),
      unresolvedEventCount: missingRawEventIds.length,
      missingRawEventIds: missingRawEventIds.slice(0, 50),
      evidenceIntegrityStatus: missingRawEventIds.length ? 'missing_raw_events' : 'ok',
      requiresManualReview: userCount === 0 || missingRawEventIds.length > 0 || replay.structuralAnomalies.length > 0 || replay.warnings.includes('invalid_trusted_local_date'),
      applyableInCurrentVersion: false,
      applyCommand: null,
    };
  }
}

type Pair = EpisodeReplayPair;

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
    startEventId: eventIds[0],
    endEventId: eventIds.at(-1),
    eventCount: eventIds.length,
    reason,
    startedAt: times.length ? Math.min(...times) : undefined,
    endedAt: times.length ? Math.max(...times) : undefined,
    ...counts,
  };
}

function sourceFingerprint(pairs: Pair[], startedAt: number, status: string, policy: unknown): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify([startedAt, status, policy]));
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
      event?.localDateSource,
      isImportedEvent(event),
      event?.contentHash,
    ]));
  }
  return hash.digest('hex');
}

function trustedLocalDate(event: MemoryEvent | undefined, timezone?: string): string | undefined {
  return resolveTrustedLocalDate(event, timezone).date;
}

function roleCounts(pairs: Pair[]) {
  return {
    userEventCount: pairs.filter((item) => item.event?.role === 'user').length,
    assistantEventCount: pairs.filter((item) => item.event?.role === 'assistant' || item.event?.role === 'agent').length,
    toolEventCount: pairs.filter((item) => item.event?.role === 'tool').length,
    systemEventCount: pairs.filter((item) => item.event?.role === 'system').length,
  };
}

function segmentsFromBoundaries(
  pairs: Pair[],
  boundaries: Array<{ afterEventId?: string; reason: string }>,
  includeEventIds: boolean,
): EpisodeSplitPlanSegment[] {
  const segments: EpisodeSplitPlanSegment[] = [];
  let start = 0;
  for (const boundary of boundaries) {
    const nextIndex = boundary.afterEventId ? pairs.findIndex((pair) => pair.link.eventId === boundary.afterEventId) : -1;
    if (nextIndex <= start) continue;
    segments.push(segment(segments.length, pairs.slice(start, nextIndex), boundary.reason, includeEventIds));
    start = nextIndex;
  }
  if (start < pairs.length) segments.push(segment(segments.length, pairs.slice(start), segments.length ? 'tail' : 'single_segment', includeEventIds));
  return segments;
}

function isImportedEvent(event: MemoryEvent | undefined): boolean {
  const payload = event?.payload as { metadata?: Record<string, unknown> } | undefined;
  return payload?.metadata?.imported === true || payload?.metadata?.sourceRef !== undefined;
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
