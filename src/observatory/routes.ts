/**
 * The read-only HTTP surface of the observatory, mounted on a running `cogmem-mcp --transport http`.
 *
 * Three hard constraints, all of them structural rather than documented:
 *  - only GET is answered, so there is no verb that could change anything;
 *  - the socket address is checked against loopback on every request, so a process bound to a LAN
 *    address does not expose the corpus by merely existing;
 *  - every read goes through `MemoryObservatory`, which holds a read-only connection.
 */

import { fileURLToPath } from 'node:url';

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

export interface ObservatoryRouteOptions {
  observatory: MemoryObservatory;
  /** Directory holding the page. Defaults to `src/observatory/web` beside this module. */
  webRoot?: string;
  now?: () => number;
}

export function defaultWebRoot(): string {
  return fileURLToPath(new URL('./web/', import.meta.url));
}

export function isLoopbackAddress(address: string | undefined): boolean {
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

/**
 * Answers `/observatory…` and returns `null` for every other path, so the caller's own router stays
 * in charge of the MCP endpoint.
 */
export function createObservatoryRoutes(options: ObservatoryRouteOptions) {
  const webRoot = options.webRoot ?? defaultWebRoot();
  const observatory = options.observatory;

  return async function handleObservatory(request: Request, remoteAddress?: string): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.pathname !== OBSERVATORY_PREFIX && !url.pathname.startsWith(`${OBSERVATORY_PREFIX}/`)) return null;

    if (!isLoopbackAddress(remoteAddress)) {
      return new Response('forbidden: the observatory answers on loopback only', { status: 403 });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method_not_allowed: the observatory is read-only', { status: 405, headers: { allow: 'GET, HEAD' } });
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
        const detail = observatory.recall(decodeURIComponent(recallMatch[1]!), { projectId: project });
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

    return jsonResponse({ error: 'not_found', endpoints: ['/snapshot', '/node/:id', '/timeline', '/recalls', '/recalls/:traceId'] }, 404, acceptEncoding);
  };
}
