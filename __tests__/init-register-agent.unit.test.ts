import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAgentRegistry } from '../src/mcp/AgentRegistry.js';

/**
 * #65 acceptance item 4: the onboarding flows, extended to two agents.
 *
 * Registering an agent is deliberately not part of writing config. The second
 * agent on a machine is onboarded long after `config.toml` exists, and `init`
 * refuses to overwrite an existing config — so registration has to be able to run
 * on a configured machine, or "onboard two agents" would mean editing files by
 * hand. These tests drive the real binary.
 */

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const initBin = join(coreRoot, 'src/bin/init.ts');

function run(args: string[]) {
  const proc = Bun.spawn({
    cmd: ['bun', initBin, ...args],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
}

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'cogmem-init-register-'));
}

describe('cogmem init --register-agent', () => {
  test('mints a credential, prints it once, and writes a file the server reads back', async () => {
    const home = makeHome();
    const proc = await run(['--register-agent', 'bot-a', '--json', '--home', home]);

    expect(proc.stderr).toBe('');
    expect(proc.exitCode).toBe(0);
    const doc = JSON.parse(proc.stdout);
    expect(doc.command).toBe('init');
    expect(doc.registeredAgents).toHaveLength(1);

    const token = doc.registeredAgents[0].token as string;
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThanOrEqual(32);

    const path = join(home, 'agents.json');
    expect(existsSync(path)).toBe(true);
    // The printed credential is the one the server will resolve: the file is the
    // source of truth, and the output is only a delivery of it.
    expect(loadAgentRegistry(path)?.resolve(token)?.hostId).toBe('bot-a');
    // A credential file nobody else can read.
    expect(statSync(path).mode & 0o077).toBe(0);
    // Registration is not a configuration action.
    expect(existsSync(join(home, 'config.toml'))).toBe(false);
  });

  test('a second invocation adds a second agent on an already-configured machine', async () => {
    const home = makeHome();
    await run(['--register-agent', 'bot-a', '--json', '--home', home]);
    // This is what a real machine looks like by the time a second agent arrives.
    writeFileSync(join(home, 'config.toml'), '[core]\ndb_path = "memory.db"\n');

    const second = await run(['--register-agent', 'bot-b', '--json', '--home', home]);
    expect(second.exitCode).toBe(0);

    const registry = loadAgentRegistry(join(home, 'agents.json'));
    expect(registry?.list().map((agent) => agent.hostId).sort()).toEqual(['bot-a', 'bot-b']);
  });

  test('refuses to replace a credential without --rotate, and rotates with it', async () => {
    const home = makeHome();
    const first = await run(['--register-agent', 'bot-a', '--json', '--home', home]);
    const firstToken = JSON.parse(first.stdout).registeredAgents[0].token as string;

    const again = await run(['--register-agent', 'bot-a', '--json', '--home', home]);
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain('--rotate');
    // The refused run changed nothing: the agent's existing credential still works.
    expect(loadAgentRegistry(join(home, 'agents.json'))?.resolve(firstToken)?.hostId).toBe('bot-a');

    const rotated = await run(['--register-agent', 'bot-a', '--rotate', '--json', '--home', home]);
    expect(rotated.exitCode).toBe(0);
    const newToken = JSON.parse(rotated.stdout).registeredAgents[0].token as string;
    expect(newToken).not.toBe(firstToken);

    const registry = loadAgentRegistry(join(home, 'agents.json'));
    expect(registry?.resolve(newToken)?.hostId).toBe('bot-a');
    expect(registry?.resolve(firstToken)).toBeUndefined();
  });

  test('--dry-run reports the registration without writing one', async () => {
    const home = makeHome();
    const proc = await run(['--register-agent', 'bot-a', '--json', '--dry-run', '--home', home]);

    expect(proc.exitCode).toBe(0);
    expect(JSON.parse(proc.stdout).registeredAgents[0].dryRun).toBe(true);
    expect(existsSync(join(home, 'agents.json'))).toBe(false);
  });

  test('several agents can be registered in one invocation', async () => {
    const home = makeHome();
    const proc = await run(['--register-agent', 'bot-a', '--register-agent', 'bot-b', '--json', '--home', home]);

    expect(proc.exitCode).toBe(0);
    expect(JSON.parse(proc.stdout).registeredAgents).toHaveLength(2);
    expect(loadAgentRegistry(join(home, 'agents.json'))?.list()).toHaveLength(2);
  });

  test('a hostId already in the file is what "registered" means, not a second entry', async () => {
    const home = makeHome();
    await run(['--register-agent', 'bot-a', '--register-agent', 'bot-a', '--json', '--home', home]);
    // Registering the same agent twice in one run is the same refusal as twice
    // across runs: keeping the first entry and dropping the second would hand the
    // operator a credential the file does not contain.
    const path = join(home, 'agents.json');
    expect(loadAgentRegistry(path)?.list().length ?? 0).toBeLessThanOrEqual(1);
  });
});
