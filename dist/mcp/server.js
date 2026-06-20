import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { callCogmemMcpTool, listCogmemMcpTools, } from './CoreMcpTools.js';
export function createCogmemMcpServer(runtime = {}) {
    const server = new Server({
        name: 'cogmem-core',
        version: '3.4.0',
    }, {
        capabilities: {
            tools: {},
        },
        instructions: 'Use cogmem_strategy_plan to inspect the bounded current-turn memory policy, cogmem_recall to retrieve governed context, cogmem_remember_turn to write conversation turns, cogmem_memory_map for anatomy, cogmem_maintenance_tick for host-owned upkeep, and cogmem_prospective for confirmed-only future-memory state. Strategy capsules and prospective memory never authorize task or tool execution.',
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
