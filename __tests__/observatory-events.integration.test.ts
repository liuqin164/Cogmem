import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { startObservatoryServer, type ObservatoryServerHandle } from '../src/observatory/HttpServer.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * The SSE face of the event stream (#155) on the observatory's loopback process.
 *
 * The acceptance here is the HTTP translation of the in-process contract: a cursor replays over
 * `?since=`, the filter dimensions apply, a refused cursor is a status rather than a stream, the
 * endpoint answers only GET, and — #136's constraint — a full stream round trip still leaves the
 * database byte-identical.
 */

const scratch = makeTempDir('cogmem-observatory-events-');
const dbPath = join(scratch, 'memory.db');
let kernel: MemoryKernel;
let handle: ObservatoryServerHandle;
let base: string;

beforeAll(async () => {
  kernel = createMemoryKernel({ dbPath });
  handle = await startObservatoryServer({ kernel, cwd: scratch, port: 0 });
  base = `http://127.0.0.1:${handle.port}/observatory`;
});

afterAll(() => {
  handle.stop();
  kernel.close();
});

interface SseFrame {
  id?: string;
  event?: string;
  data?: string;
}

/**
 * Read SSE frames until `count` data frames arrive or the deadline passes.
 *
 * A stream that is still open when the deadline hits is normal here — the last subscription stays
 * live — so the deadline ends the read quietly and returns what arrived. Any other transport failure
 * is thrown: a broken fetch must not masquerade as an empty-but-healthy stream.
 */
async function readFrames(query: string, count: number, timeoutMs = 2000): Promise<{ status: number; frames: SseFrame[]; timedOut: boolean }> {
  const controller = new AbortController();
  const frames: SseFrame[] = [];
  let status = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(`${base}/events${query}`, { signal: controller.signal });
    status = response.status;
    if (status !== 200) return { status, frames, timedOut };
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (frames.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = parseFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (frame.data !== undefined) frames.push(frame);
        boundary = buffer.indexOf('\n\n');
      }
    }
  } catch (error) {
    if (!timedOut) throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
  return { status, frames, timedOut };
}

function parseFrame(raw: string): SseFrame {
  const frame: SseFrame = {};
  for (const line of raw.split('\n')) {
    if (line.startsWith('id: ')) frame.id = line.slice(4);
    else if (line.startsWith('event: ')) frame.event = line.slice(7);
    else if (line.startsWith('data: ')) frame.data = line.slice(6);
  }
  return frame;
}

let seq = 0;
function write(projectId: string, metadata?: Record<string, unknown>): string {
  seq += 1;
  return kernel.recordRawEvent({
    threadId: `sse-thread-${seq}`,
    sessionId: `sse-session-${seq}`,
    role: 'user',
    content: `sse message ${seq}`,
    projectId,
    ...(metadata ? { metadata } : {}),
  }).eventId;
}

function digest(): string {
  return createHash('sha256').update(readFileSync(dbPath)).digest('hex');
}

describe('/observatory/events', () => {
  test('replays from ?since= in cursor order, once each, with the envelope as data', async () => {
    const start = kernel.events.headCursor;
    const ids = [write('sse'), write('sse'), write('sse')];
    const { status, frames } = await readFrames(`?types=ledger-append&since=${start}`, 3);
    expect(status).toBe(200);
    expect(frames.length).toBe(3);
    expect(frames.every((frame) => frame.event === 'ledger-append')).toBe(true);
    expect(frames.map((frame) => Number(frame.id))).toEqual([start + 1, start + 2, start + 3]);
    expect(frames.map((frame) => JSON.parse(frame.data!).payload.eventId)).toEqual(ids);
  });

  test('a disconnect and reconnect over ?since= loses nothing and repeats nothing', async () => {
    const start = kernel.events.headCursor;
    const first = write('sse-reconnect');
    const connected = await readFrames(`?types=ledger-append&since=${start}`, 1);
    expect(connected.frames.length).toBe(1);
    expect(JSON.parse(connected.frames[0]!.data!).payload.eventId).toBe(first);
    const lastHandled = Number(connected.frames[0]!.id);

    // Disconnected here: the read above aborted its client, and three rows land with no stream open.
    const whileAway = [write('sse-reconnect'), write('sse-reconnect'), write('sse-reconnect')];

    const reconnected = await readFrames(`?types=ledger-append&since=${lastHandled}`, 3);
    const ids = reconnected.frames.map((frame) => JSON.parse(frame.data!).payload.eventId);
    expect(ids).toEqual(whileAway);
    expect(reconnected.frames.map((frame) => Number(frame.id)))
      .toEqual([lastHandled + 1, lastHandled + 2, lastHandled + 3]);
    expect(new Set(ids).size).toBe(3);
  });

  test('a client that disconnects does not affect the write path', async () => {
    const start = kernel.events.headCursor;
    write('sse-drop');
    const connected = await readFrames(`?types=ledger-append&since=${start}`, 1);
    expect(connected.frames.length).toBe(1);

    // `readFrames` aborts its client in `finally`, so the server has seen this subscriber go.
    const eventId = write('sse-drop');
    expect(kernel.eventStore.getEvent(eventId)).toBeTruthy();
  });

  test('a filter dimension applies over HTTP', async () => {
    const start = kernel.events.headCursor;
    write('alpha');
    write('beta');
    const { frames } = await readFrames(`?types=ledger-append&project=alpha&since=${start}`, 1, 500);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((frame) => JSON.parse(frame.data!).projectId === 'alpha')).toBe(true);
  });

  test('a cursor beyond the head is 409 cursor_expired, not a stream', async () => {
    const response = await fetch(`${base}/events?since=${kernel.events.headCursor + 5}`);
    expect(response.status).toBe(409);
    const body = await response.json() as { error: string; headCursor: number };
    expect(body.error).toBe('cursor_expired');
    expect(body.headCursor).toBe(kernel.events.headCursor);
  });

  test('an unknown event type is 400 invalid_filter', async () => {
    const response = await fetch(`${base}/events?types=not-a-type`);
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toBe('invalid_filter');
  });

  test('the stream is GET only', async () => {
    const posted = await fetch(`${base}/events`, { method: 'POST' });
    expect(posted.status).toBe(405);
    const headed = await fetch(`${base}/events`, { method: 'HEAD' });
    expect(headed.status).toBe(405);
  });

  test('a full stream round trip leaves the database byte-identical', async () => {
    write('sse-hash');
    const before = digest();
    await readFrames('?types=ledger-append&since=0', 1, 500);
    await readFrames('?project=sse-hash&since=0', 1, 500);
    expect(digest()).toBe(before);
  });
});
