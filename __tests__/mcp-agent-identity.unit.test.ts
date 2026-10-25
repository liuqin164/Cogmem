import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { startCogmemMcpHttpServer, type CogmemMcpHttpHandle } from '../src/mcp/http.js';
import { createAgentRegistry, loadAgentRegistry, parseAgentRegistry } from '../src/mcp/AgentRegistry.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #65: several agents behind one resident process, each with private memory.
 *
 * The tests below are the issue's first two acceptance items, driven through the
 * real HTTP transport rather than the identity helper:
 *
 * 1. a request holding agent A's credential cannot claim to be B, and A cannot
 *    read or write B's memory;
 * 2. a loopback connection with no credential cannot obtain a hostId at all.
 *
 * The third item (the plugin/bridge path) rides on the same resolver, so what is
 * pinned here is the decision both paths have to share.
 */

const scratch = makeTempDir('cogmem-agent-identity-');
const handles: CogmemMcpHttpHandle[] = [];

const AGENT_A = { hostId: 'bot-a', token: 'token-for-bot-a-0123456789', projectId: 'project-a', profile: 'admin' as const };
const AGENT_B = { hostId: 'bot-b', token: 'token-for-bot-b-9876543210', projectId: 'project-b', profile: 'admin' as const };

afterAll(() => {
  for (const handle of handles) handle.stop();
  rmSync(scratch, { recursive: true, force: true });
});

async function startServer(options: { registry?: boolean } = {}): Promise<CogmemMcpHttpHandle> {
  const dbPath = join(scratch, `memory-${handles.length}.db`);
  const handle = await startCogmemMcpHttpServer(
    { dbPath, cwd: scratch },
    {
      port: 0,
      profile: 'admin',
      hostId: 'resident-server',
      agents: options.registry === false ? undefined : createAgentRegistry([AGENT_A, AGENT_B]),
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
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'agent-identity-test', version: '1' } },
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
  const result = response.json.result;
  const text = result.content[0].text as string;
  return { isError: result.isError === true, body: text.startsWith('{') ? JSON.parse(text) : text, raw: text };
}

describe('#65 the credential registry', () => {
  test('resolves a registered token to its agent and rejects anything else', () => {
    const registry = createAgentRegistry([AGENT_A, AGENT_B]);
    expect(registry.resolve(AGENT_A.token)?.hostId).toBe('bot-a');
    expect(registry.resolve(AGENT_B.token)?.hostId).toBe('bot-b');
    expect(registry.resolve('not-a-token')).toBeUndefined();
    expect(registry.resolve('')).toBeUndefined();
    // A token that is a prefix of a real one must not resolve: the comparison is
    // over the whole credential, not a prefix match.
    expect(registry.resolve(AGENT_A.token.slice(0, 10))).toBeUndefined();
  });

  test('refuses a registration without a hostId or a usable credential', () => {
    expect(() => parseAgentRegistry({ agents: [{ hostId: '', token: 'x' }] })).toThrow(/hostId/);
    expect(() => parseAgentRegistry({ agents: [{ hostId: 'a', token: '' }] })).toThrow(/token/);
    expect(() => parseAgentRegistry({ agents: [{ hostId: 'a', token: 'x' }, { hostId: 'a', token: 'y' }] })).toThrow(/duplicate/);
    expect(() => parseAgentRegistry({ agents: 'nope' })).toThrow(/agents/);
  });

  test('an absent registry file is not an error, a malformed one is', () => {
    expect(loadAgentRegistry(join(scratch, 'absent', 'agents.json'))).toBeUndefined();

    const bad = join(scratch, 'bad-agents.json');
    mkdirSync(scratch, { recursive: true });
    writeFileSync(bad, '{"agents": [{"hostId": "bot-a"}]}');
    expect(() => loadAgentRegistry(bad)).toThrow(/token/);

    const good = join(scratch, 'good-agents.json');
    writeFileSync(good, JSON.stringify({ agents: [AGENT_A] }));
    expect(loadAgentRegistry(good)?.resolve(AGENT_A.token)?.hostId).toBe('bot-a');
  });
});

