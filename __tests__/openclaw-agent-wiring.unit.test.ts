import { describe, expect, test } from 'bun:test';

import {
  openClawAgentIds,
  openClawAgentRefs,
  openClawCogmemServerName,
  unwireOpenClawCogmemAgentEntries,
  verifyOpenClawAgentIsolation,
  wireOpenClawCogmemAgentEntries,
} from '../src/host/openclaw/OpenClawAgentWiring.js';

/**
 * #148: OpenClaw keeps one global `mcp.servers` map, so the only way an agent gets a
 * Cogmem identity of its own is an entry of its own plus a denial of every other agent's
 * entry. The denial is the whole feature — without it the neighbour's server is callable
 * and two agents' memory mingles — so both the wiring and the check that reads it back are
 * asserted here.
 */

const serverFor = (agentId: string) => ({
  command: '/usr/local/bin/cogmem',
  args: ['mcp', '--host', agentId, '--project', agentId, '--config', '/ws/.cogmem/config.toml'],
});

function agents(entries: Record<string, unknown>): Record<string, unknown> {
  return { agents: { entries } };
}

function wired(ids: string[]): Record<string, unknown> {
  const root = agents(Object.fromEntries(ids.map((id) => [id, { name: id }])));
  const refs = openClawAgentRefs(root);
  wireOpenClawCogmemAgentEntries({ root, refs, serverFor });
  return root;
}

describe('reading the agents an OpenClaw config defines', () => {
  test('reads agents.entries, which is keyed by agent id', () => {
    const refs = openClawAgentRefs(agents({ susan: { name: 'susan' }, writer: {} }));
    expect(refs.map((ref) => ref.id)).toEqual(['susan', 'writer']);
  });

  test('reads the older agents.list array, by id or by name', () => {
    const refs = openClawAgentRefs({ agents: { list: [{ id: 'alpha' }, { name: 'beta' }] } });
    expect(refs.map((ref) => ref.id)).toEqual(['alpha', 'beta']);
  });

  test('reads agents.list as a map too, because both shapes ship', () => {
    const refs = openClawAgentRefs({ agents: { list: { alpha: {}, beta: {} } } });
    expect(refs.map((ref) => ref.id)).toEqual(['alpha', 'beta']);
  });

  test('an agent that cannot be named is refused rather than skipped', () => {
    // Skipping it would leave that agent unwired and un-denied, which is the failure this
    // module exists to prevent. A bare string has nowhere to carry a tool policy either.
    expect(() => openClawAgentRefs({ agents: { list: ['alpha', 'beta'] } })).toThrow(/nowhere to carry a tool policy/);
    expect(() => openClawAgentRefs({ agents: { list: [{ name: 42 }] } })).toThrow(/no id or name/);
  });

  test('no agents section, no agents', () => {
    expect(openClawAgentRefs({})).toEqual([]);
    expect(openClawAgentRefs({ agents: {} })).toEqual([]);
  });
});

