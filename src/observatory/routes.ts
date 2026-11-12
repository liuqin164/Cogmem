/**
 * The read-only HTTP surface of the observatory, served by the loopback process in `HttpServer.ts`.
 *
 * Three hard constraints, all of them structural rather than documented:
 *  - only GET is answered, so there is no verb that could change anything;
 *  - the socket address is checked against loopback on every request, so a process bound to a LAN
 *    address does not expose the corpus by merely existing;
 *  - every read goes through `MemoryObservatory`, which holds a read-only connection.
 *
 * `/observatory/events` is the exception that proves the constraints: it is a GET, it is refused off
 * loopback, and it writes nothing — it reads the kernel's in-process event stream and hands the
 * envelopes over SSE. The stream itself is contract-bound (`docs/events.md`), so a bad cursor is the
 * same typed error here as in-process, mapped to a status rather than stringified.
 */

import { fileURLToPath } from 'node:url';

import { KernelEventStreamError, type KernelEvent, type KernelEventType, type MemoryEventStream } from '../events/index.js';
import type { MemoryObservatory } from './MemoryObservatory.js';

export const OBSERVATORY_PREFIX = '/observatory';

/** Everything the page loads, by exact path: no directory walk, so no traversal to defend against. */
const STATIC_FILES: Record<string, { file: string; type: string }> = {
  '/observatory': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/observatory/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/observatory/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/observatory/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/observatory/three.bundle.js': { file: 'three.bundle.js', type: 'text/javascript; charset=utf-8' },
  '/observatory/three.LICENSE': { file: 'three.LICENSE', type: 'text/plain; charset=utf-8' },
  '/observatory/demo.json': { file: 'demo.json', type: 'application/json; charset=utf-8' },
};

function defaultWebRoot(): string {
  return fileURLToPath(new URL('./web/', import.meta.url));
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === 'localhost'
    || normalized.startsWith('127.');
}

function jsonResponse(body: unknown, status = 200, acceptEncoding?: string | null): Response {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  const gzip = (acceptEncoding ?? '').includes('gzip');
  return new Response(gzip ? Bun.gzipSync(bytes) : bytes, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(gzip ? { 'content-encoding': 'gzip' } : {}),
      'cache-control': 'no-store',
    },
  });
}

/** Keeps an idle SSE connection (and any proxy in front of it) from being reaped. */
const EVENT_STREAM_HEARTBEAT_MS = 15_000;

function queryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name);
  return value === null || value === '' ? undefined : value;
}

/**
 * One SSE connection over the kernel's event stream.
 *
 * The subscription is opened before the `Response` exists, because a cursor the stream refuses is an
 * HTTP status and a status cannot be changed after the body starts. `since` is exclusive and is the
 * reconnect contract: a client sends the `id` of the last frame it handled and gets exactly what
 * followed, in order, once.
 */
