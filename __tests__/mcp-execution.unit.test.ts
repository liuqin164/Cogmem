import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { startCogmemMcpHttpServer, type CogmemMcpHttpHandle } from '../src/mcp/http.js';
import { CORE_TOOLS } from '../src/mcp/profiles.js';
import { makeTempDir } from './helpers/tmp.js';

const scratch = makeTempDir('cogmem-mcp-exec-');
const dbPath = join(scratch, 'memory.db');
const handles: CogmemMcpHttpHandle[] = [];

afterAll(() => {
  for (const handle of handles) handle.stop();
  rmSync(scratch, { recursive: true, force: true });
});

async function start(): Promise<CogmemMcpHttpHandle> {
  const handle = await startCogmemMcpHttpServer(
    { dbPath, cwd: scratch },
    { port: 0, profile: 'admin', hostId: 'exec-host' },
  );
  handles.push(handle);
  return handle;
}

async function startBound(projectId: string): Promise<CogmemMcpHttpHandle> {
  const handle = await startCogmemMcpHttpServer(
    { dbPath, cwd: scratch },
    { port: 0, profile: 'admin', hostId: 'exec-host', projectId },
  );
  handles.push(handle);
  return handle;
}

function parseBody(contentType: string | null, body: string): any {
  if (contentType?.includes('text/event-stream')) {
    const lines = body.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim());
    return JSON.parse(lines[lines.length - 1]);
  }
  return JSON.parse(body);
}

async function rpc(url: string, payload: unknown, sessionId?: string) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return {
    status: response.status,
    sessionId: response.headers.get('mcp-session-id') ?? undefined,
    json: response.ok ? parseBody(response.headers.get('content-type'), text) : null,
  };
}

async function connect(url: string): Promise<string> {
  const init = await rpc(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'exec-test', version: '1' } },
  });
  expect(init.status).toBe(200);
  return init.sessionId as string;
}

let callId = 100;
async function call(url: string, sessionId: string, name: string, args: object) {
  const response = await rpc(url, {
    jsonrpc: '2.0',
    id: callId++,
    method: 'tools/call',
    params: { name, arguments: args },
  }, sessionId);
  const result = response.json?.result;
  const text = result?.content?.[0]?.text ?? '';
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { isError: result?.isError === true, body, raw: text };
}

describe('tool execution semantics', () => {
  test('a retry under the same turnId is a replay, not a second turn (#113)', async () => {
    // The tool now exposes turnId, and a named turn is an identity. Before this the
    // MCP surface could not name a turn at all, so every write was named after a
    // timestamp and a sequence and every retry landed a second copy in the ledger.
    const handle = await start();
    const session = await connect(handle.url);
    const turn = {
      turnId: 'exec-turn-replay-1',
      userText: '请记住代号 REPLAY-1 的负责小组是青栎组。',
      assistantText: '已记下。',
      sessionId: 'exec-session-replay',
      agentId: 'exec-agent',
      projectId: 'exec-project-replay',
    };

    const first = await call(handle.url, session, 'cogmem_remember_turn', turn);
    expect(first.isError).toBe(false);
    expect(first.body.duplicate).toBeUndefined();

    const second = await call(handle.url, session, 'cogmem_remember_turn', turn);
    expect(second.isError).toBe(false);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.reason).toBe('duplicate_turn');
    expect(second.body.rawEventIds).toEqual(first.body.rawEventIds);

    // The same identity carrying different text is refused rather than written beside it.
    const conflict = await call(handle.url, session, 'cogmem_remember_turn', {
      ...turn,
      userText: '同一轮次，完全不同的内容。',
    });
    expect(conflict.isError).toBe(true);
    expect(conflict.raw).toContain('agent_turn_identity_conflict');
  });


  test('remember_turn writes evidence that recall returns', async () => {
    const handle = await start();
    const session = await connect(handle.url);
    const marker = 'zanzibar-quartz-42';

    const written = await call(handle.url, session, 'cogmem_remember_turn', {
      userText: `For the release we agreed on ${marker} as the storage decision.`,
      assistantText: 'Recorded.',
      sessionId: 'exec-session-1',
      agentId: 'exec-agent',
      projectId: 'exec-project',
    });

    expect(written.isError).toBe(false);
    expect(Array.isArray(written.body.rawEventIds)).toBe(true);
    expect(written.body.rawEventIds.length).toBeGreaterThan(0);

    const recalled = await call(handle.url, session, 'cogmem_recall', {
      query: `what did we decide about ${marker}`,
      agentId: 'exec-agent',
      projectId: 'exec-project',
    });

    expect(recalled.isError).toBe(false);
    expect(recalled.raw).toContain(marker);
  });

  test('unknown tools are rejected by name', async () => {
    const handle = await start();
    const session = await connect(handle.url);
    const called = await call(handle.url, session, 'cogmem_does_not_exist', {});
    expect(called.isError).toBe(true);
    expect(called.raw).toContain('cogmem_does_not_exist');
  });

  test('a removed shared-memory tool is rejected as missing, not as profile-restricted', async () => {
    // #68: this server runs the admin profile, which is the widest surface a
    // caller can reach without a token. The old answer here was
    // `tool_not_in_profile`, which reads as "widen the profile and it appears".
    const handle = await start();
    const session = await connect(handle.url);
    const called = await call(handle.url, session, 'cogmem_shared_publish', {
      items: [{ itemHash: 'no-such-tool', collection: 'team' }],
    });
    expect(called.isError).toBe(true);
    expect(called.raw).toContain('tool_not_found');
    expect(called.raw).not.toContain('tool_not_in_profile');
  });

  test('a missing required argument is reported with the field name', async () => {
    const handle = await start();
    const session = await connect(handle.url);
    const called = await call(handle.url, session, 'cogmem_episode_seal', {});
    expect(called.isError).toBe(true);
    expect(called.raw).toContain('projectId');
  });

  test('recall on an empty project answers instead of throwing', async () => {
    const handle = await start();
    const session = await connect(handle.url);
    const recalled = await call(handle.url, session, 'cogmem_recall', {
      query: 'anything at all',
      agentId: 'exec-agent',
      projectId: 'empty-project',
    });
    expect(recalled.isError).toBe(false);
    expect(recalled.body).toBeTruthy();
  });
});