describe('#65 a credential decides the identity, and a header cannot change it', () => {
  test('an unknown credential is refused before any tool runs', async () => {
    const handle = await startServer();
    const denied = await rpc(handle.url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
    }, { token: 'forged-token' });
    expect(denied.status).toBe(401);
  });

  test('agent A cannot claim to be agent B through the identity header', async () => {
    const handle = await startServer();
    const session = await connect(handle.url, { token: AGENT_A.token });

    const claimed = await callTool(handle.url, session, 'cogmem_recall', { query: 'anything' }, {
      token: AGENT_A.token,
      identity: { hostId: 'bot-b' },
    });
    expect(claimed.isError).toBe(true);
    expect(claimed.raw).toContain('host_identity_mismatch');
  });

  test('agent A cannot read agent B project memory', async () => {
    const handle = await startServer();

    // B writes inside its own project.
    const sessionB = await connect(handle.url, { token: AGENT_B.token });
    const written = await callTool(handle.url, sessionB, 'cogmem_remember_turn', {
      userText: 'bot-b private note about {{SECRET_9f2ka7}}',
      assistantText: 'noted',
      sessionId: 'b-session',
      agentId: 'bot-b',
      ingestMode: 'raw_archive_only',
    }, { token: AGENT_B.token });
    expect(written.isError).toBe(false);

    // B can read it back, so the memory exists. Without this the "A sees
    // nothing" assertions below would also pass if the write had simply failed.
    const bRead = await callTool(handle.url, sessionB, 'cogmem_recall', { query: 'bot-b private note', agentId: 'bot-b' }, { token: AGENT_B.token });
    expect(bRead.isError).toBe(false);
    expect(JSON.stringify(bRead.body.items)).toContain('{{SECRET_9f2ka7}}');

    // A cannot reach it: its connection is bound to project-a, so naming
    // project-b is refused rather than served.
    const sessionA = await connect(handle.url, { token: AGENT_A.token });
    const crossRead = await callTool(handle.url, sessionA, 'cogmem_recall', {
      query: 'bot-b private note',
      projectId: 'project-b',
    }, { token: AGENT_A.token });
    expect(crossRead.isError).toBe(true);
    expect(crossRead.raw).toContain('project_scope_violation');

    // Nor can it read B's memory from its own connection — not even by naming
    // B's agent id explicitly, because the project scope is what bounds the
    // lookup. The query text is echoed in the response, so the assertion is on
    // the recalled items, which is where a leak would show.
    const ownRead = await callTool(handle.url, sessionA, 'cogmem_recall', { query: 'bot-b private note', agentId: 'bot-b' }, { token: AGENT_A.token });
    expect(ownRead.isError).toBe(false);
    expect((ownRead.body as { items: unknown[] }).items).toEqual([]);
  });

  test('agent A cannot write into agent B project', async () => {
    const handle = await startServer();
    const sessionA = await connect(handle.url, { token: AGENT_A.token });

    const crossWrite = await callTool(handle.url, sessionA, 'cogmem_remember_turn', {
      userText: 'A writing into B project',
      sessionId: 'a-session',
      agentId: 'bot-a',
      projectId: 'project-b',
    }, { token: AGENT_A.token });
    expect(crossWrite.isError).toBe(true);
    expect(crossWrite.raw).toContain('project_scope_violation');
  });

  test('a credential is a ceiling: the header may narrow the profile but never widen it', async () => {
    const handle = await startServer();
    // AGENT_A is registered with profile "admin"; the server launches at "admin".
    const narrowed = await connect(handle.url, { token: AGENT_A.token, identity: { profile: 'core' } });
    const listedNarrow = await rpc(handle.url, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { sessionId: narrowed, token: AGENT_A.token, identity: { profile: 'core' } });
    expect(listedNarrow.json.result.tools.length).toBe(6);

    const widened = await connect(handle.url, { token: AGENT_A.token, identity: { profile: 'full' } });
    const listedWide = await rpc(handle.url, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
      { sessionId: widened, token: AGENT_A.token, identity: { profile: 'full' } });
    // "full" is wider than the credential's admin ceiling, so it is refused down
    // to the ceiling rather than granted.
    expect(listedWide.json.result.tools.length).toBe(22);
  });
});

describe('#65 a connection with no credential gets no identity', () => {
  test('a loopback client cannot obtain a hostId by claiming one', async () => {
    const handle = await startServer({ registry: false });
    const session = await connect(handle.url, { identity: { hostId: 'impersonated', profile: 'core' } });

    // The claim is ignored, not honoured: the call still runs, narrowed, as the
    // server. Nothing about the response names the claimed host.
    const listed = await rpc(handle.url, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { sessionId: session, identity: { hostId: 'impersonated', profile: 'core' } });
    expect(listed.json.result.tools.length).toBe(6);
    expect(JSON.stringify(listed.json)).not.toContain('impersonated');

    // And a wider claim is still refused: no credential, no widening.
    const elevated = await connect(handle.url, { identity: { hostId: 'impersonated', profile: 'full' } });
    const listedElevated = await rpc(handle.url, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
      { sessionId: elevated, identity: { hostId: 'impersonated', profile: 'full' } });
    expect(listedElevated.json.result.tools.length).toBe(22);
  });
});
