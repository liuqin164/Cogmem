import { createHash } from 'node:crypto';
import type Database from 'bun:sqlite';
import type { EventStore } from '../store/EventStore.js';
import { MemoryAtlasStore } from '../store/MemoryAtlasStore.js';
import { eventTextForMemory } from '../episode/CogmemBlockStripper.js';
import type { MemoryEvent } from '../types/index.js';
import { EpisodeTitleGenerator } from './EpisodeTitleGenerator.js';
import { extractEntityCues, normalizeEntityCueId } from '../utils/EntityCueExtractor.js';
import { inferActionKinds } from '../utils/ActionKindRegistry.js';
import { localDateFor } from '../utils/LocalDateContext.js';

interface EpisodeRow {
  episode_id: string;
  project_id: string;
  session_id?: string | null;
  conversation_thread_id?: string | null;
  topic_path?: string | null;
  episode_type?: string | null;
  status: string;
  importance: number;
  summary?: string | null;
  start_event_id?: string | null;
  end_event_id?: string | null;
  event_count: number;
  started_at: number;
  updated_at: number;
}

interface FacetTarget {
  type: string;
  id: string;
  nodeId: string;
  label: string;
  relation: string;
  confidence: number;
}

interface EpisodeProjection {
  row: EpisodeRow;
  eventIds: string[];
  events: MemoryEvent[];
  issueHints: string[];
  topicHints: string[];
  localDate?: string;
}

export interface GraphCuratorResult {
  episodeCount: number;
  facetNodeCount: number;
  facetEdgeCount: number;
  reviewNeeded: number;
}

const FACET_EDGE_RELATIONS = new Set([
  'OCCURRED_ON',
  'OCCURRED_IN',
  'ABOUT_TOPIC',
  'PART_OF_ISSUE',
  'INVOLVES_ENTITY',
  'IN_SESSION',
  'IN_THREAD',
  'HAS_EVIDENCE',
  'HAS_MEMORY_KIND',
  'HAS_ACTION_KIND',
  'SAME_ISSUE',
  'FOLLOWS_UP',
  'REFINES',
  'CORRECTS',
  'CONTRADICTS',
  'SUPERSEDES',
  'RELATED_TO',
]);

export class GraphCurator {
  private readonly titleGenerator = new EpisodeTitleGenerator();

  constructor(
    private readonly db: Database,
    private readonly eventStore: EventStore,
    private readonly atlasStore: MemoryAtlasStore,
  ) {}

