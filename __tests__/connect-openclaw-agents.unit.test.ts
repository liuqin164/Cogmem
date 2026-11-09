import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTempDir } from './helpers/tmp.js';

/**
 * `connect openclaw --auto` on a config that runs several agents (#148).
 *
 * OpenClaw has no per-agent MCP server map, so the command writes one Cogmem entry per
 * agent plus the tool denial that keeps every other entry out of that agent's reach — and
 * then checks that the entries really run as their agents. All of it goes through the real
 * CLI here, because the parts that break are the parts that touch the file: a second run
 * that duplicates, a removal that leaves a server behind, a refusal that writes first.
 */

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const connectBin = join(coreRoot, 'src/bin/connect.ts');

/**
 * A stand-in for `cogmem mcp` that answers the identity self-check with the `--host` it was
 * started with. The check spawns the written command, so this is what makes the identity
 * half testable without a database: the agent's identity has to travel from the entry's
 * arguments through a real process to the answer. `STUB_AGENT_ID` makes it lie, which is
 * how the "an entry that answers as somebody else" case is exercised.
 */
function writeStubServer(dir: string): string {
  const path = join(dir, 'stub-cogmem');
  writeFileSync(path, `#!/usr/bin/env bun
const argv = process.argv.slice(2);
const flag = (name) => { const at = argv.indexOf(name); return at === -1 ? undefined : argv[at + 1]; };
const host = process.env.STUB_AGENT_ID ?? flag('--host') ?? 'unknown';
const project = flag('--project') ?? host;
const reply = (payload) => process.stdout.write(JSON.stringify(payload) + '\\n');
const decoder = new TextDecoder();
let buffer = '';
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk);
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id === 1) reply({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'stub' } } });
    else if (message.id === 2) reply({ jsonrpc: '2.0', id: 2, result: { structuredContent: { query: 'identity', agentId: host, projectId: project, items: [] } } });
  }
}
`, 'utf8');
  chmodSync(path, 0o755);
  return path;
}

function project(agentIds: string[]): { dir: string; home: string; ws: string; configPath: string; openclawConfig: string; stub: string } {
  const dir = makeTempDir('cogmem-openclaw-agents-');
  const home = join(dir, 'home');
  const ws = join(dir, 'ws');
  mkdirSync(join(ws, '.cogmem'), { recursive: true });
  mkdirSync(join(home, '.cogmem'), { recursive: true });
  const configPath = join(ws, '.cogmem', 'config.toml');
  writeFileSync(configPath, `[core]\ndb_path = "${join(ws, 'memory.db')}"\n\n[integrations.openclaw]\nenabled = true\n`);
  const openclawConfig = join(dir, 'openclaw.json');
  writeFileSync(openclawConfig, `${JSON.stringify({
    agents: { ownership: 'explicit', entries: Object.fromEntries(agentIds.map((id) => [id, { name: id }])) },
  }, null, 2)}\n`);
  return { dir, home, ws, configPath, openclawConfig, stub: writeStubServer(dir) };
}