function createEventStreamResponse(events: MemoryEventStream, url: URL, signal: AbortSignal): Response {
  const types = queryParam(url, 'types')?.split(',').map((type) => type.trim()).filter(Boolean) as KernelEventType[] | undefined;
  const sinceParam = queryParam(url, 'since');

  const queue: KernelEvent[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let subscription: ReturnType<MemoryEventStream['subscribe']>;
  try {
    subscription = events.subscribe(
      { project: queryParam(url, 'project'), agent: queryParam(url, 'agent'), topic: queryParam(url, 'topic'), types },
      (event) => {
        queue.push(event);
        wake?.();
        wake = null;
      },
      { since: sinceParam === undefined ? undefined : Number(sinceParam) },
    );
  } catch (error) {
    if (error instanceof KernelEventStreamError) {
      return jsonResponse({
        error: error.code,
        message: error.message,
        oldestCursor: error.oldestCursor,
        headCursor: error.headCursor,
      }, error.code === 'cursor_expired' ? 409 : 400);
    }
    throw error;
  }

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => {
    if (finished) return;
    finished = true;
    subscription.unsubscribe();
    if (heartbeat !== undefined) clearInterval(heartbeat);
    wake?.();
    wake = null;
  };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(': connected\n\n'));
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          stop();
        }
      }, EVENT_STREAM_HEARTBEAT_MS);
    },
    async pull(controller) {
      while (!finished && queue.length === 0) await new Promise<void>((resolve) => { wake = resolve; });
      for (const event of queue.splice(0)) {
        controller.enqueue(encoder.encode(`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      }
      if (finished) controller.close();
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    },
  });
}

/**
 * Answers `/observatory…` and returns `null` for every other path, so the caller can answer those
 * with its own 404.
 */
export function createObservatoryRoutes(observatory: MemoryObservatory, options: { events?: MemoryEventStream } = {}) {
  // The page always ships beside this module: `bun run build` copies `src/observatory/web` into `dist`.
  const webRoot = defaultWebRoot();

  return async function handleObservatory(request: Request, remoteAddress?: string): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.pathname !== OBSERVATORY_PREFIX && !url.pathname.startsWith(`${OBSERVATORY_PREFIX}/`)) return null;

    if (!isLoopbackAddress(remoteAddress)) {
      return new Response('forbidden: the observatory answers on loopback only', { status: 403 });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method_not_allowed: the observatory is read-only', { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    if (url.pathname === '/observatory/events') {
      // HEAD would open a subscription it can never drain; the stream is GET-only.
      if (request.method === 'HEAD') return new Response('method_not_allowed', { status: 405, headers: { allow: 'GET' } });
      const events = options.events;
      if (!events) return jsonResponse({ error: 'event_stream_unavailable' }, 503);
      return createEventStreamResponse(events, url, request.signal);
    }

    const staticFile = STATIC_FILES[url.pathname];
    if (staticFile) {
      const file = Bun.file(`${webRoot}${staticFile.file}`);
      if (!(await file.exists())) return new Response(`missing_asset: ${staticFile.file}`, { status: 500 });
      return new Response(file, { headers: { 'content-type': staticFile.type, 'cache-control': 'no-store' } });
    }

    const project = url.searchParams.get('project') ?? undefined;
    const agent = url.searchParams.get('agent') ?? undefined;
    const acceptEncoding = request.headers.get('accept-encoding');
    try {
      if (url.pathname === '/observatory/snapshot') {
        return jsonResponse(observatory.snapshot({ projectId: project, agent }), 200, acceptEncoding);
      }
      if (url.pathname === '/observatory/timeline') {
        return jsonResponse(observatory.timeline({
          projectId: project, agent,
          from: url.searchParams.get('from') ?? undefined,
          to: url.searchParams.get('to') ?? undefined,
        }), 200, acceptEncoding);
      }
      if (url.pathname === '/observatory/recalls') {
        const limit = Number(url.searchParams.get('limit') ?? '50');
        return jsonResponse(observatory.recalls({ projectId: project, agent, limit: Number.isFinite(limit) ? limit : 50 }), 200, acceptEncoding);
      }
      const recallMatch = /^\/observatory\/recalls\/([^/]+)$/u.exec(url.pathname);
      if (recallMatch) {
        // The detail takes the same scope as the list: an id the list hides must not open.
        const detail = observatory.recall(decodeURIComponent(recallMatch[1]!), { projectId: project, agent });
        if (!detail) return jsonResponse({ error: 'trace_not_found' }, 404, acceptEncoding);
        return jsonResponse(detail, 200, acceptEncoding);
      }
      const nodeMatch = /^\/observatory\/node\/(.+)$/u.exec(url.pathname);
      if (nodeMatch) {
        const detail = observatory.node(decodeURIComponent(nodeMatch[1]!), { projectId: project, agent });
        if (!detail) return jsonResponse({ error: 'node_not_found_in_scope' }, 404, acceptEncoding);
        return jsonResponse(detail, 200, acceptEncoding);
      }
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500, acceptEncoding);
    }

    return jsonResponse({ error: 'not_found', endpoints: ['/snapshot', '/node/:id', '/timeline', '/recalls', '/recalls/:recallId', '/events'] }, 404, acceptEncoding);
  };
}
