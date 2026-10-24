import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createSqlitePorts } from '../src/adapters/sqlite/SqliteMemoryPorts.js';
import { callCogmemMcpTool, listCogmemMcpTools } from '../src/mcp/CoreMcpTools.js';
import {
  ADMIN_TOOLS,
  CORE_TOOLS,
  filterToolsByProfile,
  type McpToolProfile,
} from '../src/mcp/profiles.js';
import { startCogmemMcpHttpServer, type CogmemMcpHttpHandle } from '../src/mcp/http.js';

/**
 * #68: 4.0 does not ship shared memory.
 *
 * The shared region (`SqliteSharedMemory` behind `SharedMemoryPort`) stays in
 * the tree for 4.1, but 4.0 must not reach it from any public entry. Two
 * things are asserted here, and the second is the one that has teeth:
 *
 * 1. no profile registers a shared-memory tool, and
 * 2. a call to one answers "this tool does not exist" rather than "your
 *    profile hides it".
 *
 * The second matters because "not in this profile" reads as *widen the profile
 * and it appears*: on a 4.0 server that instruction is false, and following it
 * lands an operator on `--profile full` expecting a capability the release
 * deliberately withheld. A tool that is in no registry can never be reached by
 * any profile, so the accurate answer is the one an unknown name gets.
 *
 * A fresh 4.0 database is also asserted to carry no `shared_items` table: the
 * kernel used to create it as a side effect of constructing a shared region the
 * server never went on to use.
 */

const SHARED_PREFIX = 'cogmem_shared_';
const PROFILES: McpToolProfile[] = ['core', 'admin', 'full'];

const scratch = mkdtempSync(join(tmpdir(), 'cogmem-mcp-shared-removed-'));
const handles: CogmemMcpHttpHandle[] = [];

afterAll(() => {
  for (const handle of handles) handle.stop();
  rmSync(scratch, { recursive: true, force: true });
});

/** Any table whose name mentions sharing: 4.0 should have created none. */
function sharedTables(db: Database): string[] {
  return (db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%shared%'",
  ).all() as Array<{ name: string }>).map((row) => row.name);
}

async function startServer(options: { profile?: McpToolProfile; dbPath?: string } = {}): Promise<CogmemMcpHttpHandle> {
  const handle = await startCogmemMcpHttpServer(
    { dbPath: options.dbPath ?? join(scratch, 'memory.db'), cwd: scratch },
    { port: 0, profile: options.profile ?? 'core', hostId: 'shared-removal-test' },
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
    json: response.ok ? parseRpcBody(response.headers.get('content-type'), text) : null,
  };
}

async function connect(url: string): Promise<string> {
  const init = await rpc(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'shared-removal-test', version: '1' } },
  });
  expect(init.status).toBe(200);
  return init.sessionId as string;
}

async function callTool(url: string, sessionId: string, name: string, args: object = {}) {
  const response = await rpc(url, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name, arguments: args },
  }, sessionId);
  const result = response.json.result;
  const text = result.content[0].text as string;
  return { isError: result.isError === true, body: text.startsWith('{') ? JSON.parse(text) : text, raw: text };
}

async function listTools(url: string, sessionId: string): Promise<string[]> {
  const listed = await rpc(url, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }, sessionId);
  expect(listed.status).toBe(200);
  return (listed.json.result.tools as Array<{ name: string }>).map((tool) => tool.name);
}

describe('#68 no profile registers a shared-memory tool', () => {
  test('the shipped registry contains no cogmem_shared_ tool', () => {
    const shared = listCogmemMcpTools()
      .map((tool) => tool.name)
      .filter((name) => name.startsWith(SHARED_PREFIX));
    expect(shared).toEqual([]);
  });

  test('every profile filters the shared tools out rather than hiding them behind a widening hint', () => {
    const all = listCogmemMcpTools();
    for (const profile of PROFILES) {
      const shared = filterToolsByProfile(profile, all)
        .map((tool) => tool.name)
        .filter((name) => name.startsWith(SHARED_PREFIX));
      expect({ profile, shared }).toEqual({ profile, shared: [] });
    }
  });

  test('the profile constants themselves name no shared tool', () => {
    const shared = [...CORE_TOOLS, ...ADMIN_TOOLS].filter((name) => name.startsWith(SHARED_PREFIX));
    expect(shared).toEqual([]);
  });

  test('tools/list offers no shared tool on any profile', async () => {
    for (const profile of PROFILES) {
      const handle = await startServer({ profile });
      const sessionId = await connect(handle.url);
      const offered = (await listTools(handle.url, sessionId)).filter((name) => name.startsWith(SHARED_PREFIX));
      expect({ profile, offered }).toEqual({ profile, offered: [] });
    }
  });
});

describe('#68 a shared-memory call answers "no such tool"', () => {
  // The four names the release removed. Spelled out here because this is the
  // caller-visible set an operator or a stale host config would still hold.
  const REMOVED = [
    'cogmem_shared_publish',
    'cogmem_shared_retract',
    'cogmem_shared_subscribe',
    'cogmem_shared_explain',
  ];

  test('the direct dispatcher has no cogmem_shared_ prefix branch', async () => {
    const result = await callCogmemMcpTool('cogmem_shared_publish', {
      items: [{ itemHash: 'nope', collection: 'nope' }],
    }, {});
    expect(result.isError).toBe(true);
    const body = result.structuredContent as { error?: string };
    expect(body.error).toContain('Unknown cogmem MCP tool');
  });

  test('admin and full report tool_not_found, never tool_not_in_profile', async () => {
    for (const profile of ['admin', 'full'] as McpToolProfile[]) {
      const handle = await startServer({ profile });
      const sessionId = await connect(handle.url);
      for (const name of REMOVED) {
        const called = await callTool(handle.url, sessionId, name);
        const label = `${profile}:${name}`;
        expect({ label, isError: called.isError }).toEqual({ label, isError: true });
        expect({ label, namesToolNotFound: called.raw.includes('tool_not_found') })
          .toEqual({ label, namesToolNotFound: true });
        expect({ label, claimsProfileRestriction: called.raw.includes('tool_not_in_profile') })
          .toEqual({ label, claimsProfileRestriction: false });
      }
    }
  });

  test('a registered tool outside the profile still reports tool_not_in_profile', async () => {
    // The registry gate must not swallow the profile message for tools that do
    // exist: that message is accurate and actionable there.
    const handle = await startServer({ profile: 'core' });
    const sessionId = await connect(handle.url);
    const called = await callTool(handle.url, sessionId, 'cogmem_maintenance_tick');
    expect(called.isError).toBe(true);
    expect(called.raw).toContain('tool_not_in_profile');
  });
});

describe('#68 a fresh served database carries no shared-memory storage', () => {
  test('starting a server does not create the shared_items table', async () => {
    const dbPath = join(scratch, 'fresh-db', 'memory.db');
    const handle = await startServer({ profile: 'core', dbPath });
    await connect(handle.url);
    handle.stop();

    const db = new Database(dbPath, { readonly: true });
    try {
      expect(sharedTables(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  test('the SQLite port bundle does not create a shared region on its own', () => {
    // The last default-creation site: a caller that never mentioned sharing
    // used to get a region constructed for it, which made the table exist.
    const dbPath = join(scratch, 'ports', 'memory.db');
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    try {
      expect(createSqlitePorts({ db }).shared).toBeNull();
      expect(sharedTables(db)).toEqual([]);
    } finally {
      db.close();
    }
  });
});