  rebuild(projectId: string, now = Date.now()): GraphCuratorResult {
    this.deleteFacetEdges(projectId);
    const rows = this.db.prepare(`
      SELECT episode_id,project_id,session_id,conversation_thread_id,topic_path,episode_type,status,
        importance,summary,start_event_id,end_event_id,event_count,started_at,updated_at
      FROM memory_episodes
      WHERE project_id=?
        AND COALESCE(event_count,0)>0
        AND status NOT IN ('archived','rejected','merged','invalidated')
      ORDER BY started_at ASC, episode_id ASC
    `).all(projectId) as EpisodeRow[];

    const projections: EpisodeProjection[] = [];
    let facetNodeCount = 0;
    let facetEdgeCount = 0;
    let reviewNeeded = 0;

    for (const row of rows) {
      const eventIds = this.episodeEventIds(row.episode_id);
      const events = eventIds.map((eventId) => this.eventStore.getEvent(eventId)).filter((event): event is MemoryEvent => Boolean(event));
      const title = this.titleGenerator.generate({
        episodeId: row.episode_id,
        summary: row.summary,
        topicPath: row.topic_path,
        episodeType: row.episode_type,
        startedAt: row.started_at,
        events,
      });
      const evidenceEventIds = Array.from(new Set([...title.sourceEventIds, ...eventIds])).slice(0, 30);
      if (title.reviewNeeded) reviewNeeded += 1;
      this.atlasStore.upsertDocument({
        id: `episode:${row.episode_id}`,
        projectId,
        nodeType: 'episode',
        sourceId: row.episode_id,
        label: title.displayTitle,
        summary: title.oneLineSummary,
        topicPath: row.topic_path || undefined,
        confidence: Math.max(0.01, Math.min(1, Number(row.importance || 0.5))),
        supportCount: Math.max(1, Number(row.event_count || evidenceEventIds.length || 1)),
        status: row.status,
        occurredAt: row.started_at,
        evidenceEventIds,
        metadata: {
          originalSummary: row.summary || undefined,
          displayTitle: title.displayTitle,
          titleConfidence: title.confidence,
          topicHints: title.topicHints,
          issueHints: title.issueHints,
          eventKind: title.eventKind,
          userIntent: title.userIntent,
          localDate: title.localDate,
          reviewNeeded: title.reviewNeeded,
          generatorTrace: title.generatorTrace,
          episodeType: row.episode_type,
          sessionId: row.session_id || undefined,
          threadId: row.conversation_thread_id || undefined,
          canonicalId: `episode:${row.episode_id}`,
        },
        updatedAt: now,
      });

      for (const event of events.slice(0, 30)) {
        this.upsertRawEventNode(projectId, event, now);
      }

      const projection: EpisodeProjection = {
        row,
        eventIds,
        events,
        issueHints: title.issueHints,
        topicHints: title.topicHints,
        localDate: title.localDate,
      };
      projections.push(projection);

      const targets = this.facetTargetsFor(projection);
      for (const target of targets) {
        this.upsertFacetNode(projectId, target, projection, now);
        facetNodeCount += 1;
        this.upsertEdge({
          projectId,
          sourceType: 'episode',
          sourceId: row.episode_id,
          relationType: target.relation,
          targetType: target.type,
          targetId: target.id,
          confidence: target.confidence,
          evidenceEventIds,
          status: 'active',
          sourceAuthority: 'atlas_curator',
          now,
        });
        facetEdgeCount += 1;
      }
    }

    facetEdgeCount += this.projectEpisodeRelations(projectId, projections, now);
    return { episodeCount: rows.length, facetNodeCount, facetEdgeCount, reviewNeeded };
  }

  rebuildEpisodes(projectId: string, episodeIds: string[], now = Date.now()): GraphCuratorResult {
    const bounded = Array.from(new Set(episodeIds.filter(Boolean))).slice(0, 100);
    if (!bounded.length) return { episodeCount: 0, facetNodeCount: 0, facetEdgeCount: 0, reviewNeeded: 0 };
    this.deleteFacetEdgesForEpisodes(projectId, bounded);
    const rows = this.db.prepare(`
      SELECT episode_id,project_id,session_id,conversation_thread_id,topic_path,episode_type,status,
        importance,summary,start_event_id,end_event_id,event_count,started_at,updated_at
      FROM memory_episodes
      WHERE project_id=? AND episode_id IN (${bounded.map(() => '?').join(',')})
        AND COALESCE(event_count,0)>0
        AND status NOT IN ('archived','rejected','merged','invalidated')
      ORDER BY started_at ASC, episode_id ASC
    `).all(projectId, ...bounded) as EpisodeRow[];
    let facetNodeCount = 0;
    let facetEdgeCount = 0;
    let reviewNeeded = 0;
    for (const row of rows) {
      const projection = this.projectEpisode(row, projectId, now);
      facetNodeCount += projection.facetNodeCount;
      facetEdgeCount += projection.facetEdgeCount;
      reviewNeeded += projection.reviewNeeded;
    }
    return { episodeCount: rows.length, facetNodeCount, facetEdgeCount, reviewNeeded };
  }