describe('one Cogmem entry per agent', () => {
  test('names each entry predictably and runs it under its own identity', () => {
    const root = wired(['bot-a', 'bot-b']);
    const servers = (root.mcp as Record<string, Record<string, unknown>>).servers;
    expect(Object.keys(servers)).toEqual(['cogmem-bot-a', 'cogmem-bot-b']);
    expect(servers['cogmem-bot-a']!.args).toEqual([
      'mcp', '--host', 'bot-a', '--project', 'bot-a', '--config', '/ws/.cogmem/config.toml',
    ]);
    expect(servers['cogmem-bot-b']!.args).toContain('bot-b');
  });

  test('denies every other agent, and leaves the agent its own', () => {
    const root = wired(['bot-a', 'bot-b', 'bot-c']);
    const entries = (root.agents as { entries: Record<string, { tools?: { deny?: string[] } }> }).entries;
    expect(entries['bot-a']!.tools?.deny).toEqual(['cogmem-bot-b__*', 'cogmem-bot-c__*']);
    expect(entries['bot-b']!.tools?.deny).toEqual(['cogmem-bot-a__*', 'cogmem-bot-c__*']);
    expect(entries['bot-c']!.tools?.deny).toEqual(['cogmem-bot-a__*', 'cogmem-bot-b__*']);
  });

  test('keeps what the user put in the entry, and adds to an existing deny list', () => {
    const root = agents({
      'bot-a': { name: 'bot-a', workspace: '/home/u/ws', tools: { deny: ['exec'] }, identity: { emoji: '🧭' } },
      'bot-b': { name: 'bot-b' },
    });
    wireOpenClawCogmemAgentEntries({ root, refs: openClawAgentRefs(root), serverFor });
    const entry = (root.agents as { entries: Record<string, { tools: { deny: string[] }; workspace: string; identity: unknown }> }).entries['bot-a']!;
    expect(entry.tools.deny).toEqual(['exec', 'cogmem-bot-b__*']);
    expect(entry.workspace).toBe('/home/u/ws');
    expect(entry.identity).toEqual({ emoji: '🧭' });
  });

  test('a second run adds nothing, so reconnecting is not a diff', () => {
    const root = wired(['bot-a', 'bot-b']);
    const before = JSON.stringify(root);
    const again = wireOpenClawCogmemAgentEntries({ root, refs: openClawAgentRefs(root), serverFor });
    expect(again.denialsAdded).toEqual([]);
    expect(again.entries.every((entry) => !entry.created)).toBe(true);
    expect(JSON.stringify(root)).toBe(before);
  });

  test('an entry somebody else wrote under our name is a conflict, not a silent overwrite', () => {
    const root = agents({ 'bot-a': {}, 'bot-b': {} });
    root.mcp = { servers: { 'cogmem-bot-a': { command: 'my-own-server', args: ['serve'] } } };
    const refs = openClawAgentRefs(root);
    expect(() => wireOpenClawCogmemAgentEntries({ root, refs, serverFor })).toThrow(/already exists and was not written for agent "bot-a"/);
    // And it is still there, untouched: a refusal that wrote anyway would not be one.
    expect((root.mcp as { servers: Record<string, unknown> }).servers['cogmem-bot-a']).toEqual({ command: 'my-own-server', args: ['serve'] });
    wireOpenClawCogmemAgentEntries({ root, refs, serverFor, force: true });
    expect((root.mcp as { servers: Record<string, { command: string }> }).servers['cogmem-bot-a']!.command).toBe('/usr/local/bin/cogmem');
  });

  test('two agent ids that ask for one server name are refused', () => {
    // `cogmem-a.b` and `cogmem-a-b` both sanitize to `cogmem-a-b`: one identity for two
    // agents is exactly the merge this is meant to prevent, so it cannot be written.
    const root = agents({ 'a.b': {}, 'a-b': {} });
    expect(() => wireOpenClawCogmemAgentEntries({ root, refs: openClawAgentRefs(root), serverFor })).toThrow(/same server name/);
  });
});

describe('the isolation self-check', () => {
  test('passes on a config this command wrote', () => {
    const root = wired(['bot-a', 'bot-b']);
    expect(verifyOpenClawAgentIsolation(root, openClawAgentRefs(root))).toEqual({ ok: true, problems: [] });
  });

  test('names the agent and the exact missing denial when one is deleted', () => {
    // The ticket's acceptance: delete one deny and the check has to go red and say which.
    const root = wired(['bot-a', 'bot-b']);
    delete ((root.agents as { entries: Record<string, { tools?: unknown }> }).entries['bot-a']!).tools;
    const report = verifyOpenClawAgentIsolation(root, openClawAgentRefs(root));
    expect(report.ok).toBe(false);
    expect(report.problems).toEqual([
      'agent "bot-a" can see mcp.servers.cogmem-bot-b (agent "bot-b"\'s entry): agents...bot-a.tools.deny is missing "cogmem-bot-b__*"',
    ]);
  });

  test('a denial only for the neighbour by name does not hide its tools', () => {
    // OpenClaw hides a server's namespace with `<server>__*` and matches tool names, so
    // `cogmem-bot-b` alone denies nothing and the check must not accept it.
    const root = wired(['bot-a', 'bot-b']);
    ((root.agents as { entries: Record<string, { tools: { deny: string[] } }> }).entries['bot-a']!).tools.deny = ['cogmem-bot-b'];
    const report = verifyOpenClawAgentIsolation(root, openClawAgentRefs(root));
    expect(report.ok).toBe(false);
    expect(report.problems[0]).toContain('cogmem-bot-b__*');
  });

  test('an agent that denies its own entry is reported too: it could not use its own memory', () => {
    const root = wired(['bot-a', 'bot-b']);
    ((root.agents as { entries: Record<string, { tools: { deny: string[] } }> }).entries['bot-a']!).tools.deny.push('cogmem-*');
    const report = verifyOpenClawAgentIsolation(root, openClawAgentRefs(root));
    expect(report.ok).toBe(false);
    expect(report.problems).toEqual([
      'agent "bot-a" denies its own entry mcp.servers.cogmem-bot-a: remove "cogmem-*" from agents...bot-a.tools.deny',
    ]);
  });

  test('a missing entry is only a problem once the wiring claims to be done', () => {
    const root = agents({ 'bot-a': {}, 'bot-b': {} });
    const refs = openClawAgentRefs(root);
    expect(verifyOpenClawAgentIsolation(root, refs, { requireOwnEntries: false })).toEqual({ ok: true, problems: [] });
    expect(verifyOpenClawAgentIsolation(root, refs).problems).toEqual([
      'agent "bot-a" has no mcp.servers.cogmem-bot-a entry, so it has no Cogmem identity of its own',
      'agent "bot-b" has no mcp.servers.cogmem-bot-b entry, so it has no Cogmem identity of its own',
    ]);
  });

  test('one agent is not a multi-agent config, so there is nothing to check', () => {
    const root = agents({ only: {} });
    expect(verifyOpenClawAgentIsolation(root, openClawAgentRefs(root))).toEqual({ ok: true, problems: [] });
  });

  test('a hand-written cogmem server for one agent is policed like ours', () => {
    // The leak does not care who wrote the entry: the neighbour of a hand-written
    // `cogmem-susan` can still see it.
    const root = agents({ susan: {}, writer: {} });
    root.mcp = { servers: { 'cogmem-susan': { command: 'cogmem', args: ['mcp', '--host', 'susan'] } } };
    const report = verifyOpenClawAgentIsolation(root, openClawAgentRefs(root), { requireOwnEntries: false });
    expect(report.ok).toBe(false);
    expect(report.problems).toEqual([
      'agent "writer" can see mcp.servers.cogmem-susan (agent "susan"\'s entry): agents...writer.tools.deny is missing "cogmem-susan__*"',
    ]);
  });
});

