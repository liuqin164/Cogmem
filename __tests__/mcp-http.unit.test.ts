import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startCogmemMcpHttpServer, type CogmemMcpHttpHandle } from '../src/mcp/http.js';
import { applyIdentity, parseSessionIdentity } from '../src/mcp/server.js';
import { listCogmemMcpTools } from '../src/mcp/CoreMcpTools.js';
import { ADMIN_TOOLS, CORE_TOOLS, filterToolsByProfile, resolveProfile } from '../src/mcp/profiles.js';

const scratch = mkdtempSync(join(tmpdir(), 'cogmem-mcp-http-'));
const dbPath = join(scratch, 'memory.db');
const handles: CogmemMcpHttpHandle[] = [];

const call = async (
  url: string,
  sessionId: string,
  name: string,
  args: object,
  extraHeaders: Record<string, string> = {},
) => {
  const response = await rpc(url, {
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: { name, arguments: args },
  }, { sessionId, extraHeaders });
  const result = response.json.result;
  const text = result.content[0].text as string;
  return { isError: result.isError === true, body: text.startsWith('{') ? JSON.parse(text) : text };
};

afterAll(() => {
  for (const handle of handles) handle.stop();
  rmSync(scratch, { recursive: true, force: true });
});

async function start(options: { profile?: 'core' | 'admin' | 'full'; token?: string; project?: string; maxSessions?: number } = {}) {
  const handle = await startCogmemMcpHttpServer(
    { dbPath, cwd: scratch },
    {
      port: 0,
      profile: options.profile ?? 'core',
      hostId: 'test',
      token: options.token,
      projectId: options.project,
      maxSessions: options.maxSessions,
    },
  );
  handles.push(handle);
  return handle;
}

function parseRpcBody(contentType: string | null, body: string): any {
  if (contentType?.includes('text/event-stream')) {
    const dataLines = body
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    if (dataLines.length === 0) throw new Error(`empty_sse:${body.slice(0, 120)}`);
    return JSON.parse(dataLines[dataLines.length - 1]);
  }
  return JSON.parse(body);
}

async function rpc(
  url: string,
  payload: unknown,
  options: { sessionId?: string; token?: string; extraHeaders?: Record<string, string> } = {},
) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(options.sessionId ? { 'mcp-session-id': options.sessionId } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.extraHeaders ?? {}),
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

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'cogmem-test', version: '1.0.0' },
  },
};

async function connect(url: string, token?: string, extraHeaders?: Record<string, string>) {
  const init = await rpc(url, initialize, { token, extraHeaders });
  expect(init.status).toBe(200);
  expect(init.sessionId).toBeTruthy();
  return init.sessionId as string;
}

describe('tool profiles', () => {
  test('every profiled tool exists in the server tool list', () => {
    const names = new Set(listCogmemMcpTools().map((tool) => tool.name));
    for (const name of ADMIN_TOOLS) {
      expect(names.has(name)).toBe(true);
    }
    expect(CORE_TOOLS.every((name) => names.has(name))).toBe(true);
  });

  test('core is a strict subset of admin, and full is unfiltered', () => {
    const all = listCogmemMcpTools();
    const core = filterToolsByProfile('core', all);
    const admin = filterToolsByProfile('admin', all);

    expect(core).toHaveLength(CORE_TOOLS.length);
    expect(admin.length).toBeGreaterThan(core.length);
    expect(filterToolsByProfile('full', all)).toHaveLength(all.length);
  });

  test('an unknown profile is rejected', () => {
    expect(() => resolveProfile('everything')).toThrow(/unknown_tool_profile/);
  });
});

