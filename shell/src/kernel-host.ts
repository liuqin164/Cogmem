/**
 * The shell *is* the kernel host process (guidance topology): one kernel per database, opened here.
 *
 * It used to serve that kernel over MCP to other hosts. That face is gone (#200 R2): the shell and
 * the kernel are one process, so an outward MCP endpoint was a second way in with no second reader,
 * and this shell's only other caller — the installer — speaks the control socket instead. What is
 * left on the loopback HTTP port is status and the star map, and nothing that runs a tool: `GET
 * /health` (the doctor's window into a *running* resident, so it never opens a second kernel) and
 * the read-only observatory when the kernel source is beside the shell.
 *
 * The observatory's modules are exported by neither `cogmem` nor `cogmem/internal`, so the star map
 * is reached by path — and only when it resolves. A shell copied away from the kernel source (the
 * detach test does exactly that) keeps serving health and simply has no observatory page. This is
 * the same class of borrow as #189 and is named in the round report rather than probed here: it is
 * a relative path into the kernel's file layout, which no package export covers.
 */
import { Database } from 'bun:sqlite';
import { DeepWriteRedactor } from 'cogmem/internal';

const OBSERVATORY_MODULE = '../../src/observatory/MemoryObservatory.ts';
const OBSERVATORY_ROUTES = '../../src/observatory/routes.ts';

export interface HttpFaceOptions {
  port: number;
  hostname: string;
  /** Extra health fields the host wants reported (lifecycle state, version, ...). */
  health?: () => Record<string, unknown>;
  /** The companion's own identity, listed in the roster before it has written a ledger row. */
  connectedAgents?: () => string[];
}

export interface HttpFaceHandle {
  /** `http://host:port`; the resident's address, used in what the installer prints. */
  baseUrl: string;
  healthUrl: string;
  port: number;
  stop(): void;
}

/**
 * The read-only star map, over a connection the page can never write through, or undefined when the
 * kernel has no database file to point a page at (`:memory:` has no second connection) or when the
 * kernel source is not where this shell can see it.
 */
async function openObservatory(
  kernel: unknown,
  dbPath: string | undefined,
  connectedAgents?: () => string[],
): Promise<{ db: Database; handle: (request: Request, remoteAddress?: string) => Promise<Response | null> } | undefined> {
  if (!dbPath || dbPath === ':memory:' || dbPath.startsWith('file:')) return undefined;
  try {
    const [observatoryModule, routesModule] = await Promise.all([
      import(OBSERVATORY_MODULE),
      import(OBSERVATORY_ROUTES),
    ]);
    const db = new Database(dbPath, { readonly: true });
    const atlas = (kernel as { memoryAtlasService?: { node(...args: unknown[]): any } }).memoryAtlasService;
    // The factory's shape drifted under the shell (23-165 probe): it takes the kernel's event
    // stream as a second positional argument now, not an options object. The stream is what backs
    // `/observatory/events`, so borrowing it keeps this face identical to the kernel's own
    // `startObservatoryServer` rather than a variant with one route missing.
    const events = (kernel as { events?: unknown }).events;
    const soul = (kernel as { soul?: unknown }).soul as Parameters<typeof routesModule.createObservatoryRoutes>[2];
    const observatory = new observatoryModule.MemoryObservatory({
      db,
      nodeDetail: atlas ? (nodeId: string, projectId: string) => atlas.node(nodeId, { projectId, includeEvidence: true, evidenceLimit: 8, refresh: false, staleOk: true }) : undefined,
      connectedAgents,
    });
    return { db, handle: routesModule.createObservatoryRoutes(observatory, events, soul) };
  } catch {
    return undefined;
  }
}

/** A loopback-only HTTP face over the in-process kernel: status and the read-only star map. */
export async function startKernelHttpFace(kernel: unknown, options: HttpFaceOptions): Promise<HttpFaceHandle> {
  const kernelHealth = (): Record<string, unknown> => {
    try {
      const health = (kernel as { getHealthStatus?: () => { status?: string; package?: string; dbPath?: string } }).getHealthStatus?.();
      if (!health) return { status: 'unknown' };
      return { status: health.status ?? 'unknown', package: health.package, dbPath: health.dbPath };
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  };

  const observatory = await openObservatory(kernel, kernelHealth().dbPath as string | undefined, options.connectedAgents);

  const httpServer = Bun.serve({
    port: options.port,
    hostname: options.hostname,
    async fetch(request: Request, server): Promise<Response> {
      const url = new URL(request.url);
      // The install doctor's window into a *running* resident. Opening a second kernel to ask the
      // first how it is would be two writers on one file, which CONCURRENT_ACCESS.md forbids.
      if (url.pathname === '/health') {
        return Response.json({
          status: 'ok',
          service: 'cogmem-companion-shell',
          version: '0.1.0-spike',
          bind: options.hostname,
          port: httpServer.port ?? options.port,
          kernel: kernelHealth(),
          ...options.health?.(),
        });
      }
      if (observatory) {
        const response = await observatory.handle(request, server.requestIP(request)?.address ?? undefined);
        if (response) return response;
      }
      return new Response('not_found', { status: 404 });
    },
  });
  const actualPort = httpServer.port ?? options.port;
  return {
    baseUrl: `http://${options.hostname}:${actualPort}`,
    healthUrl: `http://${options.hostname}:${actualPort}/health`,
    port: actualPort,
    stop() {
      observatory?.db.close();
      httpServer.stop(true);
    },
  };
}

/**
 * Secret redaction for captured text (#189).
 *
 * `cogmem`'s curated surface (`src/public.ts`) exports no secret primitive at all: it has
 * `PiiRedactor` (email/phone/ssn) and nothing that matches `sk-…`, `Bearer …` or a private key.
 * `redactSecretText` and the pattern table live in `src/security/SecretPatterns.ts`, which neither
 * `public.ts` nor `internal.ts` re-exports individually — what `internal.ts` does carry is
 * `DeepWriteRedactor`, the kernel's own write-path redactor, and `cogmem/internal` is the package's
 * declared `exports` subpath for it (package.json), not a relative path into the kernel's source.
 * So the shell binds through that declared subpath and refuses to start without it: writing secrets
 * to the ledger because the import moved is the one failure mode this must not have. Promoting
 * `redactSecretText`/`countSecretFindings` to `public.ts` is #189, and it needs a kernel change, so
 * it is not this round's to make (spike rule: the kernel takes zero diff).
 */
export class SecretRedactor {
  private readonly redactor = new DeepWriteRedactor();

  redact<T>(value: T): { value: T; count: number; chars: number } {
    const before = typeof value === 'string' ? value.length : JSON.stringify(value ?? '').length;
    const result = this.redactor.redact(value);
    const after = typeof result.value === 'string' ? result.value.length : JSON.stringify(result.value ?? '').length;
    return { value: result.value, count: result.redactionCount, chars: Math.max(0, before - after) };
  }

  /** The ledger mark. `total` is what the kernel's own suppression checks read. */
  mark<T>(value: T): { value: T; metadata: Record<string, unknown> } {
    const result = this.redact(value);
    if (result.count === 0) return { value: result.value, metadata: {} };
    return {
      value: result.value,
      metadata: { secretFindings: { total: result.count }, redaction: { count: result.count, chars: result.chars } },
    };
  }
}
