import { afterAll, describe, expect, test } from 'bun:test';

import { startCogmemMcpHttpServer } from '../src/mcp/http.js';
import { createAgentRegistry, digest } from '../src/mcp/AgentRegistry.js';
import { makeTempDir } from './helpers/tmp.js';
import { connect, rpc } from './helpers/mcp-http.js';

/**
 * `--token` and `--agents` both gate the same Authorization header, and a
 * registry gives every agent its own credential — so no single value can satisfy
 * both checks. Configuring both used to answer 401 to everything. The registry
 * wins; this file pins that precedence.
 */

const scratch = makeTempDir('cogmem-http-auth-combo-');
const handles: Awaited<ReturnType<typeof startCogmemMcpHttpServer>>[] = [];

const AGENT_A_TOKEN = 'agent-a-secret-token-123456789012345678901234';
const AGENT_A = { hostId: 'agent-a', tokenDigest: digest(AGENT_A_TOKEN), projectId: 'proj-a', profile: 'admin' as const };
const GLOBAL_TOKEN = 'global-secret-token-098765432109876543210987';

async function startServer(options: { agents?: boolean; globalToken?: boolean } = {}) {
  const handle = await startCogmemMcpHttpServer(
    { dbPath: `${scratch}/memory-${handles.length}.db`, cwd: scratch },
    {
      port: 0,
      profile: 'admin',
      hostId: 'resident-server',
      agents: options.agents ? createAgentRegistry([AGENT_A]) : undefined,
      token: options.globalToken ? GLOBAL_TOKEN : undefined,
    },
  );
  handles.push(handle);
  return handle;
}

afterAll(() => {
  for (const handle of handles) handle.stop();
});

describe('HTTP auth: --token + --agents combination', () => {
  test('agents registry only: accepts a registered credential, refuses an unknown one', async () => {
    const handle = await startServer({ agents: true });
    expect(await connect(handle.url, { token: AGENT_A_TOKEN })).toBeTruthy();

    const denied = await rpc(handle.url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { token: 'unknown-token' });
    expect(denied.status).toBe(401);
  });

  test('both configured: the registry wins and the global token is refused', async () => {
    const handle = await startServer({ agents: true, globalToken: true });

    expect(await connect(handle.url, { token: AGENT_A_TOKEN })).toBeTruthy();

    // The global token authenticates nothing once a registry is loaded: it would
    // otherwise be a second path that skips per-agent identity (ADR-0006).
    const denied = await rpc(handle.url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { token: GLOBAL_TOKEN });
    expect(denied.status).toBe(401);
  });

  test('no token and no registry: loopback stays open', async () => {
    const handle = await startServer({});
    const session = await connect(handle.url);
    const listed = await rpc(handle.url, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { sessionId: session });
    expect(listed.status).toBe(200);
  });
});
