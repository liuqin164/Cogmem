import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { compactStorage } from '../src/storage/StorageCompactor.js';
import { makeTempDir } from './helpers/tmp.js';

test('storage compactor dry-run plans vector pruning without deleting raw ledger evidence', async () => {
  const dir = makeTempDir('cogmem-compact-dry-run-');
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-compact',
    userText: 'Important compact test memory should compile.',
    assistantText: 'Stored.',
    ingestMode: 'selective_compile',
  });
  const [neuron] = kernel.memoryGraph.listNeuronsByTimeRange(0, Date.now() + 10_000, 'demo');
  kernel.memoryGraph.updateNeuronStatus(neuron.id, 'cold');

  const beforeEvents = kernel.eventStore.getEventCount();
  const beforeVectors = kernel.vectorStore.getCurrentCount();
  kernel.close();

  const result = compactStorage({
    dbPath: join(dir, 'memory.db'),
    dryRun: true,
    statuses: ['cold'],
  });

  expect(result.rawEventsBefore).toBe(beforeEvents);
  expect(result.rawEventsAfter).toBe(beforeEvents);
  expect(result.rawEventsDeleted).toBe(0);
  expect(result.vectorCountBefore).toBe(beforeVectors);
  expect(result.eligibleVectorCount).toBe(1);
  expect(result.vectorsDeleted).toBe(0);
  expect(result.dryRun).toBe(true);
});

test('storage compactor apply deletes only eligible vectors and preserves raw ledger replay', async () => {
  const dir = makeTempDir('cogmem-compact-apply-');
  const dbPath = join(dir, 'memory.db');
  const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-compact',
    userText: 'Important compact apply memory should compile.',
    assistantText: 'Stored.',
    ingestMode: 'selective_compile',
  });
  const [neuron] = kernel.memoryGraph.listNeuronsByTimeRange(0, Date.now() + 10_000, 'demo');
  kernel.memoryGraph.updateNeuronStatus(neuron.id, 'archived');
  const rawBefore = kernel.getThreadEvents('session-compact').map((event) => event.payload.text);
  kernel.close();

  const result = compactStorage({
    dbPath,
    dryRun: false,
    statuses: ['archived'],
  });

  const reopened = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  expect(result.vectorsDeleted).toBe(1);
  expect(result.rawEventsDeleted).toBe(0);
  expect(reopened.vectorStore.getCurrentCount()).toBe(0);
  expect(reopened.getThreadEvents('session-compact').map((event) => event.payload.text)).toEqual(rawBefore);
  reopened.close();
});