  private projectEpisode(row: EpisodeRow, projectId: string, now: number): { projection: EpisodeProjection; facetNodeCount: number; facetEdgeCount: number; reviewNeeded: number } {
    const eventIds = this.episodeEventIds(row.episode_id);
    const events = eventIds.map((eventId) => this.eventStore.getEvent(eventId)).filter((event): event is MemoryEvent => Boolean(event));
    const title = this.titleGenerator.generate({
      episodeId: row.episode_id,
      summary: row.summary,
      topicPath: row.topic_path,
      episodeType: row.episode_type,
      startedAt: row.started_at,
      events,
    });
    const evidenceEventIds = Array.from(new Set([...title.sourceEventIds, ...eventIds])).slice(0, 30);
    this.atlasStore.upsertDocument({
      id: `episode:${row.episode_id}`,
      projectId,
      nodeType: 'episode',
      sourceId: row.episode_id,
      label: title.displayTitle,
      summary: title.oneLineSummary,
      topicPath: row.topic_path || undefined,
      confidence: Math.max(0.01, Math.min(1, Number(row.importance || 0.5))),
      supportCount: Math.max(1, Number(row.event_count || evidenceEventIds.length || 1)),
      status: row.status,
      occurredAt: row.started_at,
      evidenceEventIds,
      metadata: {
        originalSummary: row.summary || undefined,
        displayTitle: title.displayTitle,
        titleConfidence: title.confidence,
        topicHints: title.topicHints,
        issueHints: title.issueHints,
        eventKind: title.eventKind,
        userIntent: title.userIntent,
        localDate: title.localDate,
        reviewNeeded: title.reviewNeeded,
        generatorTrace: title.generatorTrace,
        episodeType: row.episode_type,
        sessionId: row.session_id || undefined,
        threadId: row.conversation_thread_id || undefined,
        canonicalId: `episode:${row.episode_id}`,
      },
      updatedAt: now,
    });
    for (const event of events.slice(0, 30)) this.upsertRawEventNode(projectId, event, now);
    const projection: EpisodeProjection = { row, eventIds, events, issueHints: title.issueHints, topicHints: title.topicHints, localDate: title.localDate };
    let facetNodeCount = 0;
    let facetEdgeCount = 0;
    for (const target of this.facetTargetsFor(projection)) {
      this.upsertFacetNode(projectId, target, projection, now);
      facetNodeCount += 1;
      this.upsertEdge({
        projectId,
        sourceType: 'episode',
        sourceId: row.episode_id,
        relationType: target.relation,
        targetType: target.type,
        targetId: target.id,
        confidence: target.confidence,
        evidenceEventIds,
        status: 'active',
        sourceAuthority: 'atlas_curator',
        now,
      });
      facetEdgeCount += 1;
    }
    return { projection, facetNodeCount, facetEdgeCount, reviewNeeded: title.reviewNeeded ? 1 : 0 };
  }

  private episodeEventIds(episodeId: string): string[] {
    const rows = this.db.prepare(`SELECT event_id FROM memory_episode_events WHERE episode_id=? ORDER BY position ASC`).all(episodeId) as Array<{ event_id: string }>;
    return rows.map((row) => row.event_id).filter(Boolean);
  }

