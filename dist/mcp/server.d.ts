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
     * Header that carries a per-request identity JSON blob (`hostId`,
     * `projectId`, `profile`). A request that presents one overrides the
     * session-bound identity for that call only. It may narrow the profile but
     * never widen it unless the transport authenticated the request.
     */
    identityHeader?: string;
    /**
     * Session-bound identity, looked up by the transport for sessions that were
     * opened with an identity header. Used when a request carries none of its own.
     */
    identityForSession?: (sessionId?: string) => SessionIdentity | undefined;
    /**
     * Whether the transport authenticated the request. Only a trusted request may
     * widen the profile through the identity header; an untrusted one can narrow
     * it but never escalate. Defaults to false.
     */
    identityTrusted?: boolean;
}
export interface SessionIdentity {
    hostId?: string;
    projectId?: string;
    profile?: string;
}
/**
 * Identity a call runs under, plus the transport-supplied request context.
 * `trusted` means the transport already authenticated the request (a bearer
 * token was configured and presented), so a header may widen the profile.
 */
export interface ResolvedIdentity {
    identity: SessionIdentity;
    /** The project this connection is bound to, if any. */
    boundProjectId?: string;
}
/** Parse the identity JSON blob. Unknown fields are ignored; a non-string value is dropped. */
export declare function parseSessionIdentity(raw: unknown): SessionIdentity | undefined;
/**
 * Apply the identity to the server options, enforcing the security boundary:
 * the configured profile is a ceiling unless the request is trusted, a project
 * binding may not be silently overridden, and a hostId may only be asserted by
 * an authenticated connection.
 *
 * Exported because "who is this call running as" is the security boundary of
 * this module, and it is decided by a pure function rather than by the
 * transport that happens to be in front of it.
 */
export declare function applyIdentity(baseOptions: CogmemMcpServerOptions, resolved: ResolvedIdentity, trusted: boolean): CogmemMcpServerOptions & {
    profile: McpToolProfile;
};
export declare function createCogmemMcpServer(runtime?: CogmemMcpRuntime, options?: CogmemMcpServerOptions): Server;
export interface CogmemMcpStdioHandle {
    server: Server;
    stop(): void;
}
export declare function startCogmemMcpServer(runtime?: CogmemMcpRuntime, options?: CogmemMcpServerOptions): Promise<CogmemMcpStdioHandle>;
export { resolveProfile };
//# sourceMappingURL=server.d.ts.map