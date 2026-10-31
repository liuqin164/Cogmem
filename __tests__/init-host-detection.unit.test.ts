import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hostsEnabledByCombinedChoice, shouldOfferWireAll } from '../src/bin/init.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * One install, three agents (#97).
 *
 * A machine with OpenClaw, Hermes and pi had no way to learn that from `init`, and
 * no way to wire more than one host from it: Hermes was conditional on OpenClaw
 * being *absent*, and pi was not detected at all. These tests pin the machine
 * where all three are present, because that is the case the old rule got wrong.
 *
 * The config side already supported it — `connect` writing all three produces three
 * `[integrations.*]` sections — so what is under test is the install-time path.
 */
const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const initBin = join(coreRoot, 'src/bin/init.ts');

/** A home with all three agents' own files, and a cwd that looks like an OpenClaw workspace. */
function machineWithThreeAgents(): { dir: string; home: string; cwd: string } {
  const dir = makeTempDir('cogmem-init-hosts-');
  const home = join(dir, 'home');
  const cwd = join(dir, 'workspace');
  mkdirSync(join(home, '.hermes'), { recursive: true });
  mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
  mkdirSync(join(cwd, 'memory'), { recursive: true });
  writeFileSync(join(home, '.hermes', 'config.yaml'), 'model: test\n');
  writeFileSync(join(home, '.pi', 'agent', 'auth.json'), '{}\n');
  return { dir, home, cwd };
}

async function runInit(args: string[], env: Record<string, string>): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ['bun', initBin, ...args],
    cwd: env.COGMEM_TEST_CWD || coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

describe('init on a machine with all three agents', () => {
  test('--agent all wires every host into the one backend', async () => {
    const { dir, home, cwd } = machineWithThreeAgents();
    const { exitCode, stdout, stderr } = await runInit(
      ['--yes', '--dry-run', '--agent', 'all', '--home', join(dir, '.cogmem'), '--no-probe'],
      { HOME: home, COGMEM_TEST_CWD: cwd },
    );
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    // All three sections exist and are on: one install, one backend, three hosts.
    for (const host of ['openclaw', 'hermes', 'pi']) {
      expect(stdout).toContain(`[integrations.${host}]`);
    }
    const on = stdout.match(/enabled = true/g) ?? [];
    expect(on.length).toBeGreaterThanOrEqual(3);
  });

  test('a comma-separated list names the hosts to wire, and pi is one of them', async () => {
    const { dir, home, cwd } = machineWithThreeAgents();
    const { exitCode, stdout } = await runInit(
      ['--yes', '--dry-run', '--agent', 'hermes,pi', '--home', join(dir, '.cogmem'), '--no-probe'],
      { HOME: home, COGMEM_TEST_CWD: cwd },
    );
    expect(exitCode).toBe(0);
    const section = (host: string): string => stdout.slice(stdout.indexOf(`[integrations.${host}]`));
    expect(section('hermes').startsWith('[integrations.hermes]\nenabled = true')).toBe(true);
    expect(section('pi').startsWith('[integrations.pi]\nenabled = true')).toBe(true);
    expect(section('openclaw').startsWith('[integrations.openclaw]\nenabled = false')).toBe(true);
  });

  test('a host this command does not know is refused, not quietly read as auto', async () => {
    // `--agent pi` used to be accepted-and-ignored before pi existed, which looks
    // like success and changes nothing. Silence is the failure mode to avoid.
    const { dir, home, cwd } = machineWithThreeAgents();
    const { exitCode, stderr } = await runInit(
      ['--yes', '--dry-run', '--agent', 'openclaw,notahost', '--home', join(dir, '.cogmem'), '--no-probe'],
      { HOME: home, COGMEM_TEST_CWD: cwd },
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('notahost');
  });

  test('the JSON report names all three hosts, and says which were wired', async () => {
    const { dir, home, cwd } = machineWithThreeAgents();
    const { exitCode, stdout } = await runInit(
      ['--yes', '--dry-run', '--json', '--home', join(dir, '.cogmem'), '--no-probe'],
      { HOME: home, COGMEM_TEST_CWD: cwd },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      hosts?: Array<{ name: string; detected: boolean; enabled: boolean }>;
      config?: { integrations?: Record<string, boolean> };
    };
    expect(parsed.hosts?.map((host) => host.name)).toEqual(['openclaw', 'hermes', 'pi']);
    expect(parsed.hosts?.every((host) => host.detected)).toBe(true);
    // An unattended run wires nothing it was not told to wire (ADR-0003), and it
    // says so rather than leaving the operator to guess what it found.
    expect(parsed.hosts?.every((host) => !host.enabled)).toBe(true);
    expect(parsed.config?.integrations).toMatchObject({ openclaw: false, hermes: false, pi: false });
  });
});

describe('the combined host question', () => {
  const allPresent = { openclaw: true, hermes: true, pi: true };
  const none = { openclaw: false, hermes: false, pi: false };

  test('is offered only when it means something', () => {
    // One agent has no "all of them" to offer, an explicit list already answered the
    // question, and an unattended run asks nothing (ADR-0003).
    expect(shouldOfferWireAll({ mode: 'auto', requested: [], detectedCount: 3 })).toBe(true);
    expect(shouldOfferWireAll({ mode: 'auto', requested: [], detectedCount: 1 })).toBe(false);
    expect(shouldOfferWireAll({ mode: 'auto', requested: ['pi'], detectedCount: 3 })).toBe(false);
    expect(shouldOfferWireAll({ mode: 'hermes', requested: ['hermes'], detectedCount: 3 })).toBe(false);
    expect(shouldOfferWireAll({ mode: 'none', requested: [], detectedCount: 3 })).toBe(false);
  });

  test('answering yes wires every detected host and nothing else', () => {
    expect(hostsEnabledByCombinedChoice({ requested: [], detected: allPresent, wireAll: true }))
      .toEqual({ openclaw: true, hermes: true, pi: true });
    // A host that is not here is not switched on by "yes" — the answer is about the
    // hosts that were found, not about the three names that exist.
    expect(hostsEnabledByCombinedChoice({ requested: [], detected: { ...none, pi: true }, wireAll: true }))
      .toEqual({ openclaw: false, hermes: false, pi: true });
  });

  test('a named host is wired whether or not the combined question was answered', () => {
    expect(hostsEnabledByCombinedChoice({ requested: ['hermes'], detected: allPresent, wireAll: false }))
      .toEqual({ openclaw: false, hermes: true, pi: false });
    expect(hostsEnabledByCombinedChoice({ requested: ['hermes'], detected: allPresent, wireAll: true }))
      .toEqual({ openclaw: true, hermes: true, pi: true });
  });

  test('answering no enables nothing on its own', () => {
    // The per-host prompts run next; this function must not pre-empt them.
    expect(hostsEnabledByCombinedChoice({ requested: [], detected: allPresent, wireAll: false }))
      .toEqual({ openclaw: false, hermes: false, pi: false });
  });
});
