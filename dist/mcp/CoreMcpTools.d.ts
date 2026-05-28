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
}
export declare function listCogmemMcpTools(): CogmemMcpTool[];
export declare function callCogmemMcpTool(name: string, args: Record<string, unknown> | undefined, runtime?: CogmemMcpRuntime): Promise<CogmemMcpCallResult>;
//# sourceMappingURL=CoreMcpTools.d.ts.map