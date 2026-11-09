/**
 * The stored recall decisions, read.
 *
 * The observatory's recall page shows what the default lane actually decided, and in this version it
 * reads decisions that were already stored rather than running `explain` to make one — that path can
 * write a row, and a read-only page may not. The table is checked for existence rather than
 * initialized, because `TraceStore.initSchema` is a write.
 *
 * Known gap, and the reason this file is small: nothing in the product constructs a `TraceStore`, so
 * `trace_events` does not exist on a real database and every answer here is empty. The page says so.
 * When a producer lands (#187), this is the one file that has to change.
 */

import type Database from 'bun:sqlite';

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

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
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

/** Whether the trace table exists. Cached per connection: `sqlite_master` does not change under a reader. */
const traceTablePresence = new WeakMap<object, boolean>();

export function traceTableExists(db: Database): boolean {
  const cached = traceTablePresence.get(db as unknown as object);
  if (cached !== undefined) return cached;
  const rows = db.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'trace_events'`).all() as Array<{ name: string }>;
  const present = rows.length > 0;
  traceTablePresence.set(db as unknown as object, present);
  return present;
}

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
    available: traceTableExists(db),
    recalls: [],
  };
  if (!empty.available || !projectId) return empty;

  const rows = db
    .query(`SELECT id, timestamp, task_id, project_id, event_type, payload FROM trace_events
            WHERE event_type IN ('recall.request','recall.result')
            ORDER BY timestamp DESC, id ASC LIMIT ?`)
    .all(Math.min(limit * 2, 1000)) as TraceRow[];

  const seenTasks = new Set<string>();
  const recalls: ObservatoryRecall[] = [];
  for (const row of rows) {
    if (row.project_id && row.project_id !== projectId) continue;
    const recall = toRecall(row);
    if (agent !== null && !recallNamesAgent(recall.payload, agent)) continue;
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
  if (!traceTableExists(db)) return null;
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