describe('streamable HTTP transport', () => {
  test('serves initialize and a profile-filtered tools/list', async () => {
    const handle = await start({ profile: 'core' });
    const sessionId = await connect(handle.url);

    const listed = await rpc(handle.url, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { sessionId });

    expect(listed.status).toBe(200);
    expect(listed.json.result.tools).toHaveLength(CORE_TOOLS.length);
    expect(listed.json.result.tools.map((t: { name: string }) => t.name).sort())
      .toEqual([...CORE_TOOLS].sort());
  });

  test('admin profile exposes more tools than core', async () => {
    const handle = await start({ profile: 'admin' });
    const sessionId = await connect(handle.url);

    const listed = await rpc(handle.url, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { sessionId });

    expect(listed.json.result.tools).toHaveLength(ADMIN_TOOLS.length);
  });

  test('a tool outside the profile is refused, not executed', async () => {
    const handle = await start({ profile: 'core' });
    const sessionId = await connect(handle.url);

    const called = await rpc(handle.url, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'cogmem_maintenance_tick', arguments: {} },
    }, { sessionId });

    expect(called.status).toBe(200);
    expect(called.json.result.isError).toBe(true);
    expect(called.json.result.content[0].text).toContain('tool_not_in_profile');
  });

  test('an unknown session id is rejected instead of silently opening a session', async () => {
    const handle = await start();
    const response = await rpc(
      handle.url,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { sessionId: 'no-such-session' },
    );

    expect(response.status).toBe(404);
  });

  test('unknown paths return 404', async () => {
    const handle = await start();
    const response = await fetch(handle.url.replace('/mcp', '/nope'), { method: 'POST', body: '{}' });
    expect(response.status).toBe(404);
  });

  test('a configured token is required', async () => {
    const handle = await start({ token: 's3cret' });

    const denied = await rpc(handle.url, initialize);
    expect(denied.status).toBe(401);

    const allowed = await rpc(handle.url, initialize, { token: 's3cret' });
    expect(allowed.status).toBe(200);
    expect(allowed.sessionId).toBeTruthy();
  });

  test('two clients get independent sessions on one kernel', async () => {
    const handle = await start();
    const first = await connect(handle.url);
    const second = await connect(handle.url);

    expect(first).not.toBe(second);
    expect(handle.sessions()).toBe(2);

    const listed = await rpc(handle.url, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { sessionId: second });
    expect(listed.status).toBe(200);
  });

  test('a bound connection stamps its project on calls that omit one', async () => {
    const handle = await start({ project: 'bound-project' });
    const sessionId = await connect(handle.url);

    const recalled = await rpc(handle.url, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'cogmem_recall', arguments: { query: 'anything' } },
    }, { sessionId });

    const text = recalled.json.result.content[0].text as string;
    expect(recalled.json.result.isError).toBeFalsy();
    expect(JSON.parse(text).projectId).toBe('bound-project');
  });

  test('a bound connection rejects a call that names another project', async () => {
    const handle = await start({ project: 'bound-project' });
    const sessionId = await connect(handle.url);

    const recalled = await rpc(handle.url, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'cogmem_recall', arguments: { query: 'anything', projectId: 'someone-else' } },
    }, { sessionId });

    expect(recalled.json.result.isError).toBe(true);
    expect(recalled.json.result.content[0].text).toContain('project_scope_violation');
  });
});

// #68 removed the shared-memory tools from every profile, so the publish /
// subscribe / retract / explain round trips that used to live here have no
// subject. The 4.0 contract that replaced them — no profile offers a shared
// tool, a call to one is answered as a missing tool rather than a profile
// restriction, and a fresh served database carries no shared storage — is
// asserted in `mcp-shared-memory-not-exposed.unit.test.ts`.

describe('session lifecycle', () => {
  test('the session map is capped and evicts the oldest session', async () => {
    const handle = await start({ maxSessions: 2 });
    const first = await connect(handle.url);
    await connect(handle.url);
    const third = await connect(handle.url);

    expect(handle.sessions()).toBe(2);

    const stale = await rpc(handle.url, { jsonrpc: '2.0', id: 20, method: 'tools/list' }, { sessionId: first });
    expect(stale.status).toBe(404);

    const live = await rpc(handle.url, { jsonrpc: '2.0', id: 21, method: 'tools/list' }, { sessionId: third });
    expect(live.status).toBe(200);
  });

  test('an unknown session id is rejected instead of silently starting a new one', async () => {
    const handle = await start();
    const response = await rpc(handle.url, { jsonrpc: '2.0', id: 22, method: 'tools/list' }, {
      sessionId: '00000000-0000-4000-8000-000000000000',
    });
    expect(response.status).toBe(404);
  });
});

