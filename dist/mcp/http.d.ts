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
import { type CogmemMcpServerOptions } from './server.js';
import type { CogmemMcpRuntime } from './CoreMcpTools.js';
export interface CogmemMcpHttpOptions extends CogmemMcpServerOptions {
    port: number;
    /** Bind address. Defaults to loopback. */
    hostname?: string;
    /** URL path the endpoint answers on. Defaults to `/mcp`. */
    path?: string;
    /** When set, every request must carry the matching bearer credential. */
    token?: string;
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
export declare function startCogmemMcpHttpServer(runtime: CogmemMcpRuntime | undefined, options: CogmemMcpHttpOptions): Promise<CogmemMcpHttpHandle>;
//# sourceMappingURL=http.d.ts.map