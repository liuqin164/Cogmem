import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTempDir } from './helpers/tmp.js';

/**
 * `connect all`: the second half of "install one cogmem and wire them all" (#97).
 *
 * `init --agent all` records the intent; this is the one command that acts on it. It
 * wires exactly what the config enables, because inventing hosts would install three
 * host plugins on a machine that may have one agent.
 */
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const connectBin = join(coreRoot, 'src/bin/connect.ts');
const doctorBin = join(coreRoot, 'src/bin/doctor.ts');

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn({ cmd, cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NO_COLOR: '1', ...env } });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

/** A workspace whose config enables the hosts given, and a home for the hosts' own files. */
function project(hosts: Array<'openclaw' | 'hermes' | 'pi'>) {
  const dir = makeTempDir('cogmem-connect-all-');
  const home = join(dir, 'home');
  const ws = join(dir, 'ws');
  mkdirSync(join(ws, '.cogmem'), { recursive: true });
  mkdirSync(join(home, '.hermes'), { recursive: true });
  mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
  writeFileSync(join(dir, 'openclaw.json'), '{}\n');
  const integrations = (['openclaw', 'hermes', 'pi'] as const)
    .map((host) => `\n[integrations.${host}]\nenabled = ${hosts.includes(host)}\n`)
    .join('');
  const configPath = join(ws, '.cogmem', 'config.toml');
  writeFileSync(configPath, `[core]\ndb_path = "memory.db"\n${integrations}`);
  return { dir, home, ws, configPath };
}

function connectArgs(target: string, p: ReturnType<typeof project>): string[] {
  return [
    'bun', connectBin, target,
    '--workspace', p.ws,
    '--config', p.configPath,
    '--auto', '--json',
    '--openclaw-config', join(p.dir, 'openclaw.json'),
    '--hermes-config', join(p.home, '.hermes', 'config.yaml'),
    '--pi-config', join(p.home, '.pi', 'agent', 'mcp.json'),
  ];
}

describe('connect all', () => {
  test('wires every host the config enables, in one run', async () => {
    const p = project(['openclaw', 'hermes', 'pi']);
    const { exitCode, stdout, stderr } = await run(connectArgs('all', p), p.ws, { HOME: p.home });
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout) as { hosts?: Array<{ agent: string }> };
    expect(parsed.hosts?.map((result) => result.agent)).toEqual(['openclaw', 'hermes', 'pi']);

    // Each host got its own files, from the one command.
    expect(existsSync(join(p.ws, 'extensions'))).toBe(true);
    expect(readFileSync(join(p.home, '.hermes', 'config.yaml'), 'utf8')).toContain('cogmem');
    expect(readFileSync(join(p.home, '.pi', 'agent', 'mcp.json'), 'utf8')).toContain('mcpServers');
    // And one skill per host, each in the location that host scans.
    expect(existsSync(join(p.ws, 'skills', 'cogmem-memory', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(p.home, '.hermes', 'skills', 'cogmem-memory', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(p.home, '.agents', 'skills', 'cogmem-memory', 'SKILL.md'))).toBe(true);
  });

  test('wires only what is enabled, and says nothing about the rest', async () => {
    const p = project(['pi']);
    const { exitCode, stdout } = await run(connectArgs('all', p), p.ws, { HOME: p.home });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { hosts?: Array<{ agent: string }> };
    expect(parsed.hosts?.map((result) => result.agent)).toEqual(['pi']);
    // No plugin was installed for a host nobody enabled.
    expect(existsSync(join(p.ws, 'extensions'))).toBe(false);
    expect(existsSync(join(p.home, '.hermes', 'config.yaml'))).toBe(false);
  });

  test('refuses when nothing is enabled, instead of guessing', async () => {
    const p = project([]);
    const { exitCode, stderr } = await run(connectArgs('all', p), p.ws, { HOME: p.home });
    expect(exitCode).not.toBe(0);
    // The message has to say what to do, since the operator asked for something the
    // config cannot answer.
    expect(stderr).toContain('init --agent all');
  });

  test('refuses an unknown host rather than reading it as all', async () => {
    const p = project(['pi']);
    const { exitCode, stderr } = await run(connectArgs('everything', p), p.ws, { HOME: p.home });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('everything');
  });
});

describe('the gate finishes a three-host install in one step', () => {
  test('names one connect-all step while several hosts are outstanding', async () => {
    const p = project(['openclaw', 'hermes', 'pi']);
    const { exitCode, stdout } = await run(
      ['bun', doctorBin, '--workspace', p.ws, '--config', p.configPath, '--json'],
      p.ws,
      { HOME: p.home },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      nextConnectHost?: string;
      nextConnectHosts?: string[];
      nextSteps?: Array<{ id: string; command: string }>;
    };
    // All three are named, and the step is the one command that finishes them.
    expect(parsed.nextConnectHosts).toEqual(['openclaw', 'hermes', 'pi']);
    const connect = parsed.nextSteps?.filter((step) => step.id === 'connect_all_hosts') ?? [];
    expect(connect).toHaveLength(1);
    expect(connect[0]!.command).toContain('connect all');
  });

  test('falls back to the single-host step when only one is outstanding', async () => {
    const p = project(['pi']);
    const { stdout } = await run(
      ['bun', doctorBin, '--workspace', p.ws, '--config', p.configPath, '--json'],
      p.ws,
      { HOME: p.home },
    );
    const parsed = JSON.parse(stdout) as {
      nextConnectHosts?: string[];
      nextSteps?: Array<{ id: string; command: string }>;
    };
    expect(parsed.nextConnectHosts).toEqual(['pi']);
    const step = parsed.nextSteps?.find((entry) => entry.id === 'connect_host');
    expect(step?.command).toContain('connect pi');
  });
});

describe('reconnecting a host refreshes its entry', () => {
  test('a dead command path is repaired rather than preserved', async () => {
    const p = project(['hermes']);
    const hermesConfig = join(p.home, '.hermes', 'config.yaml');
    const first = await run(connectArgs('hermes', p), p.ws, { HOME: p.home });
    expect(first.exitCode).toBe(0);

    // An entry written by an install that has since moved. Only the `args` line was
    // ever refreshed on a re-run, so the command survived every reconnect: Hermes
    // kept naming a directory that no longer existed, its server never started, and
    // it had no memory while reporting nothing.
    const dead = '/nonexistent/old-workspace/node_modules/.bin/cogmem';
    const rewritten = readFileSync(hermesConfig, 'utf8').replace(/^(\s*)command\s*:.*$/mu, `$1command: "${dead}"`);
    expect(rewritten).toContain(dead);
    writeFileSync(hermesConfig, rewritten, 'utf8');

    const second = await run([...connectArgs('hermes', p), '--force'], p.ws, { HOME: p.home });
    expect(second.exitCode).toBe(0);

    const after = readFileSync(hermesConfig, 'utf8');
    expect(after).not.toContain(dead);
    expect(after).toMatch(/^\s*command\s*:\s*".*cogmem.*"$/mu);
  });
});