describe('taking the wiring back out', () => {
  test('removes our entries and our denials, and nothing else', () => {
    const root = wired(['bot-a', 'bot-b']);
    const servers = (root.mcp as { servers: Record<string, unknown> }).servers;
    servers['mine'] = { command: 'other', args: [] };
    ((root.agents as { entries: Record<string, { tools: { deny: string[] } }> }).entries['bot-a']!).tools.deny.push('exec');
    const teardown = unwireOpenClawCogmemAgentEntries(root, openClawAgentRefs(root));
    expect(teardown.servers).toEqual(['cogmem-bot-a', 'cogmem-bot-b']);
    expect(teardown.denials).toEqual([
      { agentId: 'bot-a', pattern: 'cogmem-bot-b__*' },
      { agentId: 'bot-b', pattern: 'cogmem-bot-a__*' },
    ]);
    expect(Object.keys((root.mcp as { servers: Record<string, unknown> }).servers)).toEqual(['mine']);
    // `exec` was the user's, so it stays; the deny list that still has something in it
    // keeps its `tools`, and the one we emptied takes the empty `tools` with it.
    expect((root.agents as { entries: Record<string, unknown> }).entries['bot-a']).toEqual({ name: 'bot-a', tools: { deny: ['exec'] } });
    expect((root.agents as { entries: Record<string, unknown> }).entries['bot-b']).toEqual({ name: 'bot-b' });
  });

  test('an entry somebody else wrote under our name stays, and the map stays with it', () => {
    const root = agents({ 'bot-a': {}, 'bot-b': {} });
    root.mcp = { servers: { 'cogmem-bot-a': { command: 'mine', args: [] } } };
    const teardown = unwireOpenClawCogmemAgentEntries(root, openClawAgentRefs(root));
    expect(teardown.servers).toEqual([]);
    expect((root.mcp as { servers: Record<string, unknown> }).servers['cogmem-bot-a']).toEqual({ command: 'mine', args: [] });
  });
});

test('a server name OpenClaw would rewrite is the name we deny', () => {
  // Names are matched after OpenClaw's own sanitizer, so the wiring has to agree with it:
  // `cogmem-a.b` is `cogmem-a-b` by the time anything sees it.
  expect(openClawCogmemServerName('a.b')).toBe('cogmem-a-b');
  expect(openClawCogmemServerName('a'.repeat(40))).toHaveLength(30);
  expect(openClawAgentIds([{ id: 'a', node: {} }, { id: 'a', node: {} }])).toEqual(['a']);
});