  private facetTargetsFor(projection: EpisodeProjection): FacetTarget[] {
    const targets: FacetTarget[] = [];
    const date = projection.localDate ?? dateFromTimestamp(projection.row.started_at, this.eventStore.getProjectTimeZone());
    if (date) {
      const [year, month] = [date.slice(0, 4), date.slice(0, 7)];
      targets.push({ type: 'time', id: date, nodeId: `time:${projection.row.project_id}:${date}`, label: date, relation: 'OCCURRED_ON', confidence: 1 });
      targets.push({ type: 'time', id: month, nodeId: `time:${projection.row.project_id}:${month}`, label: month, relation: 'OCCURRED_IN', confidence: 1 });
      targets.push({ type: 'time', id: year, nodeId: `time:${projection.row.project_id}:${year}`, label: year, relation: 'OCCURRED_IN', confidence: 1 });
    }
    for (const topicHint of normalizedHints(projection.topicHints)) {
      const topicPath = `PROJECT/${projection.row.project_id}/${topicHint}`;
      targets.push({ type: 'topic', id: topicPath, nodeId: `topic:${projection.row.project_id}:${topicPath}`, label: topicLabel(topicHint), relation: 'ABOUT_TOPIC', confidence: 0.86 });
    }
    if (projection.row.topic_path) {
      targets.push({ type: 'topic', id: projection.row.topic_path, nodeId: `topic:${projection.row.project_id}:${projection.row.topic_path}`, label: projection.row.topic_path, relation: 'ABOUT_TOPIC', confidence: 0.72 });
    }
    for (const issueHint of normalizedHints(projection.issueHints)) {
      targets.push({ type: 'issue', id: issueHint, nodeId: `issue:${projection.row.project_id}:${issueHint}`, label: issueLabel(issueHint), relation: 'PART_OF_ISSUE', confidence: 0.9 });
    }
    for (const entity of this.entityHintsFor(projection)) {
      const entityId = normalizeEntityCueId(entity);
      if (!entityId) continue;
      targets.push({ type: 'entity', id: `facet:${entityId}`, nodeId: `entity:${projection.row.project_id}:facet:${entityId}`, label: entity, relation: 'INVOLVES_ENTITY', confidence: 0.78 });
    }
    if (projection.row.session_id) {
      targets.push({ type: 'session', id: projection.row.session_id, nodeId: `session:${projection.row.project_id}:${projection.row.session_id}`, label: `Session ${projection.row.session_id}`, relation: 'IN_SESSION', confidence: 1 });
    }
    if (projection.row.conversation_thread_id) {
      targets.push({ type: 'thread', id: projection.row.conversation_thread_id, nodeId: `thread:${projection.row.project_id}:${projection.row.conversation_thread_id}`, label: `Thread ${projection.row.conversation_thread_id}`, relation: 'IN_THREAD', confidence: 1 });
    }
    const memoryKind = normalizeKind(projection.issueHints[0] ? issueKind(projection.issueHints[0]) : projection.row.episode_type || 'discussion');
    targets.push({ type: 'memoryKind', id: memoryKind, nodeId: `memoryKind:${projection.row.project_id}:${memoryKind}`, label: memoryKind, relation: 'HAS_MEMORY_KIND', confidence: 0.75 });
    for (const actionKind of actionKindsFor(projection)) {
      targets.push({ type: 'actionKind', id: actionKind, nodeId: `actionKind:${projection.row.project_id}:${actionKind}`, label: actionKind, relation: 'HAS_ACTION_KIND', confidence: 0.7 });
    }
    for (const eventId of projection.eventIds.slice(0, 30)) {
      targets.push({ type: 'raw_event', id: eventId, nodeId: `raw_event:${eventId}`, label: eventId, relation: 'HAS_EVIDENCE', confidence: 1 });
    }
    return dedupeTargets(targets);
  }

  private upsertFacetNode(projectId: string, target: FacetTarget, projection: EpisodeProjection, now: number): void {
    if (target.type === 'raw_event') return;
    this.atlasStore.upsertDocument({
      id: target.nodeId,
      projectId,
      nodeType: target.type as any,
      sourceId: target.id,
      label: target.label,
      summary: facetSummary(target),
      topicPath: target.type === 'topic' ? target.id : undefined,
      confidence: target.confidence,
      supportCount: 1,
      status: 'active',
      occurredAt: target.type === 'time' ? projection.row.started_at : undefined,
      evidenceEventIds: projection.eventIds.slice(0, 20),
      metadata: {
        projection: 'memory_atlas.facets.v1',
        facetType: target.type,
        facetValue: target.id,
      },
      updatedAt: now,
    });
  }

  private upsertRawEventNode(projectId: string, event: MemoryEvent, now: number): void {
    const text = eventTextForMemory(event);
    this.atlasStore.upsertDocument({
      id: `raw_event:${event.eventId}`,
      projectId,
      nodeType: 'raw_event',
      sourceId: event.eventId,
      label: `${event.role || 'event'} ${event.localDate ?? localDateFor(event.occurredAt, this.eventStore.getProjectTimeZone())}`,
      summary: text.slice(0, 220),
      confidence: 1,
      supportCount: 1,
      status: 'active',
      occurredAt: event.occurredAt,
      evidenceEventIds: [event.eventId],
      metadata: { projection: 'memory_atlas.facets.v1', role: event.role, localDate: event.localDate },
      updatedAt: now,
    });
  }

