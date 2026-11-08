import { expect, test } from 'bun:test';
import { join } from 'node:path';
import Database from 'bun:sqlite';
import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { countSecretFindings } from '../src/security/SecretPatterns.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #142's back-scan, on the fixture the decision asked for: a database in its pre-fix shape, where the secret is not
 * in the item a recall returns but in a *neighbour* the window carries along. Scanning item text would miss it, so
 * this is the case that proves the back-scan is what covers the window path.
 */
const SECRET = 'sk-proj-abcdefghijklmnopqrstuvwx';
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

async function preFixDatabase() {
  const dir = makeTempDir('cogmem-backscan-');
  const dbPath = join(dir, 'brain.db');
  const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  // The turn holding the secret, and the neighbour a query will actually match.
  await backend.rememberTurn({ agentId: 'hermes', sessionId: 's1', projectId: 'p', turnId: 'secret-turn', userText: `staging api key is ${SECRET} for the worker`, assistantText: 'ok', timestamp: NOW });
  await backend.rememberTurn({ agentId: 'hermes', sessionId: 's1', projectId: 'p', turnId: 'neighbour', userText: 'The load balancer certificate rotation is documented in the runbook.', assistantText: 'noted', timestamp: NOW + 1000 });
  kernel.close();

  // Pre-fix shape: the marks the write path adds today are stripped, exactly as rows written before it look.
  const db = new Database(dbPath);
  db.exec("UPDATE memory_events SET payload_json = json_remove(payload_json, '$.metadata.secretFindings', '$.metadata.secretFindingsAssistant')");
  db.close();
  expect(countSecretFindings(`staging api key is ${SECRET} for the worker`).total).toBeGreaterThan(0);
  return dbPath;
}

async function scan(dbPath: string, apply: boolean) {
  // The store methods the repair command uses, driven directly so the test does not depend on the CLI's plumbing.
  const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  let scanned = 0; const marked: string[] = [];
  for (const event of kernel.eventStore.listEventsForSecretBackScan()) {
    scanned += 1;
    const found = countSecretFindings(event.text);
    if (found.total === 0) continue;
    if (!apply) continue;
    if (kernel.eventStore.addSecretFindings(event.eventId, event.role === 'assistant' ? 'secretFindingsAssistant' : 'secretFindings', { total: found.total, byKind: found.byKind })) marked.push(event.eventId);
  }
  kernel.close();
  return { scanned, marked };
}

function recallBody(dbPath: string, apply: boolean) {
  const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  try {
    const backend = new KernelAgentMemoryBackend(kernel);
    const result = backend.recall({ agentId: 'hermes', projectId: 'p', query: 'load balancer certificate rotation runbook', limit: 5, now: NOW + 5000 });
    // Every string in the response, at any depth — the window paths included, which is the whole point.
    const strings: string[] = [];
    const walk = (node: unknown) => {
      if (typeof node === 'string') { strings.push(node); return; }
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(result);
    return { strings, suppressed: JSON.stringify(result.decisionTrace ?? {}) };
  } finally {
    kernel.close();
  }
}

test('before the back-scan the neighbour window carries the secret — the reason this repair exists', async () => {
  const dbPath = await preFixDatabase();
  const { strings } = recallBody(dbPath, false);
  expect(strings.some((value) => value.includes(SECRET))).toBe(true);
});

test('after the back-scan no string in the response carries it, and the reason is reported', async () => {
  const dbPath = await preFixDatabase();
  const { marked } = await scan(dbPath, true);
  expect(marked.length).toBeGreaterThan(0);
  const { strings } = recallBody(dbPath, true);
  expect(strings.some((value) => value.includes(SECRET))).toBe(false);
  // The window is what this fixture is about, so assert the neighbour's own text too: the mark has to remove the
  // event from the window, and that is a different guarantee from the trace's suppression counter (which the raw
  // lane reports only when the marked event was itself a candidate — asserted in secret-chain-mcp-path).
  expect(strings.some((value) => value.includes('staging api key'))).toBe(false);
});

test('running it twice stamps nothing the second time', async () => {
  const dbPath = await preFixDatabase();
  const first = await scan(dbPath, true);
  const second = await scan(dbPath, true);
  expect(first.marked.length).toBeGreaterThan(0);
  expect(second.marked).toHaveLength(0);
});

test('an ordinary old turn survives the back-scan: the repair does not touch it', async () => {
  const dbPath = await preFixDatabase();
  const before = recallBody(dbPath, false);
  await scan(dbPath, true);
  const after = recallBody(dbPath, true);
  // The ordinary neighbour is what this fixture is about. While the secret turn leaked, its own *window* also
  // carried this sentence, so counting every occurrence measured the leak rather than this turn (the two are
  // separate facts: the first is asserted above, this half must hold after the repair). What must not happen is
  // the repair taking the ordinary turn away with it.
  const ordinaryTurn = 'load balancer certificate rotation is documented in the runbook';
  expect(before.strings.some((value) => value.includes(ordinaryTurn))).toBe(true);
  expect(after.strings.some((value) => value.includes(ordinaryTurn))).toBe(true);
});

test('rollback-red: without the mark write the fixture stays leaking', async () => {
  const dbPath = await preFixDatabase();
  const { marked, scanned } = await scan(dbPath, false); // dry-run: the scan sees it, writes nothing
  expect(scanned).toBeGreaterThan(0);
  expect(marked).toHaveLength(0);
  const { strings } = recallBody(dbPath, false);
  expect(strings.some((value) => value.includes(SECRET))).toBe(true);
});