async function run(cmd: string[], p: ReturnType<typeof project>, env: Record<string, string> = {}) {
  const list = [
    'bun', connectBin, 'openclaw',
    ...(cmd.includes('--remove') ? [] : ['--auto']),
    '--json',
    '--workspace', p.ws,
    '--config', p.configPath,
    '--openclaw-config', p.openclawConfig,
    ...cmd,
  ];
  const proc = Bun.spawn({
    cmd: list,
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, HOME: p.home, NO_COLOR: '1', COGMEM_BIN: p.stub, ...env },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

interface Result {
  autoMemory?: {
    multiAgent?: {
      agents: string[];
      entries: Array<{ agentId: string; name: string }>;
      denialsAdded: Array<{ pattern: string }>;
    };
    installed?: boolean;
    alreadyCurrent?: boolean;
    configUpdated?: boolean;
  };
  verification?: { ok: boolean; how: string; detail: string };
  installed?: boolean;
}

function config(p: ReturnType<typeof project>): Record<string, any> {
  return JSON.parse(readFileSync(p.openclawConfig, 'utf8'));
}

describe('one Cogmem entry per OpenClaw agent', () => {
  test('writes an entry and the cross-denials, then checks each entry runs as its agent', async () => {
    const p = project(['bot-a', 'bot-b']);
    const { exitCode, stdout, stderr } = await run([], p);
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as Result;
    expect(result.autoMemory?.multiAgent?.agents).toEqual(['bot-a', 'bot-b']);
    expect(result.autoMemory?.multiAgent?.entries.map((entry) => entry.name)).toEqual(['cogmem-bot-a', 'cogmem-bot-b']);
    expect(result.autoMemory?.multiAgent?.denialsAdded.map((denial) => denial.pattern)).toEqual(['cogmem-bot-b__*', 'cogmem-bot-a__*']);

    const written = config(p);
    expect(Object.keys(written.mcp.servers)).toEqual(['cogmem-bot-a', 'cogmem-bot-b']);
    // The identity is the agent; the project is per-agent *and* derived from the
    // integration's own scope, so `bot-a` in this workspace is not `bot-a` in another one.
    const args = written.mcp.servers['cogmem-bot-a'].args as string[];
    expect(args.slice(0, 4)).toEqual(['mcp', '--host', 'bot-a', '--project']);
    expect(args[4]).toMatch(/^openclaw-[0-9a-f]{8}-bot-a$/);
    expect(args.slice(5)).toEqual(['--config', p.configPath]);
    expect(written.agents.entries['bot-a'].tools.deny).toEqual(['cogmem-bot-b__*']);
    expect(written.agents.entries['bot-b'].tools.deny).toEqual(['cogmem-bot-a__*']);

    // The self-check the ticket asks for: the entry that was written is started, asked to
    // recall, and has to answer as the agent it belongs to.
    expect(result.verification?.ok).toBe(true);
    expect(result.verification?.how).toBe('plugin_files_and_config_entry_and_agent_identity');
    expect(result.verification?.detail).toContain('bot-a: verified');
    expect(result.verification?.detail).toContain('agentId=bot-b');
  });

  test('re-running changes nothing: no duplicate entry, no diff noise', async () => {
    const p = project(['bot-a', 'bot-b']);
    await run([], p);
    const before = readFileSync(p.openclawConfig, 'utf8');
    const { exitCode, stdout } = await run([], p);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as Result;
    expect(result.installed).toBe(false);
    expect(result.autoMemory?.alreadyCurrent).toBe(true);
    expect(result.autoMemory?.configUpdated).toBe(false);
    expect(result.autoMemory?.multiAgent?.denialsAdded).toEqual([]);
    expect(readFileSync(p.openclawConfig, 'utf8')).toBe(before);
  });

  test('a deleted denial is refused by name, and the config is left alone', async () => {
    // The ticket's acceptance: remove one deny and the self-check must go red and say
    // which one. Nothing may be written first — a check that repairs what it is checking
    // can never report it.
    const p = project(['bot-a', 'bot-b']);
    await run([], p);
    const written = config(p);
    delete written.agents.entries['bot-a'].tools;
    writeFileSync(p.openclawConfig, `${JSON.stringify(written, null, 2)}\n`);
    const before = readFileSync(p.openclawConfig, 'utf8');

    const { exitCode, stderr } = await run([], p);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('agent "bot-a" can see mcp.servers.cogmem-bot-b');
    expect(stderr).toContain('cogmem-bot-b__*');
    expect(readFileSync(p.openclawConfig, 'utf8')).toBe(before);
  });

  test('--force writes the denial the check named', async () => {
    const p = project(['bot-a', 'bot-b']);
    await run([], p);
    const written = config(p);
    delete written.agents.entries['bot-a'].tools;
    writeFileSync(p.openclawConfig, `${JSON.stringify(written, null, 2)}\n`);

    const { exitCode } = await run(['--force'], p);
    expect(exitCode).toBe(0);
    expect(config(p).agents.entries['bot-a'].tools.deny).toEqual(['cogmem-bot-b__*']);
  });

  test('an entry written by the standalone cogmem-mcp has no positional `mcp`, and is still ours', async () => {
    // `COGMEM_MCP_BIN`/`cogmem-mcp` is the server itself: it reads a positional `mcp` as a
    // bad argument, so `connect` writes the args without it. Recognising the entry by that
    // first word made a re-run refuse its own entry and `--remove` leave the server behind.
    const p = project(['bot-a', 'bot-b']);
    const mcpOnly = { COGMEM_MCP_BIN: p.stub };
    const first = await run([], p, mcpOnly);
    expect(first.exitCode).toBe(0);
    expect((config(p).mcp.servers['cogmem-bot-a'].args as string[])[0]).toBe('--host');

    const before = readFileSync(p.openclawConfig, 'utf8');
    const again = await run([], p, mcpOnly);
    expect(again.exitCode).toBe(0);
    expect(JSON.parse(again.stdout).autoMemory.configUpdated).toBe(false);
    expect(readFileSync(p.openclawConfig, 'utf8')).toBe(before);

    const removed = await run(['--remove'], p, mcpOnly);
    expect(removed.exitCode).toBe(0);
    expect(config(p).mcp).toBeUndefined();
  });

  test('an entry that answers as another agent ends the command', async () => {
    // The half no file can show: an entry that runs as somebody else is two agents sharing
    // one identity, so it is not a "could not verify" report — the same check does that for
    // a machine without the launcher — it is a failure.
    const p = project(['bot-a', 'bot-b']);
    const { exitCode, stderr } = await run([], p, { STUB_AGENT_ID: 'somebody-else' });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('openclaw_agent_identity');
    expect(stderr).toContain('cogmem-bot-a answered as agentId=somebody-else, not bot-a');
  });

  test('a single-agent config keeps the integration it always had', async () => {
    const p = project(['solo']);
    const { exitCode } = await run([], p);
    expect(exitCode).toBe(0);
    // No entry invented for one agent, and no tool policy written into a config that has
    // only one identity to keep.
    expect(config(p).mcp).toBeUndefined();
    expect(config(p).agents.entries.solo.tools).toBeUndefined();
  });

  test('one agent nobody could have denied is not enough to refuse a config', async () => {
    // `agents.list` as bare strings is a shape with nowhere to put a tool policy. With two
    // agents that is a refusal; with one there is nothing to keep apart, and a config this
    // command never wired must not start failing because of it.
    const p = project([]);
    writeFileSync(p.openclawConfig, `${JSON.stringify({ agents: { list: ['solo'] } }, null, 2)}\n`);
    const { exitCode, stdout } = await run([], p);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).autoMemory.multiAgent).toBeUndefined();
    expect(config(p).agents.list).toEqual(['solo']);
  });

  test('one agent carried in both key shapes is still one agent', async () => {
    // `entries` and `list` are two spellings of the same list; counting the refs rather than
    // the agents read this as multi-agent and invented an entry for a single-agent config.
    const p = project([]);
    writeFileSync(p.openclawConfig, `${JSON.stringify({ agents: { ownership: 'explicit', entries: { solo: { name: 'solo' } }, list: [{ id: 'solo' }] } }, null, 2)}\n`);
    const { exitCode, stdout } = await run([], p);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).autoMemory.multiAgent).toBeUndefined();
    expect(config(p).mcp).toBeUndefined();
  });

  test('a machine with an agent registry is refused instead of wired to a server that cannot start', async () => {
    const p = project(['bot-a', 'bot-b']);
    writeFileSync(join(p.home, '.cogmem', 'agents.json'), `${JSON.stringify({ agents: [{ hostId: 'bot-a', tokenDigest: 'x' }] })}\n`);
    const { exitCode, stderr } = await run([], p);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('multi_agent_credentials_required');
    expect(stderr).toContain('#185');
    expect(config(p).mcp).toBeUndefined();
  });

  test('--remove takes the entries and the denials back out', async () => {
    const p = project(['bot-a', 'bot-b']);
    await run([], p);
    const { exitCode } = await run(['--remove', '--json'], p);
    expect(exitCode).toBe(0);
    const written = config(p);
    expect(written.mcp).toBeUndefined();
    expect(written.agents.entries['bot-a'].tools).toBeUndefined();
    expect(written.agents.entries['bot-b'].tools).toBeUndefined();
    // The agent entries themselves are the host's, not ours.
    expect(Object.keys(written.agents.entries)).toEqual(['bot-a', 'bot-b']);
    // The plugin the same command installed goes too, or the removal only did half of it.
    const extensions = join(p.ws, 'extensions');
    expect(existsSync(extensions) ? readdirSync(extensions) : []).toEqual([]);
  });
});
