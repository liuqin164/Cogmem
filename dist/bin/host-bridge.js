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
import { KernelAgentMemoryBackend } from '../agent/AgentMemoryBackend.js';
import { createMemoryKernelFromConfig } from '../factory.js';
import { recallForHost, rememberForHost } from '../host/bridge/HostBridge.js';
import { formatStrategyContext } from '../strategy/StrategyContextFormatter.js';
function readArg(name) {
    const index = process.argv.indexOf(name);
    if (index < 0)
        return undefined;
    const value = process.argv[index + 1];
    return value && !value.startsWith('--') ? value : undefined;
}
function fail(message) {
    console.error(`cogmem-host-bridge: ${message}`);
    process.exit(1);
}
const command = process.argv[2];
if (command !== 'recall' && command !== 'remember') {
    fail(`expected "recall" or "remember", got ${command === undefined ? 'nothing' : JSON.stringify(command)}`);
}
// A host that does not name itself would have its turns recorded under whatever
// default we picked, and the store would lie about where memory came from.
const hostId = readArg('--host');
if (!hostId)
    fail('--host <id> is required: the adapter names itself, this tool never guesses');
const identity = {
    agentId: readArg('--agent') ?? hostId,
    projectId: readArg('--project') ?? 'default',
    sessionId: readArg('--session') ?? `${hostId}-session`,
    memorySource: readArg('--source') ?? `${hostId}-plugin`,
    pluginId: readArg('--plugin-id'),
};
const stdinText = await new Response(Bun.stdin.stream()).text();
let request = {};
if (stdinText.trim()) {
    try {
        request = JSON.parse(stdinText);
    }
    catch (error) {
        fail(`stdin is not JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
}
// Flags win, so a host can bind a session once and keep it out of every payload.
if (identity.projectId === 'default' && typeof request.projectId === 'string')
    identity.projectId = request.projectId;
if (identity.sessionId.endsWith('-session') && typeof request.sessionId === 'string')
    identity.sessionId = request.sessionId;
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
}
catch (error) {
    fail(error instanceof Error ? error.message : String(error));
}
finally {
    try {
        kernel.close();
    }
    catch { /* the response is already written */ }
}
