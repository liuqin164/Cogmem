/**
 * Streamable HTTP transport.
 *
 * Every target host speaks Streamable HTTP, so one resident process can serve
 * several clients without a stdio spawn per conversation.
 *
 * Two properties matter here:
 *  - one kernel per process, shared by every session, so the database keeps a
 *    single writer (CONCURRENT_ACCESS.md forbids two writer kernels on one path);
 *  - one transport per MCP session, because the SDK's stateless transport may
 *    not be reused across requests.
 *  - per-session identity: each authenticated session gets bound hostId, projectId, profile
 */

import { randomUUID } from 'node:crypto';

import { Database } from 'bun:sqlite';

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { createCogmemMcpServer, parseSessionIdentity, type CogmemMcpServerOptions } from './server.js';
import type { CogmemMcpRuntime } from './CoreMcpTools.js';
import type { AgentRegistry } from './AgentRegistry.js';
import { createMemoryKernel, createMemoryKernelFromConfig, type MemoryKernel } from '../factory.js';
import { MemoryObservatory } from '../observatory/MemoryObservatory.js';
import { createObservatoryRoutes, OBSERVATORY_PREFIX } from '../observatory/routes.js';
import { ensureUsableTempSpace } from '../utils/SqliteTempDirectory.js';

export interface CogmemMcpHttpOptions extends CogmemMcpServerOptions {
  port: number;
  /** Bind address. Defaults to loopback. */
  hostname?: string;
  /** URL path the endpoint answers on. Defaults to `/mcp`. */
  path?: string;
  /** When set, every request must carry the matching bearer credential. */
  token?: string;
  /**
   * Registered agents and their credentials. When set, the presented credential
   * *is* the identity: a request with no registered credential is refused even
   * on loopback, and the agent's registration is the ceiling for its hostId,
   * project scope, and tool profile.
   */
  agents?: AgentRegistry;
  /** Header name that carries the session identity (JSON: {hostId, projectId, profile}). Defaults to `x-cogmem-identity`. */
  identityHeader?: string;
  /** Allowed Origin values. Defaults to loopback origins only. Use `['*']` to allow all (not recommended for non-loopback). */
  allowedOrigins?: string[];
  /** Upper bound on live MCP sessions. The oldest is closed first. Defaults to 32. */
  maxSessions?: number;
}

export interface CogmemMcpHttpHandle {
  url: string;
  /**
   * Where a person opens the read-only star map, or undefined when this kernel has no database file
   * to point a page at. Loopback only, whatever `hostname` the MCP face uses.
   */
  observatoryUrl?: string;
  port: number;
  sessions(): number;
  stop(): void;
}

interface SessionIdentity {
  hostId?: string;
  projectId?: string;
  profile?: string;
}

function resolveKernel(runtime: CogmemMcpRuntime) {
  if (runtime.kernel) return runtime.kernel;
  if (runtime.dbPath) return createMemoryKernel({ dbPath: runtime.dbPath });
  return createMemoryKernelFromConfig({
    configPath: runtime.configPath,
    cwd: runtime.cwd,
  });
}

/**
 * The bearer credential a request presents, if any. Matched case-insensitively
 * and tolerant of surrounding whitespace, because hosts differ and a credential
 * check must not depend on how the header was spelled.
 */
function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : undefined;
}

