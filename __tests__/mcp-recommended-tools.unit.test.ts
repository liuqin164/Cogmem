import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';
import { callCogmemMcpTool, listCogmemMcpTools } from '../src/mcp/CoreMcpTools.js';
import { isToolAllowed } from '../src/mcp/profiles.js';
import type { McpToolProfile } from '../src/mcp/profiles.js';

// Tool responses that hand the caller a tool name are read as an instruction to
// call it. A name that is not registered costs the model a turn on "unknown
// tool", and a name outside the serving profile costs it a turn on
// "tool_not_in_profile" — the same failure the `instructions` string was fixed
// for, reached through `suggestedTool` and `recommendedActions` instead. Both
// fields are covered by the class-wide scan below, so a new invented name fails
// here rather than in a host's logs.

const root = join(import.meta.dir, '..');
const PROFILES: McpToolProfile[] = ['core', 'admin', 'full'];
const registered = new Set(listCogmemMcpTools().map((tool) => tool.name));

// Tokens that look like tool names but are not: each one is a different kind of
// identifier in this codebase, so it has to be named here rather than loosening
// the scan.
const NOT_TOOL_NAMES: Record<string, string> = {
  cogmem_bootstrap_state: 'the _cogmem_bootstrap_state migration bookkeeping table',
  cogmem_config: 'the missing_cogmem_config error code, which names a config file',
  cogmem_memory_dream: 'the operator_runs_cogmem_memory_dream schedule-mode token',
};

/** Every profile that can call `toolName` at all. */
const servingProfiles = (toolName: string) => PROFILES.filter((profile) => isToolAllowed(profile, toolName));

/** `cogmem_*` entries in a caller-facing list, which the host will try to call. */
const suggestedTools = (values: unknown): string[] =>
  (Array.isArray(values) ? values : []).filter((value): value is string => typeof value === 'string' && value.startsWith('cogmem_'));

function expectCallableFrom(caller: string, names: string[]) {
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    expect({ name, registered: registered.has(name) }).toEqual({ name, registered: true });
    const unreachable = servingProfiles(caller).filter((profile) => !isToolAllowed(profile, name));
    expect({ name, unreachable }).toEqual({ name, unreachable: [] });
  }
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('tool responses only name tools the caller can call', () => {
  test('no source file invents a cogmem_ tool name', () => {
    const seen = new Map<string, string[]>();
    for (const file of sourceFiles(join(root, 'src'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/cogmem_[a-z0-9_]+/g)) {
        if (registered.has(match[0])) continue;
        seen.set(match[0], [...(seen.get(match[0]) ?? []), file.slice(root.length + 1)]);
      }
    }
    const invented = [...seen].filter(([token]) => !(token in NOT_TOOL_NAMES)).map(([token, where]) => `${token} (${[...new Set(where)].join(', ')})`);
    expect(invented).toEqual([]);
    // An allowlist entry that no longer matches anything is stale permission.
    expect(Object.keys(NOT_TOOL_NAMES).filter((token) => !seen.has(token))).toEqual([]);
  });

  test('episode status recommends a real, callable repair tool for unassigned raw events', async () => {
    const kernel = createMemoryKernel();
    try {
      kernel.eventStore.append({
        eventId: 'evt-guard-raw', streamId: 'guard', streamType: 'thread', eventType: 'RAW_EVENT_RECORDED',
        rawEventType: 'message', projectId: 'guard', role: 'user', payload: { text: 'raw event with no episode' },
      });
      const result = await callCogmemMcpTool('cogmem_episode_status', { projectId: 'guard' }, { kernel });
      expect(result.isError).toBeFalsy();
      const body = result.structuredContent as { recentRawAvailable: boolean; recommendedActions: string[] };
      expect(body.recentRawAvailable).toBe(true);
      expect(body.recommendedActions).toContain('cogmem_episode_repair');
      expectCallableFrom('cogmem_episode_status', suggestedTools(body.recommendedActions));
    } finally {
      kernel.close();
    }
  });

  test('a sealed episode queues one Dream tick, not a tool that does not exist', async () => {
    const kernel = createMemoryKernel();
    try {
      const appended = await callCogmemMcpTool('cogmem_episode_append', {
        projectId: 'guard', sessionId: 'guard-session', sourceAgent: 'guard', role: 'user',
        text: 'Orion ships next week', externalMessageId: 'guard-m1', threadId: 'guard-thread',
      }, { kernel });
      expect(appended.isError).toBeFalsy();
      const episodeId = (appended.structuredContent as { episodeId: string }).episodeId;
      kernel.sealImportedEpisode(episodeId, { reason: 'guard_seal', force: true });

      const result = await callCogmemMcpTool('cogmem_episode_status', { projectId: 'guard' }, { kernel });
      const body = result.structuredContent as { dream: { pending: number }; recommendedActions: string[] };
      expect(body.dream.pending).toBe(1);
      expect(body.recommendedActions).toEqual(['cogmem_dream_tick']);
      expectCallableFrom('cogmem_episode_status', suggestedTools(body.recommendedActions));
    } finally {
      kernel.close();
    }
  });

  test('recall points a host with no episodes at a core-visible write tool', async () => {
    const kernel = createMemoryKernel();
    try {
      const empty = await callCogmemMcpTool('cogmem_recall', { projectId: 'guard', agentId: 'guard', query: 'Orion' }, { kernel });
      expect(empty.isError).toBeFalsy();
      const emptyBody = empty.structuredContent as { suggestedTool?: string; warnings: string[] };
      expect(emptyBody.warnings).toContain('no_recent_episode_ingestion_detected');
      expect(emptyBody.suggestedTool).toBe('cogmem_episode_append');
      // Recall is a core tool, so the tool it suggests must be reachable from core too.
      expectCallableFrom('cogmem_recall', [emptyBody.suggestedTool as string]);

      const appended = await callCogmemMcpTool('cogmem_episode_append', {
        projectId: 'guard', sessionId: 'guard-session', sourceAgent: 'guard', role: 'user',
        text: 'Orion ships next week', externalMessageId: 'guard-m1', threadId: 'guard-thread',
      }, { kernel });
      expect(appended.isError).toBeFalsy();
      const ingested = await callCogmemMcpTool('cogmem_recall', { projectId: 'guard', agentId: 'guard', query: 'Orion' }, { kernel });
      const ingestedBody = ingested.structuredContent as { suggestedTool?: string; warnings: string[] };
      expect(ingestedBody.warnings).toEqual([]);
      expect(ingestedBody.suggestedTool).toBeUndefined();
    } finally {
      kernel.close();
    }
  });
});
