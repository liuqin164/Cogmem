import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAgentRegistry, registerAgent, resolveAgentRegistryPath } from '../src/mcp/AgentRegistry.js';
import { callTool } from './helpers/mcp-http.js';
import { startCogmemMcpHttpServer, type CogmemMcpHttpHandle } from '../src/mcp/http.js';
import { makeTempDir } from './helpers/tmp.js';
import { connect, initializeRequest, rpc } from './helpers/mcp-http.js';

/**
 * #80: a registration is found by the reader that needs it, and a credential
 * that cannot be identified is refused.
 *
 * `init --scope project --register-agent` writes `<workspace>/.cogmem/agents.json`,
 * while `cogmem mcp` and `cogmem-host-bridge` looked only beside the home
 * directory. The reader therefore found nothing, concluded "single agent", and
 * served a *registered* agent as an unregistered one — no credential demanded and
 * no project confinement. That is the failure direction ADR-0006 exists to close,
 * and the one acceptance criterion here that is a security property.
 *
 * The refusal has to stay distinguishable from "no registry is configured": a
 * machine with one agent and no registry is supported, and a client that presents
 * no credential must still be served.
 */
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const bridgeBin = join(coreRoot, 'src/bin/host-bridge.ts');
const mcpBin = join(coreRoot, 'src/bin/mcp.ts');
const initBin = join(coreRoot, 'src/bin/init.ts');

const handles: CogmemMcpHttpHandle[] = [];
afterAll(() => {
  for (const handle of handles) handle.stop();
});

