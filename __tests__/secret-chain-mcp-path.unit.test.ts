import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #142: the secret chain has to hold on the write path that does not go through a host adapter.
 *
 * Found by the stress phase: a `cogmem_remember_turn` over MCP reached the ledger unmarked, so `cogmem_recall`
 * handed the key back verbatim. The mark is now written where the ledger is appended, and a compiled item — which
 * is not an event and carries no mark — is checked by its own text.
 *
 * The value below is one the detector is known to catch. That mattered: an earlier probe used a value the
 * patterns do not match, so `suppressed` was legitimately empty and a broken fixture read as a leak.
 */
const SECRET = 'sk-proj-abcdefghijklmnopqrstuvwx';

async function seeded() {
  const dir = makeTempDir('cogmem-secret-mcp-');
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  return { kernel, backend };
}

test('a secret written through the backend is stored, marked and never returned', async () => {
  const { kernel, backend } = await seeded();
  try {
    const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
    await backend.rememberTurn({
      agentId: 'hermes', sessionId: 's1', projectId: 'p', turnId: 't1',
      userText: `the staging api key is ${SECRET} for the worker`, assistantText: 'ok', timestamp: NOW,
    });
    const result = backend.recall({ agentId: 'hermes', projectId: 'p', query: 'staging api key worker', limit: 5, now: NOW + 1000 });
    const body = JSON.stringify(result);
    // Nothing in the response carries the value: not an item's text, not a window's anchor, not a neighbour.
    expect(body.includes(SECRET)).toBe(false);
    // And the reason is reported rather than left for the caller to guess.
    expect(JSON.stringify(result.decisionTrace)).toContain('secret_bearing_withheld');
  } finally {
    kernel.close();
  }
});

test('an ordinary turn is unaffected, so the mark is not a blanket suppression', async () => {
  const { kernel, backend } = await seeded();
  try {
    const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
    await backend.rememberTurn({
      agentId: 'hermes', sessionId: 's1', projectId: 'p', turnId: 't2',
      userText: 'The billing service deploy window is Tuesday at 02:00.', assistantText: 'noted', timestamp: NOW,
    });
    const result = backend.recall({ agentId: 'hermes', projectId: 'p', query: 'billing service deploy window', limit: 5, now: NOW + 1000 });
    expect(JSON.stringify(result).includes('billing service')).toBe(true);
    expect(JSON.stringify(result.decisionTrace ?? {})).not.toContain('secret_bearing_withheld');
  } finally {
    kernel.close();
  }
});
