import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel, type MemoryKernel, type RawMemoryEventInput } from '../src/factory.js';
import {
  DEFAULT_EVENT_BUFFER_CAPACITY,
  EVENT_CONTRACT_VERSION,
  KERNEL_EVENT_TYPES,
  KernelEventStreamError,
  MemoryEventStream,
  type KernelEvent,
  type KernelEventFilter,
  type KernelEventType,
} from '../src/events/index.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The F1 event-stream contract (#155), asserted against the document it claims to implement.
 *
 * Two kinds of test here. The document test reads `docs/events.md` and compares its frozen table with
 * `KERNEL_EVENT_TYPES`, so a type added in one place and not the other is red. The rest are the
 * acceptance criteria: cursor replay across a disconnect, one discriminative test per filter
 * dimension, a throwing subscriber that cannot fail a ledger write, and the typed errors.
 */

const scratch = makeTempDir('cogmem-event-stream-');
const dbPath = join(scratch, 'memory.db');
let kernel: MemoryKernel;

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath });
});

afterAll(() => {
  kernel.close();
});

/** Replay everything the stream still holds, from `since`, and stop. Synchronous by construction. */
function replay(stream: { subscribe: MemoryEventStream['subscribe'] }, filter: KernelEventFilter, since = 0): KernelEvent[] {
  const seen: KernelEvent[] = [];
  const subscription = stream.subscribe(filter, (event) => seen.push(event), { since });
  subscription.unsubscribe();
  return seen;
}

let messageSeq = 0;
function write(input: Partial<RawMemoryEventInput> & { projectId: string; metadata?: Record<string, unknown> }): string {
  messageSeq += 1;
  return kernel.recordRawEvent({
    threadId: `thread-${messageSeq}`,
    sessionId: `session-${messageSeq}`,
    role: 'user',
    content: `message ${messageSeq}`,
    ...input,
  }).eventId;
}

describe('the contract document and the frozen list agree', () => {
  test('the event-types table in docs/events.md is exactly KERNEL_EVENT_TYPES', () => {
    const markdown = readFileSync(fileURLToPath(new URL('../docs/events.md', import.meta.url)), 'utf8');
    const section = markdown.split('## Event types (frozen)')[1]?.split('\n## ')[0];
    expect(section).toBeTruthy();
    const documented = [...(section ?? '').matchAll(/^\|\s*`([a-z][a-z-]*)`\s*\|/gmu)].map((match) => match[1]);
    expect(documented.length).toBeGreaterThan(0);
    expect([...documented].sort()).toEqual([...KERNEL_EVENT_TYPES].sort());
    expect(EVENT_CONTRACT_VERSION).toBe(1);
    expect(DEFAULT_EVENT_BUFFER_CAPACITY).toBeGreaterThan(0);
  });
});

describe('ledger-append', () => {
  test('a committed row is announced with ids and scope, and none of its text', () => {
    const secret = 'the vault code is 4711';
    const seen: KernelEvent[] = [];
    const subscription = kernel.events.subscribe({}, (event) => seen.push(event));
    const eventId = write({ projectId: 'alpha', metadata: { sourceAgent: 'cog' }, content: secret });
    subscription.unsubscribe();

    const announced = seen.find((event) => event.type === 'ledger-append' && event.payload.eventId === eventId);
    expect(announced).toBeTruthy();
    expect(announced!.projectId).toBe('alpha');
    expect(announced!.agentIds).toContain('cog');
    expect(JSON.stringify(announced)).not.toContain(secret);
  });

  test('the cursor advances with every delivered event', () => {
    const seen: KernelEvent[] = [];
    const subscription = kernel.events.subscribe({ types: ['ledger-append'] }, (event) => seen.push(event));
    write({ projectId: 'alpha' });
    write({ projectId: 'alpha' });
    expect(subscription.cursor).toBe(seen[seen.length - 1]!.cursor);
    expect(seen.map((event) => event.cursor)).toEqual([...seen.map((event) => event.cursor)].sort((a, b) => a - b));
    subscription.unsubscribe();
    expect(subscription.active).toBe(false);
  });
});