describe('session identity binding', () => {
  // The header's hostId used to be observable only through the shared-memory
  // tools, which #68 removed. #65 will build on this field, so the parse itself
  // is pinned here rather than left to the first consumer.
  test('the identity header parses hostId even when no 4.0 tool spends it', () => {
    expect(parseSessionIdentity(JSON.stringify({ hostId: 'bot-a', projectId: 'project-a' })))
      .toEqual({ hostId: 'bot-a', projectId: 'project-a', profile: undefined });
    expect(parseSessionIdentity('not json')).toBeUndefined();
    expect(parseSessionIdentity(JSON.stringify({}))).toBeUndefined();
  });

  test('an unauthenticated connection cannot obtain a hostId by claiming one', () => {
    // #65: a hostId says *which agent* a call runs as, so only an authenticated
    // connection may assert one. On loopback with no credential configured the
    // claim is ignored rather than honoured — the connection runs as the server,
    // not as the name in the header. The documented project and profile
    // bindings keep working, because those narrow what the connection may do
    // instead of inventing who it is.
    const pretender = applyIdentity({ profile: 'core' }, { identity: { hostId: 'bot-b' } }, false);
    expect(pretender.hostId).toBeUndefined();

    // A header may not introduce a hostId even on an authenticated request: the
    // identity comes from the credential, and a claim can only agree with it.
    const claimedWithoutIdentity = applyIdentity({ profile: 'core' }, { identity: { hostId: 'bot-a' } }, true);
    expect(claimedWithoutIdentity.hostId).toBeUndefined();
    const agreeing = applyIdentity(
      { profile: 'core', authenticatedHostId: 'bot-a' },
      { identity: { hostId: 'bot-a' } },
      true,
    );
    expect(agreeing.hostId).toBe('bot-a');

    // The connection's own hostId still wins over nothing, and no credential is
    // needed for the narrowing fields.
    const configured = applyIdentity({ profile: 'core', hostId: 'server-host' }, { identity: { hostId: 'bot-b' } }, false);
    expect(configured.hostId).toBe('server-host');
    const bound = applyIdentity(
      { profile: 'core', projectId: 'project-a' },
      { identity: { projectId: 'project-a', profile: 'core' } },
      false,
    );
    expect({ hostId: bound.hostId, projectId: bound.projectId }).toEqual({ hostId: undefined, projectId: 'project-a' });
  });

  test('session identity header binds projectId for tool calls', async () => {
    const handle = await start({ profile: 'admin' });
    const sessionId = await connect(handle.url, undefined, { 'x-cogmem-identity': JSON.stringify({ hostId: 'bot-b', projectId: 'project-b', profile: 'admin' }) });

    // Call with identity header specifying projectId
    const recalled = await call(handle.url, sessionId, 'cogmem_recall', { query: 'test' });
    expect(recalled.isError).toBe(false);
    expect(recalled.body.projectId).toBe('project-b');
  });

  test('an identity header cannot widen the profile without a token', async () => {
    const handle = await start({ profile: 'core' });
    const sessionId = await connect(handle.url, undefined, { 'x-cogmem-identity': JSON.stringify({ hostId: 'bot-c', projectId: 'project-c', profile: 'admin' }) });

    // The server profile is a ceiling: an unauthenticated header may narrow it,
    // never escalate beyond it.
    const listed = await rpc(handle.url, { jsonrpc: '2.0', id: 103, method: 'tools/list', params: {} }, { sessionId });
    expect(listed.json.result.tools).toHaveLength(CORE_TOOLS.length);
  });

  test('an identity header may narrow the profile without a token', async () => {
    const handle = await start({ profile: 'admin' });
    const sessionId = await connect(handle.url, undefined, { 'x-cogmem-identity': JSON.stringify({ hostId: 'bot-n', profile: 'core' }) });

    const listed = await rpc(handle.url, { jsonrpc: '2.0', id: 104, method: 'tools/list', params: {} }, { sessionId });
    expect(listed.json.result.tools).toHaveLength(CORE_TOOLS.length);
  });

  test('a tampered profile header cannot escalate past the server default', async () => {
    const handle = await start({ profile: 'core' });
    const sessionId = await connect(handle.url, undefined, { 'x-cogmem-identity': JSON.stringify({ hostId: 'attacker', projectId: 'project-x', profile: 'full' }) });

    const listed = await rpc(handle.url, { jsonrpc: '2.0', id: 105, method: 'tools/list', params: {} }, { sessionId });
    expect(listed.json.result.tools).toHaveLength(CORE_TOOLS.length);

    const blocked = await call(handle.url, sessionId, 'cogmem_maintenance_tick', {});
    expect(blocked.isError).toBe(true);
    expect(blocked.body).toContain('tool_not_in_profile');
  });

  test('a token-authenticated identity header may widen the profile', async () => {
    const handle = await start({ profile: 'core', token: 's3cret' });
    const sessionId = await connect(handle.url, 's3cret', { 'x-cogmem-identity': JSON.stringify({ hostId: 'bot-t', profile: 'admin' }) });

    const listed = await rpc(handle.url, { jsonrpc: '2.0', id: 1051, method: 'tools/list', params: {} }, { sessionId, token: 's3cret' });
    expect(listed.json.result.tools).toHaveLength(ADMIN_TOOLS.length);
  });

  test('an unknown profile in the identity header is rejected', async () => {
    const handle = await start({ profile: 'admin' });
    const sessionId = await connect(handle.url, undefined, { 'x-cogmem-identity': JSON.stringify({ profile: 'bogus' }) });

    const called = await call(handle.url, sessionId, 'cogmem_maintenance_tick', {});
    expect(called.isError).toBe(true);
    expect(called.body).toContain('unknown_tool_profile:bogus');
  });

  test('a per-call identity header cannot silently rewrite the project binding', async () => {
    const handle = await start({ profile: 'admin' });
    const sessionId = await connect(handle.url, undefined, { 'x-cogmem-identity': JSON.stringify({ hostId: 'bot-p', projectId: 'project-a' }) });

    const overridden = await call(handle.url, sessionId, 'cogmem_recall', { query: 'x' }, { 'x-cogmem-identity': JSON.stringify({ projectId: 'project-b' }) });
    expect(overridden.isError).toBe(true);
    expect(overridden.body).toContain('project_scope_violation');
  });

  test('an empty identity header keeps the session binding', async () => {
    const handle = await start({ profile: 'admin' });
    const sessionId = await connect(handle.url, undefined, { 'x-cogmem-identity': JSON.stringify({ hostId: 'bot-e', projectId: 'project-e' }) });

    const recalled = await call(handle.url, sessionId, 'cogmem_recall', { query: 'x' }, { 'x-cogmem-identity': '{}' });
    expect(recalled.isError).toBe(false);
    expect(recalled.body.projectId).toBe('project-e');
  });

  test('two sessions with different identities get isolated tool surfaces', async () => {
    const handle = await start({ profile: 'admin' });
    const session1 = await connect(handle.url, undefined, { 'x-cogmem-identity': JSON.stringify({ hostId: 'bot-1', projectId: 'project-1', profile: 'core' }) });
    const session2 = await connect(handle.url);

    // Session 1 narrows itself to core through the identity header
    const listed1 = await rpc(handle.url, { jsonrpc: '2.0', id: 105, method: 'tools/list', params: {} }, { sessionId: session1 });
    expect(listed1.json.result.tools).toHaveLength(CORE_TOOLS.length);

    // Session 2 keeps the server default
    const listed2 = await rpc(handle.url, { jsonrpc: '2.0', id: 106, method: 'tools/list', params: {} }, { sessionId: session2 });
    expect(listed2.json.result.tools).toHaveLength(ADMIN_TOOLS.length);

    // Session 1 is narrowed to core, so an admin tool is denied
    const callResult1 = await call(handle.url, session1, 'cogmem_maintenance_tick', {});
    expect(callResult1.isError).toBe(true);
    expect(callResult1.body).toContain('tool_not_in_profile');

    // Session 2 keeps the server default, so the admin tool is reachable
    const callResult2 = await call(handle.url, session2, 'cogmem_maintenance_tick', {});
    expect(callResult2.isError).toBe(false);
  });
});
