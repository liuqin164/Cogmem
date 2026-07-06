import { createHash } from 'node:crypto';
import type { MemoryEvent } from '../types/index.js';
import type { EpisodeBoundaryConfig } from './EpisodeBoundaryPolicy.js';
import { normalizeEpisodeBoundaryConfig } from './EpisodeBoundaryPolicy.js';
import type { EpisodeStore } from './EpisodeStore.js';
import type { EpisodeStatus, TurnRelation } from './EpisodeTypes.js';

export interface EpisodeBoundaryAuditItem {
  episodeId: string;
  projectId: string;
  status: EpisodeStatus;
  sessionId: string;
  threadId?: string;
  sourceAgent?: string;
  storedEventCount: number;
  actualLinkedEventCount: number;
  startedAt: number;
  firstEventAt?: number;
  lastEventAt?: number;
  durationMs: number;
  maxEventGapMs: number;
  maxUserTurnGapMs: number;
  maxBoundaryIdleGapMs: number;
  trustedLocalDates: string[];
  localDateConfidence: 'trusted' | 'unknown';
  crossesTrustedLocalDate: boolean;
  storedRelationCounts: Record<string, number>;
  strongShiftCount: number;
  ambiguousShiftCount: number;
  userEventCount: number;
  assistantEventCount: number;
  toolEventCount: number;
  systemEventCount: number;
  outOfOrderEventCount: number;
  sourceFingerprint: string;
  unresolvedEventCount: number;
  missingRawEventIds: string[];
  evidenceIntegrityStatus: 'ok' | 'missing_raw_events';
  requiresManualReview: boolean;
  severity: 'info' | 'warning' | 'critical';
  reasons: string[];
  warnings: string[];
  recommendedAction: 'none' | 'split-plan' | 'inspect';
}

export interface EpisodeBoundaryAuditResult {
  items: EpisodeBoundaryAuditItem[];
  nextCursor?: string;
}

export class EpisodeBoundaryAuditService {
  constructor(
    private readonly store: EpisodeStore,
    private readonly resolveEvent?: (eventId: string) => MemoryEvent | null | undefined,
  ) {}

