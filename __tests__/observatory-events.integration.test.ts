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
 * live — so the timeout ends the read rather than failing it, and the caller asserts on what arrived.
 */
async function readFrames(query: string, count: number, timeoutMs = 2000): Promise<{ status: number; frames: SseFrame[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/events${query}`, { signal: controller.signal });
    if (response.status !== 200) return { status: response.status, frames: [] };
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const frames: SseFrame[] = [];
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
    return { status: response.status, frames };
  } catch {
    return { status: 200, frames: [] };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
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
    const ids = [write('sse'), write('sse'), write('sse')];
    const { status, frames } = await readFrames('?types=ledger-append&since=0', 3);
    expect(status).toBe(200);
    expect(frames.length).toBe(3);
    expect(frames.every((frame) => frame.event === 'ledger-append')).toBe(true);
    const cursors = frames.map((frame) => Number(frame.id));
    expect(cursors).toEqual([...cursors].sort((a, b) => a - b));
    expect(new Set(cursors).size).toBe(3);
    expect(frames.map((frame) => JSON.parse(frame.data!).payload.eventId)).toEqual(ids);
  });

  test('a filter dimension applies over HTTP', async () => {
    write('alpha');
    write('beta');
    const { frames } = await readFrames('?types=ledger-append&project=alpha&since=0', 1, 500);
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
