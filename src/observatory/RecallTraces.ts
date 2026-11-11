/**
 * The stored recall decisions, read.
 *
 * The observatory's recall page shows what the default lane actually decided, and it reads decisions
 * that were already stored rather than running `explain` to make one — that path can write a row, and
 * a read-only page may not. The producer is `RecallDecisionTrace` (#187), written by
 * `KernelAgentMemoryBackend.recall()`; this side only reads. The table is still checked for existence
 * rather than initialized, because `TraceStore.initSchema` is a write.
 */

import type Database from 'bun:sqlite';

import { parseJsonObject, tableExists } from '../utils/Values.js';

export type RecallDecision = 'recall.request' | 'recall.result';

export interface ObservatoryRecall {
  recallId: string;
  taskId?: string;
  projectId?: string;
  startedAt: number;
  query?: string;
  decision: RecallDecision;
  payload: Record<string, unknown>;
}

export interface ObservatoryRecalls {
  source: 'live';
  generatedAt: number;
  watermark: number;
  projectId: string;
  agent: string | null;
  /** False when this database has no `trace_events` table at all — the honest answer, not an error. */
  available: boolean;
  recalls: ObservatoryRecall[];
}

export interface ObservatoryRecallDetail extends ObservatoryRecall {
  chain: Array<{ id: string; eventType: string; timestamp: number; payload: Record<string, unknown> }>;
}

interface TraceRow {
  id: string;
  timestamp: number;
  task_id: string | null;
  project_id: string | null;
  event_type: string;
  payload: string;
  parent_event_id?: string | null;
}

function toRecall(row: TraceRow): ObservatoryRecall {
  const payload = parseJsonObject(row.payload);
  return {
    recallId: row.id,
    taskId: row.task_id ?? undefined,
    projectId: row.project_id ?? undefined,
    startedAt: Number(row.timestamp ?? 0),
    query: typeof payload.query === 'string' ? payload.query : undefined,
    decision: row.event_type === 'recall.result' ? 'recall.result' : 'recall.request',
    payload,
  };
}

/**
 * A stored decision that names no agent is project-level, the same reading the scope rule gives a
 * record with no owner — the trace format has no agent column, so the payload is where a name can be.
 */
function recallNamesAgent(payload: Record<string, unknown>, agent: string): boolean {
  const named = [payload.agentId, payload.agent, payload.sourceAgent]
    .filter((value): value is string => typeof value === 'string');
  return named.length === 0 || named.includes(agent);
}

/**
 * The SQL twin of {@link recallNamesAgent}, for the read where the scope has to sit in the WHERE
 * rather than in a pass over the rows: the recall list, whose LIMIT must spend its budget on rows it
 * will actually show (#188). The `json_valid` guard mirrors `parseJsonObject`'s catch — a malformed
 * payload names nobody — and the CASE is what keeps the JSON calls off that payload.
 */
const AGENT_SCOPE_SQL = `(? IS NULL OR CASE
    WHEN json_valid(payload) = 0 THEN 1
    WHEN json_type(payload,'$.agentId') = 'text'
      OR json_type(payload,'$.agent') = 'text'
      OR json_type(payload,'$.sourceAgent') = 'text'
    THEN (json_extract(payload,'$.agentId') = ?
       OR json_extract(payload,'$.agent') = ?
       OR json_extract(payload,'$.sourceAgent') = ?)
    ELSE 1
  END)`;

export function readRecalls(
  db: Database,
  options: { projectId: string; agent: string | null; limit: number; watermark: number; generatedAt: number },
): ObservatoryRecalls {
  const { projectId, agent } = options;
  const limit = Math.max(1, Math.min(Math.floor(options.limit), 500));
  const empty: ObservatoryRecalls = {
    source: 'live',
    generatedAt: options.generatedAt,
    watermark: options.watermark,
    projectId,
    agent,
    // Asked per read rather than cached: the kernel's own connection creates the table on the first
    // recall (#187), and the observatory opens its read-only connection before any recall has
    // happened, so a cached "no" from that moment would outlive the table and empty the page forever.
    available: tableExists(db, 'trace_events'),
    recalls: [],
  };
  if (!empty.available || !projectId) return empty;

  // The scope is part of the WHERE, so the LIMIT is spent on rows this page will show. Filtering the
  // fetched rows instead handed another project's decisions the budget and returned fewer than `limit`
  // on a shared database (#188). An unowned row — NULL or empty, the way the row filter read a missing
  // project — is project-level and passes every project's read.
  const rows = db
    .query(`SELECT id, timestamp, task_id, project_id, event_type, payload FROM trace_events
            WHERE event_type IN ('recall.request','recall.result')
              AND (project_id IS NULL OR project_id = '' OR project_id = ?)
              AND ${AGENT_SCOPE_SQL}
            ORDER BY timestamp DESC, id ASC LIMIT ?`)
    .all(projectId, agent, agent, agent, agent, Math.min(limit * 2, 1000)) as TraceRow[];

  const seenTasks = new Set<string>();
  const recalls: ObservatoryRecall[] = [];
  for (const row of rows) {
    const recall = toRecall(row);
    // One row per decision: a task's request and its result are the same decision at two moments.
    const key = recall.taskId ?? recall.recallId;
    if (seenTasks.has(key)) continue;
    seenTasks.add(key);
    recalls.push(recall);
    if (recalls.length >= limit) break;
  }
  return { ...empty, recalls };
}

export function readRecall(
  db: Database,
  recallId: string,
  options: { projectId: string; agent: string | null },
): ObservatoryRecallDetail | null {
  if (!tableExists(db, 'trace_events')) return null;
  const row = db
    .query(`SELECT id, timestamp, task_id, project_id, event_type, payload, parent_event_id FROM trace_events WHERE id = ?`)
    .get(recallId) as TraceRow | null;
  if (!row) return null;
  if (row.project_id && options.projectId && row.project_id !== options.projectId) return null;
  const recall = toRecall(row);
  // The list is agent-filtered, so the detail has to be too: otherwise a decision the list hides is
  // still readable by anyone who guesses its id, which is the same scope leak in a quieter form.
  if (options.agent !== null && !recallNamesAgent(recall.payload, options.agent)) return null;

  const chain: ObservatoryRecallDetail['chain'] = [];
  const visited = new Set<string>();
  let currentId: string | null = row.id;
  while (currentId && !visited.has(currentId) && chain.length < 32) {
    visited.add(currentId);
    const link = db
      .query(`SELECT id, timestamp, event_type, payload, parent_event_id FROM trace_events WHERE id = ?`)
      .get(currentId) as TraceRow | null;
    if (!link) break;
    chain.push({ id: link.id, eventType: link.event_type, timestamp: Number(link.timestamp ?? 0), payload: parseJsonObject(link.payload) });
    currentId = link.parent_event_id ?? null;
  }
  return { ...recall, chain: chain.reverse() };
}