  audit(options: {
    projectId: string;
    episodeId?: string;
    status?: EpisodeStatus;
    limit?: number;
    cursor?: string;
    maxEvents?: number;
    maxDurationMs?: number;
    maxIdleGapMs?: number;
    timezone?: string;
  }): EpisodeBoundaryAuditResult {
    if (!options.projectId) throw new Error('projectId is required');
    const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 1000));
    const page = options.episodeId ? { episodes: [this.requireProjectEpisode(options.projectId, options.episodeId)], nextCursor: undefined } : this.store.listEpisodesForBoundaryAudit({
      projectId: options.projectId,
      statuses: options.status ? [options.status] : undefined,
      limit,
      cursor: options.cursor,
    });
    const config = normalizeEpisodeBoundaryConfig(options).config;
    const items = page.episodes.map((episode) => this.auditEpisode(episode, config));
    return { items, nextCursor: page.nextCursor };
  }

  private requireProjectEpisode(projectId: string, episodeId: string) {
    const episode = this.store.getEpisode(episodeId);
    if (!episode || episode.projectId !== projectId) throw new Error(`episode_project_mismatch:${episodeId}`);
    return episode;
  }

  private auditEpisode(episode: NonNullable<ReturnType<EpisodeStore['getEpisode']>>, config: EpisodeBoundaryConfig): EpisodeBoundaryAuditItem {
    const links = this.store.listEventLinks(episode.episodeId);
    const pairs = links.map((link) => ({ link, event: this.resolveEvent?.(link.eventId) || undefined }));
    const events = pairs.map((item) => item.event).filter((event): event is MemoryEvent => Boolean(event));
    const missingRawEventIds = pairs.filter((item) => !item.event).map((item) => item.link.eventId);
    const times = events.map((event) => event.occurredAt).filter((value): value is number => typeof value === 'number');
    const dates = [...new Set(events.map((event) => trustedLocalDate(event, config.timezone)).filter((value): value is string => Boolean(value)))];
    const relationCounts: Record<string, number> = {};
    for (const link of links) relationCounts[link.relation] = (relationCounts[link.relation] || 0) + 1;
    const userTimes = events.filter((event) => event.role === 'user').map((event) => event.occurredAt || 0);
    const reasons: string[] = [];
    const warnings: string[] = [];
    const durationMs = times.length ? Math.max(...times) - Math.min(...times) : 0;
    const maxEventGapMs = maxGap(times);
    const maxUserTurnGapMs = maxGap(userTimes);
    const maxBoundaryIdleGapMs = maxBoundaryIdleGap(pairs);
    const outOfOrderEventCount = events.filter((event, index) => index > 0 && (event.occurredAt || 0) < (events[index - 1].occurredAt || 0)).length;
    if (episode.eventCount !== links.length) reasons.push('stored_actual_event_count_mismatch');
    if (missingRawEventIds.length > 0) reasons.push('unresolved_raw_events');
    if (links.length > config.maxEvents) reasons.push('event_count_exceeds_max');
    if (durationMs > config.maxDurationMs) reasons.push('duration_exceeds_max');
    if (maxBoundaryIdleGapMs > config.maxIdleGapMs) reasons.push('boundary_idle_gap_exceeds_max');
    if (dates.length > 1) reasons.push('multiple_trusted_local_dates');
    if (outOfOrderEventCount > 0) reasons.push('out_of_order_events');
    if ((relationCounts.ambiguous_shift || 0) > 1) reasons.push('repeated_ambiguous_shifts');
    if (hardShiftCount(relationCounts) > 1) reasons.push('multiple_hard_topic_switch_relations');
    if (!events.some((event) => event.role === 'user')) reasons.push('zero_user_event_episode');
    if (!dates.length) warnings.push('trusted_local_date_unavailable');
    const critical = reasons.some((reason) => [
      'stored_actual_event_count_mismatch', 'event_count_exceeds_max', 'duration_exceeds_max',
      'boundary_idle_gap_exceeds_max', 'multiple_trusted_local_dates', 'unresolved_raw_events',
    ].includes(reason));
    return {
      episodeId: episode.episodeId,
      projectId: episode.projectId,
      status: episode.status,
      sessionId: episode.sessionId,
      threadId: episode.conversationThreadId,
      sourceAgent: episode.sourceAgent,
      storedEventCount: episode.eventCount,
      actualLinkedEventCount: links.length,
      startedAt: episode.startedAt,
      firstEventAt: times.length ? Math.min(...times) : undefined,
      lastEventAt: times.length ? Math.max(...times) : undefined,
      durationMs,
      maxEventGapMs,
      maxUserTurnGapMs,
      maxBoundaryIdleGapMs,
      trustedLocalDates: dates,
      localDateConfidence: dates.length ? 'trusted' : 'unknown',
      crossesTrustedLocalDate: dates.length > 1,
      storedRelationCounts: relationCounts,
      strongShiftCount: hardShiftCount(relationCounts),
      ambiguousShiftCount: relationCounts.ambiguous_shift || 0,
      userEventCount: events.filter((event) => event.role === 'user').length,
      assistantEventCount: events.filter((event) => event.role === 'assistant' || event.role === 'agent').length,
      toolEventCount: events.filter((event) => event.role === 'tool').length,
      systemEventCount: events.filter((event) => event.role === 'system').length,
      outOfOrderEventCount,
      sourceFingerprint: sourceFingerprint(pairs.map((item) => ({ ...item.link, event: item.event }))),
      unresolvedEventCount: missingRawEventIds.length,
      missingRawEventIds: missingRawEventIds.slice(0, 50),
      evidenceIntegrityStatus: missingRawEventIds.length ? 'missing_raw_events' : 'ok',
      requiresManualReview: missingRawEventIds.length > 0,
      severity: critical ? 'critical' : reasons.length ? 'warning' : 'info',
      reasons,
      warnings,
      recommendedAction: critical ? 'split-plan' : reasons.length ? 'inspect' : 'none',
    };
  }
}

function maxGap(values: number[]): number {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  let max = 0;
  for (let index = 1; index < ordered.length; index += 1) max = Math.max(max, ordered[index] - ordered[index - 1]);
  return max;
}

function maxBoundaryIdleGap(pairs: Array<{ event?: MemoryEvent }>): number {
  let max = 0;
  for (let index = 1; index < pairs.length; index += 1) {
    const event = pairs[index].event;
    const previous = pairs[index - 1].event;
    if (event?.role !== 'user') continue;
    if (typeof event.occurredAt !== 'number' || typeof previous?.occurredAt !== 'number') continue;
    max = Math.max(max, event.occurredAt - previous.occurredAt);
  }
  return max;
}

function hardShiftCount(counts: Record<string, number>): number {
  return (counts.hard_topic_switch || 0) + (counts.starts_new_topic || 0) + (counts.switches_topic || 0);
}

function sourceFingerprint(items: Array<{ eventId: string; relation: TurnRelation; event?: MemoryEvent }>): string {
  const hash = createHash('sha256');
  for (const item of items) {
    hash.update(JSON.stringify([
      item.eventId,
      item.relation,
      item.event?.role,
      item.event?.turnId,
      item.event?.turnSeq,
      item.event?.eventOrdinal,
      item.event?.occurredAt,
      item.event?.localDate,
      item.event?.contentHash,
    ]));
  }
  return hash.digest('hex');
}

function trustedLocalDate(event: MemoryEvent, timezone?: string): string | undefined {
  if (event.localDate && /^\d{4}-\d{2}-\d{2}$/.test(event.localDate)) return event.localDate;
  if (!timezone || !event.occurredAt) return undefined;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(event.occurredAt);
}
