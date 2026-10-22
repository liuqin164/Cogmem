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
}
export declare function createCogmemMcpServer(runtime?: CogmemMcpRuntime, options?: CogmemMcpServerOptions): Server;
export declare function startCogmemMcpServer(runtime?: CogmemMcpRuntime, options?: CogmemMcpServerOptions): Promise<Server>;
export { resolveProfile };
//# sourceMappingURL=server.d.ts.map