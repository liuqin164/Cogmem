import { type MemoryKernel } from '../factory.js';
export interface CogmemMcpTool {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, object>;
        required?: string[];
    };
    annotations?: {
        title?: string;
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
    };
}
export interface CogmemMcpCallResult {
    content: Array<{
        type: 'text';
        text: string;
    }>;
    structuredContent?: object;
    isError?: boolean;
}
export interface CogmemMcpRuntime {
    kernel?: MemoryKernel;
    dbPath?: string;
    configPath?: string;
    cwd?: string;
    /** Host identity this connection resolved to, e.g. `claude`, `cursor`, `codex`. */
    hostId?: string;
}
export declare function listCogmemMcpTools(): CogmemMcpTool[];
/**
 * Whether `name` is a tool this build ships, independent of any profile.
 *
 * Both entry points need this question answered before they answer a
 * profile question, and they must not disagree about the answer, so the set
 * lives here and the protocol handler asks for it rather than rebuilding it.
 * A name outside this set is answered as missing before a runtime kernel is
 * opened: a host config that still names a tool this release does not ship
 * must not touch (or create) a database to be told the tool does not exist.
 */
export declare function isCogmemMcpTool(name: string): boolean;
export declare function callCogmemMcpTool(name: string, args: Record<string, unknown> | undefined, runtime?: CogmemMcpRuntime): Promise<CogmemMcpCallResult>;
//# sourceMappingURL=CoreMcpTools.d.ts.map