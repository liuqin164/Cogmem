import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';

import {
  callCogmemMcpTool,
  listCogmemMcpTools,
  type CogmemMcpRuntime,
} from './CoreMcpTools.js';

export function createCogmemMcpServer(runtime: CogmemMcpRuntime = {}): Server {
  const server = new Server({
    name: 'cogmem-core',
    version: '3.3.0',
  }, {
    capabilities: {
      tools: {},
    },
    instructions: 'Use cogmem_recall to retrieve prepared memory context, cogmem_remember_turn to write conversation turns, cogmem_memory_map for memory anatomy, cogmem_maintenance_tick for host-owned upkeep suggestions, and cogmem_prospective for confirmed-only future-memory state. Prospective memory never authorizes task or tool execution.',
  });

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
    tools: listCogmemMcpTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const result = await callCogmemMcpTool(
      request.params.name,
      request.params.arguments,
      runtime,
    );
    return result as CallToolResult;
  });

  return server;
}

export async function startCogmemMcpServer(runtime: CogmemMcpRuntime = {}): Promise<Server> {
  const server = createCogmemMcpServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
