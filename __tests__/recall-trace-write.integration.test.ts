import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { startObservatoryServer, type ObservatoryServerHandle } from '../src/observatory/HttpServer.js';
import { RecallDecisionTrace, recallTracePayload, RECALL_TRACE_MAX_ROWS } from '../src/observability/RecallDecisionTrace.js';
import type { TraceStore } from '../src/observability/TraceStore.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #187: the recall decision trace has a writer, and the observatory's recall page reads it.
 *
 * The ticket's acceptance is three claims, so there are three kinds of evidence here: a real recall
 * produces a row the page serves (over HTTP, against the same database the recall wrote), the row
 * names what a secret gate withheld without carrying its text, and the table cannot grow without a
 * bound. The recall path itself is not re-tested — the suite that already covers it is the evidence
 * that this changed nothing about what recall returns.
 */

const PROJECT = 'recall-trace';
const AGENT = 'hermes';
const SECRET_TOKEN = 'ghp_abcdefghijklmnopqrstuvwx';
const SECRET_TEXT = `注意 ${SECRET_TOKEN} 这个令牌要轮换`;
/** A word of the marked turn that is not the question: the question is legitimately in the row. */
const SECRET_MARKER = '令牌';
/** What the recall is asked. It reaches the marked turn, which is why the gate has work to do. */
const RECALL_QUERY = '轮换';

const scratch = makeTempDir('cogmem-recall-trace-');
const dbPath = join(scratch, 'memory.db');
let kernel: MemoryKernel;
let backend: KernelAgentMemoryBackend;
let handle: ObservatoryServerHandle;
let base: string;

function append(eventId: string, text: string, metadata?: Record<string, unknown>): void {
  kernel.eventStore.append({
    eventId, streamId: 's-1', streamType: 'thread', eventType: 'MESSAGE', rawEventType: 'message',
    projectId: PROJECT, sessionId: 's-1', threadId: 's-1', role: 'user',
    occurredAt: Date.UTC(2026, 0, 10), sourceId: `${AGENT}:s-1`,
    payload: { text, ...(metadata ? { metadata } : {}) },
  } as never);
}

/** The row the recall just wrote, read through the kernel's own connection. */
function newestTrace(): { id: string; eventType: string; projectId: string | null; payload: Record<string, unknown> } {
  const row = kernel.factStore.getDatabase()
    .query(`SELECT id, event_type, project_id, payload FROM trace_events ORDER BY timestamp DESC, rowid DESC LIMIT 1`)
    .get() as { id: string; event_type: string; project_id: string | null; payload: string } | null;
  if (!row) throw new Error('no trace row was written');
  return { id: row.id, eventType: row.event_type, projectId: row.project_id, payload: JSON.parse(row.payload) as Record<string, unknown> };
}

function rowCount(): number {
  // Zero before the first recall: the table is created by the first decision this process records.
  try {
    return Number((kernel.factStore.getDatabase().query('SELECT COUNT(*) AS c FROM trace_events').get() as { c: number }).c);
  } catch {
    return 0;
  }
}

function suppressedIds(payload: Record<string, unknown>, reason: string): string[] {
  const entries = Array.isArray(payload.suppressed) ? payload.suppressed as Array<{ reason?: string; ids?: string[] }> : [];
  return entries.filter((entry) => entry.reason === reason).flatMap((entry) => entry.ids ?? []);
}

beforeAll(async () => {
  kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  backend = new KernelAgentMemoryBackend(kernel);
  // One ordinary turn and one secret-marked turn. The secret one is written verbatim and marked, the
  // way every write path writes it (#142), so the raw lane drops it before it can become an item.
  append('evt-ordinary', 'the deploy window is Tuesday');
  append('evt-secret', SECRET_TEXT, { secretFindings: { total: 1, byKind: { github_token: 1 } } });
  // The kernel is injected, so the page and the recall share one database while the page keeps its own
  // read-only connection — the shape `cogmem observatory` runs in.
  handle = await startObservatoryServer({ kernel, cwd: scratch, port: 0 });
  base = handle.url.replace(/\/$/u, '');
});

