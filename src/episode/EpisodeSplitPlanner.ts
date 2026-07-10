import { createHash } from 'node:crypto';
import type { MemoryEvent } from '../types/index.js';
import type { EpisodeStore } from './EpisodeStore.js';
import type { EpisodeEventLink, TurnRelation } from './EpisodeTypes.js';
import type { EpisodeBoundaryConfig } from './EpisodeBoundaryPolicy.js';
import { normalizeEpisodeBoundaryConfig, resolveTrustedLocalDate } from './EpisodeBoundaryPolicy.js';
import { replayEpisodeBoundaries, type EpisodeReplayPair } from './EpisodeBoundaryReplayEngine.js';
import { validateEpisodeInvariants } from './EpisodeInvariantValidator.js';

export const EPISODE_SPLIT_PLANNER_VERSION = 'episode_split_preview.v1';

export interface EpisodeSplitPlanSegment {
  segmentIndex: number;
  eventIds?: string[];
  eventIdsHash: string;
  eventIdsOmitted: number;
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
  policyFingerprint: string;
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
    private readonly liveConfigDiagnostics: Array<{ code: string }> = [],
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
    const overrideWarnings = boundaryOverrideWarnings(options);
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
    const warnings: string[] = [...this.liveConfigDiagnostics.map((item) => item.code).filter((code) => code.startsWith('invalid_episode_boundary_')), ...overrideWarnings, ...normalized.diagnostics.map((item) => item.code)];
    if (missingRawEventIds.length) warnings.push('unresolved_raw_events');
    if (events[0] && events[0].role !== 'user') warnings.push('leading_non_user_event');
    const userCount = events.filter((event) => event.role === 'user').length;
    if (userCount === 0) warnings.push('no_user_event_episode');
    const replay = replayEpisodeBoundaries({ episode, pairs, config: normalized.config });
    warnings.push(...replay.warnings, ...replay.structuralAnomalies);
    const invariantViolations = validateEpisodeInvariants({
      episode, pairs, timezone: normalized.config.timezone,
      closureReceipts: this.store.listClosureReceipts({ episodeId: episode.episodeId, limit: 1 }),
      dreamJobState: this.store.getDreamJobState(episode.episodeId),
    });
    warnings.push(...invariantViolations.map((violation) => violation.reason));
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
    const fingerprint = sourceFingerprint(pairs, episode.startedAt, episode.status);
    const canonicalSegments = segments.map((item) => ({
      segmentIndex: item.segmentIndex,
      eventIdsHash: item.eventIdsHash,
      startEventId: item.startEventId,
      endEventId: item.endEventId,
      eventCount: item.eventCount,
      reason: item.reason,
    }));
    const policyFingerprint = createHash('sha256').update(JSON.stringify(policy)).digest('hex');
    const hash = createHash('sha256').update(JSON.stringify([
      options.projectId,
      options.episodeId,
      fingerprint,
      policyFingerprint,
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
      policyFingerprint,
      normalizedPolicy: policy,
      proposedBoundaries,
      impactInventory: impactInventory(pairs, policy.timezone),
      segments,
      warnings: [...new Set(warnings)].sort(),
      unresolvedEventCount: missingRawEventIds.length,
      missingRawEventIds: missingRawEventIds.slice(0, 50),
      evidenceIntegrityStatus: missingRawEventIds.length ? 'missing_raw_events' : 'ok',
      requiresManualReview: userCount === 0 || missingRawEventIds.length > 0 || replay.structuralAnomalies.length > 0 || replay.warnings.includes('invalid_trusted_local_date') || invariantViolations.some((violation) => violation.requiresManualReview),
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
  const range = timeRange(times);
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
    startedAt: range?.min,
    endedAt: range?.max,
    ...counts,
  };
}

function sourceFingerprint(pairs: Pair[], startedAt: number, status: string): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify([startedAt, status]));
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

function timeRange(values: number[]): { min: number; max: number } | undefined {
  let min: number | undefined;
  let max: number | undefined;
  for (const value of values) {
    min = min === undefined ? value : Math.min(min, value);
    max = max === undefined ? value : Math.max(max, value);
  }
  return min === undefined || max === undefined ? undefined : { min, max };
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
  if (overrides.maxEvents !== undefined && validThreshold(overrides.maxEvents, 20, 500)) config.maxEvents = overrides.maxEvents;
  if (overrides.maxDurationMs !== undefined && validThreshold(overrides.maxDurationMs, 300_000, 86_400_000)) config.maxDurationMs = overrides.maxDurationMs;
  if (overrides.maxIdleGapMs !== undefined && validThreshold(overrides.maxIdleGapMs, 300_000, 86_400_000)) config.maxIdleGapMs = overrides.maxIdleGapMs;
  if (typeof overrides.timezone === 'string' && overrides.timezone.trim()) config.timezone = overrides.timezone;
  return config;
}

function validThreshold(value: number | undefined, min: number, max: number): value is number {
  return value !== undefined && Number.isFinite(value) && value >= min && value <= max;
}

function boundaryOverrideWarnings(overrides: { maxEvents?: number; maxDurationMs?: number; maxIdleGapMs?: number; timezone?: string }): string[] {
  const warnings: string[] = [];
  if (overrides.maxEvents !== undefined && !validThreshold(overrides.maxEvents, 20, 500)) warnings.push('invalid_episode_boundary_max_events');
  if (overrides.maxDurationMs !== undefined && !validThreshold(overrides.maxDurationMs, 300_000, 86_400_000)) warnings.push('invalid_episode_boundary_max_duration_ms');
  if (overrides.maxIdleGapMs !== undefined && !validThreshold(overrides.maxIdleGapMs, 300_000, 86_400_000)) warnings.push('invalid_episode_boundary_max_idle_gap_ms');
  if (overrides.timezone !== undefined && !overrides.timezone.trim()) warnings.push('invalid_episode_boundary_timezone');
  return warnings;
}
