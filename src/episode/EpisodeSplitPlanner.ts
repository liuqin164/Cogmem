import { createHash } from 'node:crypto';
import type { MemoryEvent } from '../types/index.js';
import type { EpisodeStore } from './EpisodeStore.js';
import type { EpisodeEventLink } from './EpisodeTypes.js';
import { DEFAULT_EPISODE_BOUNDARY_CONFIG } from './EpisodeBoundaryPolicy.js';

export interface EpisodeSplitPlanSegment {
  segmentIndex: number;
  eventIds: string[];
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
    const events = links.map((link) => this.resolveEvent?.(link.eventId)).filter((event): event is MemoryEvent => Boolean(event));
    const maxEvents = Math.max(1, Math.trunc(options.maxEvents ?? DEFAULT_EPISODE_BOUNDARY_CONFIG.maxEvents));
    const warnings: string[] = [];
    if (events[0] && events[0].role !== 'user') warnings.push('leading_non_user_event');
    const userCount = events.filter((event) => event.role === 'user').length;
    if (userCount === 0) warnings.push('no_user_event_episode');
    const groups = logicalTurns(links, events);
    const segments: EpisodeSplitPlanSegment[] = [];
    let current: string[] = [];
    for (const group of groups) {
      if (current.length > 0 && current.length + group.length > maxEvents) {
        segments.push(segment(segments.length, current, 'max_events_boundary'));
        current = [];
      }
      current.push(...group.map((item) => item.eventId));
    }
    if (current.length > 0) segments.push(segment(segments.length, current, segments.length ? 'tail' : 'single_segment'));
    const fingerprint = sourceFingerprint(links, events);
    const hash = createHash('sha256').update(JSON.stringify([options.projectId, options.episodeId, fingerprint, maxEvents, segments])).digest('hex');
    return {
      planId: `episode-split-plan-${hash.slice(0, 24)}`,
      projectId: options.projectId,
      episodeId: options.episodeId,
      sourceFingerprint: fingerprint,
      segments,
      warnings,
      requiresManualReview: userCount === 0,
      applyableInCurrentVersion: false,
      applyCommand: null,
    };
  }
}

function logicalTurns(links: EpisodeEventLink[], events: MemoryEvent[]): EpisodeEventLink[][] {
  const groups: EpisodeEventLink[][] = [];
  let current: EpisodeEventLink[] = [];
  for (const [index, link] of links.entries()) {
    const event = events[index];
    if (event?.role === 'user' && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(link);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function segment(index: number, eventIds: string[], reason: string): EpisodeSplitPlanSegment {
  return {
    segmentIndex: index,
    eventIds,
    startEventId: eventIds[0],
    endEventId: eventIds.at(-1),
    eventCount: eventIds.length,
    reason,
  };
}

function sourceFingerprint(links: EpisodeEventLink[], events: MemoryEvent[]): string {
  const hash = createHash('sha256');
  for (const [index, link] of links.entries()) {
    const event = events[index];
    hash.update(JSON.stringify([link.eventId, link.position, link.relation, event?.occurredAt, event?.localDate, event?.contentHash]));
  }
  return hash.digest('hex');
}
