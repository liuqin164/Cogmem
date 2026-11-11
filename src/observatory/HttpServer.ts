/**
 * The observatory's own loopback HTTP process.
 *
 * The page used to ride the MCP server's HTTP transport; that face is gone, and this is the service
 * that remains. It answers three pages and their JSON endpoints, and it binds loopback by default —
 * `createObservatoryRoutes` refuses any request whose socket address is not loopback whatever the
 * bind address is, so a LAN address can only reach the refusal.
 *
 * Read-only is a property of the handle, not of everyone's memory of the SQL: the connection this
 * opens is `readonly: true`, which SQLite refuses to write through. A `:memory:` or `file:`-URI
 * database has no second connection to open, and lending it the kernel's writable handle would make
 * read-only a property of the call site, so that kernel simply gets no page.
 */

import { Database } from 'bun:sqlite';

import { createMemoryKernel, createMemoryKernelFromConfig, type MemoryKernel } from '../factory.js';
import { ensureUsableTempSpace } from '../utils/SqliteTempDirectory.js';
import { MemoryObservatory } from './MemoryObservatory.js';
import { createObservatoryRoutes, OBSERVATORY_PREFIX } from './routes.js';

export interface ObservatoryRuntime {
  /** An already-open kernel. When absent one is opened from `dbPath`, else from the config walk. */
  kernel?: MemoryKernel;
  dbPath?: string;
  configPath?: string;
  cwd?: string;
  /** Hosts this install names, listed in the roster beside the identities the corpus names. */
  connectedAgents?: () => string[];
}

export interface ObservatoryServerOptions extends ObservatoryRuntime {
  port: number;
  /** Bind address. Defaults to loopback. */
  hostname?: string;
}

export interface ObservatoryServerHandle {
  /** Always named as loopback: 0.0.0.0 is not a browsable address, and every non-loopback request is refused. */
  url: string;
  port: number;
  stop(): void;
}

function resolveKernel(runtime: ObservatoryRuntime): MemoryKernel {
  if (runtime.kernel) return runtime.kernel;
  if (runtime.dbPath) return createMemoryKernel({ dbPath: runtime.dbPath });
  return createMemoryKernelFromConfig({ configPath: runtime.configPath, cwd: runtime.cwd });
}

export async function startObservatoryServer(options: ObservatoryServerOptions): Promise<ObservatoryServerHandle> {
  const hostname = options.hostname ?? '127.0.0.1';
  const kernel = resolveKernel(options);
  const ownsKernel = !options.kernel;

  const observatoryDb = openObservatoryDatabase(kernel);
  if (observatoryDb === null) {
    if (ownsKernel) kernel.close();
    throw new Error('observatory_requires_a_file_database');
  }

  const handleObservatory = createObservatoryRoutes(new MemoryObservatory({
    db: observatoryDb.db,
    nodeDetail: (nodeId, projectId) => kernel.memoryAtlasService.node(nodeId, {
      projectId, includeEvidence: true, evidenceLimit: 8, refresh: false, staleOk: true,
    }),
    connectedAgents: options.connectedAgents ?? (() => []),
  }));

  const httpServer = Bun.serve({
    port: options.port,
    hostname,
    async fetch(request: Request, server): Promise<Response> {
      const response = await handleObservatory(request, server.requestIP(request)?.address ?? undefined);
      return response ?? new Response('not_found', { status: 404 });
    },
  });

  const actualPort = httpServer.port ?? options.port;
  return {
    url: `http://127.0.0.1:${actualPort}${OBSERVATORY_PREFIX}/`,
    port: actualPort,
    stop() {
      httpServer.stop(true);
      observatoryDb.close();
      if (ownsKernel) kernel.close();
    },
  };
}

/**
 * A connection the observatory cannot write through, or null when there is no file to open.
 *
 * `ensureUsableTempSpace` is the same conditional the kernel's own connections use (ADR-0008): the
 * snapshot orders every candidate node, which SQLite spills to a temporary file, and on a host whose
 * temporary directory is not writable that failure is reported as `unable to open database file`.
 */
function openObservatoryDatabase(kernel: MemoryKernel): { db: Database; close: () => void } | null {
  const path = kernel.databasePath;
  if (!path || path === ':memory:' || path.startsWith('file:')) return null;
  const db = new Database(path, { readonly: true });
  ensureUsableTempSpace(db);
  return { db, close: () => db.close() };
}
