import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { type CogmemMcpRuntime } from './CoreMcpTools.js';
import { resolveProfile, type McpToolProfile } from './profiles.js';
export interface CogmemMcpServerOptions {
    /** Tool surface exposed to this client. Defaults to `core`. */
    profile?: McpToolProfile;
    /** Host this connection belongs to, e.g. `claude`, `cursor`, `codex`, `hermes`. */
    hostId?: string;
    /**
     * When set, this connection is bound to one project. Calls that omit
     * `projectId` are stamped with it; calls that name a different project are
     * rejected instead of silently reading someone else's memory.
     */
    projectId?: string;
    /**
     * Header that carries a per-request identity JSON blob. A request that
     * presents one overrides the session-bound identity for that call only.
     */
    identityHeader?: string;
    /**
     * Session-bound identity, looked up by the transport for sessions that were
     * opened with an identity header. Used when a request carries none of its own.
     */
    identityForSession?: (sessionId?: string) => SessionIdentity | undefined;
}
export interface SessionIdentity {
    hostId?: string;
    projectId?: string;
    profile?: string;
}
export declare function createCogmemMcpServer(runtime?: CogmemMcpRuntime, options?: CogmemMcpServerOptions): Server;
export interface CogmemMcpStdioHandle {
    server: Server;
    stop(): void;
}
export declare function startCogmemMcpServer(runtime?: CogmemMcpRuntime, options?: CogmemMcpServerOptions): Promise<CogmemMcpStdioHandle>;
export { resolveProfile };
//# sourceMappingURL=server.d.ts.map