describe('cursor replay across a disconnect', () => {
  test('reconnecting from the cursor returns exactly what was written while away, in order, once', () => {
    const truth: KernelEvent[] = [];
    const truthSub = kernel.events.subscribe({ types: ['ledger-append'] }, (event) => truth.push(event));

    write({ projectId: 'replay' });
    const resumeFrom = kernel.events.headCursor;

    // The client is disconnected here: nothing is subscribed on its behalf while these three land.
    const written: string[] = [
      write({ projectId: 'replay' }),
      write({ projectId: 'replay' }),
      write({ projectId: 'replay' }),
    ];

    const expected = truth.filter((event) => event.cursor > resumeFrom);
    truthSub.unsubscribe();
    expect(expected.length).toBeGreaterThanOrEqual(3);

    const replayed = replay(kernel.events, { types: ['ledger-append'] }, resumeFrom);
    expect(replayed.map((event) => event.cursor)).toEqual(expected.map((event) => event.cursor));
    expect(new Set(replayed.map((event) => event.cursor)).size).toBe(replayed.length);
    for (const eventId of written) {
      expect(replayed.some((event) => event.payload.eventId === eventId)).toBe(true);
    }

    // Replaying the same cursor twice is the same answer both times: no consumption, no drift.
    expect(replay(kernel.events, { types: ['ledger-append'] }, resumeFrom).map((event) => event.cursor))
      .toEqual(replayed.map((event) => event.cursor));
  });

  test('subscribing with no cursor starts live and replays nothing', () => {
    write({ projectId: 'replay' });
    const seen: KernelEvent[] = [];
    const subscription = kernel.events.subscribe({ types: ['ledger-append'] }, (event) => seen.push(event));
    expect(seen).toEqual([]);
    write({ projectId: 'replay' });
    expect(seen.length).toBe(1);
    subscription.unsubscribe();
  });
});

describe('filter dimensions are each discriminative', () => {
  let baseline = 0;
  const all: KernelEvent[] = [];

  beforeAll(() => {
    baseline = kernel.events.headCursor;
    const observer = kernel.events.subscribe({ types: ['ledger-append'] }, (event) => all.push(event));
    write({ projectId: 'alpha', metadata: { sourceAgent: 'cog', topicPath: 'memory/alpha' } });
    write({ projectId: 'beta', metadata: { sourceAgent: 'other', topicPath: 'memory/beta' } });
    write({ projectId: 'beta' });
    observer.unsubscribe();
  });

  test('project selects one project and its complement exists', () => {
    const selected = replay(kernel.events, { types: ['ledger-append'], project: 'alpha' }, baseline);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((event) => event.projectId === 'alpha')).toBe(true);
    expect(all.some((event) => event.projectId === 'beta')).toBe(true);
    expect(selected.length).toBeLessThan(all.length);
  });

  test('agent selects events scoped to that agent and its complement exists', () => {
    const selected = replay(kernel.events, { types: ['ledger-append'], agent: 'cog' }, baseline);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((event) => (event.agentIds ?? []).includes('cog'))).toBe(true);
    expect(all.some((event) => !(event.agentIds ?? []).includes('cog'))).toBe(true);
    expect(selected.length).toBeLessThan(all.length);
  });

  test('topic selects rows that name a topic and its complement exists', () => {
    const selected = replay(kernel.events, { types: ['ledger-append'], topic: 'memory/alpha' }, baseline);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((event) => event.topic === 'memory/alpha')).toBe(true);
    expect(all.some((event) => event.topic !== 'memory/alpha')).toBe(true);
    expect(selected.length).toBeLessThan(all.length);
  });

  test('types selects one event type and its complement exists', () => {
    const selected = replay(kernel.events, { types: ['compile-done'] }, baseline);
    expect(selected.every((event) => event.type === 'compile-done')).toBe(true);
    expect(all.some((event) => event.type === 'ledger-append')).toBe(true);
  });

  test('all present dimensions are ANDed', () => {
    const selected = replay(kernel.events, { project: 'alpha', agent: 'other', types: ['ledger-append'] }, baseline);
    expect(selected).toEqual([]);
  });
});

describe('a subscriber cannot fail the write path', () => {
  test('a throwing callback is dropped and the row still lands, and other subscribers still hear it', () => {
    const throwing = kernel.events.subscribe({}, () => {
      throw new Error('subscriber crashed');
    });
    const other: KernelEvent[] = [];
    const otherSub = kernel.events.subscribe({ types: ['ledger-append'] }, (event) => other.push(event));

    const eventId = write({ projectId: 'crash' });

    expect(kernel.eventStore.getEvent(eventId)).toBeTruthy();
    expect(other.some((event) => event.payload.eventId === eventId)).toBe(true);
    expect(throwing.active).toBe(false);
    expect(otherSub.active).toBe(true);
    otherSub.unsubscribe();
  });
});

