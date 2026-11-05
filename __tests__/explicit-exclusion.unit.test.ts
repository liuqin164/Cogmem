import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { rememberForHost } from '../src/host/bridge/HostBridge.js';
import {
  EXPLICIT_EXCLUSION_INLINE_CLOSE as CLOSE,
  EXPLICIT_EXCLUSION_INLINE_OPEN as OPEN,
  EXPLICIT_EXCLUSION_WHOLE_TURN as WHOLE,
} from '../src/context/ExplicitExclusion.js';
import { makeTempDir } from './helpers/tmp.js';

const HERMES = { agentId: 'hermes-agent', projectId: 'proj-hermes', sessionId: 'hermes-session', memorySource: 'hermes-plugin' } as never;

function fixture() {
  const dir = makeTempDir('cogmem-explicit-exclusion-');
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  return { kernel, memory: new KernelAgentMemoryBackend(kernel) };
}

/**
 * #133: marked text is never stored — not "stored and hidden". So the check is the store itself, not recall:
 * every text surface in the database is searched for the passage. Recall is asserted as well, but it is the
 * weaker statement.
 */
function storeContains(kernel: ReturnType<typeof createMemoryKernel>, needle: string): string[] {
  const db = kernel.factStore.getDatabase();
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((row) => row.name);
  const hits: string[] = [];
  for (const table of tables) {
    let rows: unknown[];
    try { rows = db.prepare(`SELECT * FROM "${table}"`).all(); } catch { continue; }
    if (JSON.stringify(rows).includes(needle)) hits.push(table);
  }
  return hits;
}

test('a marked span never reaches the store, and the rest of the turn does', async () => {
  const { kernel, memory } = fixture();
  try {
    const secret = 'my private medical note';
    const result = await rememberForHost({ kernel, memory }, {
      sessionId: 's1',
      userText: `Public part before. ${OPEN}${secret}${CLOSE} Public part after.`,
      assistantText: 'Understood.',
    }, {}, HERMES);

    // The passage is nowhere: not the ledger, not a neuron, not the FTS index.
    expect(storeContains(kernel, secret)).toEqual([]);
    // The rest of the same turn landed normally and is recallable.
    expect(storeContains(kernel, 'Public part before.').length).toBeGreaterThan(0);
    const recalled = memory.recall({ agentId: 'hermes-agent', projectId: 'proj-hermes', query: 'public part before', limit: 5 });
    expect(recalled.items.length).toBeGreaterThan(0);
    // The hygiene channel counts the span and holds no content.
    expect(result.hygiene.excludedSpanCount).toBe(1);
    expect(result.hygiene.excludedChars).toBeGreaterThan(0);
    expect(JSON.stringify(result.hygiene)).not.toContain(secret);
  } finally {
    kernel.close();
  }
});

test('sending the same text without the marker stores it, so exclusion leaves no state behind', async () => {
  const { kernel, memory } = fixture();
  try {
    const prose = 'a passage that was excluded once';
    await rememberForHost({ kernel, memory }, { sessionId: 's1', userText: `${OPEN}${prose}${CLOSE}`, assistantText: 'ok' }, {}, HERMES);
    expect(storeContains(kernel, prose)).toEqual([]);
    await rememberForHost({ kernel, memory }, { sessionId: 's1', userText: prose, assistantText: 'ok', turnId: undefined } as never, {}, HERMES);
    expect(storeContains(kernel, prose).length).toBeGreaterThan(0);
  } finally {
    kernel.close();
  }
});

test('the whole-turn marker keeps the user turn out of the store', async () => {
  const { kernel, memory } = fixture();
  try {
    const prose = 'everything here is off the record';
    const result = await rememberForHost({ kernel, memory }, {
      sessionId: 's1', userText: `${prose} ${WHOLE}`, assistantText: 'ok',
    }, {}, HERMES);
    expect(storeContains(kernel, prose)).toEqual([]);
    expect(result.hygiene.excludedSpanCount).toBe(1);
  } finally {
    kernel.close();
  }
});

test('the marker is read in both payload shapes the hosts send', async () => {
  const { kernel, memory } = fixture();
  try {
    const camel = 'camel case passage';
    const snake = 'snake case passage';
    // camelCase: the shape the plugins send.
    await rememberForHost({ kernel, memory }, {
      sessionId: 's1', userText: `x ${OPEN}${camel}${CLOSE}`, assistantText: 'ok',
      toolCalls: [{ id: 'call-1', name: 'read' }], toolResults: [],
    } as never, {}, HERMES);
    // snake_case: the shape the CLI hosts send for tools; the user text spelling is camelCase in this path.
    await rememberForHost({ kernel, memory }, {
      session_id: 's1', user_text: `y ${OPEN}${snake}${CLOSE}`, assistant_text: 'ok',
      tool_calls: [{ id: 'call-2', name: 'read' }], tool_results: [],
    } as never, {}, HERMES);
    // Both spellings are read and both markers are honoured. Before this was fixed, the snake_case host had
    // its entire user half silently dropped — the turn was stored as a reply to nothing.
    expect(storeContains(kernel, camel)).toEqual([]);
    expect(storeContains(kernel, snake)).toEqual([]);
    expect(storeContains(kernel, 'x ').length).toBeGreaterThan(0);
    expect(storeContains(kernel, 'y ').length).toBeGreaterThan(0);
  } finally {
    kernel.close();
  }
});
