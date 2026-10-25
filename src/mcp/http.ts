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

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { createCogmemMcpServer, parseSessionIdentity, type CogmemMcpServerOptions } from './server.js';
import type { CogmemMcpRuntime } from './CoreMcpTools.js';
import type { AgentRegistry } from './AgentRegistry.js';
import { createMemoryKernel, createMemoryKernelFromConfig } from '../factory.js';

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
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
  const maxSessions = options.maxSessions ?? 32;
  const ownsKernel = !runtime.kernel;

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
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);

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

      // With a registry the credential *is* the identity, so an unregistered one
      // is refused even on loopback: a local client that presents no registered
      // credential has no agent to be, and letting it through as anonymous is
      // how one agent ends up reading another's memory.
      const agent = options.agents?.resolve(bearerToken(request));
      if (options.agents && !agent) {
        return new Response('unauthorized', { status: 401 });
      }

      const sessionId = request.headers.get('mcp-session-id');
      let transport = sessionId ? transports.get(sessionId) : undefined;

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
              }
            }
            transports.set(id, created);
            // Bind identity from header if present
            const bound = parseSessionIdentity(request.headers.get(identityHeader));
            if (bound) sessionIdentities.set(id, bound);
          },
        });
        created.onclose = () => {
          if (created.sessionId) {
            transports.delete(created.sessionId);
            sessionIdentities.delete(created.sessionId);
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
    port: actualPort,
    sessions: () => transports.size,
    stop() {
      for (const transport of transports.values()) {
        void transport.close();
      }
      transports.clear();
      sessionIdentities.clear();
      httpServer.stop(true);
      // Only close what this server opened: an injected kernel belongs to the caller.
      if (ownsKernel) kernel.close();
    },
  };
}