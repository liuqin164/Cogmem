/**
 * The stored recall decision, written.
 *
 * One row per call of the default recall lane: `KernelAgentMemoryBackend.recall()` is where the MCP
 * tool, the CLI, the host bridge, `recallPack()` and explain's re-run all arrive, so a decision is
 * recorded once, in one place, rather than at each of those call sites.
 *
 * What the row may contain is the whole discipline, and it is ids, reasons and the lane (#177, #178).
 * A secret-marked turn is withheld from every lane and its text never reaches an answer; this row is
 * read by an operator auditing those lanes, so it must not become the leak the lanes closed. The
 * payload is built here and nowhere else, which is what makes that checkable.
 *
 * The rows are what the observatory's recall page reads (#136). Until this module existed nothing in
 * the product constructed a `TraceStore`, so `trace_events` never existed on a real database and the
 * page was empty by construction (#187).
 *
 * `reason` and `lane` are plain strings here on purpose: this is a serialization contract with a
 * separate consumer (`src/observatory/RecallTraces.ts`), and it has to accept a row written by an
 * older build or a lane the agent module has since renamed, rather than reject it at the type level.
 * The unions stay in `AgentMemoryBackend`, where the decision is made.
 */

import { TraceStore } from './TraceStore.js';
import { TraceWriter } from './TraceWriter.js';

/**
 * The ceiling on the table: it never holds more rows than this.
 *
 * The newest win. One row per recall, so this is a few megabytes at the cap. The sweep keeps
 * `RECALL_TRACE_MAX_ROWS - PRUNE_EVERY + 1` and runs at most every `PRUNE_EVERY` appends, which is
 * what makes this number the real bound rather than the sweep target — `cogmem doctor --storage`
 * prints `<rows>/<this>` and a value above it would be a bug.
 *
 * ponytail: a row cap, not an age policy — upgrade to "older than N days" if a day's volume ever
 * matters more than a count.
 */
export const RECALL_TRACE_MAX_ROWS = 5000;

/** Ids one decision may name per bucket. The row is for reading, not for reconstructing a ranking. */
const ID_LIMIT = 20;

/** Appends between retention sweeps, so the DELETE is amortized instead of paid on every recall. */
const PRUNE_EVERY = 256;

/** The question is bounded: it is written to be read, not archived. */
const QUERY_LIMIT = 300;

export interface RecallTraceSuppression {
  reason: string;
  count: number;
  /** Which entries this reason removed, when the gate that removed them knew their ids. Bounded. */
  ids?: string[];
}

/** The decision, as plain data — everything the payload needs and nothing that could hold text. */
export interface RecallTraceFacts {
  projectId: string;
  agentId?: string;
  query: string;
  /** The channel that answered: `selectedLane` on the decision trace. */
  lane: string;
  reason: string;
  /** Ids of the items the recall returned. */
  selectedIds: string[];
  suppressed?: RecallTraceSuppression[];
}

function bounded(ids: readonly string[]): string[] {
  return ids.slice(0, ID_LIMIT);
}

export function recallTracePayload(facts: RecallTraceFacts): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    query: facts.query.slice(0, QUERY_LIMIT),
    lane: facts.lane,
    reason: facts.reason,
    selectedIds: bounded(facts.selectedIds),
  };
  // The read side's per-agent filter looks for a name in the payload (`recallNamesAgent`), and the
  // trace table has no agent column.
  if (facts.agentId) payload.agentId = facts.agentId;
  if (facts.suppressed?.length) {
    payload.suppressed = facts.suppressed.map((entry) => ({
      reason: entry.reason,
      count: entry.count,
      ...(entry.ids?.length ? { ids: bounded(entry.ids) } : {}),
    }));
  }
  return payload;
}

/**
 * Appends one decision and keeps the table bounded.
 *
 * Synchronous on purpose: the observatory reads the database through its own read-only connection, and
 * the acceptance point is that a recall which just returned is visible to it. A queue would put a timer
 * between the write and the read for no gain — one INSERT is what the measurement on the 20,343-event
 * corpus paid (see the ticket), and the retention sweep is one DELETE per {@link PRUNE_EVERY} recalls.
 */
export class RecallDecisionTrace {
  private readonly writer: TraceWriter;
  private appendsSincePrune = 0;

  constructor(private readonly store: TraceStore) {
    this.writer = new TraceWriter(store);
  }

  record(facts: RecallTraceFacts): void {
    // A decision with no project has no page to appear on: the observatory is project-scoped, and a
    // row with a NULL `project_id` passes every project's filter on the read side. Skipped rather than
    // written unowned, which would make one recall visible everywhere.
    if (!facts.projectId) return;
    // No `taskId`: the observatory reads one row per decision and keys a decision by `taskId ?? id`, so
    // leaving it empty keeps every recall its own decision instead of collapsing a host's session.
    this.writer.emit({
      projectId: facts.projectId,
      eventType: 'recall.result',
      payload: recallTracePayload(facts),
    });
    this.appendsSincePrune += 1;
    if (this.appendsSincePrune < PRUNE_EVERY) return;
    this.appendsSincePrune = 0;
    // The sweep target is one interval below the ceiling, so reaching it at most once per interval
    // cannot carry the table past {@link RECALL_TRACE_MAX_ROWS}.
    this.store.pruneToLimit(RECALL_TRACE_MAX_ROWS - PRUNE_EVERY + 1);
  }
}