afterAll(() => {
  handle?.stop();
  kernel?.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe('a real recall writes a decision the observatory reads', () => {
  test('the row names the hit, the lane and the reason, with no item text', () => {
    const before = rowCount();
    const result = backend.recall({ agentId: AGENT, projectId: PROJECT, query: 'deploy window', limit: 5 });
    expect(result.items.map((item) => item.id)).toContain('evt-ordinary');
    // One recall, one row: the inverse of "the write point is missing" is "the write point doubled".
    expect(rowCount() - before).toBe(1);

    const row = newestTrace();
    expect(row.eventType).toBe('recall.result');
    expect(row.projectId).toBe(PROJECT);
    expect(row.payload.agentId).toBe(AGENT);
    expect(row.payload.lane).toBe('raw_ledger');
    expect(row.payload.reason).toBe('raw_ledger_only');
    expect(row.payload.selectedIds).toEqual(['evt-ordinary']);
    // The question is what the page shows; the answer's text is not in the row.
    expect(row.payload.query).toBe('deploy window');
    expect(JSON.stringify(row.payload)).not.toContain('Tuesday');

    // `anchorText` is a caller's text — the OpenClaw plugin fills it with a returned item's — and the
    // row is written from the question alone. A recall whose only text is the anchor must not carry it.
    backend.recall({ agentId: AGENT, projectId: PROJECT, query: '', anchorText: 'the deploy window is Tuesday', limit: 5 });
    const anchored = newestTrace();
    expect(anchored.payload.query).toBe('');
    expect(JSON.stringify(anchored.payload)).not.toContain('Tuesday');
  });

  test('the page serves the same id, over HTTP, from its read-only connection', async () => {
    expect(base).not.toBe('');
    const row = newestTrace();

    const listed = await (await fetch(`${base}/recalls?project=${PROJECT}&limit=20`)).json() as {
      available: boolean;
      recalls: Array<{ recallId: string; query?: string }>;
    };
    expect(listed.available).toBe(true);
    expect(listed.recalls.map((recall) => recall.recallId)).toContain(row.id);

    const detail = await (await fetch(`${base}/recalls/${encodeURIComponent(row.id)}?project=${PROJECT}`)).json() as {
      recallId: string;
      payload: Record<string, unknown>;
      chain: Array<{ id: string }>;
    };
    expect(detail.recallId).toBe(row.id);
    expect(detail.payload.selectedIds).toEqual(row.payload.selectedIds);
    expect(detail.chain.map((link) => link.id)).toEqual([row.id]);
  });
});

describe('the secret discipline holds in the trace (#177, #178)', () => {
  test('a withheld secret turn is named by id and reason, never by content', async () => {
    const result = backend.recall({ agentId: AGENT, projectId: PROJECT, query: RECALL_QUERY, limit: 5 });
    // The recall itself still withholds it: the trace is a report on that decision, not a way around it.
    expect(result.items.some((item) => item.text.includes(SECRET_MARKER))).toBe(false);

    const row = newestTrace();
    expect(suppressedIds(row.payload, 'secret_bearing_withheld')).toContain('evt-secret');
    expect(JSON.stringify(row.payload)).not.toContain(SECRET_TOKEN);
    expect(JSON.stringify(row.payload)).not.toContain(SECRET_MARKER);

    // And the page cannot hand it back either: everything it serves about this decision is the row.
    const listed = await fetch(`${base}/recalls?project=${PROJECT}&limit=50`).then((response) => response.text());
    const detail = await fetch(`${base}/recalls/${encodeURIComponent(row.id)}?project=${PROJECT}`).then((response) => response.text());
    for (const body of [listed, detail]) {
      expect(body).not.toContain(SECRET_TOKEN);
      expect(body).not.toContain(SECRET_MARKER);
    }
  });
});

describe('a trace that cannot be written is not a failed recall', () => {
  test('the recall still answers, and the failure is recorded', () => {
    const dir = makeTempDir('cogmem-recall-trace-broken-');
    const path = join(dir, 'memory.db');
    const other = createMemoryKernel({ dbPath: path, vectorBackend: 'sqlite-vec' });
    try {
      other.eventStore.append({
        eventId: 'evt-fragile', streamId: 's', streamType: 'thread', eventType: 'MESSAGE', rawEventType: 'message',
        projectId: PROJECT, sessionId: 's', threadId: 's', role: 'user', occurredAt: 1, sourceId: `${AGENT}:s`,
        payload: { text: 'the deploy window is Tuesday' },
      } as never);
      const memory = new KernelAgentMemoryBackend(other);
      // The first recall creates the table and caches the writer.
      expect(memory.recall({ agentId: AGENT, projectId: PROJECT, query: 'deploy window', limit: 3 }).items).toHaveLength(1);

      // Now break the thing the writer writes to. Every remaining append throws.
      other.factStore.getDatabase().exec('DROP TABLE trace_events');
      const after = memory.recall({ agentId: AGENT, projectId: PROJECT, query: 'deploy window', limit: 3 });
      expect(after.items.map((item) => item.id)).toEqual(['evt-fragile']);

      const nonFatal = other.factStore.getDatabase()
        .query(`SELECT COUNT(*) AS c FROM pipeline_nonfatal_events WHERE kind = 'recall_trace_failed'`)
        .get() as { c: number };
      expect(Number(nonFatal.c)).toBeGreaterThan(0);
    } finally {
      other.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the table stays bounded', () => {
  test('the payload bounds the ids and the question it carries', () => {
    const payload = recallTracePayload({
      projectId: PROJECT,
      query: 'x'.repeat(1000),
      lane: 'raw_ledger',
      reason: 'raw_ledger_only',
      selectedIds: Array.from({ length: 50 }, (_, index) => `id-${index}`),
      suppressed: [{ reason: 'entry_social', count: 50, ids: Array.from({ length: 50 }, (_, index) => `s-${index}`) }],
    });
    expect((payload.query as string).length).toBe(300);
    expect((payload.selectedIds as string[]).length).toBe(20);
    expect((payload.suppressed as Array<{ ids?: string[] }>)[0]?.ids?.length).toBe(20);
  });

  test('retention is swept every 256 appends, and the sweep target is below the ceiling', () => {
    const calls: string[] = [];
    const store = {
      append: () => { calls.push('append'); },
      pruneToLimit: (maxRows: number) => { calls.push(`prune:${maxRows}`); return 0; },
    } as unknown as TraceStore;
    const trace = new RecallDecisionTrace(store);
    const facts = { projectId: PROJECT, query: 'q', lane: 'raw_ledger', reason: 'raw_ledger_only', selectedIds: [] };

    for (let index = 0; index < 256; index += 1) trace.record(facts);
    expect(calls.filter((call) => call === 'append').length).toBe(256);
    // 256 appends between sweeps, so the sweep has to leave that much headroom under the ceiling:
    // the table never exceeds RECALL_TRACE_MAX_ROWS, which is the number doctor prints it against.
    const [prune] = calls.filter((call) => call.startsWith('prune:'));
    expect(prune).toBe(`prune:${RECALL_TRACE_MAX_ROWS - 256 + 1}`);

    trace.record(facts);
    expect(calls.filter((call) => call.startsWith('prune:')).length).toBe(1);
  });

  test('a decision that names no project is not written', () => {
    const calls: string[] = [];
    const store = {
      append: () => { calls.push('append'); },
      pruneToLimit: () => 0,
    } as unknown as TraceStore;
    // A row with a NULL `project_id` passes every project's filter on the read side, so one recall
    // would show up on the page of every project on the database.
    new RecallDecisionTrace(store).record({ projectId: '', query: 'q', lane: 'raw_ledger', reason: 'raw_ledger_only', selectedIds: [] });
    expect(calls).toEqual([]);
  });
});
