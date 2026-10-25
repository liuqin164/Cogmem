import { describe, expect, test, afterAll } from 'bun:test';
import { startCogmemMcpHttpServer } from '../src/mcp/http.js';
import { createAgentRegistry } from '../src/mcp/AgentRegistry.js';
import { makeTempDir } from './helpers/tmp.js';
import { createHash } from 'node:crypto';

const scratch = makeTempDir('cogmem-http-auth-combo-');
const handles: Awaited<ReturnType<typeof startCogmemMcpHttpServer>>[] = [];

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const AGENT_A_TOKEN = 'agent-a-secret-token-123456789012345678901234';
const AGENT_A = { hostId: 'agent-a', tokenDigest: digest(AGENT_A_TOKEN), projectId: 'proj-a', profile: 'admin' as const };
const GLOBAL_TOKEN = 'global-secret-token-098765432109876543210987';

async function startServer(options: { agents?: boolean; globalToken?: boolean } = {}): Promise<Awaited<ReturnType<typeof startCogmemMcpHttpServer>>> {
  const dbPath = `${scratch}/memory-${handles.length}.db`;
  const agentRegistry = options.agents ? createAgentRegistry([AGENT_A]) : undefined;
  const token = options.globalToken ? GLOBAL_TOKEN : undefined;

  const handle = await startCogmemMcpHttpServer(
    { dbPath, cwd: scratch },
    {
      port: 0,
      profile: 'admin',
      hostId: 'resident-server',
      agents: agentRegistry,
      token,
    },
  );
  handles.push(handle);
  return handle;
}

function parseRpcBody(contentType: string | null, body: string): any {
  if (contentType?.includes('text/event-stream')) {
    const dataLines = body.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter(Boolean);
    if (dataLines.length === 0) throw new Error(`empty_sse:${body.slice(0, 120)}`);
    return JSON.parse(dataLines[dataLines.length - 1]);
  }
  return JSON.parse(body);
}

async function rpc(
  url: string,
  payload: unknown,
  options: { sessionId?: string; token?: string; identity?: Record<string, string> } = {},
) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(options.sessionId ? { 'mcp-session-id': options.sessionId } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.identity ? { 'x-cogmem-identity': JSON.stringify(options.identity) } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return {
    status: response.status,
    sessionId: response.headers.get('mcp-session-id') ?? undefined,
    json: response.ok ? parseRpcBody(response.headers.get('content-type'), text) : null,
    text,
  };
}

async function connect(url: string, options: { token?: string; identity?: Record<string, string> } = {}): Promise<string> {
  const init = await rpc(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'auth-combo-test', version: '1' } },
  }, options);
  expect(init.status).toBe(200);
  return init.sessionId as string;
}

async function callTool(
  url: string,
  sessionId: string,
  name: string,
  args: object,
  options: { token?: string; identity?: Record<string, string> } = {},
) {
  const response = await rpc(url, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name, arguments: args },
  }, { sessionId, ...options });
  const result = response.json?.result;
  return { status: response.status, isError: result?.isError === true, body: result?.content?.[0]?.text ?? response.text, raw: response.text };
}

afterAll(() => {
  for (const handle of handles) handle.stop();
});

describe('HTTP auth: --token + --agents combination', () => {
  test('global token only: accepts valid token, rejects invalid', async () => {
    const handle = await startServer({ globalToken: true });

    // Valid global token works
    const session = await connect(handle.url, { token: GLOBAL_TOKEN });
    expect(session).toBeDefined();

    // Invalid token rejected
    const denied = await rpc(handle.url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
    }, { token: 'wrong-token' });
    expect(denied.status).toBe(401);
  });

  test('agents registry only: accepts registered agent token, rejects unknown', async () => {
    const handle = await startServer({ agents: true });

    // Registered agent token works
    const session = await connect(handle.url, { token: AGENT_A_TOKEN });
    expect(session).toBeDefined();

    // Unknown token rejected
    const denied = await rpc(handle.url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
    }, { token: 'unknown-token' });
    expect(denied.status).toBe(401);
  });

  test('both configured: agents registry takes precedence, global token ignored', async () => {
    const handle = await startServer({ agents: true, globalToken: true });

    // Agent token works (agents registry takes precedence)
    const sessionAgent = await connect(handle.url, { token: AGENT_A_TOKEN });
    expect(sessionAgent).toBeDefined();

    // Global token does NOT work (it's ignored when agents registry is present)
    const denied = await rpc(handle.url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
    }, { token: GLOBAL_TOKEN });
    expect(denied.status).toBe(401);
  });

  test('both configured: global token cannot access agent memory', async () => {
    const handle = await startServer({ agents: true, globalToken: true });

    // Agent writes with its token
    const sessionAgent = await connect(handle.url, { token: AGENT_A_TOKEN });
    const written = await callTool(handle.url, sessionAgent, 'cogmem_remember_turn', {
      userText: 'agent secret {{SECRET_AGENT}}',
      assistantText: 'ok',
      sessionId: 'agent-session',
      agentId: 'agent-a',
      ingestMode: 'raw_archive_only',
    }, { token: AGENT_A_TOKEN });
    expect(written.status).toBe(200);

    // Global token cannot read it (401 on initialize)
    const denied = await rpc(handle.url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
    }, { token: GLOBAL_TOKEN });
    expect(denied.status).toBe(401);
  });

  test('no auth on loopback without agents or global token', async () => {
    const handle = await startServer({});

    // No token required on loopback
    const session = await connect(handle.url);
    expect(session).toBeDefined();

    // Can call tools
    const listed = await rpc(handle.url, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { sessionId: session });
    expect(listed.status).toBe(200);
  });
});