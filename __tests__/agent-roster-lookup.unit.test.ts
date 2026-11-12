import { expect, describe, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadAgentRegistry,
  loadRegisteredAgents,
  parseAgentRegistry,
  resolveAgentRegistryPath,
} from '../src/agent/AgentRegistry.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #80 and R3 of #200: the registry is now a read-only family roster.
 *
 * What is asserted here is the whole difference from the credential register it used to be:
 * a roster is found by the reader that needs it (Workspace first, then home — ADR-0010), a
 * named roster that cannot be read is refused rather than read as "no roster", and a file the
 * old `init --register-agent` wrote still loads because its credential fields are ignored
 * instead of trusted. There is no token lookup left to assert a refusal against, so the
 * absence of the lookup is what the last case pins.
 */
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const observatoryBin = join(coreRoot, 'src/bin/observatory.ts');

/** A Workspace with a config, and a home of its own so nothing leaks between cases. */
function makeWorkspace(prefix: string, homeName = 'home'): { root: string; home: string; configPath: string; rosterPath: string } {
  const root = makeTempDir(prefix);
  const home = join(root, homeName);
  const configPath = join(root, '.cogmem', 'config.toml');
  mkdirSync(dirname(configPath), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\n');
  return { root, home, configPath, rosterPath: join(root, '.cogmem', 'agents.json') };
}

function writeRoster(path: string, entries: Array<Record<string, unknown>>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ agents: entries }, null, 2)}\n`);
}

describe('where a roster is read from', () => {
  test('the Workspace first, then beside the home directory, and neither is a refusal', () => {
    const ws = makeWorkspace('cogmem-roster-lookup-');
    const elsewhere = makeTempDir('cogmem-roster-elsewhere-');
    const env = { HOME: ws.home };

    // Nothing anywhere: no roster is configured, which is the supported single-agent case.
    expect(resolveAgentRegistryPath({ cwd: elsewhere, env }).path).toBeUndefined();

    writeRoster(ws.rosterPath, [{ hostId: 'bot-ws', projectId: 'proj-ws' }]);
    expect(resolveAgentRegistryPath({ cwd: elsewhere, configPath: ws.configPath, env }))
      .toEqual({ path: ws.rosterPath, explicit: false });

    // An existing home-scoped roster keeps working, and the Workspace is preferred when both exist.
    const homeRoster = join(ws.home, '.cogmem', 'agents.json');
    writeRoster(homeRoster, [{ hostId: 'bot-home', projectId: 'proj-home' }]);
    expect(resolveAgentRegistryPath({ cwd: elsewhere, configPath: ws.configPath, env }).path).toBe(ws.rosterPath);
    expect(resolveAgentRegistryPath({ cwd: elsewhere, env }).path).toBe(homeRoster);

    // A `.cogmem/` that holds a roster but no config is still where its readers look.
    const proj = makeTempDir('cogmem-roster-noconfig-');
    const projRoster = join(proj, '.cogmem', 'agents.json');
    writeRoster(projRoster, [{ hostId: 'bot-proj', projectId: 'proj-only' }]);
    const globalHome = join(makeTempDir('cogmem-roster-globalhome-'), 'home');
    mkdirSync(join(globalHome, '.cogmem'), { recursive: true });
    writeFileSync(join(globalHome, '.cogmem', 'config.toml'), '[core]\ndb_path = "memory.db"\n');
    expect(resolveAgentRegistryPath({ cwd: proj, env: { HOME: globalHome } }).path).toBe(projRoster);

    // A named path is taken as named.
    expect(resolveAgentRegistryPath({ explicit: homeRoster, cwd: elsewhere, env }))
      .toEqual({ path: homeRoster, explicit: true });
  });

  test('a named roster that cannot be read is refused, not read as the single-agent case', async () => {
    const scratch = makeTempDir('cogmem-roster-missing-');
    // Directly: the resolver is the single place every reader goes through (#80).
    expect(() => resolveAgentRegistryPath({ explicit: join(scratch, 'agents.json') }))
      .toThrow(/agent_registry_not_found/);

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

describe('the roster body', () => {
  test('an entry needs a name, not a credential, and duplicate names are refused', () => {
    expect(parseAgentRegistry({ agents: [{ hostId: 'bot-a' }, { hostId: 'bot-b', projectId: 'proj-b' }] }))
      .toEqual([{ hostId: 'bot-a', projectId: undefined, profile: undefined }, { hostId: 'bot-b', projectId: 'proj-b', profile: undefined }]);
    expect(() => parseAgentRegistry({ agents: [{ hostId: 'bot-a' }, { hostId: 'bot-a' }] })).toThrow(/duplicate agent hostId/);
    expect(() => parseAgentRegistry({ agents: [{ projectId: 'no-name' }] })).toThrow(/hostId must be a non-empty string/);
  });

  test('a credential the old command wrote is ignored, and no token lookup exists', () => {
    const dir = makeTempDir('cogmem-roster-legacy-');
    const path = join(dir, 'agents.json');
    // The exact shape `init --register-agent` used to write: a digest and a tool profile.
    writeRoster(path, [{ hostId: 'legacy-bot', tokenDigest: 'a'.repeat(64), projectId: 'legacy-proj', profile: 'admin' }]);
    expect(loadRegisteredAgents(path)).toEqual([{ hostId: 'legacy-bot', projectId: 'legacy-proj', profile: 'admin' }]);

    const registry = loadAgentRegistry(path);
    expect(registry?.list().map((agent) => agent.hostId)).toEqual(['legacy-bot']);
    // The trust path is gone: there is no `resolve(token)` to present a secret to. This is
    // the assertion that fails if credential lookup is ever reintroduced.
    expect(Object.hasOwn(registry as object, 'resolve')).toBe(false);
  });
});
