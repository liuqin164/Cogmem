import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

function createKernel(): MemoryKernel {
  return createMemoryKernel({ dbPath: join(makeTempDir('cogmem-thread-read-'), 'memory.db') });
}

function appendThreadEvent(kernel: MemoryKernel, eventId: string, threadId: string, projectId: string, threadSeq: number): void {
  kernel.eventStore.append({
    eventId,
    streamId: threadId,
    streamType: 'thread',
    eventType: 'MESSAGE',
    rawEventType: 'message',
    eventVersion: threadSeq + 1,
    projectId,
    sessionId: threadId,
    threadId,
    threadSeq,
    role: 'user',
    occurredAt: Date.UTC(2026, 5, 5, 12, 0, 0) + threadSeq,
    payload: { text: `${threadId} turn ${threadSeq}` },
  });
}

/** Every plan line the thread read produced for the event table. */
function captureThreadPlans(kernel: MemoryKernel, run: () => void): string[] {
  const db = kernel.eventStore.db as unknown as { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } };
  const prepare = db.prepare.bind(db);
  const plans: string[] = [];
  db.prepare = (sql: string) => {
    const statement = prepare(sql);
    if (/^\s*SELECT/i.test(sql) && sql.includes('memory_events')) {
      const all = statement.all.bind(statement);
      statement.all = (...args: unknown[]) => {
        plans.push(...(prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Array<{ detail: string }>).map((row) => row.detail));
        return all(...args);
      };
    }
    return statement;
  };
  try {
    run();
  } finally {
    db.prepare = prepare;
  }
  return plans;
}

test('a thread is read in thread order through the thread index, not by scanning every event', () => {
  const kernel = createKernel();
  try {
    for (const seq of [2, 0, 1]) appendThreadEvent(kernel, `evt-${seq}`, 'target', 'p', seq);
    // The same thread id in another project must not leak into the read.
    appendThreadEvent(kernel, 'evt-other-project', 'target', 'other', 9);

    let events: Array<{ eventId: string }> = [];
    const plans = captureThreadPlans(kernel, () => {
      events = kernel.eventStore.getThreadEvents('target', { projectId: 'p' });
    });

    expect(events.map((event) => event.eventId)).toEqual(['evt-0', 'evt-1', 'evt-2']);

    const eventLines = plans.filter((line) => line.includes('memory_events'));
    expect(eventLines.length).toBeGreaterThan(0);
    // The `OR` this read used to carry kept SQLite off both indexes and scanned
    // the whole event table — 6.5 ms for a 60-event thread on the year corpus.
    expect(eventLines.every((line) => line.startsWith('SEARCH'))).toBe(true);
  } finally {
    kernel.close();
  }
});