/** A Workspace with a config, and a home of its own so nothing leaks between cases. */
function makeWorkspace(prefix: string, homeName = 'home'): { root: string; home: string; configPath: string; registryPath: string } {
  const root = makeTempDir(prefix);
  const home = join(root, homeName);
  const configPath = join(root, '.cogmem', 'config.toml');
  mkdirSync(dirname(configPath), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
  return { root, home, configPath, registryPath: join(root, '.cogmem', 'agents.json') };
}

async function startServer(registryPath: string | undefined, dbPath: string): Promise<CogmemMcpHttpHandle> {
  const handle = await startCogmemMcpHttpServer(
    { kernel: undefined, dbPath },
    { port: 0, agents: registryPath ? loadAgentRegistry(registryPath) : undefined },
  );
  handles.push(handle);
  return handle;
}

function bridge(args: string[], stdin: string, home: string) {
  const proc = Bun.spawn({
    cmd: ['bun', bridgeBin, ...args],
    cwd: coreRoot,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    // HOME is set explicitly: otherwise "no registry anywhere" would be whatever
    // the developer happens to have in `~/.cogmem/agents.json`, which is the
    // documented way to turn this suite green for the wrong reason.
    env: { ...process.env, NO_COLOR: '1', HOME: home },
  });
  proc.stdin.write(stdin);
  void proc.stdin.end();
  return Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
}

describe('where a registry is read from', () => {
  test('the Workspace first, then beside the home directory, and neither is a refusal', () => {
    const ws = makeWorkspace('cogmem-registry-lookup-');
    const elsewhere = makeTempDir('cogmem-registry-elsewhere-');
    const env = { HOME: ws.home };

    // Nothing anywhere. That is "no registry configured" — the supported
    // single-agent case, and a different answer from a refused credential.
    expect(resolveAgentRegistryPath({ cwd: elsewhere, env }).path).toBeUndefined();

    // What `init --scope project --register-agent` writes.
    registerAgent({ path: ws.registryPath, hostId: 'bot-ws', projectId: 'proj-ws' });
    expect(resolveAgentRegistryPath({ cwd: elsewhere, configPath: ws.configPath, env }))
      .toEqual({ path: ws.registryPath, explicit: false });

    // An existing home-scoped registry keeps working unchanged, and the
    // Workspace is preferred when both exist.
    const homeRegistry = join(ws.home, '.cogmem', 'agents.json');
    registerAgent({ path: homeRegistry, hostId: 'bot-home', projectId: 'proj-home' });
    expect(resolveAgentRegistryPath({ cwd: elsewhere, configPath: ws.configPath, env }).path).toBe(ws.registryPath);
    expect(resolveAgentRegistryPath({ cwd: elsewhere, env }).path).toBe(homeRegistry);

    // A `.cogmem/` that holds a registry but no config is still where its readers
    // look: `init --register-agent` writes there and deliberately does not create a
    // config, and the Workspace above is derived from a config (GLOSSARY: the
    // Workspace is identified by the `.cogmem/` it contains).
    const proj = makeTempDir('cogmem-registry-noconfig-');
    const projRegistry = join(proj, '.cogmem', 'agents.json');
    mkdirSync(dirname(projRegistry), { recursive: true });
    registerAgent({ path: projRegistry, hostId: 'bot-proj', projectId: 'proj-only' });
    const globalHome = join(makeTempDir('cogmem-registry-globalhome-'), 'home');
    mkdirSync(join(globalHome, '.cogmem'), { recursive: true });
    writeFileSync(join(globalHome, '.cogmem', 'config.toml'), '[core]\ndb_path = "memory.db"\n');
    expect(resolveAgentRegistryPath({ cwd: proj, env: { HOME: globalHome } }).path).toBe(projRegistry);

    // A named path is taken as named.
    expect(resolveAgentRegistryPath({ explicit: homeRegistry, cwd: elsewhere, env }))
      .toEqual({ path: homeRegistry, explicit: true });
  });
});

describe('the MCP server reads the registry its Workspace has', () => {
  test('a credential registered under the Workspace is accepted, and an unknown one is not', async () => {
    const ws = makeWorkspace('cogmem-registry-mcp-ws-');
    const elsewhere = makeTempDir('cogmem-registry-mcp-elsewhere-');
    const created = registerAgent({ path: ws.registryPath, hostId: 'bot-ws', projectId: 'proj-ws' });

    // Exactly what `cogmem mcp --config <the workspace config>` resolves, from a
    // directory that is not the Workspace: the reader is not required to stand in
    // it, only to know it.
    const lookup = resolveAgentRegistryPath({ cwd: elsewhere, configPath: ws.configPath, env: { HOME: ws.home } });
    expect(lookup.path).toBe(ws.registryPath);
    const url = (await startServer(lookup.path, join(ws.root, 'memory.db'))).url;

    const sessionId = await connect(url, { token: created.token });
    expect(sessionId).toBeTruthy();
    const unknown = await rpc(url, initializeRequest, { token: 'not-a-registered-credential' });
    expect(unknown.status).toBe(401);
  });

  test('a session cannot be ridden by another agent\'s credential', async () => {
    const ws = makeWorkspace('cogmem-registry-session-');
    const first = registerAgent({ path: ws.registryPath, hostId: 'bot-a', projectId: 'proj-a', profile: 'full' });
    const second = registerAgent({ path: ws.registryPath, hostId: 'bot-b', projectId: 'proj-b', profile: 'core' });
    const url = (await startServer(ws.registryPath, join(ws.root, 'memory.db'))).url;

    const sessionA = await connect(url, { token: first.token });
    // The session's server was built with A's hostId and project. Riding it with
    // B's (perfectly valid) credential would serve B as A — one agent reading
    // another's memory with its own credential.
    const replay = await callTool(url, sessionA, 'cogmem_recall', { query: 'anything' }, { token: second.token });
    expect(replay.status).toBe(401);
    expect(replay.raw).toContain('this session belongs to another agent');

    // The owner can still use it, and B keeps its own session.
    const own = await rpc(url, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }, { sessionId: sessionA, token: first.token });
    expect(own.status).toBe(200);
    const sessionB = await connect(url, { token: second.token });
    expect(sessionB).not.toBe(sessionA);
  });

  test('a credential with no registry anywhere is refused, not served unauthenticated', async () => {
    const scratch = makeTempDir('cogmem-registry-none-');
    const url = (await startServer(undefined, join(scratch, 'memory.db'))).url;

    const refused = await rpc(url, initializeRequest, { token: 'borrowed' });
    // Named so a reader can tell it from "no registry configured": the refusal is
    // about the credential, not about the install.
    expect(refused.status).toBe(401);
    expect(refused.text).toContain('no agent registry was found');

    // And no credential at all is still the supported single-agent case.
    expect(await connect(url)).toBeTruthy();
  });
});

