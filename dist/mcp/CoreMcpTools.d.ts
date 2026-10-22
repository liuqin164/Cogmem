import { type MemoryKernel } from '../factory.js';
import type { SharedMemoryPort } from '../ports/index.js';
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
    /** Shared memory region. Absent when the server was started without a database path. */
    shared?: SharedMemoryPort;
    /** Host identity, used as the publisher/retractor of shared items. */
    hostId?: string;
}
export declare function listCogmemMcpTools(): CogmemMcpTool[];
export declare function callCogmemMcpTool(name: string, args: Record<string, unknown> | undefined, runtime?: CogmemMcpRuntime): Promise<CogmemMcpCallResult>;
//# sourceMappingURL=CoreMcpTools.d.ts.map