  private projectEpisodeRelations(projectId: string, projections: EpisodeProjection[], now: number): number {
    let count = 0;
    const seen = new Set<string>();
    for (const bucket of bucketByHint(projections, (projection) => projection.issueHints)) {
      const sorted = bucket.slice().sort((left, right) => left.row.started_at - right.row.started_at);
      for (let index = 1; index < sorted.length; index += 1) {
        const older = sorted[index - 1]!;
        const newer = sorted[index]!;
        const sameIssueKey = relationKey(older, newer, 'SAME_ISSUE');
        if (!seen.has(sameIssueKey)) {
          this.upsertEpisodeRelation(projectId, older, newer, 'SAME_ISSUE', 0.8, now);
          seen.add(sameIssueKey);
          count += 1;
        }
        const followsKey = relationKey(newer, older, 'FOLLOWS_UP');
        if (!seen.has(followsKey)) {
          this.upsertEpisodeRelation(projectId, newer, older, 'FOLLOWS_UP', 0.76, now);
          seen.add(followsKey);
          count += 1;
        }
      }
    }
    for (const bucket of bucketByHint(projections, (projection) => projection.topicHints)) {
      const sorted = bucket.slice().sort((left, right) => left.row.started_at - right.row.started_at);
      for (let index = 1; index < sorted.length; index += 1) {
        const older = sorted[index - 1]!;
        const newer = sorted[index]!;
        if (intersection(older.issueHints, newer.issueHints).length) continue;
        const key = relationKey(older, newer, 'RELATED_TO');
        if (seen.has(key)) continue;
        this.upsertEpisodeRelation(projectId, older, newer, 'RELATED_TO', 0.45, now, 'weak');
        seen.add(key);
        count += 1;
      }
    }
    return count;
  }

  private upsertEpisodeRelation(projectId: string, left: EpisodeProjection, right: EpisodeProjection, relationType: string, confidence: number, now: number, status = 'active'): void {
    this.upsertEdge({
      projectId,
      sourceType: 'episode',
      sourceId: left.row.episode_id,
      relationType,
      targetType: 'episode',
      targetId: right.row.episode_id,
      confidence,
      evidenceEventIds: Array.from(new Set([...left.eventIds.slice(0, 3), ...right.eventIds.slice(0, 3)])),
      status,
      sourceAuthority: 'atlas_curator',
      now,
    });
  }

  private entityHintsFor(projection: EpisodeProjection): string[] {
    const hints = new Set(entityHints(projection.events));
    if (projection.eventIds.length) {
      const rows = this.db.prepare(`
        SELECT entity_name FROM memory_bindings
        WHERE project_id=? AND event_id IN (${projection.eventIds.map(() => '?').join(',')})
          AND COALESCE(entity_name,'')<>''
        ORDER BY confidence DESC, created_at DESC LIMIT 20
      `).all(projection.row.project_id, ...projection.eventIds) as Array<{ entity_name?: string | null }>;
      for (const row of rows) if (row.entity_name?.trim()) hints.add(row.entity_name.trim());
    }
    return Array.from(hints);
  }

  private deleteFacetEdges(projectId: string): void {
    const relations = Array.from(FACET_EDGE_RELATIONS);
    this.db.prepare(`DELETE FROM memory_edges WHERE project_id=? AND source_authority='atlas_curator' AND relation_type IN (${relations.map(() => '?').join(',')})`).run(projectId, ...relations);
  }

  private deleteFacetEdgesForEpisodes(projectId: string, episodeIds: string[]): void {
    const relations = Array.from(FACET_EDGE_RELATIONS);
    this.db.prepare(`
      DELETE FROM memory_edges
      WHERE project_id=? AND source_authority='atlas_curator'
        AND relation_type IN (${relations.map(() => '?').join(',')})
        AND (
          (source_type='episode' AND source_id IN (${episodeIds.map(() => '?').join(',')}))
          OR (target_type='episode' AND target_id IN (${episodeIds.map(() => '?').join(',')}))
        )
    `).run(projectId, ...relations, ...episodeIds, ...episodeIds);
  }

