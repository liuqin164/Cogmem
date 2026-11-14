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

export interface ObservatoryHealthDream {
  runId: string;
  projectId: string | null;
  status: string;
  selectedMode: string;
  reason: string;
  createdAt: number;
  durationMs: number;
  episodeCount: number;
  candidateCount: number;
  failedEpisodeCount: number;
}

export interface ObservatoryHealth {
  source: 'live';
  generatedAt: number;
  /** False when no `health.check` has ever persisted a report. */
  checked: boolean;
  report: unknown | null;
  lastDream: ObservatoryHealthDream | null;
  lastCompile: { framesUpdatedAt: number | null; atlasUpdatedAt: number | null };
  budget: { intent: string; budgetTokens: number; usedTokens: number; createdAt: number } | null;
  anomalies: { windowMs: number; degradedTransitions: number; failedDreamRuns: number };
  snapshot: { file: string; createdAt: string; ok: boolean; checks: Record<string, boolean>; checkedAt: string } | null;
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
  /** The family roster, listed beside the identities the corpus names. */
  connectedAgents?: () => string[];
  /**
   * The star map's node budget. Production uses {@link SNAPSHOT_NODE_LIMIT}; the seam exists so a
   * test can reproduce "the agent's node is outside the top N" without inserting 20,001 rows.
   */
  nodeLimit?: number;
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

interface AgentAggregate {
  stamp: string;
  nodes: ObservatoryNode[];
  truncated: ObservatoryTruncation | null;
  nodesByType: Record<string, number>;
  layout: ObservatorySnapshot['layout'];
}

interface FullVisibility {
  stamp: string;
  rows: AtlasRow[];
  agentsByNode: Map<string, string[]>;
  counts: Map<string, number>;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const name = key(item);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

function countByTypeRows(rows: AtlasRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.node_type] = (counts[row.node_type] ?? 0) + 1;
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
  private readonly nodeLimit: number;
  private readonly cache = new Map<string, ProjectAggregate>();
  private readonly agentCache = new Map<string, AgentAggregate>();
  private readonly fullCache = new Map<string, FullVisibility>();

  constructor(options: MemoryObservatoryOptions) {
    this.db = options.db;
    this.nodeDetail = options.nodeDetail;
    this.connectedAgents = options.connectedAgents ?? (() => []);
    this.nodeLimit = Math.max(1, Math.floor(options.nodeLimit ?? SNAPSHOT_NODE_LIMIT));
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
      .all(projectId, this.nodeLimit + 1) as AtlasRow[];
    const overflow = rows.length > this.nodeLimit;
    const kept = overflow ? rows.slice(0, this.nodeLimit) : rows;

    const built = this.buildNodes(kept, projectId);
    const { nodes, nodeEventIds, armOf, armRule } = built;

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
        armRule,
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
    // The roster's node count is the agent's own view of the whole project, not the count that
    // survived the project's display budget (#204). Only a truncated project needs the full read;
    // below the limit the kept rows are the whole project and the loop above already counted them.
    if (nodesTotal > this.nodeLimit) {
      const full = this.fullVisibility(projectId, aggregate);
      aggregate.agents = aggregate.agents.map((agent) => ({ ...agent, nodes: full.counts.get(agent.id) ?? 0 }));
    }
    this.cache.set(projectId, aggregate);
    return aggregate;
  }