describe('the host bridge searches the same places', () => {
  test('a Workspace-scoped credential is found from an unrelated directory', async () => {
    const ws = makeWorkspace('cogmem-registry-bridge-ws-');
    const created = registerAgent({ path: ws.registryPath, hostId: 'bot-ws', projectId: 'proj-ws' });

    const result = await bridge(
      ['recall', '--config', ws.configPath, '--token', created.token],
      JSON.stringify({ query: 'anything' }),
      ws.home,
    );
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).ok).toBe(true);
  });

  test('a credential with no registry is refused, and no credential stays single-agent', async () => {
    const ws = makeWorkspace('cogmem-registry-bridge-none-');
    const scratch = makeTempDir('cogmem-registry-bridge-elsewhere-');
    const configPath = join(scratch, '.cogmem', 'config.toml');
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');

    const refused = await bridge(
      ['recall', '--config', configPath, '--token', 'borrowed', '--host', 'someone'],
      JSON.stringify({ query: 'anything' }),
      ws.home,
    );
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('a credential was presented but no agent registry was found');

    // Single-agent is unchanged: no credential, the host names itself.
    const single = await bridge(
      ['remember', '--config', configPath, '--host', 'hermes', '--project', 'proj-single'],
      JSON.stringify({ userText: 'a turn', assistantText: 'an answer' }),
      ws.home,
    );
    expect(single.exitCode).toBe(0);

    // A Workspace registry that exists still wins over the refusal above.
    registerAgent({ path: ws.registryPath, hostId: 'bot-ws', projectId: 'proj-ws' });
    expect(resolveAgentRegistryPath({ configPath: ws.configPath, env: { HOME: ws.home } }).path).toBe(ws.registryPath);
  });
});

describe('the stdio transport enforces the registry too', () => {
  const STDIO_INPUT = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    '',
  ].join('\n');

  function stdio(args: string[], env: Record<string, string | undefined>) {
    const proc = Bun.spawn({
      cmd: ['bun', mcpBin, ...args],
      cwd: coreRoot,
      stdin: new Blob([STDIO_INPUT]),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NO_COLOR: '1', COGMEM_AGENT_TOKEN: undefined, ...env },
    });
    return Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
      .then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
  }

  test('a registered credential decides the identity, and no credential is refused', async () => {
    const ws = makeWorkspace('cogmem-registry-stdio-');
    const created = registerAgent({ path: ws.registryPath, hostId: 'bot-ws', projectId: 'proj-ws', profile: 'admin' });
    const dbPath = join(ws.root, 'memory.db');

    // No credential: a registry means identities exist, and a connection that has
    // not established one is not served with project access.
    const refused = await stdio(['--agents', ws.registryPath, '--db', dbPath], {});
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('agent_credential_required');

    // With the agent's credential the registration is the ceiling: the profile
    // comes from the registry, not from the command line's default.
    const applied = await stdio(['--agents', ws.registryPath, '--db', dbPath], { COGMEM_AGENT_TOKEN: created.token });
    expect(applied.exitCode).toBe(0);
    expect(applied.stdout).toContain('cogmem_dream_tick');

    // And with *no* registry, a presented credential is refused here as it is on
    // HTTP and in the bridge: three readers, one answer.
    const emptyHome = makeTempDir('cogmem-registry-stdio-nohome-');
    const unnamed = await stdio(
      ['--db', join(emptyHome, 'memory.db')],
      { HOME: emptyHome, COGMEM_AGENT_TOKEN: 'borrowed' },
    );
    expect(unnamed.exitCode).toBe(1);
    expect(unnamed.stderr).toContain('agent_registry_not_found');
  });
});

describe('the writer and the readers agree where the registry goes', () => {
  test('a registration made from a subdirectory lands beside the config its readers read', async () => {
    const ws = makeWorkspace('cogmem-registry-subdir-');
    const sub = join(ws.root, 'sub');
    mkdirSync(sub, { recursive: true });

    const registered = Bun.spawn({
      cmd: ['bun', initBin, '--scope', 'project', '--register-agent', 'bot-sub', '--json'],
      cwd: sub,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NO_COLOR: '1', HOME: ws.home },
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(registered.stdout).text(),
      new Response(registered.stderr).text(),
      registered.exited,
    ]);
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    const credential = JSON.parse(stdout).registeredAgents[0].token as string;

    // Where the readers derive the Workspace from — not `<sub>/.cogmem/`, which no
    // reader would look in.
    expect(resolveAgentRegistryPath({ cwd: ws.root, configPath: ws.configPath, env: { HOME: ws.home } }).path)
      .toBe(ws.registryPath);
    expect(loadAgentRegistry(ws.registryPath)?.resolve(credential)?.hostId).toBe('bot-sub');
  });
});

describe('a named registry that cannot be read', () => {
  test('the MCP server refuses to start instead of serving everyone as anonymous', async () => {
    const scratch = makeTempDir('cogmem-registry-missing-');
    const proc = Bun.spawn({
      cmd: ['bun', mcpBin, '--agents', join(scratch, 'agents.json')],
      cwd: coreRoot,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, NO_COLOR: '1' },
    });
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('agent_registry_not_found');
  });
});
