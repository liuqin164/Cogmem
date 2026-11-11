import { expect, describe, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAgentRegistry, registerAgent, resolveAgentRegistryPath } from '../src/agent/AgentRegistry.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #80: a registration is found by the reader that needs it, and a credential
 * that cannot be identified is refused.
 *
 * `init --scope project --register-agent` writes `<workspace>/.cogmem/agents.json`,
 * while the resident readers looked only beside the home directory. The reader
 * therefore found nothing, concluded "single agent", and served a *registered*
 * agent as an unregistered one — no credential demanded and no project
 * confinement. That is the failure direction ADR-0006 exists to close, and the
 * one acceptance criterion here that is a security property.
 *
 * The refusal has to stay distinguishable from "no registry is configured": a
 * machine with one agent and no registry is supported, and a client that presents
 * no credential must still be served.
 */
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const bridgeBin = join(coreRoot, 'src/bin/host-bridge.ts');
const observatoryBin = join(coreRoot, 'src/bin/observatory.ts');
const initBin = join(coreRoot, 'src/bin/init.ts');

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
  test('the resident refuses to start instead of serving everyone as anonymous', async () => {
    const scratch = makeTempDir('cogmem-registry-missing-');
    const proc = Bun.spawn({
      cmd: ['bun', observatoryBin, '--agents', join(scratch, 'agents.json'), '--port', '7599'],
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