describe('project isolation', () => {
  test('a memory written to one project never appears in another', async () => {
    const handle = await start();
    const session = await connect(handle.url);
    const secret = 'isolation-canary-9371';

    const written = await call(handle.url, session, 'cogmem_remember_turn', {
      userText: `tenant A keeps ${secret} in this project only`,
      sessionId: 'iso-session',
      agentId: 'iso-agent',
      projectId: 'tenant-a',
    });
    expect(written.isError).toBe(false);

    const inA = await call(handle.url, session, 'cogmem_recall', {
      query: `what is stored as ${secret}`,
      agentId: 'iso-agent',
      projectId: 'tenant-a',
    });
    expect(inA.isError).toBe(false);
    expect(JSON.stringify(inA.body.items)).toContain(secret);

    const inB = await call(handle.url, session, 'cogmem_recall', {
      query: `what is stored as ${secret}`,
      agentId: 'iso-agent',
      projectId: 'tenant-b',
    });
    expect(inB.isError).toBe(false);
    expect(JSON.stringify(inB.body.items ?? [])).not.toContain(secret);
  });

  test('a project-bound connection cannot read another project even with a query that names it', async () => {
    const handle = await start();
    const session = await connect(handle.url);
    const secret = 'bound-canary-5520';

    await call(handle.url, session, 'cogmem_remember_turn', {
      userText: `tenant A secret ${secret}`,
      sessionId: 'iso-session-2',
      agentId: 'iso-agent',
      projectId: 'tenant-a',
    });

    const bound = await startBound('tenant-b');
    const boundSession = await connect(bound.url);
    const recalled = await call(bound.url, boundSession, 'cogmem_recall', {
      query: `tenant A secret ${secret}`,
      agentId: 'iso-agent',
    });
    expect(recalled.isError).toBe(false);
    expect(recalled.body.projectId).toBe('tenant-b');
    expect(JSON.stringify(recalled.body.items ?? [])).not.toContain(secret);
  });
});

describe('durability', () => {
  test('remembered turns survive a server restart', async () => {
    const first = await start();
    const before = await connect(first.url);
    const marker = 'durable-quartz-77';

    const written = await call(first.url, before, 'cogmem_remember_turn', {
      userText: `The restart check keeps ${marker} in the raw ledger.`,
      assistantText: 'Recorded.',
      sessionId: 'durable-session',
      agentId: 'durable-agent',
      projectId: 'durable-project',
      ingestMode: 'raw_archive_only',
    });
    expect(written.isError).toBe(false);
    first.stop();

    const second = await start();
    const after = await connect(second.url);

    const recalled = await call(second.url, after, 'cogmem_recall', {
      query: `what is kept as ${marker}`,
      agentId: 'durable-agent',
      projectId: 'durable-project',
    });
    expect(recalled.isError).toBe(false);
    expect(recalled.raw).toContain(marker);
  });
});

describe('--db path handling', () => {
  test('a missing parent directory is created instead of failing to open', async () => {
    const nested = join(scratch, 'deep', 'nested', 'dirs', 'memory.db');
    expect(existsSync(join(scratch, 'deep'))).toBe(false);

    const handle = await startCogmemMcpHttpServer(
      { dbPath: nested, cwd: scratch },
      { port: 0, profile: 'core', hostId: 'dir-test' },
    );
    handles.push(handle);

    expect(existsSync(nested)).toBe(true);
    const session = await connect(handle.url);
    const listed = await rpc(handle.url, { jsonrpc: '2.0', id: 30, method: 'tools/list' }, session);
    expect(listed.status).toBe(200);
    expect(listed.json.result.tools.length).toBe(CORE_TOOLS.length);
  });
});
