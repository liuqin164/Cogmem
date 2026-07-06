import { createHash } from 'node:crypto';
import type { MemoryEvent } from '../types/index.js';
import type { EpisodeBoundaryConfig } from './EpisodeBoundaryPolicy.js';
import { EpisodeBoundaryPolicy, normalizeEpisodeBoundaryConfig, resolveTrustedLocalDate } from './EpisodeBoundaryPolicy.js';
import type { EpisodeStore } from './EpisodeStore.js';
import type { EpisodeEventLink, EpisodeStatus, TurnRelation } from './EpisodeTypes.js';

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
    private readonly liveBoundaryConfig: Partial<EpisodeBoundaryConfig> = {},
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
    const normalized = normalizeEpisodeBoundaryConfig(configWithDefinedOverrides(this.liveBoundaryConfig, options));
    const items = page.episodes.map((episode) => this.auditEpisode(episode, normalized.config, normalized.diagnostics.map((item) => item.code)));
    return { items, nextCursor: page.nextCursor };
  }

  private requireProjectEpisode(projectId: string, episodeId: string) {
    const episode = this.store.getEpisode(episodeId);
    if (!episode || episode.projectId !== projectId) throw new Error(`episode_project_mismatch:${episodeId}`);
    return episode;
  }

  private auditEpisode(episode: NonNullable<ReturnType<EpisodeStore['getEpisode']>>, config: EpisodeBoundaryConfig, configWarnings: string[] = []): EpisodeBoundaryAuditItem {
    const links = this.store.listEventLinks(episode.episodeId);
    const pairs = links.map((link) => ({ link, event: this.resolveEvent?.(link.eventId) || undefined }));
    const events = pairs.map((item) => item.event).filter((event): event is MemoryEvent => Boolean(event));
    const missingRawEventIds = pairs.filter((item) => !item.event).map((item) => item.link.eventId);
    const times = events.map((event) => event.occurredAt).filter((value): value is number => typeof value === 'number');
    const dates = [...new Set(events.filter((event) => event.role === 'user').map((event) => trustedLocalDate(event, config.timezone)).filter((value): value is string => Boolean(value)))];
    const relationCounts: Record<string, number> = {};
    for (const link of links) relationCounts[link.relation] = (relationCounts[link.relation] || 0) + 1;
    const userTimes = events.filter((event) => event.role === 'user').map((event) => event.occurredAt || 0);
    const reasons: string[] = [];
    const warnings: string[] = [...configWarnings];
    warnings.push(...dateWarningCodes(pairs, config.timezone));
    const durationMs = times.length ? Math.max(...times) - Math.min(...times) : 0;
    const maxEventGapMs = maxGap(times);
    const maxUserTurnGapMs = maxGap(userTimes);
    const maxBoundaryIdleGapMs = maxBoundaryIdleGap(pairs);
    const outOfOrderEventCount = outOfOrderCount(events);
    reasons.push(...replayBoundaryReasons(episode.startedAt, pairs, config));
    if (episode.eventCount !== links.length) reasons.push('stored_actual_event_count_mismatch');
    if (missingRawEventIds.length > 0) reasons.push('unresolved_raw_events');
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

type Pair = { link: EpisodeEventLink; event?: MemoryEvent };

function replayBoundaryReasons(startedAt: number, pairs: Pair[], config: EpisodeBoundaryConfig): string[] {
  const policy = new EpisodeBoundaryPolicy(config);
  const reasons = new Set<string>();
  let eventCount = 0;
  let lastEventAt: number | undefined;
  let lastUserLocalDate: string | undefined;
  const userDates: string[] = [];
  for (const group of logicalTurns(pairs)) {
    const userPair = group.find((item) => item.event?.role === 'user');
    if (userPair?.event) {
      if (!isExplicitBoundary(userPair.link.relation)) {
        const result = policy.evaluate({
          active: { eventCount, startedAt, updatedAt: lastEventAt, lastTrustedLocalDate: lastUserLocalDate, localDates: userDates },
          primaryEvent: userPair.event,
          imported: isImportedTurn(group),
        });
        for (const code of result.guardCodes) reasons.add(auditReasonForGuard(code));
      }
      const date = trustedLocalDate(userPair.event, config.timezone);
      if (date) {
        lastUserLocalDate = date;
        if (!userDates.includes(date)) userDates.push(date);
      }
    }
    for (const pair of group) {
      eventCount += 1;
      if (typeof pair.event?.occurredAt === 'number') lastEventAt = Math.max(lastEventAt ?? pair.event.occurredAt, pair.event.occurredAt);
    }
  }
  return [...reasons];
}

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

function turnKeyFor(event: MemoryEvent): string | undefined {
  if (event.turnId) return `id:${event.turnId}`;
  if (typeof event.turnSeq === 'number') return `seq:${event.turnSeq}`;
  return undefined;
}

function isExplicitBoundary(relation: TurnRelation): boolean {
  return relation === 'closes_episode' || relation === 'hard_topic_switch' || relation === 'starts_new_topic' || relation === 'switches_topic';
}

function auditReasonForGuard(code: string): string {
  if (code === 'max_events_exceeded') return 'event_count_exceeds_max';
  if (code === 'max_duration_exceeded') return 'duration_exceeds_max';
  if (code === 'max_idle_gap_exceeded') return 'boundary_idle_gap_exceeds_max';
  if (code === 'trusted_local_date_changed') return 'multiple_trusted_local_dates';
  return code;
}

function outOfOrderCount(events: MemoryEvent[]): number {
  let runningMax: number | undefined;
  let count = 0;
  for (const event of events) {
    if (typeof event.occurredAt !== 'number') continue;
    if (runningMax !== undefined && event.occurredAt < runningMax) count += 1;
    runningMax = Math.max(runningMax ?? event.occurredAt, event.occurredAt);
  }
  return count;
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

function trustedLocalDate(event: MemoryEvent | undefined, timezone?: string): string | undefined {
  return resolveTrustedLocalDate(event, timezone).date;
}

function dateWarningCodes(pairs: Pair[], timezone?: string): string[] {
  return [...new Set(pairs
    .map((item) => resolveTrustedLocalDate(item.event, timezone).warning?.code)
    .filter((code): code is string => code === 'invalid_trusted_local_date'))];
}

function isImportedTurn(group: Pair[]): boolean {
  return group.some((item) => {
    const payload = item.event?.payload as { metadata?: Record<string, unknown> } | undefined;
    return payload?.metadata?.imported === true || payload?.metadata?.sourceRef !== undefined;
  });
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
