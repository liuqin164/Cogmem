import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeTempDir } from './helpers/tmp.js';

/**
 * #87 / #88 acceptance, as one sequence: a host records a conversation over the real
 * stdio MCP transport, the host seals it when it ends, Dream compiles the sealed
 * episode, and both readers — the host's own `cogmem_recall` and the CLI an operator
 * checks with — return it. A different project must not.
 *
 * This exists because #87's unit test stops where the lifecycle ends (a sealed episode
 * queued for Dream) and #88's test drives the CLI directly. Neither proves the joined
 * path, and the joined path is what a host actually does. It is deliberately a separate
 * file: it is an acceptance, not a unit.
 */

const coreRoot = join(import.meta.dir, '..');
const cogmemBin = join(coreRoot, 'src/bin/cogmem.ts');

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'acceptance', version: '1.0.0' } },
});
const INITIALIZED = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });

/** One MCP session: send these messages, collect the responses, close stdin. */
function mcp(workspaceConfig: string, project: string, messages: object[]): Record<string, unknown>[] {
  const input = [INITIALIZE, INITIALIZED, ...messages.map((message) => JSON.stringify(message))].join('\n');
  const proc = Bun.spawnSync({
    cmd: ['bun', cogmemBin, 'mcp', '--config', workspaceConfig, '--project', project],
    stdin: Buffer.from(`${input}\n`),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return String(proc.stdout)
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function toolResult(response: Record<string, unknown>): Record<string, unknown> {
  const result = response.result as { content?: { text?: string }[] } | undefined;
  return JSON.parse(String(result?.content?.[0]?.text ?? '{}')) as Record<string, unknown>;
}

function cli(args: string[]): Record<string, unknown> {
  const proc = Bun.spawnSync({ cmd: ['bun', cogmemBin, ...args], stdout: 'pipe', stderr: 'pipe' });
  expect(String(proc.stderr)).toBe('');
  expect(proc.exitCode).toBe(0);
  return JSON.parse(String(proc.stdout)) as Record<string, unknown>;
}

test('#87/#88 a conversation written over MCP is recallable end to end, and stays scoped', async () => {
  const dir = makeTempDir('cogmem-mcp-e2e-');
  const workspace = join(dir, 'ws');
  mkdirSync(join(workspace, '.cogmem'), { recursive: true });
  const config = join(workspace, '.cogmem', 'config.toml');
  writeFileSync(config, ['[core]', `db_path = "${join(workspace, '.cogmem', 'memory.db')}"`].join('\n'));
  const project = 'zen-flow';
  const marker = 'narwhal';

  // ① The host records a conversation. It sends the turn and the session, nothing else:
  //    identity comes from the connection (ADR-0006, #85).
  const written = mcp(config, project, [
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'cogmem_remember_turn', arguments: {
      sessionId: 's-1', userText: `the ${marker} rollout ships on Tuesdays`, assistantText: 'noted',
    } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'cogmem_remember_turn', arguments: {
      sessionId: 's-1', userText: `the ${marker} docs land on Monday`, assistantText: 'noted',
    } } },
  ]);
  for (const response of written.filter((item) => item.id === 2 || item.id === 3)) {
    expect(toolResult(response).ok).toBe(true);
  }

  // ② Both turns joined one episode, under the connection's project and the session.
  const status = cli(['episode', 'status', '--project', project, '--config', config, '--json']);
  const episodes = status.episodes as { episodeId: string; sessionId: string; sourceAgent: string }[];
  expect(episodes).toHaveLength(1);
  expect(episodes[0]!.sessionId).toBe('s-1');
  expect(episodes[0]!.sourceAgent).toBe(project);

  // ③ The conversation ended, so it is sealed and Dream compiles it. The idle sweep is
  //    the unattended path and needs a 30-minute quiet window; an explicit seal is the
  //    host's own boundary, and this is the sequence either way.
  cli(['episode', 'seal', '--project', project, '--episode', episodes[0]!.episodeId,
    '--mode', 'hard', '--reason', 'manual', '--config', config, '--json']);
  const dreamed = cli(['dream', 'tick', '--project', project, '--mode', 'auto', '--config', config, '--json']);
  expect(dreamed.processedEpisodeCount).toBeGreaterThan(0);
  cli(['memory', 'govern', '--project', project, '--config', config, '--json']);

  // ④ The operator's reader returns it. Assertions land on `items`: the response echoes
  //    the query, so a substring match on the whole body would pass without a hit.
  const recalled = cli(['memory', 'recall', '--project', project, '--config', config,
    '--query', `when does the ${marker} rollout ship`, '--json']);
  expect(recalled.agentId).toBe(project);
  expect(JSON.stringify(recalled.items)).toContain(marker);

  // ⑤ The host's reader agrees, after Dream, over the real transport.
  const hostRecall = mcp(config, project, [
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'cogmem_recall', arguments: {
      query: `when does the ${marker} rollout ship`,
    } } },
  ]).find((item) => item.id === 2);
  expect(JSON.stringify(toolResult(hostRecall!).items)).toContain(marker);

  // ⑥ And scope is honest: another project does not see it. A fix that made recall
  //    find things by widening the filter would pass ④ and fail here.
  const foreign = cli(['memory', 'recall', '--project', 'someone-else', '--config', config,
    '--query', `when does the ${marker} rollout ship`, '--json']);
  expect(JSON.stringify(foreign.items)).not.toContain(marker);
});