  private upsertEdge(input: {
    projectId: string;
    sourceType: string;
    sourceId: string;
    relationType: string;
    targetType: string;
    targetId: string;
    confidence: number;
    evidenceEventIds: string[];
    status: string;
    sourceAuthority: string;
    now: number;
  }): void {
    const edgeId = memoryEdgeId(input);
    this.db.prepare(`
      INSERT INTO memory_edges (
        edge_id, project_id, source_type, source_id, relation_type, target_type, target_id,
        confidence, base_weight, stability, activation, evidence_event_ids_json, status,
        valid_from, valid_to, version, source_authority, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(edge_id) DO UPDATE SET
        confidence=excluded.confidence,
        evidence_event_ids_json=excluded.evidence_event_ids_json,
        status=excluded.status,
        source_authority=${preferredMemoryEdgeAuthoritySql('memory_edges.source_authority', 'excluded.source_authority')},
        updated_at=excluded.updated_at
    `).run(
      edgeId,
      input.projectId,
      input.sourceType,
      input.sourceId,
      input.relationType,
      input.targetType,
      input.targetId,
      input.confidence,
      1,
      input.status === 'weak' ? 0.35 : 0.85,
      1,
      JSON.stringify(Array.from(new Set(input.evidenceEventIds)).slice(0, 30)),
      input.status,
      input.now,
      null,
      1,
      input.sourceAuthority,
      input.now,
      input.now,
    );
  }
}

function dateFromTimestamp(timestamp: number, timeZone?: string): string | undefined {
  if (!Number.isFinite(timestamp)) return undefined;
  return localDateFor(timestamp, timeZone);
}

function normalizedHints(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeKind(value)).filter(Boolean)));
}

function normalizeKind(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'general';
}

function topicLabel(value: string): string {
  if (value === 'memory-blackbox') return '记忆黑盒';
  if (value === 'source-drilldown') return '原文下钻';
  if (value === 'context-injection') return '上下文注入';
  if (value === 'atlas-readability') return 'Atlas 可读性';
  return value;
}

function issueLabel(value: string): string {
  if (value === 'memory-context-blackbox') return 'Memory Context 黑盒';
  if (value === 'graph-runtime-blackbox') return 'Graph Runtime 黑盒';
  if (value === 'atlas-readability') return 'Atlas 可读性黑盒';
  if (value === 'auto-injection-mismatch') return '自动注入不一致';
  return value;
}

function issueKind(value: string): string {
  if (value.includes('graph-runtime')) return 'bug';
  if (value.includes('atlas')) return 'plan';
  return 'diagnostic';
}

function actionKindsFor(projection: EpisodeProjection): string[] {
  const text = projection.events.map(eventTextForMemory).join('\n');
  return inferActionKinds(text);
}

function entityHints(events: MemoryEvent[]): string[] {
  const text = events.map(eventTextForMemory).join('\n');
  return extractEntityCues(text).map((entity) => entity.label);
}

function facetSummary(target: FacetTarget): string {
  if (target.type === 'topic') return `Topic facet for ${target.label}.`;
  if (target.type === 'issue') return `Issue facet for ${target.label}.`;
  if (target.type === 'time') return `Time facet for ${target.label}.`;
  return `${target.type} facet for ${target.label}.`;
}

function dedupeTargets(targets: FacetTarget[]): FacetTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.type}:${target.id}:${target.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function bucketByHint(projections: EpisodeProjection[], hintsFor: (projection: EpisodeProjection) => string[]): EpisodeProjection[][] {
  const buckets = new Map<string, EpisodeProjection[]>();
  for (const projection of projections) {
    for (const hint of normalizedHints(hintsFor(projection))) {
      const bucket = buckets.get(hint) ?? [];
      bucket.push(projection);
      buckets.set(hint, bucket);
    }
  }
  return Array.from(buckets.values()).filter((bucket) => bucket.length > 1);
}

function relationKey(left: EpisodeProjection, right: EpisodeProjection, relationType: string): string {
  const pair = relationType === 'SAME_ISSUE' || relationType === 'RELATED_TO'
    ? [left.row.episode_id, right.row.episode_id].sort().join('\0')
    : `${left.row.episode_id}\0${right.row.episode_id}`;
  return `${relationType}\0${pair}`;
}
import { memoryEdgeId, preferredMemoryEdgeAuthoritySql } from '../binding/MemoryBindingIdentity.js';