  /** The rows the page will draw, in the order the SQL selected them. */
  private buildNodes(rows: AtlasRow[], projectId: string): {
    nodes: ObservatoryNode[];
    nodeEventIds: Map<string, string[]>;
    armOf: Map<string, string>;
    armRule: 'topic_path' | 'project';
  } {
    const topicArm = this.topicArms(projectId);
    const nodeEventIds = new Map<string, string[]>();
    const armOf = new Map<string, string>();
    const layoutInput: Array<{ id: string; arm: string }> = [];
    let armsFromTopic = false;
    for (const row of rows) {
      const topicArmId = topicArm.get(row.node_id);
      if (row.topic_path || topicArmId) armsFromTopic = true;
      const arm = armKeyFor({ topicPath: row.topic_path ?? undefined, topicArm: topicArmId, projectId });
      armOf.set(row.node_id, arm);
      layoutInput.push({ id: row.node_id, arm });
      nodeEventIds.set(row.node_id, parseJsonArray(row.evidence_event_ids_json));
    }
    const positions = galaxyLayout(layoutInput);
    const nodes: ObservatoryNode[] = rows.map((row) => {
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
    return { nodes, nodeEventIds, armOf, armRule: armsFromTopic ? 'topic_path' : 'project' };
  }

  /**
   * The project's whole node set with each node's visible agents (#204).
   *
   * Only a project past the display budget pays for this. The predicate is not a second SQL copy:
   * the same `chainFor` + `eventsVisibleToAgent` pair the row filter used runs over every row, and
   * the display budget is applied to the answer afterwards. That is what keeps an agent's node from
   * disappearing because the project's top N filled up first.
   */
  private fullVisibility(projectId: string, aggregate: ProjectAggregate): FullVisibility {
    const cached = this.fullCache.get(projectId);
    if (cached && cached.stamp === aggregate.stamp) return cached;
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
      `)
      .all(projectId) as AtlasRow[];
    const nodeEventIds = new Map<string, string[]>();
    for (const row of rows) nodeEventIds.set(row.node_id, parseJsonArray(row.evidence_event_ids_json));
    const candidates = aggregate.agents.map((agent) => agent.id);
    const agentsByNode = new Map<string, string[]>();
    const counts = new Map<string, number>();
    for (const name of candidates) counts.set(name, 0);
    for (const row of rows) {
      const chain = this.chainFor(row.node_id, nodeEventIds, aggregate.eventIndex);
      const visible: string[] = [];
      for (const name of candidates) {
        if (eventsVisibleToAgent(chain, name)) {
          visible.push(name);
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
      agentsByNode.set(row.node_id, visible);
    }
    const full: FullVisibility = { stamp: aggregate.stamp, rows, agentsByNode, counts };
    this.fullCache.set(projectId, full);
    return full;
  }

  /** One agent's map: its visible rows first, then the display budget. */
  private agentView(projectId: string, agent: string, aggregate: ProjectAggregate): AgentAggregate {
    const key = `${projectId}\u0000${agent}`;
    const cached = this.agentCache.get(key);
    if (cached && cached.stamp === aggregate.stamp) return cached;

    let view: AgentAggregate;
    if (aggregate.nodesTotal <= this.nodeLimit) {
      const nodes = aggregate.nodes.filter((node) => (aggregate.nodeAgents.get(node.id) ?? []).includes(agent));
      view = {
        stamp: aggregate.stamp,
        nodes,
        truncated: aggregate.truncated,
        nodesByType: countBy(nodes, (node) => node.type),
        layout: { armRule: aggregate.layout.armRule, arms: armCounts(nodes, aggregate.armOf) },
      };
    } else {
      const full = this.fullVisibility(projectId, aggregate);
      const visibleRows = full.rows.filter((row) => (full.agentsByNode.get(row.node_id) ?? []).includes(agent));
      const kept = visibleRows.slice(0, this.nodeLimit);
      const built = this.buildNodes(kept, projectId);
      view = {
        stamp: aggregate.stamp,
        nodes: built.nodes,
        // The truncation is this view's own: how many of *this agent's* nodes were cut, never the
        // project's count borrowed as if it described the view (#204).
        truncated: visibleRows.length > this.nodeLimit
          ? this.truncation(visibleRows.length, kept, countByTypeRows(visibleRows))
          : null,
        nodesByType: countBy(built.nodes, (node) => node.type),
        layout: { armRule: built.armRule, arms: armCounts(built.nodes, built.armOf) },
      };
    }
    this.agentCache.set(key, view);
    return view;
  }

  private nodeVisibleToAgent(projectId: string, nodeId: string, agent: string, aggregate: ProjectAggregate): boolean {
    if (aggregate.nodesTotal <= this.nodeLimit) return (aggregate.nodeAgents.get(nodeId) ?? []).includes(agent);
    return (this.fullVisibility(projectId, aggregate).agentsByNode.get(nodeId) ?? []).includes(agent);
  }

  private truncation(nodesTotal: number, kept: AtlasRow[], nodesByType: Record<string, number>): ObservatoryTruncation {
    const returnedByType: Record<string, number> = {};
    for (const row of kept) returnedByType[row.node_type] = (returnedByType[row.node_type] ?? 0) + 1;
    const byType: Record<string, { total: number; returned: number }> = {};
    for (const [type, total] of Object.entries(nodesByType)) {
      const returned = returnedByType[type] ?? 0;
      if (returned < total) byType[type] = { total, returned };
    }
    return { limit: this.nodeLimit, returned: kept.length, omitted: Math.max(0, nodesTotal - kept.length), byType };
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
    // The agent's scope is applied to the whole project, then the display budget — not the other way
    // round (#204). `nodesTotal` stays the project's own count, the number the merged chip shows.
    const scopedView = agent === null ? null : this.agentView(projectId, agent, aggregate);
    const nodes = scopedView ? scopedView.nodes : aggregate.nodes;
    // `nodesTotal` stays the project's own count — the same number the merged chip shows — while
    // everything that describes the map (the type counts and the arms) follows the view, so a single
    // agent's legend is not a report on the neighbours' corpus.
    const scoped = scopedView === null
      ? { nodesByType: aggregate.counts.nodesByType, layout: aggregate.layout }
      : { nodesByType: scopedView.nodesByType, layout: scopedView.layout };
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
      truncation: scopedView ? scopedView.truncated : aggregate.truncated,
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
    const visibleToAgent = agent === null || this.nodeVisibleToAgent(projectId, nodeId, agent, aggregate);
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

  /**
   * The observatory's own health page (#196, F19): the last persisted self-check, the recent Dream
   * runs, the latest frame and atlas compile instants, the latest context-budget receipt, the
   * anomaly counts and the latest snapshot's verification.
   *
   * This is a read. It deliberately does not run `health.check`, because a check can record a
   * transition; the report it shows is the one the shell or `doctor` persisted.
   */
  health(input: { now?: number } = {}): ObservatoryHealth {
    const now = input.now ?? Date.now();
    const report = this.metaJson('health_state');
    return {
      source: 'live',
      generatedAt: now,
      checked: report !== null,
      report,
      lastDream: this.lastDream(),
      lastCompile: {
        framesUpdatedAt: this.maxTimestamp('memory_frames'),
        atlasUpdatedAt: this.maxTimestamp('memory_atlas_documents'),
      },
      budget: this.lastBudget(),
      anomalies: {
        windowMs: 7 * 24 * 60 * 60_000,
        degradedTransitions: this.countSince(
          `SELECT COUNT(*) AS c FROM governance_audit_log
            WHERE action = 'health_changed' AND created_at >= ?
              AND json_extract(details_json, '$.to') = 'degraded'`,
          now - 7 * 24 * 60 * 60_000,
        ),
        failedDreamRuns: this.countSince(
          `SELECT COUNT(*) AS c FROM episode_dream_runs WHERE status = 'partial' AND created_at >= ?`,
          now - 7 * 24 * 60 * 60_000,
        ),
      },
      snapshot: this.lastSnapshot(),
    };
  }

  private metaJson(key: string): unknown | null {
    try {
      const row = this.db.query('SELECT value FROM _meta WHERE key = ?').get(key) as { value?: string } | null;
      if (!row?.value) return null;
      return JSON.parse(row.value) as unknown;
    } catch {
      return null;
    }
  }

  private lastDream(): ObservatoryHealthDream | null {
    try {
      const row = this.db.query(`
        SELECT run_id, project_id, status, selected_mode, reason, created_at, duration_ms,
               episode_ids_json, candidate_ids_json, failed_episode_ids_json
          FROM episode_dream_runs
         ORDER BY created_at DESC
         LIMIT 1
      `).get() as Record<string, unknown> | null;
      if (!row) return null;
      return {
        runId: String(row.run_id ?? ''),
        projectId: row.project_id === null || row.project_id === undefined ? null : String(row.project_id),
        status: String(row.status ?? ''),
        selectedMode: String(row.selected_mode ?? ''),
        reason: String(row.reason ?? ''),
        createdAt: Number(row.created_at ?? 0),
        durationMs: Number(row.duration_ms ?? 0),
        episodeCount: jsonArrayLength(row.episode_ids_json),
        candidateCount: jsonArrayLength(row.candidate_ids_json),
        failedEpisodeCount: jsonArrayLength(row.failed_episode_ids_json),
      };
    } catch {
      return null;
    }
  }

  private maxTimestamp(table: string): number | null {
    try {
      const row = this.db.query(`SELECT MAX(updated_at) AS t FROM ${table}`).get() as { t?: number | null } | null;
      return row?.t === null || row?.t === undefined ? null : Number(row.t);
    } catch {
      return null;
    }
  }

  private lastBudget(): ObservatoryHealth['budget'] {
    try {
      const row = this.db.query(`
        SELECT intent, budget_tokens, used_tokens, created_at
          FROM context_activation_receipts
         ORDER BY created_at DESC
         LIMIT 1
      `).get() as { intent?: string; budget_tokens?: number; used_tokens?: number; created_at?: number } | null;
      if (!row) return null;
      return {
        intent: String(row.intent ?? ''),
        budgetTokens: Number(row.budget_tokens ?? 0),
        usedTokens: Number(row.used_tokens ?? 0),
        createdAt: Number(row.created_at ?? 0),
      };
    } catch {
      return null;
    }
  }

  private countSince(sql: string, since: number): number {
    try {
      const row = this.db.query(sql).get(since) as { c?: number } | null;
      return Number(row?.c ?? 0);
    } catch {
      return 0;
    }
  }

  private lastSnapshot(): ObservatoryHealth['snapshot'] {
    const value = this.metaJson('brain_snapshot_last');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const checks = record.checks && typeof record.checks === 'object' && !Array.isArray(record.checks)
      ? record.checks as Record<string, boolean>
      : {};
    return {
      file: String(record.file ?? ''),
      createdAt: String(record.createdAt ?? ''),
      ok: record.ok === true,
      checks,
      checkedAt: String(record.checkedAt ?? ''),
    };
  }
}

function jsonArrayLength(value: unknown): number {
  if (typeof value !== 'string') return 0;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}
