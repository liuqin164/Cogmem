import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startCogmemMcpHttpServer, type CogmemMcpHttpHandle } from '../src/mcp/http.js';
import { listCogmemMcpTools } from '../src/mcp/CoreMcpTools.js';
import { ADMIN_TOOLS, CORE_TOOLS, filterToolsByProfile, resolveProfile } from '../src/mcp/profiles.js';

const scratch = mkdtempSync(join(tmpdir(), 'cogmem-mcp-http-'));
const dbPath = join(scratch, 'memory.db');
const handles: CogmemMcpHttpHandle[] = [];

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
  options: { sessionId?: string; token?: string } = {},
) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(options.sessionId ? { 'mcp-session-id': options.sessionId } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
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

async function connect(url: string, token?: string) {
  const init = await rpc(url, initialize, { token });
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

describe('shared memory tools', () => {
  const call = async (url: string, sessionId: string, name: string, args: object) => {
    const response = await rpc(url, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name, arguments: args },
    }, { sessionId });
    const result = response.json.result;
    const text = result.content[0].text as string;
    return { isError: result.isError === true, body: text.startsWith('{') ? JSON.parse(text) : text };
  };

  test('publish is idempotent, subscribe reads it, retract hides but keeps history', async () => {
    const handle = await start({ profile: 'admin' });
    const sessionId = await connect(handle.url);

    const first = await call(handle.url, sessionId, 'cogmem_shared_publish', {
      items: [{ itemHash: 'h-1', collection: 'team-standards', payload: { text: 'run typecheck first' } }],
    });
    expect(first.isError).toBe(false);
    expect(first.body.inserted).toBe(1);
    expect(first.body.host).toBe('test');

    const second = await call(handle.url, sessionId, 'cogmem_shared_publish', {
      items: [{ itemHash: 'h-1', collection: 'team-standards', payload: { text: 'run typecheck first' } }],
    });
    expect(second.body.inserted).toBe(0);
    expect(second.body.idempotent).toBe(true);

    const subscribed = await call(handle.url, sessionId, 'cogmem_shared_subscribe', {
      collections: ['team-standards'],
    });
    expect(subscribed.body.count).toBe(1);
    expect(subscribed.body.items[0].payload.text).toBe('run typecheck first');

    const retracted = await call(handle.url, sessionId, 'cogmem_shared_retract', { itemHash: 'h-1' });
    expect(retracted.isError).toBe(false);
    expect(retracted.body.retractedBy).toBe('test');

    const afterRetract = await call(handle.url, sessionId, 'cogmem_shared_subscribe', {
      collections: ['team-standards'],
    });
    expect(afterRetract.body.count).toBe(0);

    const explained = await call(handle.url, sessionId, 'cogmem_shared_explain', { itemHash: 'h-1' });
    expect(explained.body.retracted).toBe(true);
    expect(explained.body.retractedAt).toBeGreaterThan(0);
    expect(explained.body.item.itemHash).toBe('h-1');
  });

  test('explaining an unknown item fails with a named error', async () => {
    const handle = await start({ profile: 'admin' });
    const sessionId = await connect(handle.url);

    const explained = await call(handle.url, sessionId, 'cogmem_shared_explain', { itemHash: 'missing' });
    expect(explained.isError).toBe(true);
    expect(String(explained.body.error)).toContain('shared_item_not_found');
  });

  test('publishing is refused on the core profile', async () => {
    const handle = await start({ profile: 'core' });
    const sessionId = await connect(handle.url);

    const published = await call(handle.url, sessionId, 'cogmem_shared_publish', {
      items: [{ itemHash: 'h-2', collection: 'team-standards' }],
    });
    expect(published.isError).toBe(true);
    expect(String(published.body)).toContain('tool_not_in_profile');
  });
});

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
