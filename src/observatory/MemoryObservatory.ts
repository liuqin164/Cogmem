/**
 * The read-only memory observatory's data side.
 *
 * Every query here is a SELECT against the materialized read models — `memory_atlas_documents`,
 * `memory_atlas_activation`, `memory_edges`, `memory_events`, `trace_events` — on a connection this
 * class does not write to. The page it feeds is for looking at a corpus, so nothing in it may
 * refresh a projection, record an access, or create the table it is reading: `trace_events` is
 * checked for presence rather than initialized, because initializing it is a write.
 *
 * One aggregation per (project, watermark) is cached in process memory, which is the only place the
 * observatory is allowed to keep anything.
 */

import type Database from 'bun:sqlite';

import { candidateAgentsForEvent, eventsVisibleToAgent, isAgentRawEvent, type ScopedEvent } from '../agent/AgentScopeRules.js';
import { encodeAtlasNodeId } from '../atlas/AtlasNodeIdCodec.js';
import type { MemoryAtlasNodeDetail } from '../atlas/MemoryAtlasTypes.js';
import { parseJsonObject } from '../utils/Values.js';
import { armKeyFor, galaxyLayout } from './GalaxyLayout.js';
import { readRecall, readRecalls, type ObservatoryRecallDetail, type ObservatoryRecalls } from './RecallTraces.js';

/** Nodes above this many are cut, most activate first — the ~20k point budget the star map is built for. */
const SNAPSHOT_NODE_LIMIT = 20_000;

const HIDDEN_STATUS = `('rejected','archived','needs_confirmation')`;
const L0_TYPES = new Set(['project', 'topic', 'cluster']);
const L2_TYPES = new Set(['raw_event', 'event']);

type ObservatoryLod = 0 | 1 | 2;

function lodFor(nodeType: string): ObservatoryLod {
  if (L0_TYPES.has(nodeType)) return 0;
  if (L2_TYPES.has(nodeType)) return 2;
  return 1;
}

export interface ObservatoryEvent extends ScopedEvent {
  localDate?: string;
  eventType: string;
}

export interface ObservatoryProject {
  projectId: string;
  nodes: number;
  events: number;
}

export interface ObservatoryAgent {
  id: string;
  /** `host` is a host that was wired to this install; `agent` is an identity the corpus names. */
  kind: 'agent' | 'host';
  events: number;
  nodes: number;
}

export interface ObservatoryNode {
  id: string;
  type: string;
  lod: ObservatoryLod;
  label: string;
  status: string;
  support: number;
  activation: number;
  evidenceTotal: number;
  occurredAt?: number;
  x: number;
  y: number;
  z: number;
}

export interface ObservatoryTruncation {
  limit: number;
  returned: number;
  omitted: number;
  byType: Record<string, { total: number; returned: number }>;
}

export interface ObservatoryHistogram {
  days: string[];
  series: Array<{ eventType: string; counts: number[] }>;
  totals: Record<string, number>;
}

export interface ObservatorySnapshot {
  source: 'live';
  generatedAt: number;
  watermark: number;
  projectId: string;
  project: string;
  agent: string | null;
  projects: ObservatoryProject[];
  agents: ObservatoryAgent[];
  counts: {
    nodesTotal: number;
    edgesTotal: number;
    nodesByType: Record<string, number>;
    edgesByRelation: Record<string, number>;
  };
  layout: { armRule: 'topic_path' | 'project'; arms: Array<{ id: string; nodes: number }> };
  truncation: ObservatoryTruncation | null;
  histogram: ObservatoryHistogram;
  nodes: ObservatoryNode[];
}

export interface ObservatoryTimeline {
  source: 'live';
  generatedAt: number;
  watermark: number;
  projectId: string;
  agent: string | null;
  from: string | null;
  to: string | null;
  histogram: ObservatoryHistogram;
}

/**
 * Which database and which identity a page is looking at. All three views take the same pair, because
 * they are one scope: switching projects or agents switches it for the map, the timeline and the
 * recall list together.
 */
export interface ObservatoryView {
  projectId?: string;
  agent?: string;
}

