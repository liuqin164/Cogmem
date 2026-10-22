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
 */

import { randomUUID } from 'node:crypto';

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { createCogmemMcpServer, type CogmemMcpServerOptions } from './server.js';
import type { CogmemMcpRuntime } from './CoreMcpTools.js';
import { createMemoryKernel, createMemoryKernelFromConfig } from '../factory.js';
import { SqliteSharedMemory } from '../adapters/sqlite/SqliteSharedMemory.js';

export interface CogmemMcpHttpOptions extends CogmemMcpServerOptions {
  port: number;
  /** Bind address. Defaults to loopback. */
  hostname?: string;
  /** URL path the endpoint answers on. Defaults to `/mcp`. */
  path?: string;
  /** When set, every request must carry the matching bearer credential. */
  token?: string;
  /** Upper bound on live MCP sessions. The oldest is closed first. Defaults to 32. */
  maxSessions?: number;
}

export interface CogmemMcpHttpHandle {
  url: string;
  port: number;
  sessions(): number;
  stop(): void;
}

function resolveKernel(runtime: CogmemMcpRuntime) {
  if (runtime.kernel) return runtime.kernel;
  if (runtime.dbPath) return createMemoryKernel({ dbPath: runtime.dbPath });
  return createMemoryKernelFromConfig({
    configPath: runtime.configPath,
    cwd: runtime.cwd,
  });
}

export async function startCogmemMcpHttpServer(
  runtime: CogmemMcpRuntime = {},
  options: CogmemMcpHttpOptions,
): Promise<CogmemMcpHttpHandle> {
  const hostname = options.hostname ?? '127.0.0.1';
  const path = options.path ?? '/mcp';

  const kernel = resolveKernel(runtime);
  const sharedRuntime: CogmemMcpRuntime = {
    ...runtime,
    kernel,
    hostId: options.hostId ?? runtime.hostId,
    shared: runtime.shared ?? new SqliteSharedMemory(kernel.eventStore.getDatabase()),
  };
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
  const maxSessions = options.maxSessions ?? 32;
  const ownsKernel = !runtime.kernel;

  const httpServer = Bun.serve({
    port: options.port,
    hostname,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);

      if (url.pathname !== path) {
        return new Response('not_found', { status: 404 });
      }

      if (options.token) {
        const header = request.headers.get('authorization');
        if (header !== `Bearer ${options.token}`) {
          return new Response('unauthorized', { status: 401 });
        }
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
              const oldestId = transports.keys().next().value;
              const oldest = oldestId ? transports.get(oldestId) : undefined;
              if (oldestId) transports.delete(oldestId);
              void oldest?.close();
            }
            transports.set(id, created);
          },
        });
        created.onclose = () => {
          if (created.sessionId) transports.delete(created.sessionId);
        };

        const server = createCogmemMcpServer(sharedRuntime, {
          profile: options.profile,
          hostId: options.hostId,
          projectId: options.projectId,
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
      httpServer.stop(true);
      // Only close what this server opened: an injected kernel belongs to the caller.
      if (ownsKernel) kernel.close();
    },
  };
}
