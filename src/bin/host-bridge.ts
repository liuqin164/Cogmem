#!/usr/bin/env bun
/**
 * One host-agnostic entry point to the shared orchestration.
 *
 * A host that cannot import TypeScript — a Python plugin, a shell hook, a host
 * whose plugin API is not JavaScript — reaches Cogmem through this: one command
 * per turn, one JSON request on stdin, one JSON response on stdout. It is the
 * smallest thing that makes `recallForHost` / `rememberForHost` usable from a
 * second host, and it is deliberately not a daemon: a per-turn process is slower
 * but has no lifetime to manage, which is the right trade for a first adapter
 * (ADR-0004).
 *
 * The host names itself. Nothing here defaults to a host name, because a default
 * would silently record one host's turns as another's.
 *
 *   cogmem-host-bridge recall   --host <id> [--project <id>] [--session <id>]
 *   cogmem-host-bridge remember --host <id> [--project <id>] [--session <id>]
 *
 * Request (stdin JSON): `recall` takes `{ query, sessionId?, threadId?, … }`;
 * `remember` takes `{ userText, assistantText, sessionId?, toolCalls?, … }`.
 * Response (stdout JSON): `recall` returns `{ context, items, … }` where
 * `context` is the block to inject, empty when nothing surfaced; `remember`
 * returns the stored-turn result.
 */
import { existsSync } from 'node:fs';

import { KernelAgentMemoryBackend } from '../agent/AgentMemoryBackend.js';
import { createMemoryKernelFromConfig } from '../factory.js';
import { recallForHost, rememberForHost, type HostIdentity } from '../host/bridge/HostBridge.js';
import { formatStrategyContext } from '../strategy/StrategyContextFormatter.js';
import { loadAgentRegistry, resolveAgentRegistryPath } from '../mcp/AgentRegistry.js';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

function fail(message: string): never {
  console.error(`cogmem-host-bridge: ${message}`);
  process.exit(1);
}

const command = process.argv[2];
if (command !== 'recall' && command !== 'remember') {
  fail(`expected "recall" or "remember", got ${command === undefined ? 'nothing' : JSON.stringify(command)}`);
}

/**
 * Who this turn belongs to.
 *
 * With an agent registry the credential answers that, and `--host` may only
 * agree with it: a local process that starts this binary is otherwise free to
 * name itself any agent and write into that agent's memory, which is the same
 * self-declaration the MCP path stopped accepting (ADR-0006). Without a registry
 * there is one agent and the operator names it, so `--host` stays required —
 * a host that does not name itself would have its turns recorded under whatever
 * default we picked, and the store would lie about where memory came from.
 */
// Workspace first, then beside the home directory (ADR-0010): the registry
// `init --scope project --register-agent` wrote is found from the Workspace it
// was written under, which is the only place its readers were not looking (#80).
const registryLookup = resolveAgentRegistryPath({ explicit: readArg('--agents'), configPath: readArg('--config') });
if (registryLookup.explicit && registryLookup.path && !existsSync(registryLookup.path)) {
  fail(`--agents ${registryLookup.path} does not exist. A named registry that cannot be read is not the single-agent case.`);
}
const registry = registryLookup.path ? loadAgentRegistry(registryLookup.path) : undefined;
const credential = readArg('--token') ?? process.env.COGMEM_AGENT_TOKEN;
// A credential is a claim to an identity. With no registry there is nothing that
// can establish it, and answering the turn as an anonymous single agent is the
// fail-open direction ADR-0006 closed. No credential at all still means
// single-agent, which is a different statement (#80).
if (!registry && credential) {
  fail('a credential was presented but no agent registry was found for this workspace or home directory. Run cogmem init --register-agent <hostId>, or pass --agents <path>; a credential that cannot be identified is refused.');
}
const claimedHostId = readArg('--host');

let hostId: string;
let registeredProjectId: string | undefined;
if (registry) {
  const agent = registry.resolve(credential);
  if (!agent) {
    fail('this machine has a registered agent list, so a credential is required: pass --token <credential> or set COGMEM_AGENT_TOKEN');
  }
  if (claimedHostId && claimedHostId !== agent.hostId) {
    fail(`--host ${claimedHostId} disagrees with the credential, which speaks for ${agent.hostId}`);
  }
  const claimedAgentId = readArg('--agent');
  if (claimedAgentId && claimedAgentId !== agent.hostId) {
    fail(`--agent ${claimedAgentId} disagrees with the credential, which speaks for ${agent.hostId}`);
  }
  hostId = agent.hostId;
  registeredProjectId = agent.projectId;
} else {
  if (!claimedHostId) fail('--host <id> is required: the adapter names itself, this tool never guesses');
  hostId = claimedHostId;
}

// A registration confines the agent to one project, so `--project` may confirm
// it but never point somewhere else.
const claimedProjectId = readArg('--project');
if (registeredProjectId && claimedProjectId && claimedProjectId !== registeredProjectId) {
  fail(`--project ${claimedProjectId} is outside the registered scope of ${registeredProjectId}`);
}

const identity: HostIdentity = {
  agentId: readArg('--agent') ?? hostId,
  projectId: claimedProjectId ?? registeredProjectId ?? 'default',
  sessionId: readArg('--session') ?? `${hostId}-session`,
  memorySource: readArg('--source') ?? `${hostId}-plugin`,
  pluginId: readArg('--plugin-id'),
};

const stdinText = await new Response(Bun.stdin.stream()).text();
let request: Record<string, unknown> = {};
if (stdinText.trim()) {
  try {
    request = JSON.parse(stdinText) as Record<string, unknown>;
  } catch (error) {
    fail(`stdin is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
// Flags win, so a host can bind a session once and keep it out of every payload.
if (identity.projectId === 'default' && typeof request.projectId === 'string') identity.projectId = request.projectId;
if (identity.sessionId.endsWith('-session') && typeof request.sessionId === 'string') identity.sessionId = request.sessionId;

const kernel = createMemoryKernelFromConfig({ configPath: readArg('--config') });
try {
  const runtime = {
    kernel,
    memory: new KernelAgentMemoryBackend(kernel),
    formatStrategyContext,
  };
  const config = { agentId: identity.agentId, projectId: identity.projectId };
  const result = command === 'recall'
    ? await recallForHost(runtime, request, config, identity)
    : await rememberForHost(runtime, request, config, identity);
  console.log(JSON.stringify({ ok: true, command, result }));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  try { kernel.close(); } catch { /* the response is already written */ }
}