export async function startCogmemMcpHttpServer(
  runtime: CogmemMcpRuntime = {},
  options: CogmemMcpHttpOptions,
): Promise<CogmemMcpHttpHandle> {
  const hostname = options.hostname ?? '127.0.0.1';
  const path = options.path ?? '/mcp';
  const identityHeader = (options.identityHeader ?? 'x-cogmem-identity').toLowerCase();
  const isLoopback = hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost';
  // Default: only allow loopback origins. If binding non-loopback, require explicit allowedOrigins.
  const allowedOrigins = options.allowedOrigins ?? (isLoopback
    ? ['http://127.0.0.1:*', 'http://localhost:*', 'http://[::1]:*']
    : []);

  // Validate auth configuration: --token and --agents are mutually exclusive in practice
  // because they both gate the same Authorization header. If both are provided,
  // agents registry takes precedence (it provides per-agent identity) and the global
  // token is ignored with a warning. This avoids 401 loops when they differ.
  const hasGlobalToken = typeof options.token === 'string' && options.token.length > 0;
  const hasAgentRegistry = options.agents !== undefined;
  if (hasGlobalToken && hasAgentRegistry) {
    console.warn('[cogmem-mcp] Both --token and --agents configured; --agents takes precedence. Global token will be ignored for request authentication.');
  }
  const useGlobalToken = hasGlobalToken && !hasAgentRegistry;

  const kernel = resolveKernel(runtime);
  const baseRuntime: CogmemMcpRuntime = {
    ...runtime,
    kernel,
    hostId: options.hostId ?? runtime.hostId,
  };
  const sessionIdentities = new Map<string, SessionIdentity>();
  /** The hostId each session's creator authenticated as, for the registry case. */
  const sessionAgents = new Map<string, string>();
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
  const maxSessions = options.maxSessions ?? 32;
  const ownsKernel = !runtime.kernel;

  // The observatory rides this process rather than opening a second one: there is already one
  // writer here, and a page that only reads does not need its own lifecycle. Its connection is
  // opened read-only, so "the observatory writes nothing" is a property of the handle, not of
  // everyone's memory of the SQL.
  const observatoryDb = openObservatoryDatabase(kernel);
  const handleObservatory = observatoryDb === null ? null : createObservatoryRoutes({
    observatory: new MemoryObservatory({
      db: observatoryDb.db,
      nodeDetail: (nodeId, projectId) => kernel.memoryAtlasService.node(nodeId, {
        projectId, includeEvidence: true, evidenceLimit: 8, refresh: false, staleOk: true,
      }),
      connectedAgents: () => (options.agents?.list() ?? []).map((agent) => agent.hostId),
    }),
  });

  function checkOrigin(request: Request): boolean {
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    // No Origin header (e.g., direct curl, server-to-server) - allow but log
    if (!origin) return true;
    // Validate against allowedOrigins
    if (allowedOrigins.includes('*')) return true;
    const expectedHost = host ?? `${hostname}:${options.port}`;
    for (const allowed of allowedOrigins) {
      if (allowed === origin) return true;
      // Support wildcard port: http://127.0.0.1:* matches any port on 127.0.0.1
      if (allowed.endsWith(':*')) {
        const prefix = allowed.slice(0, -1); // "http://127.0.0.1:"
        if (origin.startsWith(prefix)) return true;
      }
    }
    return false;
  }

  const httpServer = Bun.serve({
    port: options.port,
    hostname,
    async fetch(request: Request, server): Promise<Response> {
      const url = new URL(request.url);

      if (handleObservatory) {
        const observatoryResponse = await handleObservatory(request, server.requestIP(request)?.address ?? undefined);
        if (observatoryResponse) return observatoryResponse;
      }

      if (url.pathname !== path) {
        return new Response('not_found', { status: 404 });
      }

      // Origin/Host validation (MCP Streamable HTTP spec requirement)
      if (!checkOrigin(request)) {
        return new Response('forbidden: invalid origin', { status: 403 });
      }

      // Require authentication when not on loopback
      if (!isLoopback && !useGlobalToken && !hasAgentRegistry) {
        return new Response('forbidden: authentication required for non-loopback binding', { status: 403 });
      }

      if (useGlobalToken) {
        const header = request.headers.get('authorization');
        if (header !== `Bearer ${options.token}`) {
          return new Response('unauthorized', { status: 401 });
        }
      }

      // A presented credential is a claim to an identity. With no registry
      // anywhere there is nothing that can establish one, and answering the
      // connection as an anonymous single agent is the fail-open direction
      // ADR-0006 closed (#80). This is deliberately a different answer from "no
      // registry configured", which stays supported: a client that presents no
      // credential is still served.
      const presented = bearerToken(request);
      if (!hasAgentRegistry && !useGlobalToken && presented !== undefined) {
        return new Response('unauthorized: credential presented but no agent registry was found', { status: 401 });
      }

      // With a registry the credential *is* the identity, so an unregistered one
      // is refused even on loopback: a local client that presents no registered
      // credential has no agent to be, and letting it through as anonymous is
      // how one agent ends up reading another's memory.
      const agent = options.agents?.resolve(presented);
      if (options.agents && !agent) {
        return new Response('unauthorized', { status: 401 });
      }

      const sessionId = request.headers.get('mcp-session-id');
      let transport = sessionId ? transports.get(sessionId) : undefined;

      // A session carries the identity its creator established. Its server was built
      // with that agent's `authenticatedHostId` and project scope, so a different
      // credential replaying the session id would be served as the creator — one
      // agent reading another agent's memory with its own valid credential (#80).
      if (transport && options.agents && sessionId && sessionAgents.get(sessionId) !== agent?.hostId) {
        return new Response('unauthorized: this session belongs to another agent', { status: 401 });
      }

      if (!transport) {
        if (sessionId) {
          // A session header that names no live session must not silently open
          // a new one: the client would lose its server-side state.
          return new Response('session_not_found', { status: 404 });
        }

        const created = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            if (transports.size >= maxSessions) {
              // Safety valve: a client that never terminates its session must
              // not grow this map without bound.
              const oldestEntry = transports.keys().next();
              if (!oldestEntry.done && oldestEntry.value) {
                const oldestId = oldestEntry.value;
                const oldest = transports.get(oldestId);
                transports.delete(oldestId);
                void oldest?.close();
                sessionIdentities.delete(oldestId);
                sessionAgents.delete(oldestId);
              }
            }
            transports.set(id, created);
            // Bind identity from header if present
            const bound = parseSessionIdentity(request.headers.get(identityHeader));
            if (bound) sessionIdentities.set(id, bound);
            // The identity this session established. A later request may only ride
            // this session with a credential that speaks for the same agent.
            if (agent) sessionAgents.set(id, agent.hostId);
          },
        });
        created.onclose = () => {
          if (created.sessionId) {
            transports.delete(created.sessionId);
            sessionIdentities.delete(created.sessionId);
            sessionAgents.delete(created.sessionId);
          }
        };

        // Create server with base runtime; per-session identity resolved from
        // the request headers and the session map on every call.
        const server = createCogmemMcpServer(baseRuntime, {
          // A registered credential is the ceiling for that agent: it may narrow
          // its own profile but never widen past what it was registered with, so
          // the header is not trusted to escalate even on an authenticated
          // request. Without a registry, a global token keeps its old meaning.
          profile: agent?.profile ?? options.profile,
          hostId: agent?.hostId ?? options.hostId,
          authenticatedHostId: agent?.hostId,
          projectId: agent?.projectId ?? options.projectId,
          identityHeader,
          identityForSession: (id) => (id ? sessionIdentities.get(id) : undefined),
          identityTrusted: agent ? false : useGlobalToken,
        });
        await server.connect(created);
        transport = created;
      }

      return transport.handleRequest(request);
    },
  });

  const actualPort = httpServer.port ?? options.port;

  return {
    url: `http://${hostname}:${actualPort}${path}`,
    // Always named as loopback even when the MCP face was told to bind elsewhere: 0.0.0.0 is not a
    // browsable address, and the observatory answers only requests that arrive on loopback.
    ...(observatoryDb === null ? {} : { observatoryUrl: `http://127.0.0.1:${actualPort}${OBSERVATORY_PREFIX}/` }),
    port: actualPort,
    sessions: () => transports.size,
    stop() {
      for (const transport of transports.values()) {
        void transport.close();
      }
      transports.clear();
      sessionIdentities.clear();
      sessionAgents.clear();
      httpServer.stop(true);
      observatoryDb?.close();
      // Only close what this server opened: an injected kernel belongs to the caller.
      if (ownsKernel) kernel.close();
    },
  };
}

/**
 * A connection the observatory cannot write through, or null when there is no file to open.
 *
 * SQLite refuses a write on a read-only handle, so the guarantee does not depend on the observatory
 * remembering to be careful. A `:memory:` or `file:`-URI database has no second connection to open at
 * all, and lending it the kernel's writable handle would make read-only a property of the call site
 * rather than of the handle — so that kernel simply gets no page.
 *
 * `ensureUsableTempSpace` is the same conditional the kernel's own connections use (ADR-0008): the
 * snapshot orders every candidate node, which SQLite spills to a temporary file, and on a host whose
 * temporary directory is not writable that failure is reported as `unable to open database file` —
 * naming the database, which is fine.
 */
function openObservatoryDatabase(kernel: MemoryKernel): { db: Database; close: () => void } | null {
  const path = kernel.databasePath;
  if (!path || path === ':memory:' || path.startsWith('file:')) return null;
  const db = new Database(path, { readonly: true });
  ensureUsableTempSpace(db);
  return { db, close: () => db.close() };
}