export interface MemoryObservatoryOptions {
  /** A connection the observatory never writes through. */
  db: Database;
  /** One-hop neighbourhood and evidence locators, borrowed from the atlas service so ids and drilldowns agree. */
  nodeDetail?: (nodeId: string, projectId: string) => MemoryAtlasNodeDetail | null;
  /** Hosts wired to this install, listed in the roster beside the identities the corpus names. */
  connectedAgents?: () => string[];
}

interface AtlasRow {
  node_id: string;
  node_type: string;
  label: string;
  topic_path: string | null;
  support_count: number;
  status: string;
  occurred_at: number | null;
  activation: number | null;
  evidence_event_ids_json: string;
}

interface EventRow {
  event_id: string;
  source_id: string | null;
  local_date: string | null;
  event_type: string;
  payload_json: string;
}

interface ProjectAggregate {
  stamp: string;
  generatedAt: number;
  watermark: number;
  projectId: string;
  projects: ObservatoryProject[];
  nodes: ObservatoryNode[];
  nodesTotal: number;
  truncated: ObservatoryTruncation | null;
  counts: ObservatorySnapshot['counts'];
  layout: ObservatorySnapshot['layout'];
  agents: ObservatoryAgent[];
  histogram: ObservatoryHistogram;
  events: ObservatoryEvent[];
  eventIndex: Map<string, ScopedEvent>;
  nodeEventIds: Map<string, string[]>;
  /** Per node, the arm it was placed on, so a scoped view can re-count the arms it actually shows. */
  armOf: Map<string, string>;
  /** Per node, the agents the read-side predicate would admit. Computed once, inverted into the roster. */
  nodeAgents: Map<string, string[]>;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const name = key(item);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

/**
 * The arms a view actually shows, re-counted from the nodes that survived the scope.
 *
 * The key is the node's arm, which is derived at aggregation time and not carried per node in the
 * response, so it is re-derived here from the same rule: a topic path's first segment, else the
 * project. It matches `armKeyFor`, which is the function that placed the node in the first place.
 */
function armCounts(nodes: ObservatoryNode[], arms: Map<string, string>): ObservatorySnapshot['layout']['arms'] {
  const counts = countBy(nodes, (node) => arms.get(node.id) ?? '');
  return Object.entries(counts)
    .map(([id, count]) => ({ id, nodes: count }))
    .sort((left, right) => right.nodes - left.nodes || left.id.localeCompare(right.id));
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export class MemoryObservatory {
  private readonly db: Database;
  private readonly nodeDetail?: MemoryObservatoryOptions['nodeDetail'];
  private readonly connectedAgents: () => string[];
  private readonly cache = new Map<string, ProjectAggregate>();

  constructor(options: MemoryObservatoryOptions) {
    this.db = options.db;
    this.nodeDetail = options.nodeDetail;
    this.connectedAgents = options.connectedAgents ?? (() => []);
  }

  private projects(): ObservatoryProject[] {
    const nodes = this.db
      .query(`SELECT project_id AS id, COUNT(*) AS c FROM memory_atlas_documents GROUP BY project_id`)
      .all() as Array<{ id: string; c: number }>;
    const events = this.db
      .query(`SELECT project_id AS id, COUNT(*) AS c FROM memory_events WHERE project_id IS NOT NULL GROUP BY project_id`)
      .all() as Array<{ id: string; c: number }>;
    const merged = new Map<string, ObservatoryProject>();
    for (const row of nodes) merged.set(row.id, { projectId: row.id, nodes: row.c, events: 0 });
    for (const row of events) {
      const entry = merged.get(row.id) ?? { projectId: row.id, nodes: 0, events: 0 };
      entry.events = row.c;
      merged.set(row.id, entry);
    }
    return Array.from(merged.values()).sort((left, right) => right.events - left.events || right.nodes - left.nodes || left.projectId.localeCompare(right.projectId));
  }

  /** `max(global_seq)` is the disclosed watermark; the atlas stamp catches a projection rebuilt without a new event. */
  private stamp(projectId: string): string {
    const watermark = this.watermark();
    const atlas = this.db
      .query(`SELECT COALESCE(MAX(updated_at), 0) AS stamp FROM memory_atlas_documents WHERE project_id = ?`)
      .get(projectId) as { stamp: number } | null;
    return `${watermark}:${atlas?.stamp ?? 0}`;
  }

  private watermark(): number {
    const row = this.db.query(`SELECT COALESCE(MAX(global_seq), 0) AS watermark FROM memory_events`).get() as { watermark: number } | null;
    return Number(row?.watermark ?? 0);
  }

  /** One aggregation per (project, stamp). Everything the three pages read comes from here. */
  private aggregate(projectId: string): ProjectAggregate {
    const stamp = this.stamp(projectId);
    const cached = this.cache.get(projectId);
    if (cached && cached.stamp === stamp) return cached;

    const projects = this.projects();
    const nodesTotalRow = this.db
      .query(`SELECT COUNT(*) AS c FROM memory_atlas_documents WHERE project_id = ? AND status NOT IN ${HIDDEN_STATUS}`)
      .get(projectId) as { c: number } | null;
    const nodesTotal = Number(nodesTotalRow?.c ?? 0);

    const typeRows = this.db
      .query(`SELECT node_type AS type, COUNT(*) AS c FROM memory_atlas_documents WHERE project_id = ? AND status NOT IN ${HIDDEN_STATUS} GROUP BY node_type ORDER BY c DESC`)
      .all(projectId) as Array<{ type: string; c: number }>;
    const nodesByType: Record<string, number> = {};
    for (const row of typeRows) nodesByType[row.type] = row.c;

    const relationRows = this.db
      .query(`SELECT relation_type AS relation, COUNT(*) AS c FROM memory_edges WHERE project_id = ? AND status IN ('active','weak') GROUP BY relation_type ORDER BY c DESC`)
      .all(projectId) as Array<{ relation: string; c: number }>;
    const edgesByRelation: Record<string, number> = {};
    for (const row of relationRows) edgesByRelation[row.relation] = row.c;
    const edgesTotal = Object.values(edgesByRelation).reduce((sum, value) => sum + value, 0);

    // The L0/L1 rows are never the ones cut, and within L2 the most activated go first: an order the
    // page can explain, rather than whatever the table happened to return.
    const rows = this.db
      .query(`
        SELECT d.node_id, d.node_type, d.label, d.topic_path, d.support_count, d.status, d.occurred_at,
               d.evidence_event_ids_json, COALESCE(a.activation, 0) AS activation
        FROM memory_atlas_documents d
        LEFT JOIN memory_atlas_activation a ON a.project_id = d.project_id AND a.node_id = d.node_id
        WHERE d.project_id = ? AND d.status NOT IN ${HIDDEN_STATUS}
        ORDER BY CASE WHEN d.node_type IN ('project','topic','cluster') THEN 0
                      WHEN d.node_type IN ('raw_event','event') THEN 2 ELSE 1 END,
                 COALESCE(a.activation, 0) DESC, d.support_count DESC, d.occurred_at DESC, d.node_id ASC
        LIMIT ?
      `)
      .all(projectId, SNAPSHOT_NODE_LIMIT + 1) as AtlasRow[];
    const overflow = rows.length > SNAPSHOT_NODE_LIMIT;
    const kept = overflow ? rows.slice(0, SNAPSHOT_NODE_LIMIT) : rows;

    const topicArm = this.topicArms(projectId);
    const nodeEventIds = new Map<string, string[]>();
    const armOf = new Map<string, string>();
    const layoutInput: Array<{ id: string; arm: string }> = [];
    let armsFromTopic = false;
    for (const row of kept) {
      const topicArmId = topicArm.get(row.node_id);
      if (row.topic_path || topicArmId) armsFromTopic = true;
      const arm = armKeyFor({ topicPath: row.topic_path ?? undefined, topicArm: topicArmId, projectId });
      armOf.set(row.node_id, arm);
      layoutInput.push({ id: row.node_id, arm });
      nodeEventIds.set(row.node_id, parseJsonArray(row.evidence_event_ids_json));
    }
    const positions = galaxyLayout(layoutInput);

    const nodes: ObservatoryNode[] = kept.map((row) => {
      const point = positions.get(row.node_id) ?? { x: 0, y: 0, z: 0 };
      return {
        id: row.node_id,
        type: row.node_type,
        lod: lodFor(row.node_type),
        label: row.label,
        status: row.status,
        support: Number(row.support_count ?? 0),
        activation: Number(row.activation ?? 0),
        evidenceTotal: (nodeEventIds.get(row.node_id) ?? []).length,
        occurredAt: row.occurred_at ?? undefined,
        x: point.x,
        y: point.y,
        z: point.z,
      };
    });

    const truncated = overflow ? this.truncation(nodesTotal, kept, nodesByType) : null;

    const { events, eventIndex } = this.readEvents(projectId);
    const candidates = new Set<string>(this.connectedAgents());
    for (const event of events) for (const name of candidateAgentsForEvent(event)) candidates.add(name);

    const nodeAgents = new Map<string, string[]>();
    const agentNodeCounts = new Map<string, number>();
    const agentEventCounts = new Map<string, number>();
    for (const name of candidates) agentEventCounts.set(name, 0);
    for (const event of events) {
      for (const name of candidates) {
        if (isAgentRawEvent(event, name)) agentEventCounts.set(name, (agentEventCounts.get(name) ?? 0) + 1);
      }
    }
    for (const node of nodes) {
      const chain = this.chainFor(node.id, nodeEventIds, eventIndex);
      const visible: string[] = [];
      for (const name of candidates) {
        if (eventsVisibleToAgent(chain, name)) {
          visible.push(name);
          agentNodeCounts.set(name, (agentNodeCounts.get(name) ?? 0) + 1);
        }
      }
      nodeAgents.set(node.id, visible);
    }
    const connected = new Set(this.connectedAgents());
    const agents: ObservatoryAgent[] = Array.from(candidates)
      .map((id) => ({
        id,
        kind: connected.has(id) ? ('host' as const) : ('agent' as const),
        events: agentEventCounts.get(id) ?? 0,
        nodes: agentNodeCounts.get(id) ?? 0,
      }))
      .filter((agent) => agent.events > 0 || agent.nodes > 0 || connected.has(agent.id))
      .sort((left, right) => right.events - left.events || left.id.localeCompare(right.id));

    const aggregate: ProjectAggregate = {
      stamp,
      generatedAt: Date.now(),
      watermark: this.watermark(),
      projectId,
      projects,
      nodes,
      nodesTotal,
      truncated,
      counts: { nodesTotal, edgesTotal, nodesByType, edgesByRelation },
      layout: {
        // Which rule actually produced the arms, not which one was available: a corpus can carry
        // topic paths on its records without ever projecting a topic node.
        armRule: armsFromTopic ? 'topic_path' : 'project',
        arms: armCounts(nodes, armOf),
      },
      agents,
      histogram: this.histogramFor(events, null),
      events,
      eventIndex,
      nodeEventIds,
      armOf,
      nodeAgents,
    };
    this.cache.set(projectId, aggregate);
    return aggregate;
  }

  private truncation(nodesTotal: number, kept: AtlasRow[], nodesByType: Record<string, number>): ObservatoryTruncation {
    const returnedByType: Record<string, number> = {};
    for (const row of kept) returnedByType[row.node_type] = (returnedByType[row.node_type] ?? 0) + 1;
    const byType: Record<string, { total: number; returned: number }> = {};
    for (const [type, total] of Object.entries(nodesByType)) {
      const returned = returnedByType[type] ?? 0;
      if (returned < total) byType[type] = { total, returned };
    }
    return { limit: SNAPSHOT_NODE_LIMIT, returned: kept.length, omitted: Math.max(0, nodesTotal - kept.length), byType };
  }

  private readEvents(projectId: string): { events: ObservatoryEvent[]; eventIndex: Map<string, ScopedEvent> } {
    const rows = this.db
      .query(`SELECT event_id, source_id, local_date, event_type, payload_json
              FROM memory_events WHERE project_id = ? ORDER BY occurred_at ASC, event_id ASC`)
      .all(projectId) as EventRow[];
    const events: ObservatoryEvent[] = [];
    const eventIndex = new Map<string, ScopedEvent>();
    for (const row of rows) {
      const payload = parseJsonObject(row.payload_json);
      const event: ObservatoryEvent = {
        eventId: row.event_id,
        sourceId: row.source_id ?? undefined,
        payload,
        localDate: row.local_date ?? undefined,
        eventType: row.event_type,
      };
      events.push(event);
      eventIndex.set(row.event_id, event);
    }
    return { events, eventIndex };
  }

  /**
   * The one-hop topic a node hangs off, by the same id encoding the edge endpoints are read with.
   * Empty for a corpus with no topic nodes, which is the common shape: the arms then fall back to
   * the project and the page says so.
   */
  private topicArms(projectId: string): Map<string, string> {
    const rows = this.db
      .query(`
        SELECT source_type, source_id, target_type, target_id FROM memory_edges
        WHERE project_id = ? AND status IN ('active','weak') AND (source_type = 'topic' OR target_type = 'topic')
        LIMIT 50000
      `)
      .all(projectId) as Array<{ source_type: string; source_id: string; target_type: string; target_id: string }>;
    if (!rows.length) return new Map();
    const labels = new Map<string, string>();
    const labelRows = this.db
      .query(`SELECT node_id, label, topic_path FROM memory_atlas_documents WHERE project_id = ? AND node_type = 'topic'`)
      .all(projectId) as Array<{ node_id: string; label: string; topic_path: string | null }>;
    for (const row of labelRows) labels.set(row.node_id, row.topic_path?.split('/')[0] || row.label);
    const arms = new Map<string, string>();
    for (const row of rows) {
      const topicSide = row.source_type === 'topic';
      const topicId = encodeAtlasNodeId('topic', topicSide ? row.source_id : row.target_id, projectId);
      const peerId = encodeAtlasNodeId(topicSide ? row.target_type : row.source_type, topicSide ? row.target_id : row.source_id, projectId);
      const arm = labels.get(topicId);
      if (arm) arms.set(peerId, arm);
    }
    return arms;
  }

  /**
   * The events a node's ownership is read from: its own evidence anchors, then the raw events a
   * compile-layer anchor was built from — the same chain the read side walks (#142, #143, #144).
   *
   * Bounded the way the atlas service bounds its evidence (8 anchors, then 16 source refs each), and an
   * anchor whose event the database no longer has contributes nothing. Both bounds can only hide an
   * owner, never invent one, and a node left with an empty chain is readable by everyone — the same
   * answer the read side gives an item whose chain reached nothing.
   */
  private chainFor(nodeId: string, nodeEventIds: Map<string, string[]>, eventIndex: Map<string, ScopedEvent>): ScopedEvent[] {
    const chain: ScopedEvent[] = [];
    for (const eventId of (nodeEventIds.get(nodeId) ?? []).slice(0, 8)) {
      const anchor = eventIndex.get(eventId);
      if (!anchor) continue;
      chain.push(anchor);
      const sourceRefs = (anchor.payload as { sourceRefs?: unknown } | undefined)?.sourceRefs;
      if (!Array.isArray(sourceRefs)) continue;
      for (const ref of sourceRefs.slice(0, 16)) {
        const refId = (ref as { eventId?: unknown } | undefined)?.eventId;
        const referenced = typeof refId === 'string' ? eventIndex.get(refId) : undefined;
        if (referenced) chain.push(referenced);
      }
    }
    return chain;
  }

  private histogramFor(events: ObservatoryEvent[], agent: string | null): ObservatoryHistogram {
    const days = new Set<string>();
    const perType = new Map<string, Map<string, number>>();
    const totals: Record<string, number> = {};
    for (const event of events) {
      if (agent !== null && !isAgentRawEvent(event, agent)) continue;
      if (!event.localDate) continue;
      days.add(event.localDate);
      let series = perType.get(event.eventType);
      if (!series) {
        series = new Map();
        perType.set(event.eventType, series);
      }
      series.set(event.localDate, (series.get(event.localDate) ?? 0) + 1);
      totals[event.eventType] = (totals[event.eventType] ?? 0) + 1;
    }
    const orderedDays = Array.from(days).sort();
    const series = Array.from(perType.entries())
      .map(([eventType, counts]) => ({ eventType, counts: orderedDays.map((day) => counts.get(day) ?? 0) }))
      .sort((left, right) => totals[right.eventType]! - totals[left.eventType]! || left.eventType.localeCompare(right.eventType));
    return { days: orderedDays, series, totals };
  }

  private resolveProject(requested?: string): string | undefined {
    if (requested && requested.trim()) return requested.trim();
    return this.projects()[0]?.projectId;
  }

  snapshot(view: ObservatoryView = {}): ObservatorySnapshot {
    const projectId = this.resolveProject(view.projectId);
    const agent = view.agent?.trim() || null;
    if (!projectId) {
      return {
        source: 'live',
        generatedAt: Date.now(),
        watermark: this.watermark(),
        projectId: '',
        project: '',
        agent,
        projects: [],
        agents: [],
        counts: { nodesTotal: 0, edgesTotal: 0, nodesByType: {}, edgesByRelation: {} },
        layout: { armRule: 'project', arms: [] },
        truncation: null,
        histogram: { days: [], series: [], totals: {} },
        nodes: [],
      };
    }
    const aggregate = this.aggregate(projectId);
    const nodes = agent === null
      ? aggregate.nodes
      : aggregate.nodes.filter((node) => (aggregate.nodeAgents.get(node.id) ?? []).includes(agent));
    // `nodesTotal` stays the project's own count — the same number the merged chip shows — while
    // everything that describes the map (the type counts and the arms) follows the view, so a single
    // agent's legend is not a report on the neighbours' corpus.
    const scoped = agent === null
      ? { nodesByType: aggregate.counts.nodesByType, layout: aggregate.layout }
      : {
        nodesByType: countBy(nodes, (node) => node.type),
        layout: { armRule: aggregate.layout.armRule, arms: armCounts(nodes, aggregate.armOf) },
      };
    return {
      source: 'live',
      generatedAt: aggregate.generatedAt,
      watermark: aggregate.watermark,
      projectId,
      project: projectId,
      agent,
      projects: aggregate.projects,
      agents: aggregate.agents,
      counts: { ...aggregate.counts, nodesByType: scoped.nodesByType },
      layout: scoped.layout,
      truncation: aggregate.truncated,
      histogram: agent === null ? aggregate.histogram : this.histogramFor(aggregate.events, agent),
      nodes,
    };
  }

  timeline(view: ObservatoryView & { from?: string; to?: string } = {}): ObservatoryTimeline {
    const projectId = this.resolveProject(view.projectId);
    const agent = view.agent?.trim() || null;
    if (!projectId) {
      return {
        source: 'live', generatedAt: Date.now(), watermark: this.watermark(), projectId: '', agent,
        from: view.from ?? null, to: view.to ?? null,
        histogram: { days: [], series: [], totals: {} },
      };
    }
    const aggregate = this.aggregate(projectId);
    const from = view.from?.trim() || null;
    const to = view.to?.trim() || null;
    // A range that is echoed but never applied would be a parameter that lies about itself.
    const events = from || to
      ? aggregate.events.filter((event) => Boolean(event.localDate) && (!from || event.localDate! >= from) && (!to || event.localDate! <= to))
      : aggregate.events;
    return {
      source: 'live',
      generatedAt: aggregate.generatedAt,
      watermark: aggregate.watermark,
      projectId,
      agent,
      from,
      to,
      histogram: this.histogramFor(events, agent),
    };
  }

  /**
   * One node's detail: the atlas's own answer, so evidence locators and the drilldown command are the
   * ones every other surface prints. Refused when the node is not in the selected agent's view, which
   * is the same predicate the star map filtered on rather than a second opinion.
   */
  node(nodeId: string, view: ObservatoryView = {}): (MemoryAtlasNodeDetail & { visibleToAgent: boolean }) | null {
    const projectId = this.resolveProject(view.projectId);
    if (!projectId) return null;
    const aggregate = this.aggregate(projectId);
    const agent = view.agent?.trim() || null;
    const visibleToAgent = agent === null || (aggregate.nodeAgents.get(nodeId) ?? []).includes(agent);
    if (!visibleToAgent) return null;
    const detailed = this.nodeDetail?.(nodeId, projectId) ?? null;
    if (!detailed) return null;
    return { ...detailed, visibleToAgent };
  }

  /**
   * Stored recall decisions, written by the default recall lane (#187) and read here. The read side
   * lives in `RecallTraces` so the producer and this file never have to change together.
   */
  recalls(view: ObservatoryView & { limit?: number } = {}): ObservatoryRecalls {
    const projectId = this.resolveProject(view.projectId) ?? '';
    return readRecalls(this.db, {
      projectId,
      agent: view.agent?.trim() || null,
      limit: view.limit ?? 50,
      watermark: this.watermark(),
      generatedAt: Date.now(),
    });
  }

  recall(recallId: string, view: ObservatoryView = {}): ObservatoryRecallDetail | null {
    return readRecall(this.db, recallId, {
      projectId: this.resolveProject(view.projectId) ?? '',
      agent: view.agent?.trim() || null,
    });
  }
}