describe('typed errors', () => {
  function streamWith(capacity: number): MemoryEventStream {
    const stream = new MemoryEventStream({ capacity });
    for (let index = 1; index <= 3; index += 1) {
      stream.emit({ type: 'ledger-append', at: index, payload: { index } });
    }
    return stream;
  }

  function codeOf(fn: () => unknown): KernelEventStreamError {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(KernelEventStreamError);
      return error as KernelEventStreamError;
    }
    throw new Error('expected a KernelEventStreamError');
  }

  test('a cursor the buffer evicted is cursor_expired, and it names the window', () => {
    const stream = streamWith(2);
    const error = codeOf(() => stream.subscribe({}, () => {}, { since: 0 }));
    expect(error.code).toBe('cursor_expired');
    expect(error.oldestCursor).toBe(2);
    expect(error.headCursor).toBe(3);
  });

  test('a cursor beyond the head is cursor_expired too', () => {
    const stream = streamWith(3);
    const error = codeOf(() => stream.subscribe({}, () => {}, { since: 9 }));
    expect(error.code).toBe('cursor_expired');
    expect(error.headCursor).toBe(3);
  });

  test('a non-integer cursor is invalid_cursor', () => {
    expect(codeOf(() => streamWith(3).subscribe({}, () => {}, { since: -1 })).code).toBe('invalid_cursor');
    expect(codeOf(() => streamWith(3).subscribe({}, () => {}, { since: 1.5 })).code).toBe('invalid_cursor');
  });

  test('an unknown event type is invalid_filter, not an empty result', () => {
    const error = codeOf(() => streamWith(3).subscribe({ types: ['not-a-type' as KernelEventType] }, () => {}));
    expect(error.code).toBe('invalid_filter');
  });

  test('the window boundary is replayable: since = oldestCursor - 1 is fine, one lower is not', () => {
    const stream = streamWith(3);
    const seen: KernelEvent[] = [];
    stream.subscribe({}, (event) => seen.push(event), { since: 0 });
    expect(seen.map((event) => event.cursor)).toEqual([1, 2, 3]);

    const evicting = streamWith(2);
    expect(evicting.subscribe({}, () => {}, { since: 1 }).active).toBe(true);
    expect(codeOf(() => evicting.subscribe({}, () => {}, { since: 0 })).code).toBe('cursor_expired');
  });
});

describe('compile-done', () => {
  test('a finished Dream tick is announced, including a tick with nothing to do', async () => {
    const seen: KernelEvent[] = [];
    const subscription = kernel.events.subscribe({ types: ['compile-done'] }, (event) => seen.push(event));
    const result = await kernel.runDreamTick({ projectId: 'alpha' });
    subscription.unsubscribe();
    expect(seen.length).toBe(1);
    expect(seen[0]!.projectId).toBe('alpha');
    expect(seen[0]!.payload).toMatchObject({ kind: 'dream', runId: result.runId, skipped: true });
  });

  test('a finished offline consolidation is announced', async () => {
    const seen: KernelEvent[] = [];
    const subscription = kernel.events.subscribe({ types: ['compile-done'] }, (event) => seen.push(event));
    await kernel.consolidate({ projectId: 'alpha' });
    subscription.unsubscribe();
    expect(seen.length).toBe(1);
    expect(seen[0]!.projectId).toBe('alpha');
    expect(seen[0]!.payload).toMatchObject({ kind: 'consolidation' });
  });
});

describe('the host API face is the same stream', () => {
  test('KernelAgentMemoryBackend.subscribe replays and filters like the kernel stream', () => {
    const backend = new KernelAgentMemoryBackend(kernel);
    const eventId = write({ projectId: 'host-api', metadata: { sourceAgent: 'cog' } });
    const seen: KernelEvent[] = [];
    const subscription = backend.subscribe({ project: 'host-api' }, (event) => seen.push(event), { since: 0 });
    subscription.unsubscribe();
    expect(seen.some((event) => event.payload.eventId === eventId)).toBe(true);
    expect(seen.every((event) => event.projectId === 'host-api')).toBe(true);
  });
});
