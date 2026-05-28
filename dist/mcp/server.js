import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { callCogmemMcpTool, listCogmemMcpTools, } from './CoreMcpTools.js';
export function createCogmemMcpServer(runtime = {}) {
    const server = new Server({
        name: 'cogmem-core',
        version: '2.0.0-rc.1',
    }, {
        capabilities: {
            tools: {},
        },
        instructions: 'Use cogmem_recall to retrieve prepared memory context and cogmem_remember_turn to write conversation turns.',
    });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: listCogmemMcpTools(),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const result = await callCogmemMcpTool(request.params.name, request.params.arguments, runtime);
        return result;
    });
    return server;
}
export async function startCogmemMcpServer(runtime = {}) {
    const server = createCogmemMcpServer(runtime);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return server;
}
