import { createHash } from 'node:crypto';
import type { MemoryEvent } from '../types/index.js';
import type { EpisodeStore } from './EpisodeStore.js';
import type { EpisodeEventLink } from './EpisodeTypes.js';
import { DEFAULT_EPISODE_BOUNDARY_CONFIG } from './EpisodeBoundaryPolicy.js';

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
}

export interface EpisodeSplitPlan {
  planId: string;
  projectId: string;
  episodeId: string;
  sourceFingerprint: string;
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
    const maxEvents = Math.max(1, Math.trunc(options.maxEvents ?? DEFAULT_EPISODE_BOUNDARY_CONFIG.maxEvents));
    const warnings: string[] = [];
    if (missingRawEventIds.length) warnings.push('unresolved_raw_events');
    if (events[0] && events[0].role !== 'user') warnings.push('leading_non_user_event');
    const userCount = events.filter((event) => event.role === 'user').length;
    if (userCount === 0) warnings.push('no_user_event_episode');
    const groups = logicalTurns(pairs);
    const segments: EpisodeSplitPlanSegment[] = [];
    let current: string[] = [];
    for (const group of groups) {
      if (current.length > 0 && current.length + group.length > maxEvents) {
        segments.push(segment(segments.length, current, 'max_events_boundary', options.includeEventIds === true));
        current = [];
      }
      current.push(...group.map((item) => item.eventId));
    }
    if (current.length > 0) segments.push(segment(segments.length, current, segments.length ? 'tail' : 'single_segment', options.includeEventIds === true));
    const fingerprint = sourceFingerprint(pairs);
    const hash = createHash('sha256').update(JSON.stringify([options.projectId, options.episodeId, fingerprint, maxEvents, segments])).digest('hex');
    return {
      planId: `episode-split-plan-${hash.slice(0, 24)}`,
      projectId: options.projectId,
      episodeId: options.episodeId,
      sourceFingerprint: fingerprint,
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

function logicalTurns(pairs: Array<{ link: EpisodeEventLink; event?: MemoryEvent }>): EpisodeEventLink[][] {
  const groups: EpisodeEventLink[][] = [];
  let current: EpisodeEventLink[] = [];
  for (const { link, event } of pairs) {
    if (event?.role === 'user' && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(link);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

const MAX_RETURNED_EVENT_IDS = 500;

function segment(index: number, eventIds: string[], reason: string, includeEventIds: boolean): EpisodeSplitPlanSegment {
  const returned = includeEventIds && eventIds.length <= MAX_RETURNED_EVENT_IDS ? eventIds : undefined;
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
  };
}

function sourceFingerprint(pairs: Array<{ link: EpisodeEventLink; event?: MemoryEvent }>): string {
  const hash = createHash('sha256');
  for (const { link, event } of pairs) {
    hash.update(JSON.stringify([link.eventId, link.position, link.relation, event?.occurredAt, event?.localDate, event?.contentHash]));
  }
  return hash.digest('hex');
}
