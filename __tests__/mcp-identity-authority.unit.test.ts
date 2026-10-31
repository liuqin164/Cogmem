import { afterAll, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { startCogmemMcpHttpServer, type CogmemMcpHttpHandle } from '../src/mcp/http.js';
import { createAgentRegistry, digest } from '../src/mcp/AgentRegistry.js';
import { createMemoryKernel } from '../src/factory.js';
import { callCogmemMcpTool } from '../src/mcp/CoreMcpTools.js';
import { makeTempDir } from './helpers/tmp.js';
import { callTool, connect } from './helpers/mcp-http.js';

/**
 * #92, decided direction ①: the connection's identity is the only authority.
 *
 * The defect it closes: a host that supplies its own `agentId` (pi sends
 * `pi:default`) had its turns written under that id, while the same connection's
 * recall derived `agentId` from the project. `isAgentRawEvent()` then rejected the
 * connection's own memory, so `memory recall` returned nothing and only an explicit
 * `--agent pi:default` could find it.
 *
 * The direction that was rejected is worth stating here, because these tests are what
 * keeps it rejected: widening recall to "every agent in this project" would also make
 * the pi case pass, and would let two agents sharing a project read each other's
 * private memory. Project scope is not a sharing permission (ADR-0006, ADR-0009).
 */

const scratch = makeTempDir('cogmem-identity-authority-');
const handles: CogmemMcpHttpHandle[] = [];
const TOKEN_A = '{{SECRET_ida}}';
const TOKEN_B = '{{SECRET_idb}}';
const AGENT_A = { hostId: 'agent-a', tokenDigest: digest(TOKEN_A), projectId: 'shared-project', profile: 'admin' as const };
const AGENT_B = { hostId: 'agent-b', tokenDigest: digest(TOKEN_B), projectId: 'shared-project', profile: 'admin' as const };

afterAll(() => {
  for (const handle of handles) handle.stop();
  rmSync(scratch, { recursive: true, force: true });
});

async function startServer(): Promise<CogmemMcpHttpHandle> {
  const dbPath = join(scratch, `memory-${handles.length}.db`);
  const handle = await startCogmemMcpHttpServer(
    { dbPath, cwd: scratch },
    {
      port: 0,
      host: '127.0.0.1',
      agents: createAgentRegistry([AGENT_A, AGENT_B]),
      // Both agents share one project on purpose: the isolation under test is per
      // agent, not per project.
      projectId: 'shared-project',
      profile: 'admin',
    } as never,
  );
  handles.push(handle);
  return handle;
}

test('#92 a write under a client-supplied agentId is recallable by the same connection', async () => {
  const handle = await startServer();
  const session = await connect(handle.url, { token: TOKEN_A });

  // pi's shape: it sends its own agentId. Whatever happens to that value, the
  // connection must be able to read back what it wrote without naming it again.
  const write = await callTool(handle.url, session, 'cogmem_remember_turn', {
    agentId: 'pi:default',
    userText: 'the quokka release ships on Saturdays',
  }, { token: TOKEN_A });
  expect(write.isError).toBe(false);

  const recalled = await callTool(handle.url, session, 'cogmem_recall', {
    query: 'when does the quokka release ship',
  }, { token: TOKEN_A });
  expect(recalled.isError).toBe(false);
  // Assertion on items, not the body: the response echoes the query.
  expect(JSON.stringify(recalled.body.items)).toContain('quokka');
});

test('#92 a client-supplied agentId cannot reach another agent\'s memory', async () => {
  const handle = await startServer();
  const sessionA = await connect(handle.url, { token: TOKEN_A });
  const sessionB = await connect(handle.url, { token: TOKEN_B });

  await callTool(handle.url, sessionA, 'cogmem_remember_turn', {
    userText: 'agent A private fact about the ocelot',
  }, { token: TOKEN_A });

  // B claims to be A by argument, and by the identity header. Neither may work: the
  // credential is the authority (ADR-0006).
  const forged = await callTool(handle.url, sessionB, 'cogmem_recall', {
    query: 'agent A private fact about the ocelot',
    agentId: 'agent-a',
  }, { token: TOKEN_B, identity: { hostId: 'agent-a' } });
  expect(JSON.stringify(forged.body.items ?? [])).not.toContain('ocelot');
});

test('#92 two agents sharing one project cannot read each other by default', async () => {
  const handle = await startServer();
  const sessionA = await connect(handle.url, { token: TOKEN_A });
  const sessionB = await connect(handle.url, { token: TOKEN_B });

  await callTool(handle.url, sessionA, 'cogmem_remember_turn', {
    userText: 'the marmot rollout is agent A private',
  }, { token: TOKEN_A });

  // B, with no arguments at all: default recall must not widen to the project.
  const bDefault = await callTool(handle.url, sessionB, 'cogmem_recall', {
    query: 'when is the marmot rollout',
  }, { token: TOKEN_B });
  expect(JSON.stringify(bDefault.body.items ?? [])).not.toContain('marmot');

  // A still sees its own.
  const aDefault = await callTool(handle.url, sessionA, 'cogmem_recall', {
    query: 'when is the marmot rollout',
  }, { token: TOKEN_A });
  expect(JSON.stringify(aDefault.body.items ?? [])).toContain('marmot');
});

test('#92 legacy rows written under a client-supplied id stay readable by that connection', async () => {
  const dir = makeTempDir('cogmem-identity-legacy-');
  const dbPath = join(dir, 'memory.db');
  const kernel = createMemoryKernel({ dbPath });

  // A row written before this fix: agentId came from the caller, so the source id is
  // `pi:default:s-1` while the connection is `pi-cand`. It must not become invisible.
  const { KernelAgentMemoryBackend } = await import('../src/agent/AgentMemoryBackend.js');
  await new KernelAgentMemoryBackend(kernel).rememberTurnWithResult({
    agentId: 'pi:default',
    projectId: 'pi-cand',
    sessionId: 's-1',
    userText: 'the legacy wombat fact',
  });

  // Reading through the connection that would have written it today.
  const recalled = await callCogmemMcpTool('cogmem_recall', {
    projectId: 'pi-cand',
    query: 'the legacy wombat fact',
  }, { kernel, hostId: 'pi:default' });
  expect(JSON.stringify((recalled as { content: { text: string }[] }).content[0]!.text)).toContain('wombat');
  kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

test('#92 a single-agent install with no host name still writes and recalls', async () => {
  const dir = makeTempDir('cogmem-identity-single-');
  const dbPath = join(dir, 'memory.db');
  const kernel = createMemoryKernel({ dbPath });

  // No hostId, no agentId, no credentials: the plain stdio case that must not regress.
  const write = await callCogmemMcpTool('cogmem_remember_turn', {
    projectId: 'solo',
    sessionId: 's-1',
    userText: 'the single agent capybara fact',
  }, { kernel });
  expect(JSON.parse(String((write as { content: { text: string }[] }).content[0]!.text)).ok).toBe(true);

  const recalled = await callCogmemMcpTool('cogmem_recall', {
    projectId: 'solo',
    query: 'the single agent capybara fact',
  }, { kernel });
  expect(JSON.stringify((recalled as { content: { text: string }[] }).content[0]!.text)).toContain('capybara');
  kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

test('#92 the write tools do not advertise identity the connection already supplies', () => {
  // The schema is what a model reads before deciding whether it *can* call a tool. While
  // `remember_turn` demanded agentId/projectId/sessionId, an agent that has none of them
  // declines to call it — measured with Hermes on the audit box: it ran its own `terminal`
  // tool but never touched `cogmem_remember_turn`, and the turn it was asked to store was
  // never written. Identity now comes from the connection, so the schema must say so.
  const { listCogmemMcpTools } = require('../src/mcp/CoreMcpTools.js');
  const tools = listCogmemMcpTools() as Array<{ name: string; inputSchema: { required?: string[]; properties: Record<string, unknown> } }>;
  const required = (name: string): string[] => tools.find((tool) => tool.name === name)!.inputSchema.required ?? [];

  // Only what the caller genuinely owns: the text of the turn.
  expect(required('cogmem_remember_turn')).toEqual(['userText']);
  // The message's own data, not the connection's.
  expect(required('cogmem_episode_append')).toEqual(['role', 'text', 'externalMessageId']);
  expect(required('cogmem_episode_import')).toEqual(['messages']);

  // They stay available as properties: an explicit caller may still send them, they are
  // simply no longer demanded, and they never override the connection.
  for (const name of ['cogmem_remember_turn', 'cogmem_episode_append', 'cogmem_episode_import']) {
    const properties = tools.find((tool) => tool.name === name)!.inputSchema.properties;
    for (const field of ['agentId', 'projectId', 'sessionId', 'sourceAgent']) {
      if (field in properties) expect(required(name)).not.toContain(field);
    }
  }
});
